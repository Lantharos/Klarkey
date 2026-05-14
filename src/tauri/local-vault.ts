import { parseCommand } from '@/shared/command'
import type { ExportFormat, ExportOptions, ImportFormat, ImportOptions } from '@/shared/import-export'
import { DEFAULT_SETTINGS, type CreateItemInput, type ItemDetails, type ModifierKey, type SettingsUpdate, type UpdateItemInput, type UserSettings, type VaultLockInfo, type VaultPasskeyRecord, type VaultSnapshot } from '@/shared/types'
import { resolveSearchResponse } from '@/shared/resolver'
import { getTotpCode, parseTotpInput } from '@/shared/totp'
import type { KlarkeyApi } from '@/shared/ipc'
import { copySecret } from '@/tauri/clipboard'
import { createDevicePasskeyApi } from '@/tauri/device-passkeys'
import { exportCsv, exportJson } from '@/tauri/export-vault'
import { parseOnePux } from '@/tauri/import-1pux'
import { parseVaultImport } from '@/tauri/import-vault'
import { lockedResult } from '@/tauri/locked-result'
import { createSecretHash, shouldUpgradeSecretHash, type StoredSecretHash, verifySecretHash } from '@/tauri/secret-hash'
import { mergeNativeState } from '@/tauri/state-merge'
import { bindSyncNormalizer, createTauriSync, type TauriSyncState } from '@/tauri/sync'
import { deleteSystemUnlock, ensureSystemUnlock, startSystemUnlockRefresh, systemUnlockAvailable, systemUnlockSafeStorageAvailable, unlockWithSystem } from '@/tauri/system-unlock'
import { checkUnlockAttempt, recordUnlockFailure, resetUnlockRateLimit } from '@/tauri/unlock-rate-limit'
import { vaultSnapshot } from '@/tauri/vault-snapshot'

type StoredState = {
  items: ItemDetails[]
  settings: UserSettings
  passcodeHash?: StoredSecretHash
  masterPasswordHash?: StoredSecretHash
  systemUnlockEnabled?: boolean
  vaultPasskeys: VaultPasskeyRecord[]
  sitePasskeys: unknown[]; pendingPasskeys: unknown[]
  recents: VaultSnapshot['recents']
  sync?: TauriSyncState
  locked: boolean
}

type VaultStateMetadata = {
  locked?: boolean
  passcodeEnabled?: boolean
  passcodeSet?: boolean
  masterPasswordSet?: boolean
  systemUnlockEnabled?: boolean
  autoLockMinutes?: number
}

const storageKey = 'klarkey.tauri.vault.v1'
const platform = navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Mac') ? 'darwin' : 'linux'
let persistState: ((contents: string) => void) | undefined
let nativeStateContents: string | undefined
let nativeMetadata: VaultStateMetadata | undefined
let stateCache: string | undefined; let nativeStateRefreshStarted = false; let stateLoaded = false; let stateLoadFailed = false
let autoLockTimer: number | undefined
let lockWarningTimer: number | undefined
let lockWarningInterval: number | undefined
let lockWarningSeconds: number | undefined
let markNativeVaultLocked: (() => void) | undefined

const LOCK_WARNING_SECONDS = 30

const id = (prefix: string) => `${prefix}_${crypto.getRandomValues(new Uint32Array(2)).join('')}`
const now = () => new Date().toISOString()

const clone = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value

function emptyState(): StoredState {
  return {
    items: [],
    settings: DEFAULT_SETTINGS,
    vaultPasskeys: [],
    sitePasskeys: [], pendingPasskeys: [],
    recents: [],
    locked: false,
  }
}

function parseState(raw: string | undefined): StoredState {
  if (!raw) return emptyState()
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      items: parsed.items ?? [],
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      passcodeHash: parsed.passcodeHash,
      masterPasswordHash: parsed.masterPasswordHash,
      vaultPasskeys: parsed.vaultPasskeys ?? [],
      sitePasskeys: parsed.sitePasskeys ?? [], pendingPasskeys: parsed.pendingPasskeys ?? [],
      recents: parsed.recents ?? [],
      sync: parsed.sync,
      locked: Boolean(parsed.locked && (parsed.passcodeHash || parsed.masterPasswordHash || parsed.systemUnlockEnabled)),
    }
  } catch {
    return emptyState()
  }
}

