import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { insertIdentity } from '@/electron/repository/identity-crud'
import { loadItemDetails } from '@/electron/repository/item-details'
import { buildVaultSnapshot } from '@/electron/repository/vault-snapshot'
import { VaultRepository } from '@/electron/repository'

function createMemoryDb() {
  return new MemoryVaultDb() as unknown as Database.Database
}

type IdentityRow = {
  id: string
  itemType: string
  itemName: string
  username: string
  email: string | null
  websites: string
  notes: string | null
  customFields: string | null
  itemData: string | null
  passwordPayload: string | null
  otpPayload: string | null
  hasPasskey: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

type PasskeyRow = {
  id: string
  itemId: string
  label: string
  credentialId: string | null
  rpId: string | null
  userName: string | null
  createdAt: string
  lastUsedAt: string | null
}

type RecentActionRow = {
  id: string
  actionId: string
  itemId: string | null
  label: string
  usedAt: string
}

class MemoryVaultDb {
  identities = new Map<string, IdentityRow>()
  passkeys: PasskeyRow[] = []
  recents: RecentActionRow[] = []
  pendingPasskeys: Array<{ createdAt: string }> = []

  prepare(sql: string) {
    return new MemoryStatement(this, sql)
  }
}

class MemoryStatement {
  private db: MemoryVaultDb
  private sql: string

  constructor(
    db: MemoryVaultDb,
    sql: string,
  ) {
    this.db = db
    this.sql = sql.replace(/\s+/g, ' ').trim()
  }

  run(...args: unknown[]) {
    if (this.sql.startsWith('INSERT INTO identities') && this.sql.includes('passwordPayload')) {
      const [
        id,
        itemType,
        itemName,
        username,
        email,
        websites,
        notes,
        customFields,
        itemData,
        passwordPayload,
        otpPayload,
        hasPasskey,
        createdAt,
        updatedAt,
      ] = args as Array<string | number | null>

      this.db.identities.set(String(id), {
        id: String(id),
        itemType: String(itemType),
        itemName: String(itemName),
        username: String(username),
        email: toNullableString(email),
        websites: String(websites ?? '[]'),
        notes: toNullableString(notes),
        customFields: toNullableString(customFields),
        itemData: toNullableString(itemData),
        passwordPayload: toNullableString(passwordPayload),
        otpPayload: toNullableString(otpPayload),
        hasPasskey: Number(hasPasskey),
        lastUsedAt: null,
        createdAt: String(createdAt),
        updatedAt: String(updatedAt),
      })
      return { changes: 1 }
    }

    if (this.sql.startsWith('INSERT INTO identities')) {
      const [
        id,
        itemType,
        itemName,
        username,
        email,
        websites,
        notes,
        customFields,
        itemData,
        hasPasskey,
        createdAt,
        updatedAt,
      ] = args as Array<string | number | null>

      this.db.identities.set(String(id), {
        id: String(id),
        itemType: String(itemType),
        itemName: String(itemName),
        username: String(username),
        email: toNullableString(email),
        websites: String(websites ?? '[]'),
        notes: toNullableString(notes),
        customFields: toNullableString(customFields),
        itemData: toNullableString(itemData),
        passwordPayload: null,
        otpPayload: null,
        hasPasskey: Number(hasPasskey),
        lastUsedAt: null,
        createdAt: String(createdAt),
        updatedAt: String(updatedAt),
      })
      return { changes: 1 }
    }

    if (this.sql === 'UPDATE identities SET email = ?, itemData = ?, notes = NULL, customFields = NULL WHERE id = ?') {
      const [email, itemData, id] = args as [string | null, string, string]
      const row = this.db.identities.get(id)
      if (!row) {
        return { changes: 0 }
      }

      row.email = toNullableString(email)
      row.itemData = itemData
      row.notes = null
      row.customFields = null
      return { changes: 1 }
    }

    if (this.sql === 'DELETE FROM pending_passkeys WHERE createdAt < ?') {
      const [cutoff] = args as [string]
      const originalLength = this.db.pendingPasskeys.length
      this.db.pendingPasskeys = this.db.pendingPasskeys.filter((row) => row.createdAt >= cutoff)
      return { changes: originalLength - this.db.pendingPasskeys.length }
    }

    if (this.sql === 'DELETE FROM pending_passkeys') {
      const originalLength = this.db.pendingPasskeys.length
      this.db.pendingPasskeys = []
      return { changes: originalLength }
    }

    throw new Error(`Unsupported run SQL: ${this.sql}`)
  }

  get(...args: unknown[]) {
    if (this.sql === 'SELECT itemData, notes, customFields FROM identities WHERE id = ?') {
      const row = this.getIdentity(args[0])
      return row ? pick(row, ['itemData', 'notes', 'customFields']) : undefined
    }

    if (this.sql === 'SELECT email, itemData, notes, customFields FROM identities WHERE id = ?') {
      const row = this.getIdentity(args[0])
      return row ? pick(row, ['email', 'itemData', 'notes', 'customFields']) : undefined
    }

    if (this.sql === 'SELECT * FROM identities WHERE id = ?') {
      return this.cloneIdentity(args[0])
    }

    throw new Error(`Unsupported get SQL: ${this.sql}`)
  }

  all(...args: unknown[]) {
    if (this.sql === 'SELECT id, itemType, email, itemData, notes, customFields FROM identities') {
      return Array.from(this.db.identities.values()).map((row) =>
        pick(row, ['id', 'itemType', 'email', 'itemData', 'notes', 'customFields']),
      )
    }

    if (this.sql === 'SELECT * FROM identities ORDER BY COALESCE(lastUsedAt, updatedAt) DESC, itemName ASC') {
      return Array.from(this.db.identities.values()).map((row) => ({ ...row }))
    }

    if (this.sql === 'SELECT DISTINCT itemId FROM passkeys WHERE itemId IS NOT NULL') {
      return Array.from(new Set(this.db.passkeys.map((row) => row.itemId))).map((itemId) => ({ itemId }))
    }

    if (this.sql === 'SELECT id, actionId, itemId, label, usedAt FROM recent_actions ORDER BY usedAt DESC LIMIT 25') {
      return this.db.recents.map((row) => ({ ...row }))
    }

    if (
      this.sql ===
      'SELECT id, label, credentialId, rpId, userName, createdAt, lastUsedAt FROM passkeys WHERE itemId = ? ORDER BY COALESCE(lastUsedAt, createdAt) DESC, createdAt DESC'
    ) {
      const [itemId] = args as [string]
      return this.db.passkeys.filter((row) => row.itemId === itemId).map((row) => ({ ...row }))
    }

    throw new Error(`Unsupported all SQL: ${this.sql}`)
  }

  private getIdentity(value: unknown) {
    return typeof value === 'string' ? this.db.identities.get(value) : undefined
  }

  private cloneIdentity(value: unknown) {
    const row = this.getIdentity(value)
    return row ? { ...row } : undefined
  }
}

function toNullableString(value: unknown) {
  return value === undefined || value === null ? null : String(value)
}

function pick<Row extends Record<string, unknown>, Key extends keyof Row>(row: Row, keys: Key[]) {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<Row, Key>
}

describe('desktop repository secret lifecycle', () => {
  it('encrypts item data and redacts it from locked snapshots', () => {
    const db = createMemoryDb()
    const key = Buffer.alloc(32, 3)

    const result = insertIdentity(db, key, {
      itemType: 'card',
      itemName: 'Travel card',
      cardholderName: 'Krist Doe',
      cardNumber: '4111 1111 1111 1111',
      cardCvc: '123',
      notes: 'backup card',
      customFields: [{ id: 'pin', label: 'PIN', value: '9876' }],
    })

    const row = db.prepare('SELECT itemData, notes, customFields FROM identities WHERE id = ?').get(result.itemId) as {
      itemData: string
      notes: string | null
      customFields: string | null
    }

    expect(row.itemData).not.toContain('4111111111111111')
    expect(row.itemData).not.toContain('9876')
    expect(row.notes).toBeNull()
    expect(row.customFields).toBeNull()

    const lockedSnapshot = buildVaultSnapshot(db)
    expect(lockedSnapshot.items[0].cardNumber).toBeUndefined()
    expect(lockedSnapshot.items[0].cardCvc).toBeUndefined()
    expect(lockedSnapshot.items[0].customFields).toEqual([])

    const unlockedSnapshot = buildVaultSnapshot(db, key)
    expect(unlockedSnapshot.items[0].cardLastFour).toBe('1111')
    expect(unlockedSnapshot.items[0].cardCvc).toBe('123')

    const details = loadItemDetails(db, key, result.itemId!)
    expect(details?.cardNumber).toBe('4111111111111111')
    expect(details?.notes).toBe('backup card')
    expect(details?.customFields[0]).toMatchObject({ label: 'PIN', value: '9876' })
  })

  it('does not zero the key manager buffer when clearing repository state', () => {
    const db = createMemoryDb()
    const key = Buffer.alloc(32, 9)
    const repository = new VaultRepository(db, key)

    repository.clearKey()

    expect(key.equals(Buffer.alloc(32, 9))).toBe(true)
  })

  it('clears pending browser passkey material when clearing repository state', () => {
    const db = createMemoryDb() as unknown as MemoryVaultDb
    const repository = new VaultRepository(db as unknown as Database.Database, Buffer.alloc(32, 9))
    db.pendingPasskeys = [
      { createdAt: '2026-05-04T12:00:00.000Z' },
      { createdAt: '2026-05-04T12:01:00.000Z' },
    ]

    repository.clearKey()

    expect(db.pendingPasskeys).toEqual([])
  })
})
