import type Database from 'better-sqlite3'
import { normalizeHotkeyAccelerator } from '@/shared/hotkey-accelerator'
import { AUTO_LOCK_MINUTE_OPTIONS, CLIPBOARD_CLEAR_OPTIONS } from '@/shared/settings-options'
import { DEFAULT_SETTINGS, type SettingsUpdate, type UserSettings } from '@/shared/types'

function readOption<const T extends readonly number[]>(value: string | number | undefined, options: T, fallback: number): T[number] {
  const parsed = Number(value ?? fallback)
  return options.includes(parsed as T[number]) ? parsed as T[number] : fallback as T[number]
}

function readHotkey(value: string | undefined) {
  return value ? normalizeHotkeyAccelerator(value) ?? DEFAULT_SETTINGS.hotkey : DEFAULT_SETTINGS.hotkey
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return fallback
}

function normalizeSettings(settings: UserSettings): UserSettings {
  return {
    ...settings,
    hotkey: readHotkey(settings.hotkey),
    clearClipboardSeconds: readOption(settings.clearClipboardSeconds, CLIPBOARD_CLEAR_OPTIONS, DEFAULT_SETTINGS.clearClipboardSeconds),
    autoLockMinutes: readOption(settings.autoLockMinutes, AUTO_LOCK_MINUTE_OPTIONS, DEFAULT_SETTINGS.autoLockMinutes),
  }
}

export function readVaultSettings(db: Database.Database): UserSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: keyof UserSettings
    value: string
  }>
  const fromDb = rows.reduce<Record<string, string>>((accumulator, row) => {
    accumulator[row.key] = row.value
    return accumulator
  }, {})

  return {
    hotkey: readHotkey(fromDb.hotkey),
    clearClipboardSeconds: readOption(fromDb.clearClipboardSeconds, CLIPBOARD_CLEAR_OPTIONS, DEFAULT_SETTINGS.clearClipboardSeconds),
    launchOnStartup: readBoolean(fromDb.launchOnStartup, DEFAULT_SETTINGS.launchOnStartup),
    browserAutoOpenMenu: readBoolean(fromDb.browserAutoOpenMenu, DEFAULT_SETTINGS.browserAutoOpenMenu),
    browserAutoSubmitLogin: readBoolean(fromDb.browserAutoSubmitLogin, DEFAULT_SETTINGS.browserAutoSubmitLogin),
    browserSavePrompts: readBoolean(fromDb.browserSavePrompts, DEFAULT_SETTINGS.browserSavePrompts),
    passcodeEnabled: readBoolean(fromDb.passcodeEnabled, DEFAULT_SETTINGS.passcodeEnabled),
    autoLockMinutes: readOption(fromDb.autoLockMinutes, AUTO_LOCK_MINUTE_OPTIONS, DEFAULT_SETTINGS.autoLockMinutes),
    sshAgentEnabled: readBoolean(fromDb.sshAgentEnabled, DEFAULT_SETTINGS.sshAgentEnabled),
  }
}

export function mergeVaultSettings(db: Database.Database, update: SettingsUpdate): UserSettings {
  const current = readVaultSettings(db)
  const next = normalizeSettings({ ...current, ...update })
  const statement = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )

  statement.run('hotkey', next.hotkey)
  statement.run('clearClipboardSeconds', String(next.clearClipboardSeconds))
  statement.run('launchOnStartup', String(next.launchOnStartup))
  statement.run('browserAutoOpenMenu', String(next.browserAutoOpenMenu))
  statement.run('browserAutoSubmitLogin', String(next.browserAutoSubmitLogin))
  statement.run('browserSavePrompts', String(next.browserSavePrompts))
  statement.run('passcodeEnabled', String(next.passcodeEnabled))
  statement.run('autoLockMinutes', String(next.autoLockMinutes))
  statement.run('sshAgentEnabled', String(next.sshAgentEnabled))

  return next
}
