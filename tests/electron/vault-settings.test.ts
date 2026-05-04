import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { mergeVaultSettings, readVaultSettings } from '@/electron/repository/vault-settings'
import { DEFAULT_SETTINGS } from '@/shared/types'

function createSettingsDbMock() {
  const settings = new Map<string, string>()
  return {
    settings,
    prepare(sql: string) {
      if (sql.startsWith('SELECT key, value FROM settings')) {
        return {
          all: () => Array.from(settings.entries()).map(([key, value]) => ({ key, value })),
        }
      }
      if (sql.startsWith('INSERT INTO settings(key, value) VALUES (?, ?)')) {
        return {
          run: (key: string, value: string) => settings.set(key, value),
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
}

describe('vault settings storage', () => {
  it('falls back from invalid local settings before runtime use', () => {
    const db = createSettingsDbMock()
    db.settings.set('hotkey', 'S')
    db.settings.set('clearClipboardSeconds', '3600')
    db.settings.set('autoLockMinutes', '1440')
    db.settings.set('browserAutoSubmitLogin', 'maybe')

    expect(readVaultSettings(db as never as Database.Database)).toMatchObject({
      hotkey: DEFAULT_SETTINGS.hotkey,
      clearClipboardSeconds: DEFAULT_SETTINGS.clearClipboardSeconds,
      autoLockMinutes: DEFAULT_SETTINGS.autoLockMinutes,
      browserAutoSubmitLogin: false,
    })
  })

  it('keeps browser auto-submit opt-in while preserving explicit stored choices', () => {
    const emptyDb = createSettingsDbMock()
    expect(readVaultSettings(emptyDb as never as Database.Database).browserAutoSubmitLogin).toBe(false)

    const enabledDb = createSettingsDbMock()
    enabledDb.settings.set('browserAutoSubmitLogin', 'true')
    expect(readVaultSettings(enabledDb as never as Database.Database).browserAutoSubmitLogin).toBe(true)

    const disabledDb = createSettingsDbMock()
    disabledDb.settings.set('browserAutoSubmitLogin', 'false')
    expect(readVaultSettings(disabledDb as never as Database.Database).browserAutoSubmitLogin).toBe(false)
  })

  it('stores canonical hotkeys through settings merges', () => {
    const db = createSettingsDbMock()
    const next = mergeVaultSettings(db as never as Database.Database, { hotkey: ' ctrl + alt + s ' })

    expect(next.hotkey).toBe('Ctrl+Alt+S')
    expect(readVaultSettings(db as never as Database.Database).hotkey).toBe('Ctrl+Alt+S')
  })
})
