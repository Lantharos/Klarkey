import { describe, expect, it } from 'vitest'
import { isStaleSyncConflict, shouldPreserveConflictCopy, tombstoneRecord } from '@/shared/sync-merge'

describe('sync merge helpers', () => {
  it('detects stale record conflicts', () => {
    expect(isStaleSyncConflict({ revision: 4, contentHash: 'remote' }, { revision: 4, contentHash: 'local' })).toBe(true)
    expect(isStaleSyncConflict({ revision: 4, contentHash: 'same' }, { revision: 4, contentHash: 'same' })).toBe(false)
    expect(isStaleSyncConflict({ revision: 3, contentHash: 'remote' }, { revision: 4, contentHash: 'local' })).toBe(false)
  })

  it('preserves conflict copies only when local content differs', () => {
    expect(shouldPreserveConflictCopy('local', 'remote')).toBe(true)
    expect(shouldPreserveConflictCopy('remote', 'remote')).toBe(false)
    expect(shouldPreserveConflictCopy(undefined, 'remote')).toBe(false)
  })

  it('creates tombstones without changing the record id', () => {
    expect(tombstoneRecord({ recordId: 'item:1' }, 123)).toEqual({ recordId: 'item:1', deletedAt: 123 })
  })
})
