import { describe, expect, it, vi } from 'vitest'
import {
  LOCK_LEASE_UNTIL_KEY,
  LOCK_OWNER_PID_KEY,
  LOCK_STATE_KEY,
  readRawDesktopLockState,
  readTrustedDesktopLockState,
} from '@/electron/desktop-lock-lease'

function createSettingsDbMock(values: Record<string, string>) {
  return {
    prepare(sql: string) {
      if (sql.startsWith('SELECT value FROM settings WHERE key = ?')) {
        return {
          get(key: string) {
            const value = values[key]
            return value === undefined ? undefined : { value }
          },
        }
      }

      throw new Error(`Unsupported SQL in test mock: ${sql}`)
    },
  }
}

describe('desktop lock lease', () => {
  it('keeps raw persisted state parsing separate from trusted helper state', () => {
    const db = createSettingsDbMock({ [LOCK_STATE_KEY]: 'unlocked' }) as never

    expect(readRawDesktopLockState(db)).toBe('unlocked')
    expect(readTrustedDesktopLockState(db)).toBe('locked')
  })

  it('trusts active unlock state only while the desktop owner lease is fresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const db = createSettingsDbMock({
        [LOCK_STATE_KEY]: 'unlocked',
        [LOCK_LEASE_UNTIL_KEY]: String(Date.now() + 60_000),
        [LOCK_OWNER_PID_KEY]: String(process.pid),
      }) as never

      expect(readTrustedDesktopLockState(db)).toBe('unlocked')

      vi.advanceTimersByTime(60_001)

      expect(readTrustedDesktopLockState(db)).toBe('locked')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects active state owned by a missing process', () => {
    const db = createSettingsDbMock({
      [LOCK_STATE_KEY]: 'unlocked',
      [LOCK_LEASE_UNTIL_KEY]: String(Date.now() + 60_000),
      [LOCK_OWNER_PID_KEY]: '999999999',
    }) as never

    expect(readTrustedDesktopLockState(db)).toBe('locked')
  })
})