function loadState(): StoredState {
  const state = parseState(stateCache)
  if (stateLoadFailed || (!stateLoaded && !stateCache)) state.locked = true
  return state
}

function hasLockMethod(state: StoredState): boolean {
  return Boolean(state.passcodeHash || state.masterPasswordHash || state.systemUnlockEnabled)
}

function strictSystemUnlockRequired(settings: UserSettings): boolean {
  return settings.systemUnlockPolicy !== 'startup' && settings.autoLockMinutes > 0
}

function settingsFromMetadata(metadata: VaultStateMetadata | undefined): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    passcodeEnabled: metadata?.passcodeEnabled ?? DEFAULT_SETTINGS.passcodeEnabled,
    autoLockMinutes: metadata?.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes,
    systemUnlockPolicy: (metadata?.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes) <= 0 ? 'startup' : 'timed',
  }
}

function metadataHasLockMethod(metadata: VaultStateMetadata): boolean {
  return Boolean(metadata.passcodeSet || metadata.masterPasswordSet || metadata.systemUnlockEnabled)
}

function lockStateFromMetadata(metadata: VaultStateMetadata): VaultLockInfo {
  const passcodeEnabled = metadata.passcodeEnabled ?? DEFAULT_SETTINGS.passcodeEnabled
  const passcodeSet = Boolean(metadata.passcodeSet)
  const masterPasswordSet = Boolean(metadata.masterPasswordSet)
  const systemUnlockEnabled = Boolean(metadata.systemUnlockEnabled)
  const shouldPasscode = Boolean(metadata.locked) && passcodeEnabled && passcodeSet
  const systemMethods = systemUnlockEnabled && systemUnlockAvailable() ? ['windowsHello' as const] : []
  const primaryMethods = [...systemMethods, ...(masterPasswordSet ? ['masterPassword' as const] : [])]
  const hasPrimaryMethod = primaryMethods.length > 0

  return {
    state: metadata.locked ? (shouldPasscode ? 'passcode' : hasPrimaryMethod ? 'locked' : 'unlocked') : 'unlocked',
    primaryMethods,
    passcodeEnabled,
    passcodeSet,
    passcodeLength: 4,
    lockWarningSeconds,
    masterPasswordSet,
    autoLockMinutes: metadata.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes,
    safeStorageAvailable: systemUnlockSafeStorageAvailable(),
  }
}

function metadataFromState(state: StoredState): VaultStateMetadata {
  return {
    locked: Boolean(state.locked && hasLockMethod(state)),
    passcodeEnabled: state.settings.passcodeEnabled,
    passcodeSet: Boolean(state.passcodeHash),
    masterPasswordSet: Boolean(state.masterPasswordHash),
    systemUnlockEnabled: Boolean(state.systemUnlockEnabled),
    autoLockMinutes: state.settings.autoLockMinutes,
  }
}

function stopAutoLockTimer() {
  if (autoLockTimer !== undefined) {
    window.clearTimeout(autoLockTimer)
    autoLockTimer = undefined
  }
  if (lockWarningTimer !== undefined) {
    window.clearTimeout(lockWarningTimer)
    lockWarningTimer = undefined
  }
  if (lockWarningInterval !== undefined) {
    window.clearInterval(lockWarningInterval)
    lockWarningInterval = undefined
  }
  lockWarningSeconds = undefined
}

function startAutoLockTimer(state: StoredState) {
  stopAutoLockTimer()
  if (state.locked || !hasLockMethod(state) || state.settings.autoLockMinutes <= 0) {
    return
  }

  const autoLockMs = state.settings.autoLockMinutes * 60_000
  if (autoLockMs > LOCK_WARNING_SECONDS * 1000) {
    lockWarningTimer = window.setTimeout(() => {
      lockWarningSeconds = LOCK_WARNING_SECONDS
      publishLockState()
      lockWarningInterval = window.setInterval(() => {
        if (lockWarningSeconds === undefined) return
        lockWarningSeconds = Math.max(0, lockWarningSeconds - 1)
        publishLockState()
      }, 1000)
    }, autoLockMs - LOCK_WARNING_SECONDS * 1000)
  }

  autoLockTimer = window.setTimeout(() => {
    const current = loadState()
    current.locked = hasLockMethod(current)
    lockStateOnly(current)
    publishLockState()
  }, autoLockMs)
}

