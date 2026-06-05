import { decodeBase64Url, encodeBase64Url } from '@/shared/passkey-encoding'
import { PASSKEY_RP_ID, PASSKEY_RP_NAME } from '@/shared/passkeys'
import type { KlarkeyApi } from '@/shared/ipc'
import type { ActionExecutionResult, CreateVaultPasskeyInput, PasskeySupport, VaultPasskeyRecord } from '@/shared/types'

const createChallenge = () => crypto.getRandomValues(new Uint8Array(32))
const localhostNames = new Set(['localhost', 'desktop.localhost'])

const createPasskeyLabel = () =>
  `Klarkey ${new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())}`

export async function getDevicePasskeySupport(platform: NodeJS.Platform | 'unknown'): Promise<PasskeySupport> {
  const browserHasWebAuthn = typeof window !== 'undefined' && 'PublicKeyCredential' in window
  const relyingPartyId = currentRelyingPartyId()
  const platformAuthenticatorAvailable =
    browserHasWebAuthn && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
      : false
  const conditionalMediationAvailable =
    browserHasWebAuthn && typeof PublicKeyCredential.isConditionalMediationAvailable === 'function'
      ? await PublicKeyCredential.isConditionalMediationAvailable().catch(() => false)
      : false

  return {
    available: browserHasWebAuthn && window.isSecureContext && isUsableRelyingPartyId(relyingPartyId),
    secureContext: window.isSecureContext,
    platformAuthenticatorAvailable,
    conditionalMediationAvailable,
    platform,
    safeStorageAvailable: false,
    relyingPartyId,
    origin: `${location.protocol}//${location.host}`,
  }
}

export async function createVaultPasskeyCredential(label?: string): Promise<CreateVaultPasskeyInput> {
  const resolvedLabel = label?.trim() || createPasskeyLabel()
  const userId = crypto.getRandomValues(new Uint8Array(32))
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: createChallenge(),
      rp: { id: currentRelyingPartyId(), name: PASSKEY_RP_NAME },
      user: {
        id: userId,
        name: `vault-${encodeBase64Url(userId)}@klarkey.local`,
        displayName: resolvedLabel,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('No passkey credential was returned by the provider.')
  }

  const response = credential.response as AuthenticatorAttestationResponse
  return {
    label: resolvedLabel,
    credentialId: encodeBase64Url(credential.rawId),
    transports: response.getTransports?.() ?? [],
  }
}

export async function getVaultPasskeyCredential(passkeys: VaultPasskeyRecord[]) {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: createChallenge(),
      rpId: currentRelyingPartyId(),
      allowCredentials: passkeys.map((passkey) => ({
        id: decodeBase64Url(passkey.credentialId),
        type: 'public-key',
        transports: passkey.transports as AuthenticatorTransport[],
      })),
      userVerification: 'preferred',
      timeout: 60_000,
    },
  })

  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('No passkey assertion was returned by the provider.')
  }

  return encodeBase64Url(credential.rawId)
}

function currentRelyingPartyId() {
  return location.hostname.trim().toLowerCase() || PASSKEY_RP_ID
}

function isUsableRelyingPartyId(value: string) {
  return localhostNames.has(value) || (value.includes('.') && !/^\d+(\.\d+){3}$/.test(value))
}

export function formatPasskeyError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'The passkey prompt was cancelled or timed out.'
    }
    if (error.name === 'InvalidStateError') {
      return 'This passkey is already enrolled for Klarkey on this device.'
    }
    if (error.name === 'SecurityError') {
      return 'Passkeys require a secure app origin. Restart Klarkey after the update if this persists.'
    }
    return error.message
  }

  return error instanceof Error ? error.message : 'Passkey operation failed.'
}

type DevicePasskeyState = {
  vaultPasskeys: VaultPasskeyRecord[]
}

type DevicePasskeyAccess<State extends DevicePasskeyState> = {
  platform: NodeJS.Platform | 'unknown'
  loadState: () => State
  saveState: (state: State) => void
  requireUnlocked: () => boolean
  lockedResult: () => ActionExecutionResult
  id: (prefix: string) => string
  now: () => string
}

