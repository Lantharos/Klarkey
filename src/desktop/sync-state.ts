import type { PlainVaultRecord } from '@/shared/sync'
import { DEFAULT_SETTINGS, type CreateItemInput, type ItemDetails } from '@/shared/types'
import { stringField } from '@/desktop/sync-records'
import type { DesktopSyncState, VaultState } from '@/desktop/sync'

const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|private|privateKey|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

let accessNormalizeItem: (input: CreateItemInput, current?: ItemDetails) => ItemDetails

export function ensureSyncState<State extends VaultState>(state: State) {
  state.sync ??= { deviceId: `device_${randomBase64Url(9)}`, conflictCount: 0, serverSequence: 0, lastDeviceRegisteredAt: 0, records: {} }
  return state.sync
}

export function viewSyncState(state: VaultState): DesktopSyncState {
  return state.sync ?? { deviceId: 'desktop-local', conflictCount: 0, serverSequence: 0, lastDeviceRegisteredAt: 0, records: {} }
}

export function ensureAccountState(sync: DesktopSyncState, accountId: string) {
  if (sync.accountId === accountId) return
  sync.accountId = accountId
  sync.records = {}
  sync.pendingDeletes = {}
  sync.conflictCount = 0
  sync.serverSequence = 0
  sync.lastDeviceRegisteredAt = 0
  sync.lastSyncAt = undefined
}

export function applySyncRecord<State extends VaultState>(state: State, record: PlainVaultRecord) {
  if (record.kind === 'item') {
    state.items = record.deletedAt ? state.items.filter((item) => item.itemId !== record.itemId) : upsertItem(state, record)
  } else if (record.kind === 'settings' && !record.deletedAt) {
    state.settings = { ...DEFAULT_SETTINGS, ...record.settings }
  } else if (record.kind === 'site-passkey') {
    applySitePasskey(state, record)
  }
}

function upsertItem<State extends VaultState>(state: State, record: Extract<PlainVaultRecord, { kind: 'item' }>) {
  const index = state.items.findIndex((item) => item.itemId === record.itemId)
  const item = accessNormalizeItem(record.item, index >= 0 ? state.items[index] : undefined)
  item.updatedAt = record.updatedAt
  if (index < 0) return [...state.items, item]
  const items = [...state.items]
  items[index] = item
  return items
}

function applySitePasskey<State extends VaultState>(state: State, record: Extract<PlainVaultRecord, { kind: 'site-passkey' }>) {
  state.sitePasskeys = record.deletedAt
    ? state.sitePasskeys.filter((passkey) => stringField(passkey as Record<string, unknown>, 'credentialId') !== record.credentialId)
    : [
      ...state.sitePasskeys.filter((passkey) => stringField(passkey as Record<string, unknown>, 'credentialId') !== record.credentialId),
      { id: record.passkeyId, itemId: record.itemId, label: record.label, credentialId: record.credentialId, rpId: record.rpId, userName: record.userName, userHandle: record.userHandle, transports: record.transports, privateKeyJwk: record.privateKeyJwk, signCount: record.signCount, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt },
    ]
  for (const item of state.items) {
    item.passkeys = item.passkeys.filter((passkey) => passkey.credentialId !== record.credentialId)
    if (!record.deletedAt && item.itemId === record.itemId) item.passkeys.push({ id: record.passkeyId, label: record.label, credentialId: record.credentialId, rpId: record.rpId, userName: record.userName, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt })
  }
}

export function preserveSyncConflict<State extends VaultState>(state: State, record: PlainVaultRecord) {
  if (record.kind !== 'item' || record.deletedAt) return
  state.items.push(accessNormalizeItem({ ...record.item, itemId: `item_${randomBase64Url(9)}`, itemName: `${record.item.itemName} conflict copy` }))
}

export function recordMetadata(record: PlainVaultRecord | undefined) {
  if (!record) return {}
  if (record.kind === 'item') return { kind: record.kind, itemId: record.itemId }
  if (record.kind === 'site-passkey') return { kind: record.kind, itemId: record.itemId, credentialId: record.credentialId }
  return { kind: record.kind }
}

export function randomBase64Url(bytes: number) {
  const random = crypto.getRandomValues(new Uint8Array(bytes))
  let binary = ''
  for (const byte of random) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function safeSyncErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  return !message || message.length > 160 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message) ? fallback : message
}

export function platformName() {
  if (navigator.userAgent.includes('Windows')) return 'win32'
  if (navigator.userAgent.includes('Mac')) return 'darwin'
  return 'linux'
}

export function deviceName() {
  return navigator.platform || 'Klarkey Desktop'
}

export function bindSyncNormalizer(normalize: (input: CreateItemInput, current?: ItemDetails) => ItemDetails) {
  accessNormalizeItem = normalize
}
