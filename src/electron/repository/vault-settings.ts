import type Database from 'better-sqlite3'
import { DEFAULT_SETTINGS, type SettingsUpdate, type UserSettings } from '@/shared/types'

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
    hotkey: fromDb.hotkey ?? DEFAULT_SETTINGS.hotkey,
    clearClipboardSeconds: Number(fromDb.clearClipboardSeconds ?? DEFAULT_SETTINGS.clearClipboardSeconds),
    launchOnStartup: fromDb.launchOnStartup === 'true' ? true : DEFAULT_SETTINGS.launchOnStartup,
    browserAutoOpenMenu: fromDb.browserAutoOpenMenu === 'false' ? false : DEFAULT_SETTINGS.browserAutoOpenMenu,
    browserAutoSubmitLogin: fromDb.browserAutoSubmitLogin === 'false' ? false : DEFAULT_SETTINGS.browserAutoSubmitLogin,
    browserSavePrompts: fromDb.browserSavePrompts === 'false' ? false : DEFAULT_SETTINGS.browserSavePrompts,
  }
}

export function mergeVaultSettings(db: Database.Database, update: SettingsUpdate): UserSettings {
  const current = readVaultSettings(db)
  const next = { ...current, ...update }
  const statement = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )

  statement.run('hotkey', next.hotkey)
  statement.run('clearClipboardSeconds', String(next.clearClipboardSeconds))
  statement.run('launchOnStartup', String(next.launchOnStartup))
  statement.run('browserAutoOpenMenu', String(next.browserAutoOpenMenu))
  statement.run('browserAutoSubmitLogin', String(next.browserAutoSubmitLogin))
  statement.run('browserSavePrompts', String(next.browserSavePrompts))

  return next
}
