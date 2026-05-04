import type Database from 'better-sqlite3'

export const LOCK_STATE_KEY = 'vault_lock_state'
export const LOCK_LEASE_UNTIL_KEY = 'vault_lock_lease_until_ms'
export const LOCK_OWNER_PID_KEY = 'vault_lock_owner_pid'

export type DesktopLockState = 'locked' | 'passcode' | 'unlocked'

const activeStates = new Set<DesktopLockState>(['passcode', 'unlocked'])

const readSetting = (db: Database.Database, key: string) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined
  return row?.value
}

const isProcessAlive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export const readRawDesktopLockState = (db: Database.Database): DesktopLockState => {
  const value = readSetting(db, LOCK_STATE_KEY)
  return value === 'unlocked' || value === 'passcode' || value === 'locked' ? value : 'locked'
}

export const readTrustedDesktopLockState = (db: Database.Database): DesktopLockState => {
  const state = readRawDesktopLockState(db)
  if (!activeStates.has(state)) {
    return 'locked'
  }

  const leaseUntil = Number(readSetting(db, LOCK_LEASE_UNTIL_KEY))
  const ownerPid = Number(readSetting(db, LOCK_OWNER_PID_KEY))
  if (!Number.isSafeInteger(leaseUntil) || leaseUntil <= Date.now() || !isProcessAlive(ownerPid)) {
    return 'locked'
  }

  return state
}
