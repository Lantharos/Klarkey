import type { ItemDetails } from '@/shared/types'

export function ItemDetailOverview({ item }: { item?: ItemDetails }) {
  if (!item?.passkeys.length && !item?.ssoProvider) {
    return null
  }

  return (
    <div className="px-5 py-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-1 text-[14px]">
        {item.ssoProvider ? (
          <>
            <div className="text-white/38">Sign in with</div>
            <div className="min-w-0">
              <div className="text-white/78">{item.ssoProvider}</div>
            </div>
          </>
        ) : null}
        {item.passkeys.length ? (
          <>
            {item.ssoProvider ? <div className="text-white/38">{item.passkeys.length === 1 ? 'Passkey' : 'Passkeys'}</div> : null}
            <div className="min-w-0">
              <div className="text-white/78">{item.passkeys.length === 1 ? 'Attached' : `${item.passkeys.length} attached`}</div>
              {item.passkeys.length === 1 ? (
                <div className="truncate text-[13px] text-white/42">
                  {[item.passkeys[0].userName, item.passkeys[0].rpId].filter(Boolean).join(' / ') || item.passkeys[0].label}
                </div>
              ) : (
                <div className="truncate text-[13px] text-white/42">{item.passkeys[0].rpId}</div>
              )}
            </div>
          </>
        ) : null}
      </div>
      <div className="palette-glass-divider mt-3" />
    </div>
  )
}