function saveState(state: StoredState) {
  const contents = JSON.stringify(mergeNativeState(state, nativeStateContents))
  stateCache = contents; nativeStateContents = contents
  nativeMetadata = metadataFromState(state)
  persistState?.(contents)
  startAutoLockTimer(state)
}

function lockStateOnly(state: StoredState) {
  stopAutoLockTimer()
  state.locked = hasLockMethod(state)
  if (stateCache) {
    stateCache = JSON.stringify(mergeNativeState(state, nativeStateContents))
    nativeStateContents = stateCache
  }
  nativeMetadata = metadataFromState(state)
  markNativeVaultLocked?.()
}

function publishLockState() {
  window.dispatchEvent(new CustomEvent<VaultLockInfo>('klarkey-tauri-lock-state', { detail: lockState() }))
}

function applyNativeState(contents: string | null) {
  stateLoaded = true; stateLoadFailed = false
  if (!contents || contents === nativeStateContents) { publishLockState(); return }
  stateCache = contents; nativeStateContents = contents
  nativeMetadata = metadataFromState(parseState(contents))
  startAutoLockTimer(parseState(contents))
  localStorage.removeItem(storageKey)
  publishLockState()
}

function applyNativeMetadata(metadata: VaultStateMetadata | null) {
  stateLoaded = true; stateLoadFailed = false
  if (!metadata) {
    nativeMetadata = undefined
    publishLockState()
    return
  }
  nativeMetadata = metadata
  publishLockState()
}

function snapshot(): VaultSnapshot {
  const state = loadState()
  return vaultSnapshot(state.items, state.recents)
}

function lockState(): VaultLockInfo {
  if (!stateCache && nativeMetadata) {
    return lockStateFromMetadata(nativeMetadata)
  }

  const state = loadState()
  const shouldPasscode = state.locked && state.settings.passcodeEnabled && Boolean(state.passcodeHash)
  const systemMethods = state.systemUnlockEnabled && systemUnlockAvailable() ? ['windowsHello' as const] : []
  const primaryMethods = [...systemMethods, ...(state.masterPasswordHash ? ['masterPassword' as const] : [])]
  const hasPrimaryMethod = primaryMethods.length > 0
  return {
    state: state.locked ? (shouldPasscode ? 'passcode' : hasPrimaryMethod ? 'locked' : 'unlocked') : 'unlocked',
    primaryMethods,
    passcodeEnabled: state.settings.passcodeEnabled,
    passcodeSet: Boolean(state.passcodeHash),
    passcodeLength: 4,
    lockWarningSeconds,
    masterPasswordSet: Boolean(state.masterPasswordHash),
    autoLockMinutes: state.settings.autoLockMinutes,
    safeStorageAvailable: systemUnlockSafeStorageAvailable(),
  }
}

function requireUnlocked() {
  return lockState().state === 'unlocked'
}

function guardVaultMutation() {
  if (stateLoadFailed || !stateLoaded) return { success: false, message: 'Vault state unavailable.' }
  return requireUnlocked() ? undefined : { success: false, message: lockedResult().message }
}

function itemValue(item: ItemDetails, field: string) {
  if (field === 'password') return item.password
  if (field === 'otp') return item.otp ? getTotpCode(item.otp).value : undefined
  if (field === 'username') return item.username
  if (field === 'content') return item.content
  return undefined
}

