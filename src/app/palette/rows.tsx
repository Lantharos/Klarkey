import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getCreateTitle } from '@/app/item-type-meta'
import { ReturnHint, RowIcon } from '@/app/palette/chrome'
import { actionKindLabel } from '@/app/palette-utils'
import type { DetailAction } from '@/app/palette-types'
import type { ResolvedAction, TotpDetails } from '@/shared/types'
import { getTotpCode } from '@/shared/totp'

function OtpRowTimer({ otp }: { otp: NonNullable<DetailAction['otp']> }) {
  const [now, setNow] = useState(() => Date.now())
  const code = useMemo(() => getTotpCode(otp, now), [now, otp])
  const warning = code.remainingSeconds <= 5
  const size = 24
  const stroke = 2.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * code.progress

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="relative flex h-6 w-6 items-center justify-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={warning ? 'rgba(248, 113, 113, 0.95)' : 'rgba(255,255,255,0.72)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={clsx('absolute text-[10px] font-medium leading-none', warning ? 'text-red-200' : 'text-white/56')}>
        {code.remainingSeconds}
      </span>
    </div>
  )
}

export function FooterOtpStatus({ otp }: { otp: TotpDetails }) {
  const [now, setNow] = useState(() => Date.now())
  const code = useMemo(() => getTotpCode(otp, now), [now, otp])
  const warning = code.remainingSeconds <= 5
  const size = 20
  const stroke = 2.25
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * code.progress

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="inline-flex items-center gap-3">
      <span className={warning ? 'font-mono text-red-200' : 'font-mono text-white/78'}>{code.value}</span>
      <div className="relative flex h-5 w-5 items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={warning ? 'rgba(248, 113, 113, 0.95)' : 'rgba(255,255,255,0.72)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <span className={warning ? 'absolute text-[9px] font-medium leading-none text-red-200' : 'absolute text-[9px] font-medium leading-none text-white/56'}>
          {code.remainingSeconds}
        </span>
      </div>
    </div>
  )
}

export function ResultRow({
  action,
  selected,
  onHover,
  pointerActive = true,
}: {
  action: ResolvedAction
  selected: boolean
  onHover: () => void
  pointerActive?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      onMouseEnter={() => {
        if (pointerActive) {
          onHover()
        }
      }}
      onFocus={onHover}
      className={clsx(
        'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-3 py-3 text-left transition',
        selected ? 'bg-white/10 text-white' : 'text-white/74',
        pointerActive ? 'hover:bg-white/5' : '',
      )}
    >
      <RowIcon action={action} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="truncate text-[16px] font-medium text-white">{action.title}</span>
          <span className="truncate text-[14px] text-white/40">{action.subtitle}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[13px] text-white/38">
        <span>
          {action.kind === 'create-item' && action.itemType && action.itemType !== 'ssh-key'
            ? getCreateTitle(action.itemType)
            : actionKindLabel(action)}
        </span>
        <ReturnHint />
      </div>
    </button>
  )
}

export function DetailRow({
  action,
  selected,
  onHover,
  pointerActive = true,
}: {
  action: DetailAction
  selected: boolean
  onHover: () => void
  pointerActive?: boolean
}) {
  const Icon = action.icon
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      disabled={action.disabled}
      onMouseEnter={() => {
        if (pointerActive) {
          onHover()
        }
      }}
      onFocus={onHover}
      className={clsx(
        'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-3 py-3 text-left transition',
        action.disabled
          ? 'cursor-default text-white/30'
          : selected
            ? action.tone === 'danger'
              ? 'bg-red-500/12 text-white'
              : action.tone === 'success'
                ? 'bg-emerald-500/12 text-white'
                : 'bg-white/10 text-white'
            : action.tone === 'danger'
              ? 'text-red-200/82'
              : action.tone === 'success'
                ? 'text-emerald-200/84'
                : 'text-white/74',
        !selected && pointerActive && action.tone === 'danger' ? 'hover:bg-red-500/8' : '',
        !selected && pointerActive && action.tone === 'success' ? 'hover:bg-emerald-500/8' : '',
        !selected && pointerActive && action.tone === 'default' ? 'hover:bg-white/5' : '',
      )}
    >
      <div
        className={clsx(
          'flex h-8 w-8 items-center justify-center rounded-[9px]',
          action.disabled
            ? 'bg-white/5 text-white/20'
            : action.tone === 'danger'
              ? 'bg-red-500/14 text-red-200/78'
              : action.tone === 'success'
                ? 'bg-emerald-500/16 text-emerald-200/82'
                : 'bg-white/8 text-white/68',
        )}
      >
        {action.iconUrl ? (
          <img src={action.iconUrl} alt="" className="h-4 w-4 rounded-[4px] object-contain" />
        ) : (
          <Icon size={15} />
        )}
      </div>
      <div className="truncate text-[15px] font-medium text-white">{action.title}</div>
      <div className="flex items-center justify-end gap-3 text-[13px] text-white/34">
        {action.otp ? <OtpRowTimer otp={action.otp} /> : null}
        {action.disabled ? 'Soon' : <ReturnHint />}
      </div>
    </button>
  )
}
