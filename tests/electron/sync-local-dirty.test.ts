import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDirtyLocalRecordMap, buildMissingDeletedRecords } from '@/electron/sync/local-dirty'
import { hashPlainRecord } from '@/electron/sync/crypto'
import { validatePlainVaultRecord, type PlainVaultRecord } from '@/shared/sync'

const itemRecord = (password: string): Extract<PlainVaultRecord, { kind: 'item' }> => ({
  kind: 'item',
  recordId: 'item:item_1',
  itemId: 'item_1',
  itemType: 'login',
  item: {
    itemId: 'item_1',
    itemType: 'login',
    itemName: 'Example',
    username: 'person@example.com',
    password,
    websites: ['https://example.com'],
    customFields: [],
  },
  updatedAt: '2026-05-04T00:00:00.000Z',
})

describe('desktop sync local dirty record policy', () => {
  it('detects records changed locally since the last accepted sync state', () => {
    const synced = itemRecord('old-password')
    const edited = itemRecord('new-password')

    const dirtyRecords = buildDirtyLocalRecordMap([edited], [{
      recordId: edited.recordId,
      revision: 2,
      contentHash: hashPlainRecord(synced),
      serverSequence: 10,
    }])

    expect(dirtyRecords.get(edited.recordId)).toMatchObject({
      record: edited,
      contentHash: hashPlainRecord(edited),
    })
  })

  it('does not mark records dirty when only ignored sync metadata differs', () => {
    const synced = itemRecord('same-password')
    const withNewUpdatedAt = {
      ...synced,
      updatedAt: '2026-05-04T01:00:00.000Z',
    }

    const dirtyRecords = buildDirtyLocalRecordMap([withNewUpdatedAt], [{
      recordId: synced.recordId,
      revision: 2,
      contentHash: hashPlainRecord(synced),
      serverSequence: 10,
    }])

    expect(dirtyRecords.has(synced.recordId)).toBe(false)
  })

  it('treats unsynced new local records as dirty', () => {
    const created = itemRecord('new-password')

    const dirtyRecords = buildDirtyLocalRecordMap([created], [])

    expect(dirtyRecords.has(created.recordId)).toBe(true)
  })

  it('creates deleted records for missing synced items and site passkeys', () => {
    const deletedAt = 1_777_777_777
    const deletedRecords = buildMissingDeletedRecords([], [
      {
        kind: 'item',
        recordId: 'item:item_1',
        itemId: 'item_1',
        revision: 2,
        contentHash: 'item-hash',
        serverSequence: 10,
      },
      {
        kind: 'site-passkey',
        recordId: 'site-passkey:credential_1',
        itemId: 'item_1',
        credentialId: 'credential_1',
        revision: 2,
        contentHash: 'passkey-hash',
        serverSequence: 11,
      },
    ], deletedAt)

    expect(deletedRecords.map((record) => record.recordId)).toEqual([
      'item:item_1',
      'site-passkey:credential_1',
    ])
    expect(deletedRecords.every(validatePlainVaultRecord)).toBe(true)
    expect(deletedRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'site-passkey',
        itemId: 'item_1',
        credentialId: 'credential_1',
        deletedAt,
      }),
    ]))
  })

  it('preserves dirty local records before applying newer remote pulls', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/sync/manager.ts'), 'utf8')
    const pullRemote = source.slice(source.indexOf('private async pullRemote'), source.indexOf('private async pushLocal'))

    expect(pullRemote).toContain('const dirtyLocalRecords = buildDirtyLocalRecordMap(repository.getSyncRecords(), listRecordStates(this.db))')
    expect(pullRemote).toContain('const dirtyLocalRecord = dirtyLocalRecords.get(encrypted.recordId)')
    expect(pullRemote).toContain('localState?.contentHash && dirtyLocalRecord && dirtyLocalRecord.contentHash !== encrypted.contentHash')
    expect(pullRemote).toContain('repository.preserveSyncConflict(dirtyLocalRecord.record)')
    expect(pullRemote).toContain('recordConflict(this.db, encrypted.recordId, dirtyLocalRecord.contentHash, encrypted.contentHash)')
  })
})
