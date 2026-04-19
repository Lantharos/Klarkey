import { clsx } from 'clsx'
import { ChevronLeft, CornerDownLeft, Search, Settings2, Sparkles } from 'lucide-react'
import { StaticItemTypeIcon } from '@/app/item-ui'
import { LoginItemIcon } from '@/app/login-item-icon'
import { getItemTypeAccent, getItemTypeIcon } from '@/app/item-type-meta'
import { itemInitials } from '@/app/palette-utils'
import type { ResolvedAction } from '@/shared/types'

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