export function createDevicePasskeyApi<State extends DevicePasskeyState>(
  access: DevicePasskeyAccess<State>,
): KlarkeyApi['passkeys'] {
  return {
    getSupport: () => getDevicePasskeySupport(access.platform),
    list: async () => access.requireUnlocked() ? access.loadState().vaultPasskeys : [],
    create: async (label) => {
      if (!access.requireUnlocked()) return access.lockedResult()
      const support = await getDevicePasskeySupport(access.platform)
      if (!support.available) {
        return { status: 'error', title: 'Passkeys unavailable', message: 'This app is not running in a secure WebAuthn context yet.' }
      }
      try {
        const input = await createVaultPasskeyCredential(label)
        return saveVaultPasskey(access, input)
      } catch (error) {
        return { status: 'error', title: 'Passkey setup failed', message: formatPasskeyError(error) }
      }
    },
    authenticate: async () => {
      if (!access.requireUnlocked()) return access.lockedResult()
      const passkeys = access.loadState().vaultPasskeys
      if (passkeys.length === 0) {
        return { status: 'error', title: 'No passkeys yet', message: 'Create a Klarkey passkey before trying to verify one.' }
      }
      try {
        const credentialId = await getVaultPasskeyCredential(passkeys)
        return touchVaultPasskey(access, credentialId)
      } catch (error) {
        return { status: 'error', title: 'Passkey verification failed', message: formatPasskeyError(error) }
      }
    },
    save: (input) => Promise.resolve(saveVaultPasskey(access, input)),
    remove: (passkeyId) => Promise.resolve(removeVaultPasskey(access, passkeyId)),
  }
}

function saveVaultPasskey<State extends DevicePasskeyState>(
  access: DevicePasskeyAccess<State>,
  input: CreateVaultPasskeyInput,
): ActionExecutionResult {
  if (!access.requireUnlocked()) return access.lockedResult()
  const state = access.loadState()
  const label = input.label.trim() || 'Klarkey passkey'
  const existing = state.vaultPasskeys.find((passkey) => passkey.credentialId === input.credentialId)
  if (existing) {
    existing.label = label
    existing.transports = input.transports ?? []
    existing.lastUsedAt = access.now()
    access.saveState(state)
    return { status: 'success', title: 'Passkey ready', message: `${label} is already enrolled on this device.` }
  }
  state.vaultPasskeys.push({ id: access.id('vault_passkey'), createdAt: access.now(), lastUsedAt: access.now(), ...input, label })
  access.saveState(state)
  return { status: 'success', title: 'Passkey created', message: `${label} can now verify this Klarkey vault.` }
}

function touchVaultPasskey<State extends DevicePasskeyState>(
  access: DevicePasskeyAccess<State>,
  credentialId: string,
): ActionExecutionResult {
  const state = access.loadState()
  const current = state.vaultPasskeys.find((passkey) => passkey.credentialId === credentialId)
  if (!current) {
    return { status: 'error', title: 'Passkey missing', message: 'That passkey is not enrolled in this vault yet.' }
  }
  current.lastUsedAt = access.now()
  access.saveState(state)
  return { status: 'success', title: 'Passkey verified', message: `${current.label} completed a passkey check.` }
}

function removeVaultPasskey<State extends DevicePasskeyState>(
  access: DevicePasskeyAccess<State>,
  passkeyId: string,
): ActionExecutionResult {
  if (!access.requireUnlocked()) return access.lockedResult()
  const state = access.loadState()
  const current = state.vaultPasskeys.find((passkey) => passkey.id === passkeyId)
  state.vaultPasskeys = state.vaultPasskeys.filter((passkey) => passkey.id !== passkeyId)
  access.saveState(state)
  return { status: 'success', title: 'Passkey removed', message: `${current?.label ?? 'Passkey'} was removed.` }
}
