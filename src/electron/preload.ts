import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@/electron/constants'
import type { KlarkeyApi } from '@/shared/ipc'
import { decodeBase64Url, encodeBase64Url } from '@/shared/passkey-encoding'
import { PASSKEY_RP_ID, PASSKEY_RP_NAME } from '@/shared/passkeys'
import type { CreateVaultPasskeyInput, ExternalWindowContext, VaultLockInfo } from '@/shared/types'

const createChallenge = () => crypto.getRandomValues(new Uint8Array(32))

const createPasskeyLabel = () =>
  `Klarkey ${new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())}`

const getBrowserPasskeySupport = async () => {
  const browserHasWebAuthn = typeof window !== 'undefined' && 'PublicKeyCredential' in window
  const secureContext = window.isSecureContext
  const platformAuthenticatorAvailable =
    browserHasWebAuthn && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false)
      : false
  const conditionalMediationAvailable =
    browserHasWebAuthn && typeof PublicKeyCredential.isConditionalMediationAvailable === 'function'
      ? await PublicKeyCredential.isConditionalMediationAvailable().catch(() => false)
      : false

  return {
    browserHasWebAuthn,
    secureContext,
    platformAuthenticatorAvailable,
    conditionalMediationAvailable,
  }
}

const createPasskeyCredential = async (label?: string) => {
  const resolvedLabel = label?.trim() || createPasskeyLabel()
  const userId = crypto.getRandomValues(new Uint8Array(32))
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: createChallenge(),
      rp: {
        id: PASSKEY_RP_ID,
        name: PASSKEY_RP_NAME,
      },
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
  } satisfies CreateVaultPasskeyInput
}

