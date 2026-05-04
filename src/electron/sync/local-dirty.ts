import { hashPlainRecord } from '@/electron/sync/crypto'
import type { SyncRecordState } from '@/electron/sync/state'
import type { PlainVaultRecord } from '@/shared/sync'

export type DirtyLocalRecord = {
  record: PlainVaultRecord
  contentHash: string
}

export function buildDirtyLocalRecordMap(records: PlainVaultRecord[], states: SyncRecordState[]) {
  const stateByRecordId = new Map(states.map((state) => [state.recordId, state]))
  const dirtyRecords = new Map<string, DirtyLocalRecord>()

  for (const record of records) {
    const contentHash = hashPlainRecord(record)
    if (stateByRecordId.get(record.recordId)?.contentHash === contentHash) {
      continue
    }

    dirtyRecords.set(record.recordId, {
      record,
      contentHash,
    })
  }

  return dirtyRecords
}

function deletedItemRecord(state: SyncRecordState, deletedAt: number): PlainVaultRecord | undefined {
  const itemId = state.itemId ?? state.recordId.slice('item:'.length)
  if (!itemId) {
    return undefined
  }

  return {
    kind: 'item',
    recordId: state.recordId,
    itemId,
    itemType: 'login',
    item: {
      itemId,
      itemType: 'login',
      itemName: 'Deleted item',
      password: '',
      preserveEmptyPassword: true,
    },
    updatedAt: new Date(deletedAt).toISOString(),
    deletedAt,
  }
}

function deletedSitePasskeyRecord(state: SyncRecordState, deletedAt: number): PlainVaultRecord | undefined {
  const credentialId = state.credentialId ?? state.recordId.slice('site-passkey:'.length)
  if (!credentialId) {
    return undefined
  }

  return {
    kind: 'site-passkey',
    recordId: `site-passkey:${credentialId}`,
    passkeyId: credentialId,
    itemId: state.itemId ?? 'deleted',
    credentialId,
    label: 'Deleted passkey',
    transports: [],
    signCount: 0,
    createdAt: new Date(deletedAt).toISOString(),
    syncedCounter: true,
    deletedAt,
  }
}

export function buildMissingDeletedRecords(activeRecords: PlainVaultRecord[], states: SyncRecordState[], deletedAt = Date.now()) {
  const activeRecordIds = new Set(activeRecords.map((record) => record.recordId))
  return states.flatMap((state): PlainVaultRecord[] => {
    if (state.deletedAt || activeRecordIds.has(state.recordId)) {
      return []
    }

    if (state.kind === 'item' || (!state.kind && state.recordId.startsWith('item:'))) {
      const record = deletedItemRecord(state, deletedAt)
      return record ? [record] : []
    }

    if (state.kind === 'site-passkey' || (!state.kind && state.recordId.startsWith('site-passkey:'))) {
      const record = deletedSitePasskeyRecord(state, deletedAt)
      return record ? [record] : []
    }

    return []
  })
}
