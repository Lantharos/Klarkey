import { describe, expect, it } from 'vitest'
import { mergeNativeState } from '@/desktop/state-merge'

describe('native state merge', () => {
  it('does not resurrect locally deleted items from an older native snapshot', () => {
    const merged = mergeNativeState(
      {
        items: [],
        sitePasskeys: [],
        pendingPasskeys: [],
        deletedItemIds: { item_1: '2026-05-15T12:00:00.000Z' },
      },
      JSON.stringify({
        items: [
          { itemId: 'item_1', itemName: 'Deleted', updatedAt: '2026-05-15T11:59:00.000Z' },
          { itemId: 'item_2', itemName: 'Kept', updatedAt: '2026-05-15T11:58:00.000Z' },
        ],
      }),
    )

    expect(merged.items).toEqual([
      { itemId: 'item_2', itemName: 'Kept', updatedAt: '2026-05-15T11:58:00.000Z' },
    ])
    expect(merged.deletedItemIds.item_1).toBe('2026-05-15T12:00:00.000Z')
  })

  it('keeps a newer local recreation over an older tombstone', () => {
    const merged = mergeNativeState(
      {
        items: [
          { itemId: 'item_1', itemName: 'Recreated', updatedAt: '2026-05-15T12:01:00.000Z' },
        ],
        sitePasskeys: [],
        pendingPasskeys: [],
        deletedItemIds: { item_1: '2026-05-15T12:00:00.000Z' },
      },
      JSON.stringify({
        items: [
          { itemId: 'item_1', itemName: 'Old', updatedAt: '2026-05-15T11:59:00.000Z' },
        ],
      }),
    )

    expect(merged.items).toEqual([
      { itemId: 'item_1', itemName: 'Recreated', updatedAt: '2026-05-15T12:01:00.000Z' },
    ])
  })

  it('filters deleted site passkeys during native merge', () => {
    const merged = mergeNativeState(
      {
        items: [],
        sitePasskeys: [],
        pendingPasskeys: [],
        deletedSitePasskeyIds: { cred_1: '2026-05-15T12:00:00.000Z' },
      },
      JSON.stringify({
        sitePasskeys: [
          { credentialId: 'cred_1', itemId: 'item_1', createdAt: '2026-05-15T11:00:00.000Z' },
          { credentialId: 'cred_2', itemId: 'item_2', createdAt: '2026-05-15T11:00:00.000Z' },
        ],
      }),
    )

    expect(merged.sitePasskeys).toEqual([
      { credentialId: 'cred_2', itemId: 'item_2', createdAt: '2026-05-15T11:00:00.000Z' },
    ])
  })

  it('preserves records without merge ids', () => {
    const merged = mergeNativeState(
      {
        items: [],
        sitePasskeys: [],
        pendingPasskeys: [{ request: 'local' }],
      },
      JSON.stringify({
        pendingPasskeys: [
          { request: 'native' },
        ],
      }),
    )

    expect(merged.pendingPasskeys).toEqual([
      { request: 'native' },
      { request: 'local' },
    ])
  })
})
