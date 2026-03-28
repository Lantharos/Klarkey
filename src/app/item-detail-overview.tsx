import type { ItemDetails } from '@/shared/types'

function MetaRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 px-3 py-2.5">
      <div className="text-[13px] text-white/34">{label}</div>
      <div className={mono ? 'truncate font-mono text-[13px] text-white/74' : 'truncate text-[14px] text-white/74'}>{value}</div>
    </div>
  )
}

export function ItemDetailOverview({ item }: { item?: ItemDetails }) {
  if (!item) {
    return null
  }

  if (item.itemType === 'note') {
    return null
  }

  if (item.itemType === 'identity') {
    return null
  }

  const loginRows = [
    item.websites[0] ? <MetaRow key="website" label="Website" value={item.websites[0]} mono /> : null,
    item.notes ? <MetaRow key="notes" label="Notes" value={item.notes} /> : null,
  ].filter(Boolean)

  if (loginRows.length === 0) {
    return null
  }

  return (
    <div className="py-2">
      {loginRows}
    </div>
  )
}