const getPasskeyCredential = async (passkeys: VaultPasskeyRecord[]) => {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: createChallenge(),
      rpId: PASSKEY_RP_ID,
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

const formatPasskeyError = (error: unknown) => {
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

const api: KlarkeyApi = {
  palette: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.paletteOpen),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.paletteClose),
  },
  command: {
    parse: (raw) => ipcRenderer.invoke(IPC_CHANNELS.commandParse, raw),
  },
  search: {
    resolve: (request) => ipcRenderer.invoke(IPC_CHANNELS.searchResolve, request),
  },
  action: {
    execute: (actionId, modifier) => ipcRenderer.invoke(IPC_CHANNELS.actionExecute, actionId, modifier),
  },
  item: {
    get: (itemId) => ipcRenderer.invoke(IPC_CHANNELS.itemGet, itemId),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.itemCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.itemUpdate, input),
    delete: (itemId) => ipcRenderer.invoke(IPC_CHANNELS.itemDelete, itemId),
  },
  vault: {
    unlock: () => ipcRenderer.invoke(IPC_CHANNELS.vaultUnlock),
    lockState: () => ipcRenderer.invoke(IPC_CHANNELS.vaultLockState),
    unlockWithHello: () => ipcRenderer.invoke(IPC_CHANNELS.vaultUnlockWithHello),
    unlockWithPassword: (password) => ipcRenderer.invoke(IPC_CHANNELS.vaultUnlockWithPassword, password),
    lock: () => ipcRenderer.invoke(IPC_CHANNELS.vaultLock),
    setupMasterPassword: (password) => ipcRenderer.invoke(IPC_CHANNELS.vaultSetupMasterPassword, password),
    changeMasterPassword: (currentPassword, newPassword) => ipcRenderer.invoke(IPC_CHANNELS.vaultChangeMasterPassword, currentPassword, newPassword),
    removeMasterPassword: (currentPassword) => ipcRenderer.invoke(IPC_CHANNELS.vaultRemoveMasterPassword, currentPassword),
    setPasscode: (passcode) => ipcRenderer.invoke(IPC_CHANNELS.vaultSetPasscode, passcode),
    removePasscode: () => ipcRenderer.invoke(IPC_CHANNELS.vaultRemovePasscode),
    confirmPasscode: (passcode) => ipcRenderer.invoke(IPC_CHANNELS.vaultConfirmPasscode, passcode),
    verifyPasscode: (passcode) => ipcRenderer.invoke(IPC_CHANNELS.vaultVerifyPasscode, passcode),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    set: (update) => ipcRenderer.invoke(IPC_CHANNELS.settingsSet, update),
  },
  passkeys: {
    getSupport: async () => {
      const [browserSupport, systemSupport] = await Promise.all([
        getBrowserPasskeySupport(),
        ipcRenderer.invoke(IPC_CHANNELS.passkeySupport),
      ])

      return {
        ...systemSupport,
        available: browserSupport.browserHasWebAuthn && browserSupport.secureContext,
        secureContext: browserSupport.secureContext,
        platformAuthenticatorAvailable: browserSupport.platformAuthenticatorAvailable,
        conditionalMediationAvailable: browserSupport.conditionalMediationAvailable,
      }
    },
    list: () => ipcRenderer.invoke(IPC_CHANNELS.passkeyList),
    create: async (label) => {
      const support = await api.passkeys.getSupport()
      if (!support.available) {
        return {
          status: 'error',
          title: 'Passkeys unavailable',
          message: 'This build is not running in a secure WebAuthn context yet.',
        }
      }

      try {
        const payload = await createPasskeyCredential(label)
        return await ipcRenderer.invoke(IPC_CHANNELS.passkeyCreate, payload)
      } catch (error) {
        return {
          status: 'error',
          title: 'Passkey setup failed',
          message: formatPasskeyError(error),
        }
      }
    },
    authenticate: async () => {
      const support = await api.passkeys.getSupport()
      if (!support.available) {
        return {
          status: 'error',
          title: 'Passkeys unavailable',
          message: 'This build is not running in a secure WebAuthn context yet.',
        }
      }

      const passkeys = await ipcRenderer.invoke(IPC_CHANNELS.passkeyList) as VaultPasskeyRecord[]
      if (passkeys.length === 0) {
        return {
          status: 'error',
          title: 'No passkeys yet',
          message: 'Create a Klarkey passkey before trying to verify one.',
        }
      }

      try {
        const credentialId = await getPasskeyCredential(passkeys)
        return await ipcRenderer.invoke(IPC_CHANNELS.passkeyAuthenticate, credentialId)
      } catch (error) {
        return {
          status: 'error',
          title: 'Passkey verification failed',
          message: formatPasskeyError(error),
        }
      }
    },
    save: (input) => ipcRenderer.invoke(IPC_CHANNELS.passkeyCreate, input),
    remove: (passkeyId) => ipcRenderer.invoke(IPC_CHANNELS.passkeyDelete, passkeyId),
  },
  targetWindow: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.paletteTargetGet),
  },
  onPrepareOpen: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.palettePrepare, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.palettePrepare, listener)
  },
  onFocusRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.paletteFocus, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.paletteFocus, listener)
  },
  onTargetWindowChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, context: ExternalWindowContext) => callback(context)
    ipcRenderer.on(IPC_CHANNELS.paletteTargetChanged, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.paletteTargetChanged, listener)
  },
  onLockStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, info: VaultLockInfo) => callback(info)
    ipcRenderer.on(IPC_CHANNELS.vaultLockState, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.vaultLockState, listener)
  },
}

const isDev = window.location.protocol === 'http:' || window.location.hostname === 'localhost' || window.location.port === '5173'

if (isDev) {
  api.dev = {
    forceLock: () => ipcRenderer.invoke(IPC_CHANNELS.devForceLock),
    forceUnlock: () => ipcRenderer.invoke(IPC_CHANNELS.devForceUnlock),
    forcePasscode: () => ipcRenderer.invoke(IPC_CHANNELS.devForcePasscode),
    dumpLockInfo: () => ipcRenderer.invoke(IPC_CHANNELS.devDumpLockInfo),
    resetVault: () => ipcRenderer.invoke(IPC_CHANNELS.devResetVault),
  }
}

contextBridge.exposeInMainWorld('klarkey', api)
