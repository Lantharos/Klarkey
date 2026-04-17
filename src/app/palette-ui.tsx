import { clsx } from 'clsx'
import { ChevronLeft, CornerDownLeft, Search, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StaticItemTypeIcon } from '@/app/item-ui'
import { LoginItemIcon } from '@/app/login-item-icon'
import { getCreateTitle, getItemTypeAccent, getItemTypeIcon } from '@/app/item-type-meta'
import { actionKindLabel, itemInitials } from '@/app/palette-utils'
import type { DetailAction } from '@/app/palette-types'
import type { ActionExecutionResult, PasskeySupport, ResolvedAction, UserSettings, VaultPasskeyRecord } from '@/shared/types'
import { getTotpCode } from '@/shared/totp'

function TypeIcon({ itemType }: { itemType: ResolvedAction['itemType'] }) {
  if (!itemType || !getItemTypeIcon(itemType)) {
    return null
  }

  const accent = getItemTypeAccent(itemType)

  return (
    <div className={clsx('flex h-8 w-8 items-center justify-center rounded-[9px]', accent?.container ?? 'bg-white/8 text-white/72')}>
      <StaticItemTypeIcon itemType={itemType} />
    </div>
  )
}

export function RowIcon({ action, title }: { action?: ResolvedAction; title?: string }) {
  if (action?.kind === 'open-settings') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/8 text-white/72">
        <Settings2 size={15} />
      </div>
    )
  }

  if (action?.kind === 'create-item') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-emerald-500/18 text-emerald-300">
        <Sparkles size={15} />
      </div>
    )
  }

  if (action?.itemType === 'login') {
    return (
      <LoginItemIcon
        key={`${title ?? action.title}:${action.logoDomain ?? ''}:${action.logoName ?? ''}`}
        title={title ?? action.title}
        logoDomain={action.logoDomain}
        logoName={action.logoName}
      />
    )
  }

  if (getItemTypeIcon(action?.itemType ?? 'login')) {
    return <TypeIcon itemType={action?.itemType} />
  }

  const initials = itemInitials(title ?? action?.title ?? 'Klarkey')

  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-sky-500/20 text-[12px] font-semibold text-sky-200">
      {initials}
    </div>
  )
}

export function KeyHint({ children }: { children: string }) {
  return <span className="rounded-[7px] bg-white/6 px-2 py-1 text-[12px] text-white/50">{children}</span>
}

export function ShortcutHint({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1 rounded-[7px] bg-white/6 px-2 py-1 text-[12px] text-white/50">{children}</span>
}

export function ReturnHint({ embedded = false }: { embedded?: boolean }) {
  return (
    <span className={embedded ? 'flex items-center justify-center text-white/50' : 'flex items-center justify-center rounded-[7px] bg-white/6 px-2 py-1 text-white/50'}>
      <CornerDownLeft size={12} strokeWidth={2.2} />
    </span>
  )
}

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

export function SearchBar({
  query,
  onChange,
  onRemoveToken,
  onBackspaceEmpty,
  onMoveSelection,
  onEnter,
}: {
  query: {
    tokens: Array<{ id: string; label: string }>
    trailingText: string
  }
  onChange: (value: string) => void
  onRemoveToken: (tokenId: string) => void
  onBackspaceEmpty: () => void
  onMoveSelection: (delta: number) => void
  onEnter: () => void
}) {
  return (
    <>
      <Search size={17} className="shrink-0 text-white/38" />
      <div className="flex min-h-10 flex-1 flex-wrap items-center gap-2">
        {query.tokens.map((token) => (
          <button
            key={token.id}
            type="button"
            onClick={() => onRemoveToken(token.id)}
            className="rounded-[8px] bg-white/7 px-2.5 py-1 text-[13px] text-white/72 transition hover:bg-white/10"
          >
            {token.label}
          </button>
        ))}
        <input
          autoFocus
          value={query.trailingText}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              onMoveSelection(1)
              return
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              onMoveSelection(-1)
              return
            }

            if (event.key === 'Backspace' && query.trailingText.length === 0 && query.tokens.length > 0) {
              event.preventDefault()
              onBackspaceEmpty()
              return
            }

            if (event.key === 'Enter') {
              event.preventDefault()
              onEnter()
            }
          }}
          placeholder="Search for apps and commands..."
          className="h-10 min-w-[200px] flex-1 bg-transparent text-[18px] text-white outline-none placeholder:text-white/34"
        />
      </div>
    </>
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

function SettingRow({
  label,
  value,
  onClick,
  pointerActive = true,
}: {
  label: string
  value: string
  onClick?: () => void
  pointerActive?: boolean
}) {
  const content = (
    <div
      className={clsx(
        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-3 text-left transition',
        pointerActive ? 'hover:bg-white/5' : '',
      )}
    >
      <div className="text-[15px] text-white">{label}</div>
      <div className="text-[14px] text-white/42">{value}</div>
    </div>
  )

  if (!onClick) {
    return content
  }

  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      {content}
    </button>
  )
}