function normalizeItem(input: CreateItemInput | UpdateItemInput, current?: ItemDetails): ItemDetails {
  const itemType = input.itemType ?? current?.itemType ?? 'login'
  const itemName = input.itemName?.trim() || current?.itemName || 'Untitled'
  const otpValue = 'otp' in input ? input.otp : undefined
  const parsedOtp = otpValue !== undefined ? parseTotpInput(otpValue, { issuer: itemName, accountName: input.username || current?.username || itemName }) : current?.otp
  return {
    itemId: 'itemId' in input && input.itemId ? input.itemId : current?.itemId ?? id('item'),
    itemType,
    itemName,
    updatedAt: now(),
    username: input.username ?? current?.username ?? '',
    password: 'password' in input ? input.password || undefined : current?.password,
    otp: parsedOtp || undefined,
    fullName: input.fullName ?? current?.fullName,
    firstName: input.firstName ?? current?.firstName,
    middleName: input.middleName ?? current?.middleName,
    lastName: input.lastName ?? current?.lastName,
    company: input.company ?? current?.company,
    jobTitle: input.jobTitle ?? current?.jobTitle,
    birthDate: input.birthDate ?? current?.birthDate,
    email: input.email ?? current?.email,
    phone: input.phone ?? current?.phone,
    address: input.address ?? current?.address,
    addressLine1: input.addressLine1 ?? current?.addressLine1,
    addressLine2: input.addressLine2 ?? current?.addressLine2,
    city: input.city ?? current?.city,
    state: input.state ?? current?.state,
    postalCode: input.postalCode ?? current?.postalCode,
    country: input.country ?? current?.country,
    cardholderName: input.cardholderName ?? current?.cardholderName,
    cardNumber: input.cardNumber ?? current?.cardNumber,
    cardLastFour: (input.cardNumber ?? current?.cardNumber)?.replace(/\D/g, '').slice(-4) || current?.cardLastFour,
    cardExpiry: input.cardExpiry ?? current?.cardExpiry,
    cardExpiryMonth: input.cardExpiryMonth ?? current?.cardExpiryMonth,
    cardExpiryYear: input.cardExpiryYear ?? current?.cardExpiryYear,
    cardCvc: input.cardCvc ?? current?.cardCvc,
    cardBrand: input.cardBrand ?? current?.cardBrand,
    billingPostalCode: input.billingPostalCode ?? current?.billingPostalCode,
    sshAlgorithm: input.sshAlgorithm ?? current?.sshAlgorithm,
    sshFingerprint: input.sshFingerprint ?? current?.sshFingerprint,
    sshPublicKey: input.sshPublicKey ?? current?.sshPublicKey,
    sshPrivateKey: input.sshPrivateKey ?? current?.sshPrivateKey,
    sshComment: input.sshComment ?? current?.sshComment,
    content: input.content ?? current?.content,
    notes: input.notes ?? current?.notes,
    websites: input.websites ?? current?.websites ?? [],
    customFields: input.customFields ?? current?.customFields ?? [],
    recoveryCodes: input.recoveryCodes ?? current?.recoveryCodes ?? [],
    ssoProvider: input.ssoProvider ?? current?.ssoProvider,
    passkeys: current?.passkeys ?? [],
  }
}

function remember(actionId: string, label: string, itemId?: string) {
  const state = loadState()
  state.recents = [
    { id: id('recent'), actionId, itemId, label, usedAt: now() },
    ...state.recents.filter((recent) => recent.actionId !== actionId),
  ].slice(0, 30)
  saveState(state)
}

