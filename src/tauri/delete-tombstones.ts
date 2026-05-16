import type { PlainVaultRecord } from '@/shared/sync'
import type { CreateItemInput, ItemDetails, VaultSnapshot } from '@/shared/types'
import type { TauriSyncState } from '@/tauri/sync'

type TombstoneState = {
  deletedItemIds: Record<string, string>
  deletedSitePasskeyIds: Record<string, string>
  sitePasskeys: unknown[]
  recents: VaultSnapshot['recents']
  sync?: TauriSyncState
}

export function deletionMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] =>
      typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  )
}

export function clearDeleteMarkers(state: Pick<TombstoneState, 'deletedItemIds' | 'sync'>, itemId: string) {
  delete state.deletedItemIds[itemId]
  delete state.sync?.pendingDeletes?.[`item:${itemId}`]
}

export function markItemDeleted(state: TombstoneState, itemId: string, item: ItemDetails | undefined) {
  const deletedAt = Date.now()
  const deletedAtIso = new Date(deletedAt).toISOString()
  state.deletedItemIds[itemId] = deletedAtIso
  state.recents = state.recents.filter((recent) => recent.itemId !== itemId)
  const deletedSitePasskeys = state.sitePasskeys.filter((passkey) => stringRecordField(passkey, 'itemId') === itemId)
  state.sitePasskeys = state.sitePasskeys.filter((passkey) => stringRecordField(passkey, 'itemId') !== itemId)
  for (const passkey of deletedSitePasskeys) {
    const credentialId = stringRecordField(passkey, 'credentialId')
    if (credentialId) state.deletedSitePasskeyIds[credentialId] = deletedAtIso
  }
  markSyncItemDeleted(state.sync, item, itemId, deletedAt)
  for (const passkey of deletedSitePasskeys) markSyncSitePasskeyDeleted(state.sync, passkey, deletedAt)
}

function markSyncItemDeleted(sync: TauriSyncState | undefined, item: ItemDetails | undefined, itemId: string, deletedAt: number) {
  const recordId = `item:${itemId}`
  if (!sync || (!sync.session && !sync.records[recordId])) return
  sync.pendingDeletes ??= {}
  sync.pendingDeletes[recordId] = deletedItemRecord(item, itemId, deletedAt)
}

function deletedItemRecord(item: ItemDetails | undefined, itemId: string, deletedAt: number): Extract<PlainVaultRecord, { kind: 'item' }> {
  const itemType = (item?.itemType ?? 'login') as CreateItemInput['itemType']
  return {
    kind: 'item',
    recordId: `item:${itemId}`,
    itemId,
    itemType,
    item: {
      itemId,
      itemType,
      itemName: item?.itemName || 'Deleted item',
      password: '',
      preserveEmptyPassword: true,
    },
    updatedAt: new Date(deletedAt).toISOString(),
    deletedAt,
  }
}

function markSyncSitePasskeyDeleted(sync: TauriSyncState | undefined, passkey: unknown, deletedAt: number) {
  const credentialId = stringRecordField(passkey, 'credentialId')
  if (!credentialId) return
  const recordId = `site-passkey:${credentialId}`
  if (!sync || (!sync.session && !sync.records[recordId])) return
  sync.pendingDeletes ??= {}
  sync.pendingDeletes[recordId] = {
    kind: 'site-passkey',
    recordId,
    passkeyId: stringRecordField(passkey, 'id') ?? credentialId,
    itemId: stringRecordField(passkey, 'itemId') ?? 'deleted',
    credentialId,
    label: stringRecordField(passkey, 'label') ?? 'Deleted passkey',
    transports: arrayRecordStrings(recordField(passkey, 'transports')),
    signCount: 0,
    createdAt: new Date(deletedAt).toISOString(),
    syncedCounter: true,
    deletedAt,
  }
}

function stringRecordField(record: unknown, key: string) {
  const value = recordField(record, key)
  return typeof value === 'string' ? value : undefined
}

function recordField(record: unknown, key: string) {
  return record && typeof record === 'object' ? (record as Record<string, unknown>)[key] : undefined
}

function arrayRecordStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
