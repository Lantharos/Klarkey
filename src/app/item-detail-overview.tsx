import type { ItemDetails } from '@/shared/types'

export function ItemDetailOverview({ item }: { item?: ItemDetails }) {
  if (!item?.passkeys.length) {
    return null
  }

  const passkeyCount = item.passkeys.length
  const latestPasskey = item.passkeys[0]
  const value = passkeyCount === 1 ? 'Attached' : `${passkeyCount} attached`
  const detail =
    passkeyCount === 1
      ? [latestPasskey.userName, latestPasskey.rpId].filter(Boolean).join(' / ') || latestPasskey.label
      : latestPasskey.rpId

  return (
    <div className="px-5 py-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-1 text-[14px]">
        <div className="text-white/38">{passkeyCount === 1 ? 'Passkey' : 'Passkeys'}</div>
        <div className="min-w-0">
          <div className="text-white/78">{value}</div>
          {detail ? <div className="truncate text-[13px] text-white/42">{detail}</div> : null}
        </div>
      </div>
      <div className="mt-3 h-px bg-white/8" />
    </div>
  )
}
