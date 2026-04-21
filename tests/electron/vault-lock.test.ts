import { describe, expect, it } from 'vitest'
import { VaultLockManager } from '@/electron/vault-lock'
import type { UserSettings } from '@/shared/types'

class MockKeyManager {
  private keyInMemory = true

  isSafeStorageAvailable() {
    return true
  }

  hasMasterPassword() {
    return true
  }

  hasKeyFile() {
    return true
  }

  isKeyInMemory() {
    return this.keyInMemory
  }

  getKey() {
    return Buffer.alloc(32, 1)
  }

  unlockFromSystem() {
    this.keyInMemory = true
    return true
  }

  unlockWithPassword() {
    this.keyInMemory = true
    return true
  }

  setupWithMasterPassword() {}
  changeMasterPassword() { return true }
  removeMasterPassword() { return true }

  evictKey() {
    this.keyInMemory = false
  }

  setupNewVault() {
    this.keyInMemory = true
    return Buffer.alloc(32, 1)
  }
}

const defaultSettings: UserSettings = {
  hotkey: 'Alt+S',
  clearClipboardSeconds: 45,
  launchOnStartup: false,
  browserAutoOpenMenu: true,
  browserAutoSubmitLogin: true,
  browserSavePrompts: true,
  passcodeEnabled: true,
  autoLockMinutes: 15,
  sshAgentEnabled: false,
}

function createSettingsDbMock() {
  const settings = new Map<string, string>()

  return {
    prepare(sql: string) {
      if (sql.startsWith('SELECT value FROM settings WHERE key = ?')) {
        return {
          get(key: string) {
            const value = settings.get(key)
            return value === undefined ? undefined : { value }
          },
        }
      }

      if (sql.startsWith('INSERT INTO settings(key, value) VALUES (?, ?)')) {
        return {
          run(key: string, value: string) {
            settings.set(key, value)
          },
        }
      }

      if (sql.startsWith('DELETE FROM settings WHERE key IN')) {
        return {
          run(...keys: string[]) {
            for (const key of keys) {
              settings.delete(key)
            }
          },
        }
      }

      if (sql.startsWith("UPDATE settings SET value = 'false' WHERE key = ?")) {
        return {
          run(key: string) {
            settings.set(key, 'false')
          },
        }
      }

      throw new Error(`Unsupported SQL in test mock: ${sql}`)
    },
  }
}

describe('VaultLockManager passcode removal', () => {
  it('requires confirmPasscode before removePasscode', () => {
    const db = createSettingsDbMock()
    const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

    expect(manager.setPasscode('1234').success).toBe(true)

    const removeWithoutConfirm = manager.removePasscode()
    expect(removeWithoutConfirm.success).toBe(false)

    const confirm = manager.confirmPasscode('1234')
    expect(confirm.success).toBe(true)

    const removeWithConfirm = manager.removePasscode()
    expect(removeWithConfirm.success).toBe(true)
  })
})
