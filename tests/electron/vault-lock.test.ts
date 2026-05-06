import { describe, expect, it, vi } from 'vitest'
import { VaultLockManager } from '@/electron/vault-lock'
import type { UserSettings } from '@/shared/types'

class MockKeyManager {
  private keyInMemory = true
  private readonly passwordUnlocks: boolean
  private readonly masterPassword: boolean

  constructor(passwordUnlocks = true, masterPassword = true) {
    this.passwordUnlocks = passwordUnlocks
    this.masterPassword = masterPassword
  }

  isSafeStorageAvailable() {
    return true
  }

  hasMasterPassword() {
    return this.masterPassword
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
    this.keyInMemory = this.passwordUnlocks
    return this.passwordUnlocks
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
    settings,
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

  it('fails closed when stored passcode material is malformed', () => {
    const db = createSettingsDbMock()
    const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

    expect(manager.setPasscode('1234').success).toBe(true)
    db.settings.set('passcode_hash', 'not-base64')

    const confirm = manager.confirmPasscode('1234')
    expect(confirm.success).toBe(false)
    expect(confirm.message).toBe('Incorrect passcode.')
  })

  it('rejects malformed passcodes before unlock comparison', () => {
    const db = createSettingsDbMock()
    const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

    expect(manager.setPasscode('1234').success).toBe(true)
    manager.transitionAfterUnlock()

    expect(manager.verifyPasscode('1234567').success).toBe(false)
    expect(manager.verifyPasscode('12ab').success).toBe(false)
    expect(manager.confirmPasscode('1234567').success).toBe(false)
  })

  it('persists passcode attempt throttling across lock manager restarts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const db = createSettingsDbMock()
      const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

      expect(manager.setPasscode('1234').success).toBe(true)
      manager.transitionAfterUnlock()

      for (let attempt = 0; attempt < 10; attempt++) {
        expect(manager.verifyPasscode('9999').message).toBe('Incorrect passcode.')
      }

      expect(manager.verifyPasscode('1234').message).toContain('Too many attempts.')

      const restarted = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)
      restarted.transitionAfterUnlock()

      expect(restarted.verifyPasscode('1234').message).toContain('Too many attempts.')

      vi.advanceTimersByTime(60_000)

      expect(restarted.verifyPasscode('1234').success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists password attempt throttling across lock manager restarts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const db = createSettingsDbMock()
      const manager = new VaultLockManager(new MockKeyManager(false) as never, db as never, defaultSettings)

      for (let attempt = 0; attempt < 10; attempt++) {
        expect(manager.unlockWithPassword('wrong').message).toBe('Incorrect master password.')
      }

      expect(manager.unlockWithPassword('correct').message).toContain('Too many attempts.')

      const restarted = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)
      expect(restarted.unlockWithPassword('correct').message).toContain('Too many attempts.')

      vi.advanceTimersByTime(60_000)

      expect(restarted.unlockWithPassword('correct').success).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears corrupt future-dated attempt throttles instead of locking out indefinitely', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const db = createSettingsDbMock()
      db.settings.set('unlock_failed_attempts', '10')
      db.settings.set('unlock_last_attempt_ms', String(Date.now() + 24 * 60 * 60 * 1000))
      const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

      expect(manager.unlockWithPassword('correct').success).toBe(true)
      expect(db.settings.get('unlock_failed_attempts')).toBeUndefined()
      expect(db.settings.get('unlock_last_attempt_ms')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not unlock an OS-protected vault through the password path without a master password', () => {
    const db = createSettingsDbMock()
    const manager = new VaultLockManager(new MockKeyManager(true, false) as never, db as never, defaultSettings)

    const result = manager.unlockWithPassword('anything')

    expect(result.success).toBe(false)
    const authLabel = process.platform === 'win32' ? 'Windows Hello' : process.platform === 'darwin' ? 'Touch ID' : 'system authentication'
    expect(result.message).toBe(`Use ${authLabel} to unlock this vault, or set a master password first.`)
    expect(db.settings.get('unlock_failed_attempts')).toBeUndefined()
    expect(db.settings.get('vault_lock_state')).toBe('locked')
  })

  it('requires stronger new master passwords without blocking existing unlocks', () => {
    const db = createSettingsDbMock()
    const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

    manager.transitionAfterUnlock()

    expect(manager.setupMasterPassword('short-pass').message).toBe('Master password must be at least 12 characters.')
    expect(manager.setupMasterPassword('            ').message).toBe('Master password must be at least 12 characters.')
    expect(manager.changeMasterPassword('current-password', 'short-pass').message).toBe('New master password must be at least 12 characters.')
    expect(manager.changeMasterPassword('current-password', '            ').message).toBe('New master password must be at least 12 characters.')
    expect(manager.unlockWithPassword('oldpass8').success).toBe(true)
    expect(manager.setupMasterPassword('longer-passphrase').success).toBe(true)
    expect(manager.changeMasterPassword('current-password', 'new-long-passphrase').success).toBe(true)
  })

  it('extends auto-lock while the unlocked vault is active', () => {
    vi.useFakeTimers()
    try {
      const db = createSettingsDbMock()
      const manager = new VaultLockManager(new MockKeyManager() as never, db as never, {
        ...defaultSettings,
        autoLockMinutes: 1,
      })

      manager.transitionAfterUnlock()
      vi.advanceTimersByTime(45_000)

      expect(manager.getLockInfo().lockWarningSeconds).toBeDefined()

      manager.recordActivity()
      expect(manager.getLockInfo().lockWarningSeconds).toBeUndefined()

      vi.advanceTimersByTime(20_000)

      expect(manager.getLockInfo().state).toBe('unlocked')

      vi.advanceTimersByTime(40_000)

      expect(manager.getLockInfo().state).toBe('locked')
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes a short-lived desktop unlock lease for helper processes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const db = createSettingsDbMock()
      const manager = new VaultLockManager(new MockKeyManager() as never, db as never, defaultSettings)

      manager.transitionAfterUnlock()

      const firstLease = Number(db.settings.get('vault_lock_lease_until_ms'))
      expect(db.settings.get('vault_lock_owner_pid')).toBe(String(process.pid))
      expect(firstLease).toBe(Date.now() + 90_000)

      vi.advanceTimersByTime(30_000)

      expect(Number(db.settings.get('vault_lock_lease_until_ms'))).toBe(Date.now() + 90_000)

      manager.lock()

      expect(db.settings.get('vault_lock_lease_until_ms')).toBeUndefined()
      expect(db.settings.get('vault_lock_owner_pid')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
