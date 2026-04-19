import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'
import { formatClipboardClearLabel } from '@/app/settings-constants'
import type { UserSettings } from '@/shared/types'

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