export function SettingsPage({
  settings,
  onToggleStartup,
  onTimeoutChange,
  passkeySupport,
  passkeys,
  passkeyBusy,
  passkeyExecution,
  onCreatePasskey,
  onVerifyPasskey,
  onDeletePasskey,
  pointerActive = true,
}: {
  settings: UserSettings
  onToggleStartup: () => void
  onTimeoutChange: (seconds: number) => void
  passkeySupport?: PasskeySupport
  passkeys: VaultPasskeyRecord[]
  passkeyBusy: boolean
  passkeyExecution?: ActionExecutionResult
  onCreatePasskey: () => void
  onVerifyPasskey: () => void
  onDeletePasskey: (passkeyId: string) => void
  pointerActive?: boolean
}) {
  const providerValue = !passkeySupport
    ? 'Loading'
    : !passkeySupport.available
      ? 'Unavailable'
      : passkeySupport.platformAuthenticatorAvailable
        ? 'Ready'
        : 'Browser-managed'
  const passkeyHint = !passkeySupport
    ? 'Checking passkey support...'
    : !passkeySupport.available
      ? 'Klarkey needs a secure WebAuthn context before passkeys can run.'
      : passkeySupport.platform === 'linux' && !passkeySupport.safeStorageAvailable
        ? 'Linux support depends on a working desktop credential store such as Secret Service or KWallet.'
        : `Uses ${passkeySupport.origin} with RP ID ${passkeySupport.relyingPartyId}.`

  return (
    <div className="space-y-1 px-2 py-3">
      <SettingRow label="Shortcut" value={settings.hotkey} pointerActive={pointerActive} />
      <SettingRow
        label="Clipboard clear"
        value={`${settings.clearClipboardSeconds}s`}
        onClick={() => onTimeoutChange(settings.clearClipboardSeconds === 45 ? 60 : 45)}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Launch on startup"
        value={settings.launchOnStartup ? 'On' : 'Off'}
        onClick={onToggleStartup}
        pointerActive={pointerActive}
      />
      <div className="rounded-[10px] border border-white/8 bg-white/[0.03] px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] text-white">Vault passkeys</div>
            <div className="mt-1 max-w-[460px] text-[13px] leading-5 text-white/46">{passkeyHint}</div>
          </div>
          <div className="rounded-[8px] bg-white/6 px-2.5 py-1 text-[12px] text-white/54">{providerValue}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={passkeyBusy || !passkeySupport?.available}
            onClick={onCreatePasskey}
            className="rounded-[9px] bg-white/10 px-3 py-2 text-[13px] text-white transition hover:bg-white/14 disabled:cursor-default disabled:opacity-40"
          >
            Create passkey
          </button>
          <button
            type="button"
            disabled={passkeyBusy || passkeys.length === 0 || !passkeySupport?.available}
            onClick={onVerifyPasskey}
            className="rounded-[9px] bg-white/6 px-3 py-2 text-[13px] text-white/84 transition hover:bg-white/10 disabled:cursor-default disabled:opacity-40"
          >
            Verify passkey
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {passkeys.length === 0 ? (
            <div className="rounded-[9px] bg-white/[0.035] px-3 py-3 text-[13px] text-white/42">
              No Klarkey passkeys are enrolled on this vault yet.
            </div>
          ) : (
            passkeys.map((passkey) => (
              <div key={passkey.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[9px] bg-white/[0.035] px-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-white">{passkey.label}</div>
                  <div className="truncate text-[12px] text-white/38">
                    {passkey.lastUsedAt
                      ? `Last used ${new Date(passkey.lastUsedAt).toLocaleString()}`
                      : `Created ${new Date(passkey.createdAt).toLocaleString()}`}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={passkeyBusy}
                  onClick={() => onDeletePasskey(passkey.id)}
                  className="rounded-[8px] px-2.5 py-1 text-[12px] text-red-200/82 transition hover:bg-red-500/10 disabled:cursor-default disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
        {passkeyExecution ? (
          <div
            className={clsx(
              'mt-4 rounded-[9px] px-3 py-3 text-[13px]',
              passkeyExecution.status === 'error' ? 'bg-red-500/10 text-red-100' : 'bg-emerald-500/10 text-emerald-100',
            )}
          >
            <div className="font-medium">{passkeyExecution.title}</div>
            <div className="mt-1 text-current/80">{passkeyExecution.message}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function HeaderRow({
  title,
  subtitle,
  onBack,
  showIcon = true,
  itemType = 'login',
}: {
  title: string
  subtitle?: string
  onBack: () => void
  showIcon?: boolean
  itemType?: ResolvedAction['itemType']
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 w-9 items-center justify-center rounded-[9px] text-white/58 transition hover:bg-white/6 hover:text-white"
      >
        <ChevronLeft size={17} />
      </button>
      {showIcon ? <RowIcon action={{ itemType } as ResolvedAction} title={title} /> : null}
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="truncate text-[16px] font-medium text-white">{title}</span>
        {subtitle ? <span className="truncate text-[14px] text-white/40">{subtitle}</span> : null}
      </div>
    </>
  )
}
