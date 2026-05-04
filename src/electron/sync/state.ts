import type Database from 'better-sqlite3'
import { id, now } from '@/electron/repository/helpers'
import type { PlainVaultRecord, SyncPushAccepted } from '@/shared/sync'

export interface SyncRecordState {
  recordId: string
  kind?: PlainVaultRecord['kind']
  itemId?: string
  credentialId?: string
  revision: number
  contentHash: string
  serverSequence: number
  deletedAt?: number
}

export type SyncRecordMetadata = Pick<SyncRecordState, 'kind' | 'itemId' | 'credentialId'>

const syncAccountMetadataKey = 'syncAccountAveIdentityId'
const accountScopedMetadataKeys = [
  'lastServerSequence',
  'lastDeviceRegisteredAt',
  'lastSyncAt',
  'lastSyncError',
]

export function syncRecordMetadata(record: PlainVaultRecord): SyncRecordMetadata {
  if (record.kind === 'item') {
    return {
      kind: record.kind,
      itemId: record.itemId,
    }
  }

  if (record.kind === 'site-passkey') {
    return {
      kind: record.kind,
      itemId: record.itemId,
      credentialId: record.credentialId,
    }
  }

  return {
    kind: record.kind,
  }
}

export function getSyncMeta(db: Database.Database, key: string) {
  return (db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key) as { value: string } | undefined)?.value
}

export function setSyncMeta(db: Database.Database, key: string, value: string) {
  db.prepare('INSERT INTO sync_metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function ensureSyncAccountState(db: Database.Database, aveIdentityId: string) {
  if (getSyncMeta(db, syncAccountMetadataKey) === aveIdentityId) {
    return false
  }

  const reset = db.transaction((nextAccountId: string) => {
    db.prepare('DELETE FROM sync_record_state').run()
    db.prepare('DELETE FROM sync_conflicts').run()
    db.prepare(`DELETE FROM sync_metadata WHERE key IN (${accountScopedMetadataKeys.map(() => '?').join(', ')})`).run(...accountScopedMetadataKeys)
    setSyncMeta(db, syncAccountMetadataKey, nextAccountId)
  })
  reset(aveIdentityId)
  return true
}

export function getRecordState(db: Database.Database, recordId: string): SyncRecordState | undefined {
  const row = db.prepare('SELECT recordId, kind, itemId, credentialId, revision, contentHash, serverSequence, deletedAt FROM sync_record_state WHERE recordId = ?').get(recordId) as
    | {
        recordId: string
        kind?: PlainVaultRecord['kind']
        itemId?: string
        credentialId?: string
        revision: number
        contentHash: string
        serverSequence: number
        deletedAt?: number
      }
    | undefined

  return row
}

export function listRecordStates(db: Database.Database): SyncRecordState[] {
  return db.prepare('SELECT recordId, kind, itemId, credentialId, revision, contentHash, serverSequence, deletedAt FROM sync_record_state').all() as SyncRecordState[]
}

export function upsertRecordState(db: Database.Database, state: SyncRecordState) {
  db.prepare(`
    INSERT INTO sync_record_state(recordId, kind, itemId, credentialId, revision, contentHash, serverSequence, updatedAt, deletedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(recordId) DO UPDATE SET
      kind = excluded.kind,
      itemId = excluded.itemId,
      credentialId = excluded.credentialId,
      revision = excluded.revision,
      contentHash = excluded.contentHash,
      serverSequence = excluded.serverSequence,
      updatedAt = excluded.updatedAt,
      deletedAt = excluded.deletedAt
  `).run(
    state.recordId,
    state.kind ?? null,
    state.itemId ?? null,
    state.credentialId ?? null,
    state.revision,
    state.contentHash,
    state.serverSequence,
    now(),
    state.deletedAt ?? null,
  )
}

export function acceptPushedRecords(
  db: Database.Database,
  records: SyncPushAccepted[],
  deletedAtByRecordId = new Map<string, number | undefined>(),
  metadataByRecordId = new Map<string, SyncRecordMetadata>(),
) {
  const transaction = db.transaction((accepted: SyncPushAccepted[]) => {
    for (const record of accepted) {
      const current = getRecordState(db, record.recordId)
      const metadata = metadataByRecordId.get(record.recordId)
      upsertRecordState(db, {
        recordId: record.recordId,
        kind: metadata?.kind ?? current?.kind,
        itemId: metadata?.itemId ?? current?.itemId,
        credentialId: metadata?.credentialId ?? current?.credentialId,
        revision: record.revision,
        contentHash: record.contentHash,
        serverSequence: record.serverSequence,
        deletedAt: deletedAtByRecordId.has(record.recordId) ? deletedAtByRecordId.get(record.recordId) : current?.deletedAt,
      })
    }
  })

  transaction(records)
}

export function countRecordStates(db: Database.Database) {
  return (db.prepare('SELECT COUNT(*) AS count FROM sync_record_state').get() as { count: number }).count
}

export function recordConflict(db: Database.Database, recordId: string, localContentHash: string, remoteContentHash: string) {
  db.prepare(`
    INSERT INTO sync_conflicts(id, recordId, localContentHash, remoteContentHash, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id('sync_conflict'), recordId, localContentHash, remoteContentHash, now())
}

export function countSyncConflicts(db: Database.Database) {
  return (db.prepare('SELECT COUNT(*) AS count FROM sync_conflicts').get() as { count: number }).count
}
