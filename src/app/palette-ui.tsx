import { clsx } from 'clsx'
import { ChevronLeft, CornerDownLeft, Search, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatClipboardClearLabel } from '@/app/settings-constants'
import { StaticItemTypeIcon } from '@/app/item-ui'
import { LoginItemIcon } from '@/app/login-item-icon'
import { getCreateTitle, getItemTypeAccent, getItemTypeIcon } from '@/app/item-type-meta'
import { actionKindLabel, itemInitials } from '@/app/palette-utils'
import type { DetailAction } from '@/app/palette-types'
import type { ResolvedAction, UserSettings } from '@/shared/types'
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
      <div className="flex h-9 w-9 shrink-0 items-center justify-center text-white/38">
        <Search size={17} />
      </div>
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
  valueTone = 'default',
  selected,
  onHover,
  onClick,
  pointerActive = true,
}: {
  label: string
  value: string
  valueTone?: 'default' | 'recording'
  selected: boolean
  onHover: () => void
  onClick?: () => void
  pointerActive?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  const valueClass =
    valueTone === 'recording'
      ? selected
        ? 'text-emerald-200/90'
        : 'text-emerald-200/72'
      : selected
        ? 'text-white/52'
        : 'text-white/40'

  const content = (
    <>
      <div className={clsx('text-[15px] font-medium', selected ? 'text-white' : 'text-white/78')}>{label}</div>
      <div
        className={clsx(
          'text-[14px] tabular-nums',
          valueClass,
          valueTone === 'recording' ? 'motion-safe:animate-pulse' : '',
        )}
      >
        {value}
      </div>
    </>
  )

  if (!onClick) {
    return (
      <div
        className={clsx(
          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-3 text-left transition',
          selected ? 'bg-white/10' : '',
          pointerActive && !selected ? 'hover:bg-white/5' : '',
        )}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={() => {
        if (pointerActive) {
          onHover()
        }
      }}
      onFocus={onHover}
      className={clsx(
        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-3 text-left transition',
        selected ? 'bg-white/10' : 'text-white/74',
        !selected && pointerActive ? 'hover:bg-white/5' : '',
      )}
    >
      {content}
    </button>
  )
}

export function SettingsPage({
  settings,
  selectedIndex,
  hotkeyRecording,
  onSelectRow,
  onPaletteShortcutPress,
  onCycleClipboardClear,
  onToggleStartup,
  onToggleAutoOpenMenu,
  onToggleAutoSubmit,
  onToggleSavePrompts,
  pointerActive = true,
}: {
  settings: UserSettings
  selectedIndex: number
  hotkeyRecording: boolean
  onSelectRow: (index: number) => void
  onPaletteShortcutPress: () => void
  onCycleClipboardClear: () => void
  onToggleStartup: () => void
  onToggleAutoOpenMenu: () => void
  onToggleAutoSubmit: () => void
  onToggleSavePrompts: () => void
  pointerActive?: boolean
}) {
  const clipLabel = formatClipboardClearLabel(settings.clearClipboardSeconds)
  const shortcutValue = hotkeyRecording ? 'Recording…' : settings.hotkey

  return (
    <div className="space-y-1 px-2 pb-3 pt-1">
      <div className="px-3 pb-1 pt-1 text-[12px] text-white/38">Palette</div>
      <SettingRow
        label="Open palette"
        value={shortcutValue}
        valueTone={hotkeyRecording ? 'recording' : 'default'}
        selected={selectedIndex === 0}
        onHover={() => onSelectRow(0)}
        onClick={onPaletteShortcutPress}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Clear clipboard after copying"
        value={clipLabel}
        selected={selectedIndex === 1}
        onHover={() => onSelectRow(1)}
        onClick={onCycleClipboardClear}
        pointerActive={pointerActive}
      />
      <div className="px-3 pb-1 pt-3 text-[12px] text-white/38">System</div>
      <SettingRow
        label="Open at login"
        value={settings.launchOnStartup ? 'On' : 'Off'}
        selected={selectedIndex === 2}
        onHover={() => onSelectRow(2)}
        onClick={onToggleStartup}
        pointerActive={pointerActive}
      />
      <div className="px-3 pb-1 pt-3 text-[12px] text-white/38">Browser</div>
      <SettingRow
        label="Inline autofill menu"
        value={settings.browserAutoOpenMenu ? 'On' : 'Off'}
        selected={selectedIndex === 3}
        onHover={() => onSelectRow(3)}
        onClick={onToggleAutoOpenMenu}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Auto-submit logins"
        value={settings.browserAutoSubmitLogin ? 'On' : 'Off'}
        selected={selectedIndex === 4}
        onHover={() => onSelectRow(4)}
        onClick={onToggleAutoSubmit}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Save login prompts"
        value={settings.browserSavePrompts ? 'On' : 'Off'}
        selected={selectedIndex === 5}
        onHover={() => onSelectRow(5)}
        onClick={onToggleSavePrompts}
        pointerActive={pointerActive}
      />
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
