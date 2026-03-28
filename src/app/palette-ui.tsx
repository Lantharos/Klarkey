import { clsx } from 'clsx'
import { ChevronLeft, CornerDownLeft, Search, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { actionKindLabel, itemInitials } from '@/app/palette-utils'
import type { DetailAction } from '@/app/palette-types'
import type { ResolvedAction, UserSettings } from '@/shared/types'

export function RowIcon({ action, title }: { action?: ResolvedAction; title?: string }) {
  if (action?.kind === 'open-settings') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/8 text-white/72">
        <Settings2 size={15} />
      </div>
    )
  }

  if (action?.kind === 'create-login') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-emerald-500/18 text-emerald-300">
        <Sparkles size={15} />
      </div>
    )
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

export function ReturnHint() {
  return (
    <span className="flex items-center justify-center rounded-[7px] bg-white/6 px-2 py-1 text-white/50">
      <CornerDownLeft size={12} strokeWidth={2.2} />
    </span>
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
        <span>{action.kind === 'create-login' ? 'Create' : actionKindLabel(action)}</span>
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
        <Icon size={15} />
      </div>
      <div className="truncate text-[15px] font-medium text-white">{action.title}</div>
      <div className="flex items-center justify-end text-[13px] text-white/34">
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
  pointerActive = true,
}: {
  settings: UserSettings
  onToggleStartup: () => void
  onTimeoutChange: (seconds: number) => void
  pointerActive?: boolean
}) {
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
    </div>
  )
}

export function HeaderRow({
  title,
  subtitle,
  onBack,
  showIcon = true,
}: {
  title: string
  subtitle?: string
  onBack: () => void
  showIcon?: boolean
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
      {showIcon ? <RowIcon title={title} /> : null}
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="truncate text-[16px] font-medium text-white">{title}</span>
        {subtitle ? <span className="truncate text-[14px] text-white/40">{subtitle}</span> : null}
      </div>
    </>
  )
}
