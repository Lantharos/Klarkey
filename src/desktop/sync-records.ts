import { recordFromItemDetails, type PlainVaultRecord } from '@/shared/sync'
import type { ItemDetails, UserSettings } from '@/shared/types'

type VaultRecordState = {
  items: ItemDetails[]
  settings: UserSettings
  sitePasskeys: unknown[]
}

type DeletedRecordState = {
  recordId: string
  kind?: PlainVaultRecord['kind']
  itemId?: string
  credentialId?: string
  deletedAt?: number
}

export function recordsFromState(state: VaultRecordState): PlainVaultRecord[] {
  return [
    ...state.items.map((item) => recordFromItemDetails(item, item.updatedAt || new Date().toISOString())),
    ...state.sitePasskeys.flatMap(sitePasskeyRecord),
    { kind: 'settings', recordId: 'settings:user', settings: state.settings, updatedAt: new Date().toISOString() },
  ]
}

function sitePasskeyRecord(value: unknown): PlainVaultRecord[] {
  const passkey = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  const credentialId = stringField(passkey, 'credentialId')
  const itemId = stringField(passkey, 'itemId')
  if (!credentialId || !itemId) return []
  return [{
    kind: 'site-passkey',
    recordId: `site-passkey:${credentialId}`,
    passkeyId: stringField(passkey, 'id') ?? credentialId,
    itemId,
    credentialId,
    label: stringField(passkey, 'label') ?? 'Saved passkey',
    rpId: stringField(passkey, 'rpId'),
    userName: stringField(passkey, 'userName'),
    userHandle: stringField(passkey, 'userHandle'),
    transports: arrayStrings(passkey?.transports),
    privateKeyJwk: validPrivateKeyJwk(passkey?.privateKeyJwk),
    signCount: typeof passkey?.signCount === 'number' ? passkey.signCount : 0,
    createdAt: stringField(passkey, 'createdAt') ?? new Date().toISOString(),
    lastUsedAt: stringField(passkey, 'lastUsedAt'),
    syncedCounter: true,
  }]
}

export function missingDeletedRecords(activeRecords: PlainVaultRecord[], states: DeletedRecordState[]) {
  const activeIds = new Set(activeRecords.map((record) => record.recordId))
  return states.flatMap((state): PlainVaultRecord[] => {
    if (state.deletedAt || activeIds.has(state.recordId)) return []
    const deletedAt = Date.now()
    if (state.kind === 'item' || state.recordId.startsWith('item:')) {
      const itemId = state.itemId ?? state.recordId.slice('item:'.length)
      return [{ kind: 'item', recordId: state.recordId, itemId, itemType: 'login', item: { itemId, itemType: 'login', itemName: 'Deleted item', password: '', preserveEmptyPassword: true }, updatedAt: new Date(deletedAt).toISOString(), deletedAt }]
    }
    if (state.kind === 'site-passkey' || state.recordId.startsWith('site-passkey:')) {
      const credentialId = state.credentialId ?? state.recordId.slice('site-passkey:'.length)
      return [{ kind: 'site-passkey', recordId: `site-passkey:${credentialId}`, passkeyId: credentialId, itemId: state.itemId ?? 'deleted', credentialId, label: 'Deleted passkey', transports: [], signCount: 0, createdAt: new Date(deletedAt).toISOString(), syncedCounter: true, deletedAt }]
    }
    return []
  })
}

export function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function validPrivateKeyJwk(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const jwk = value as JsonWebKey
  return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string' && typeof jwk.d === 'string' ? jwk : undefined
}
