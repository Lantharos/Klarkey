type MergeableState = {
  items: MergeableItem[]
  sitePasskeys: unknown[]
  pendingPasskeys: unknown[]
}

type MergeableItem = {
  itemId: string
  updatedAt?: unknown
}

export function mergeNativeState<State extends MergeableState>(state: State, nativeContents?: string): State {
  if (!nativeContents) return state

  try {
    const native = JSON.parse(nativeContents) as Partial<MergeableState>
    return {
      ...state,
      items: mergeItems(native.items, state.items),
      sitePasskeys: Array.isArray(native.sitePasskeys) ? native.sitePasskeys : state.sitePasskeys,
      pendingPasskeys: Array.isArray(native.pendingPasskeys) ? native.pendingPasskeys : state.pendingPasskeys,
    }
  } catch {
    return state
  }
}

function mergeItems<Item extends MergeableItem>(nativeItems: unknown, localItems: Item[]) {
  if (!Array.isArray(nativeItems)) return localItems

  const merged = new Map<string, Item>()
  for (const item of nativeItems) {
    if (isItem(item)) merged.set(item.itemId, item as Item)
  }
  for (const item of localItems) {
    const current = merged.get(item.itemId)
    if (!current || String(item.updatedAt ?? '') >= String(current.updatedAt ?? '')) {
      merged.set(item.itemId, item)
    }
  }
  return Array.from(merged.values())
}

function isItem(value: unknown): value is MergeableItem {
  return typeof value === 'object' && value !== null && typeof (value as { itemId?: unknown }).itemId === 'string'
}
