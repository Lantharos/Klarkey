import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'
import { formatAutoLockLabel, formatClipboardClearLabel } from '@/app/settings-constants'
import type { SyncStatus } from '@/shared/sync'
import type { VaultLockInfo, UserSettings } from '@/shared/types'

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
  valueTone?: 'default' | 'recording' | 'syncing'
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
      : valueTone === 'syncing'
        ? selected
          ? 'text-white/70'
          : 'text-white/52'
      : selected
        ? 'text-white/52'
        : 'text-white/40'

  const content = (
    <>
      <div className={clsx('text-[15px] font-medium', selected ? 'text-white' : 'text-white/78')}>{label}</div>
      <div
        className={clsx(
          'flex items-center gap-2 text-[14px] tabular-nums',
          valueClass,
          valueTone === 'recording' ? 'motion-safe:animate-pulse' : '',
        )}
      >
        {valueTone === 'syncing' ? <span className="h-3 w-3 rounded-full border border-white/18 border-t-white/72 motion-safe:animate-spin" /> : null}
        <span>{value}</span>
      </div>
    </>
  )

  if (!onClick) {
    return (
      <div
        className={clsx(
          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-3 text-left transition-colors',
          selected ? 'palette-row-selected' : '',
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
      onPointerMove={(event) => {
        if (pointerActive && event.pointerType === 'mouse') {
          onHover()
        }
      }}
      className={clsx(
        'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[10px] px-3 py-3 text-left transition-colors',
        selected ? 'palette-row-selected' : 'text-white/74',
      )}
    >
      {content}
    </button>
  )
}

export function SettingsPage({
  settings,
  lockInfo,
  selectedIndex,
  hotkeyRecording,
  onSelectRow,
  onPaletteShortcutPress,
  onCycleClipboardClear,
  onToggleStartup,
  onToggleAutoOpenMenu,
  onToggleAutoSubmit,
  onToggleSavePrompts,
  onCycleAutoLock,
  onTogglePasscode,
  onSetPasscode,
  onSetupMasterPassword,
  onToggleSshAgent,
  syncStatus,
  onSyncSignIn,
  onSyncNow,
  onSyncSignOut,
  onExportVault,
  onImportVault,
  pointerActive = true,
}: {
  settings: UserSettings
  lockInfo?: VaultLockInfo
  selectedIndex: number
  hotkeyRecording: boolean
  onSelectRow: (index: number) => void
  onPaletteShortcutPress: () => void
  onCycleClipboardClear: () => void
  onToggleStartup: () => void
  onToggleAutoOpenMenu: () => void
  onToggleAutoSubmit: () => void
  onToggleSavePrompts: () => void
  onCycleAutoLock: () => void
  onTogglePasscode: () => void
  onSetPasscode: () => void
  onSetupMasterPassword: () => void
  onToggleSshAgent: () => void
  syncStatus?: SyncStatus
  onSyncSignIn: () => void
  onSyncNow: () => void
  onSyncSignOut: () => void
  onExportVault: () => void
  onImportVault: () => void
  pointerActive?: boolean
}) {
  const clipLabel = formatClipboardClearLabel(settings.clearClipboardSeconds)
  const shortcutValue = hotkeyRecording ? 'Recording…' : settings.hotkey
  const passcodeLabel = lockInfo?.passcodeSet ? (settings.passcodeEnabled ? 'On' : 'Off') : 'Not set'
  const masterPasswordLabel = lockInfo?.masterPasswordSet ? 'Set' : 'Not set'
  const sshAgentLabel = settings.sshAgentEnabled ? 'On' : 'Off'
  const syncLabel = !syncStatus?.configured
    ? 'Not configured'
    : syncStatus.signedIn
      ? syncStatus.account?.email ?? syncStatus.account?.displayName ?? 'Connected'
      : 'Sign in'
  const syncNowLabel = syncStatus?.syncing ? 'Syncing' : syncStatus?.lastSyncAt ? new Date(syncStatus.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'

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
      <div className="px-3 pb-1 pt-3 text-[12px] text-white/38">Security</div>
      <SettingRow
        label="Passcode on open"
        value={passcodeLabel}
        selected={selectedIndex === 6}
        onHover={() => onSelectRow(6)}
        onClick={lockInfo?.passcodeSet ? onTogglePasscode : onSetPasscode}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Master password"
        value={masterPasswordLabel}
        selected={selectedIndex === 7}
        onHover={() => onSelectRow(7)}
        onClick={onSetupMasterPassword}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Auto-lock after"
        value={formatAutoLockLabel(settings.autoLockMinutes)}
        selected={selectedIndex === 8}
        onHover={() => onSelectRow(8)}
        onClick={onCycleAutoLock}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="SSH agent"
        value={sshAgentLabel}
        selected={selectedIndex === 9}
        onHover={() => onSelectRow(9)}
        onClick={onToggleSshAgent}
        pointerActive={pointerActive}
      />
      <div className="px-3 pb-1 pt-3 text-[12px] text-white/38">Sync</div>
      <SettingRow
        label="Cloud sync"
        value={syncLabel}
        selected={selectedIndex === 10}
        onHover={() => onSelectRow(10)}
        onClick={syncStatus?.signedIn ? onSyncNow : onSyncSignIn}
        pointerActive={pointerActive}
      />
      {syncStatus?.signedIn ? (
        <>
          <SettingRow
            label="Sync now"
            value={syncNowLabel}
            valueTone={syncStatus.syncing ? 'syncing' : 'default'}
            selected={selectedIndex === 11}
            onHover={() => onSelectRow(11)}
            onClick={onSyncNow}
            pointerActive={pointerActive}
          />
          <SettingRow
            label="Disconnect sync"
            value="This device"
            selected={selectedIndex === 12}
            onHover={() => onSelectRow(12)}
            onClick={onSyncSignOut}
            pointerActive={pointerActive}
          />
        </>
      ) : null}
      <div className="px-3 pb-1 pt-3 text-[12px] text-white/38">Data</div>
      <SettingRow
        label="Export vault"
        value="Klarkey or CSV"
        selected={selectedIndex === 13}
        onHover={() => onSelectRow(13)}
        onClick={onExportVault}
        pointerActive={pointerActive}
      />
      <SettingRow
        label="Import vault"
        value="1Password, Bitwarden, etc."
        selected={selectedIndex === 14}
        onHover={() => onSelectRow(14)}
        onClick={onImportVault}
        pointerActive={pointerActive}
      />
    </div>
  )
}
