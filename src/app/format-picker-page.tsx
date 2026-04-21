import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'

interface FormatOption {
  id: string
  label: string
  description: string
}

function FormatRow({
  label,
  description,
  selected,
  onHover,
  onClick,
  pointerActive = true,
}: {
  label: string
  description: string
  selected: boolean
  onHover: () => void
  onClick: () => void
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
      <div className={clsx('text-[15px] font-medium', selected ? 'text-white' : 'text-white/78')}>{label}</div>
      <div className={clsx('text-[14px]', selected ? 'text-white/52' : 'text-white/40')}>{description}</div>
    </button>
  )
}

export function FormatPickerPage({
  title,
  options,
  selectedIndex,
  onSelectRow,
  onPick,
  pointerActive = true,
}: {
  title: string
  options: FormatOption[]
  selectedIndex: number
  onSelectRow: (index: number) => void
  onPick: (id: string) => void
  pointerActive?: boolean
}) {
  return (
    <div className="space-y-1 px-2 pb-3 pt-1">
      <div className="px-3 pb-1 pt-1 text-[12px] text-white/38">{title}</div>
      {options.map((option, index) => (
        <FormatRow
          key={option.id}
          label={option.label}
          description={option.description}
          selected={selectedIndex === index}
          onHover={() => onSelectRow(index)}
          onClick={() => onPick(option.id)}
          pointerActive={pointerActive}
        />
      ))}
    </div>
  )
}
