import type { SyncRecord } from '@/shared/sync'

export function isStaleSyncConflict(existing: Pick<SyncRecord, 'revision' | 'contentHash'>, incoming: Pick<SyncRecord, 'revision' | 'contentHash'>) {
  return existing.revision >= incoming.revision && existing.contentHash !== incoming.contentHash
}

export function shouldPreserveConflictCopy(localContentHash: string | undefined, remoteContentHash: string) {
  return Boolean(localContentHash && localContentHash !== remoteContentHash)
}

export function tombstoneRecord<RecordValue extends object>(record: RecordValue, deletedAt = Date.now()) {
  return {
    ...record,
    deletedAt,
  }
}