function importItems(inputs: CreateItemInput[]) {
  const state = loadState()
  for (const input of inputs) state.items.push(normalizeItem(input))
  saveState(state)
  const count = inputs.length
  return { success: true, importedCount: count, skippedCount: 0, errorCount: 0, message: `Imported ${count} item${count === 1 ? '' : 's'}.` }
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function importError(error: unknown) {
  return {
    success: false,
    importedCount: 0,
    skippedCount: 0,
    errorCount: 1,
    message: error instanceof Error && error.message.length <= 180 ? error.message : 'Klarkey could not import that vault file.',
  }
}

export function createLocalVaultApi(nativeCall: <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>): KlarkeyApi {
  const loadNativeState = async () => {
    const contents = await nativeCall<string | null>('load_vault_state')
    if (contents) {
      applyNativeState(contents)
      return true
    }
    const legacy = localStorage.getItem(storageKey)
    if (!legacy) { applyNativeState(null); return true }
    applyNativeState(legacy)
    persistState?.(legacy)
    return true
  }

  const loadNativeMetadata = async () => {
    const metadata = await nativeCall<VaultStateMetadata | null>('load_vault_metadata')
    applyNativeMetadata(metadata)
    return metadata
  }

  const markNativeStateUnavailable = () => {
    stateLoaded = true
    stateLoadFailed = true
    publishLockState()
  }

  const ensureDecryptedState = async () => {
    if (stateCache) return true
    try {
      return await loadNativeState()
    } catch {
      markNativeStateUnavailable()
      return false
    }
  }

  persistState = (contents) => {
    void nativeCall('save_vault_state', { contents }).catch(() => undefined)
  }
  markNativeVaultLocked = () => {
    void nativeCall('lock_vault_metadata').catch(() => undefined)
  }

  void loadNativeMetadata().then((metadata) => {
    if (metadata && metadataHasLockMethod(metadata)) {
      const lockedMetadata = { ...metadata, locked: true }
      applyNativeMetadata(lockedMetadata)
      markNativeVaultLocked?.()
      return
    }
    if (metadata?.locked) {
      return
    }
    return loadNativeState()
  }).catch(() => {
    void loadNativeState().catch(markNativeStateUnavailable)
  })

  if (!nativeStateRefreshStarted) {
    nativeStateRefreshStarted = true
    window.setInterval(() => {
      if (stateCache && !loadState().locked) {
        void loadNativeState().catch(() => {
          stateLoadFailed = true
          publishLockState()
        })
        return
      }
      void loadNativeMetadata().catch(() => undefined)
    }, 2000)
  }
  startSystemUnlockRefresh(nativeCall, publishLockState)
  bindSyncNormalizer(normalizeItem)
  const syncApi = createTauriSync({ nativeCall, loadState, saveState, requireUnlocked, normalizeItem, id, now })

  const api: KlarkeyApi = {
    palette: {
      open: () => nativeCall('palette_open'),
      close: () => nativeCall('palette_close'),
    },
    command: {
      parse: async (raw) => parseCommand(raw),
    },
    search: {
      resolve: async (request) => {
        const locked = !requireUnlocked()
        const safeSnapshot = locked ? { items: [], recents: [] } : snapshot()
        return { ...resolveSearchResponse(safeSnapshot, request.query, { offset: request.offset, limit: request.limit, locked, showDevOptions: true }), locked }
      },
    },
    action: {
      execute: async (actionId: string, modifier: ModifierKey) => {
        if (!requireUnlocked()) return lockedResult()
        const [, itemId, field] = actionId.split(':')
        const item = loadState().items.find((candidate) => candidate.itemId === itemId)
        if (!item) return { status: 'error', title: 'Item missing', message: 'This item could not be found.' }
        const selectedField = modifier === 'control' && actionId.startsWith('open:') ? (item.itemType === 'note' ? 'content' : 'password') : modifier === 'alt' && actionId.startsWith('open:') ? 'password' : field
        const value = itemValue(item, selectedField)
        remember(actionId, item.itemName, item.itemId)
        if (!value) return { status: 'info', title: item.itemName, message: 'No secret is stored for this action.' }
        if (actionId.startsWith('show:') || modifier === 'alt') return { status: 'success', title: selectedField === 'otp' ? 'Current OTP' : 'Secret', message: value, secret: value, itemId: item.itemId }
        const isPaste = actionId.startsWith('paste:')
        const copied = await copySecret(nativeCall, value, isPaste ? 5 : loadState().settings.clearClipboardSeconds)
        if (!isPaste || copied.status === 'error') return copied
        const target = await api.targetWindow.get()
        const pasted = await nativeCall<boolean>('paste_into_target_window', { handle: target?.handle ?? '', value })
        return pasted
          ? { status: 'success', title: 'Value inserted', message: 'Pasted into the active field.' }
          : { status: 'success', title: 'Value ready', message: 'Paste it into the field. Clipboard clears shortly.' }
      },
    },
    desktop: {
      getSupport: () => nativeCall('desktop_support'),
    },
    clipboard: {
      copySecret: (value) => copySecret(nativeCall, value, loadState().settings.clearClipboardSeconds),
    },
    item: {
      get: async (itemId) => requireUnlocked() ? clone(loadState().items.find((item) => item.itemId === itemId)) : undefined,
      create: async (input) => {
        if (!requireUnlocked()) return lockedResult()
        const state = loadState()
        const item = normalizeItem(input)
        state.items.push(item)
        saveState(state)
        return { status: 'success', title: 'Item created', message: `${item.itemName} was saved.`, itemId: item.itemId }
      },
      update: async (input) => {
        if (!requireUnlocked()) return lockedResult()
        const state = loadState()
        const index = state.items.findIndex((item) => item.itemId === input.itemId)
        if (index < 0) return { status: 'error', title: 'Item missing', message: 'This item could not be found.' }
        state.items[index] = normalizeItem(input, state.items[index])
        saveState(state)
        return { status: 'success', title: 'Item updated', message: `${state.items[index].itemName} was updated.`, itemId: input.itemId }
      },
      delete: async (itemId) => {
        if (!requireUnlocked()) return lockedResult()
        const state = loadState()
        const item = state.items.find((candidate) => candidate.itemId === itemId)
        state.items = state.items.filter((candidate) => candidate.itemId !== itemId)
        saveState(state)
        return { status: 'success', title: 'Item deleted', message: `${item?.itemName ?? 'Item'} was deleted.` }
      },
    },
    vault: {
      unlock: async () => ({ status: lockState().state === 'unlocked' ? 'success' : 'locked', title: 'Vault', message: lockState().state === 'unlocked' ? 'Vault ready.' : 'Unlock the vault to continue.' }),
      lockState: async () => lockState(),
      unlockWithHello: async () => {
        if (stateLoadFailed || !stateLoaded) return { success: false, message: 'Vault state unavailable.' }
        const result = await unlockWithSystem(
          nativeCall,
          strictSystemUnlockRequired(stateCache ? loadState().settings : settingsFromMetadata(nativeMetadata)),
        )
        if (result.success) {
          if (!await ensureDecryptedState()) {
            return { success: false, message: 'Vault state unavailable.' }
          }
          const state = loadState()
          state.locked = false
          saveState(state)
          publishLockState()
        }
        return result
      },
      unlockWithPassword: async (password) => {
        if (stateLoadFailed || !stateLoaded) return { success: false, message: 'Vault state unavailable.' }
        if (!await ensureDecryptedState()) return { success: false, message: 'Vault state unavailable.' }
        const blocked = checkUnlockAttempt()
        if (blocked) return blocked
        const state = loadState()
        if (await verifySecretHash(password, state.masterPasswordHash)) {
          if (shouldUpgradeSecretHash(state.masterPasswordHash)) {
            state.masterPasswordHash = await createSecretHash(password)
          }
          resetUnlockRateLimit()
          state.locked = false
          saveState(state)
          publishLockState()
          return { success: true, message: 'Vault unlocked.' }
        }
        recordUnlockFailure()
        return { success: false, message: 'Incorrect master password.' }
      },
      lock: async () => {
        const state = loadState()
        state.locked = hasLockMethod(state)
        lockStateOnly(state)
        publishLockState()
      },
      setupMasterPassword: async (password) => {
        const blocked = guardVaultMutation(); if (blocked) return blocked
        const state = loadState()
        state.masterPasswordHash = await createSecretHash(password)
        state.systemUnlockEnabled = await ensureSystemUnlock(nativeCall) || state.systemUnlockEnabled
        state.locked = false
        saveState(state)
        publishLockState()
        return { success: true, message: 'Master password set.' }
      },
      changeMasterPassword: async (currentPassword, newPassword) => {
        const blocked = guardVaultMutation(); if (blocked) return blocked
        const state = loadState()
        if (!await verifySecretHash(currentPassword, state.masterPasswordHash)) return { success: false, message: 'Incorrect master password.' }
        state.masterPasswordHash = await createSecretHash(newPassword)
        state.systemUnlockEnabled = await ensureSystemUnlock(nativeCall) || state.systemUnlockEnabled
        state.locked = false
        saveState(state)
        publishLockState()
        return { success: true, message: 'Master password changed.' }
      },
      removeMasterPassword: async (currentPassword) => {
        const blocked = guardVaultMutation(); if (blocked) return blocked
        const state = loadState()
        if (!await verifySecretHash(currentPassword, state.masterPasswordHash)) return { success: false, message: 'Incorrect master password.' }
        state.masterPasswordHash = undefined
        if (!state.passcodeHash) {
          state.systemUnlockEnabled = false
          await deleteSystemUnlock(nativeCall)
        }
        saveState(state)
        publishLockState()
        return { success: true, message: 'Master password removed.' }
      },
      setPasscode: async (passcode) => {
        const blocked = guardVaultMutation(); if (blocked) return blocked
        const state = loadState()
        state.passcodeHash = await createSecretHash(passcode)
        state.systemUnlockEnabled = await ensureSystemUnlock(nativeCall) || state.systemUnlockEnabled
        state.settings.passcodeEnabled = true
        saveState(state)
        publishLockState()
        return { success: true, message: 'Passcode set.' }
      },
      removePasscode: async () => {
        const blocked = guardVaultMutation(); if (blocked) return blocked
        const state = loadState()
        state.passcodeHash = undefined
        state.settings.passcodeEnabled = false
        if (!state.masterPasswordHash) {
          state.systemUnlockEnabled = false
          await deleteSystemUnlock(nativeCall)
        }
        saveState(state)
        publishLockState()
        return { success: true, message: 'Passcode removed.' }
      },
      confirmPasscode: async (passcode) => api.vault.verifyPasscode(passcode),
      verifyPasscode: async (passcode) => {
        if (stateLoadFailed || !stateLoaded) return { success: false, message: 'Vault state unavailable.' }
        if (!await ensureDecryptedState()) return { success: false, message: 'Vault state unavailable.' }
        const blocked = checkUnlockAttempt()
        if (blocked) return blocked
        const state = loadState()
        if (await verifySecretHash(passcode, state.passcodeHash)) {
          if (shouldUpgradeSecretHash(state.passcodeHash)) {
            state.passcodeHash = await createSecretHash(passcode)
          }
          resetUnlockRateLimit()
          state.locked = false
          saveState(state)
          publishLockState()
          return { success: true, message: 'Vault unlocked.' }
        }
        recordUnlockFailure()
        return { success: false, message: 'Incorrect passcode.' }
      },
    },
    settings: {
      get: async () => stateCache ? loadState().settings : settingsFromMetadata(nativeMetadata),
      set: async (update: SettingsUpdate) => {
        const state = loadState()
        const normalizedUpdate = {
          ...update,
          ...(update.autoLockMinutes !== undefined
            ? { systemUnlockPolicy: update.autoLockMinutes <= 0 ? 'startup' as const : 'timed' as const }
            : {}),
        }
        state.settings = { ...state.settings, ...normalizedUpdate }
        saveState(state)
        if (update.hotkey) {
          await nativeCall('palette_hotkey_set', { hotkey: update.hotkey })
        }
        return state.settings
      },
    },
    sync: {
      status: syncApi.status,
      signIn: syncApi.signIn,
      signOut: syncApi.signOut,
      syncNow: syncApi.syncNow,
    },
    passkeys: createDevicePasskeyApi({ platform, loadState, saveState, requireUnlocked, lockedResult, id, now }),
    targetWindow: { get: () => nativeCall('palette_target_get') },
    importExport: {
      exportVault: async (options: ExportOptions) => {
        if (!requireUnlocked()) return { success: false, exportedCount: 0, message: lockedResult().message }
        const state = loadState()
        const exportedAt = now()
        const contents = options.format === 'klarkey-json' ? exportJson(state.items, exportedAt) : exportCsv(state.items)
        await nativeCall('write_text_file', { path: options.filePath, contents })
        return { success: true, exportedCount: state.items.length, message: 'Export complete.' }
      },
      importVault: async (options: ImportOptions) => {
        if (!requireUnlocked()) return { success: false, importedCount: 0, skippedCount: 0, errorCount: 0, message: lockedResult().message }
        try {
          const isOnePux = options.format === '1pux' || options.filePath.toLowerCase().endsWith('.1pux')
          const inputs = isOnePux
            ? parseOnePux(base64ToBytes(await nativeCall<string>('read_binary_file', { path: options.filePath })))
            : parseVaultImport(options, await nativeCall<string>('read_text_file', { path: options.filePath }))
          return importItems(inputs)
        } catch (error) {
          return importError(error)
        }
      },
      pickImportFile: (format: ImportFormat) => nativeCall('pick_import_file', { format }),
      pickExportFile: (format: ExportFormat) => nativeCall('pick_export_file', { format }),
    },
    onPrepareOpen: () => () => undefined,
    onFocusRequest: () => () => undefined,
    onTargetWindowChange: () => () => undefined,
    onLockStateChanged: (callback) => {
      const handler = (event: Event) => callback((event as CustomEvent<VaultLockInfo>).detail)
      window.addEventListener('klarkey-tauri-lock-state', handler)
      return () => window.removeEventListener('klarkey-tauri-lock-state', handler)
    },
    onSyncChanged: () => () => undefined,
  }

  void nativeCall('palette_hotkey_set', { hotkey: loadState().settings.hotkey }).catch(() => undefined)

  return api
}
