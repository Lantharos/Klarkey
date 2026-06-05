type MergeableState = {
  items: MergeableItem[]
  sitePasskeys: unknown[]
  pendingPasskeys: unknown[]
  deletedItemIds?: Record<string, string>
  deletedSitePasskeyIds?: Record<string, string>
}

type MergeableItem = {
  itemId: string
  updatedAt?: unknown
}

type MergeableRecord = Record<string, unknown>

export function mergeNativeState<State extends MergeableState>(state: State, nativeContents?: string): State {
  if (!nativeContents) return state

  try {
    const native = JSON.parse(nativeContents) as Partial<MergeableState>
    const deletedItemIds = mergeDeletionMaps(native.deletedItemIds, state.deletedItemIds)
    const deletedSitePasskeyIds = mergeDeletionMaps(native.deletedSitePasskeyIds, state.deletedSitePasskeyIds)
    return {
      ...state,
      deletedItemIds,
      deletedSitePasskeyIds,
      items: mergeItems(native.items, state.items, deletedItemIds),
      sitePasskeys: mergeRecords(native.sitePasskeys, state.sitePasskeys, 'credentialId', deletedSitePasskeyIds),
      pendingPasskeys: mergeRecords(native.pendingPasskeys, state.pendingPasskeys, 'id'),
    }
  } catch {
    return state
  }
}

function mergeItems<Item extends MergeableItem>(nativeItems: unknown, localItems: Item[], deletedItemIds: Record<string, string>) {
  if (!Array.isArray(nativeItems)) return localItems.filter((item) => !isDeleted(item.itemId, item.updatedAt, deletedItemIds))

  const merged = new Map<string, Item>()
  for (const item of nativeItems) {
    if (isItem(item) && !isDeleted(item.itemId, item.updatedAt, deletedItemIds)) merged.set(item.itemId, item as Item)
  }
  for (const item of localItems) {
    if (isDeleted(item.itemId, item.updatedAt, deletedItemIds)) {
      merged.delete(item.itemId)
      continue
    }
    const current = merged.get(item.itemId)
    if (!current || String(item.updatedAt ?? '') >= String(current.updatedAt ?? '')) {
      merged.set(item.itemId, item)
    }
  }
  return Array.from(merged.values())
}

function mergeRecords(nativeRecords: unknown, localRecords: unknown[], idKey: string, deletedIds: Record<string, string> = {}) {
  if (!Array.isArray(nativeRecords)) return filterDeletedRecords(localRecords, idKey, deletedIds)

  const merged = new Map<string, unknown>()
  let anonymousIndex = 0
  for (const record of nativeRecords) {
    const id = recordId(record, idKey)
    if (!id) {
      merged.set(`native:${anonymousIndex++}`, record)
    } else if (!isDeleted(id, recordUpdatedAt(record), deletedIds)) {
      merged.set(id, record)
    }
  }
  for (const record of localRecords) {
    const id = recordId(record, idKey)
    if (!id) {
      merged.set(`local:${anonymousIndex++}`, record)
      continue
    }
    if (isDeleted(id, recordUpdatedAt(record), deletedIds)) {
      merged.delete(id)
      continue
    }
    merged.set(id, record)
  }
  return Array.from(merged.values())
}

function filterDeletedRecords(records: unknown[], idKey: string, deletedIds: Record<string, string>) {
  return records.filter((record) => {
    const id = recordId(record, idKey)
    return !id || !isDeleted(id, recordUpdatedAt(record), deletedIds)
  })
}

function isItem(value: unknown): value is MergeableItem {
  return typeof value === 'object' && value !== null && typeof (value as { itemId?: unknown }).itemId === 'string'
}

function recordId(value: unknown, key: string) {
  const record = value && typeof value === 'object' ? value as MergeableRecord : undefined
  const id = record?.[key]
  return typeof id === 'string' ? id : undefined
}

function recordUpdatedAt(value: unknown) {
  const record = value && typeof value === 'object' ? value as MergeableRecord : undefined
  return record?.updatedAt ?? record?.lastUsedAt ?? record?.createdAt
}

function mergeDeletionMaps(native: unknown, local: unknown) {
  const merged = deletionMap(native)
  for (const [id, deletedAt] of Object.entries(deletionMap(local))) {
    const current = merged[id]
    if (!current || compareRevision(deletedAt, current) >= 0) merged[id] = deletedAt
  }
  return merged
}

function deletionMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] =>
      typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  )
}

function isDeleted(id: string, updatedAt: unknown, deletedIds: Record<string, string>) {
  const deletedAt = deletedIds[id]
  return Boolean(deletedAt && (!updatedAt || compareRevision(deletedAt, updatedAt) >= 0))
}

function compareRevision(left: unknown, right: unknown) {
  const leftTime = revisionTime(left)
  const rightTime = revisionTime(right)
  if (leftTime !== undefined && rightTime !== undefined) return leftTime - rightTime
  return String(left ?? '').localeCompare(String(right ?? ''))
}

function revisionTime(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
