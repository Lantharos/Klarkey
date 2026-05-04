import type Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countRecordStates, countSyncConflicts, ensureSyncAccountState, getSyncMeta, setSyncMeta } from '@/electron/sync/state'

class SyncStateDbMock {
  metadata = new Map<string, string>()
  recordStates = new Map<string, unknown>()
  conflicts: unknown[] = []

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized === 'SELECT value FROM sync_metadata WHERE key = ?') {
      return {
        get: (key: string) => {
          const value = this.metadata.get(key)
          return value === undefined ? undefined : { value }
        },
      }
    }
    if (normalized.startsWith('INSERT INTO sync_metadata(key, value) VALUES (?, ?)')) {
      return {
        run: (key: string, value: string) => {
          this.metadata.set(key, value)
          return { changes: 1 }
        },
      }
    }
    if (normalized === 'DELETE FROM sync_record_state') {
      return {
        run: () => {
          const changes = this.recordStates.size
          this.recordStates.clear()
          return { changes }
        },
      }
    }
    if (normalized === 'DELETE FROM sync_conflicts') {
      return {
        run: () => {
          const changes = this.conflicts.length
          this.conflicts = []
          return { changes }
        },
      }
    }
    if (normalized.startsWith('DELETE FROM sync_metadata WHERE key IN')) {
      return {
        run: (...keys: string[]) => {
          let changes = 0
          for (const key of keys) {
            if (this.metadata.delete(key)) {
              changes += 1
            }
          }
          return { changes }
        },
      }
    }
    if (normalized === 'SELECT COUNT(*) AS count FROM sync_record_state') {
      return {
        get: () => ({ count: this.recordStates.size }),
      }
    }
    if (normalized === 'SELECT COUNT(*) AS count FROM sync_conflicts') {
      return {
        get: () => ({ count: this.conflicts.length }),
      }
    }
    throw new Error(`Unexpected SQL: ${normalized}`)
  }

  transaction<Args extends unknown[]>(handler: (...args: Args) => void) {
    return (...args: Args) => handler(...args)
  }
}

function dbMock() {
  return new SyncStateDbMock() as never as Database.Database
}

describe('desktop sync account state', () => {
  it('resets account-scoped sync cursors and record state when the Ave identity changes', () => {
    const db = dbMock()
    setSyncMeta(db, 'syncAccountAveIdentityId', 'old-account')
    setSyncMeta(db, 'lastServerSequence', '42')
    setSyncMeta(db, 'lastDeviceRegisteredAt', '123')
    setSyncMeta(db, 'lastSyncAt', '2026-05-04T00:00:00.000Z')
    setSyncMeta(db, 'lastSyncError', 'old error')
    setSyncMeta(db, 'deviceId', 'device_1')
    const rawDb = db as never as SyncStateDbMock
    rawDb.recordStates.set('item:item_1', {})
    rawDb.conflicts.push({})

    expect(ensureSyncAccountState(db, 'old-account')).toBe(false)
    expect(countRecordStates(db)).toBe(1)

    expect(ensureSyncAccountState(db, 'new-account')).toBe(true)
    expect(countRecordStates(db)).toBe(0)
    expect(countSyncConflicts(db)).toBe(0)
    expect(getSyncMeta(db, 'syncAccountAveIdentityId')).toBe('new-account')
    expect(getSyncMeta(db, 'lastServerSequence')).toBeUndefined()
    expect(getSyncMeta(db, 'lastDeviceRegisteredAt')).toBeUndefined()
    expect(getSyncMeta(db, 'lastSyncAt')).toBeUndefined()
    expect(getSyncMeta(db, 'lastSyncError')).toBeUndefined()
    expect(getSyncMeta(db, 'deviceId')).toBe('device_1')
  })

  it('checks the signed-in account before desktop sync uses local cursors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/sync/manager.ts'), 'utf8')

    expect(source).toContain('ensureSyncAccountState(this.db, session.account.aveIdentityId)')
    expect(source).toContain('writeSyncSession(session)')
    expect(source).toContain('const client = this.client(config, session)')
  })
})
