import { randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import type Database from 'better-sqlite3'
import { decryptValue, encryptValue, type EncryptedPayload } from '@/electron/crypto'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type CreateIdentityInput,
  type IdentityProfile,
  type ItemDetails,
  type RecentAction,
  type SettingsUpdate,
  type UpdateIdentityInput,
  type UserSettings,
  type VaultSnapshot,
} from '@/shared/types'

const now = () => new Date().toISOString()
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`
const tryDecrypt = (key: Buffer, payload?: string) => {
  if (!payload) {
    return undefined
  }

  try {
    return decryptValue(key, JSON.parse(payload) as EncryptedPayload)
  } catch {
    return undefined
  }
}

export class IdentityRepository {
  private readonly db: Database.Database
  private readonly key: Buffer

  constructor(
    db: Database.Database,
    key: Buffer,
  ) {
    this.db = db
    this.key = key
  }

  getSettings(): UserSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
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
    }
  }

  updateSettings(update: SettingsUpdate) {
    const current = this.getSettings()
    const next = { ...current, ...update }
    const statement = this.db.prepare(
      'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )

    statement.run('hotkey', next.hotkey)
    statement.run('clearClipboardSeconds', String(next.clearClipboardSeconds))
    statement.run('launchOnStartup', String(next.launchOnStartup))

    return next
  }

  getSnapshot(): VaultSnapshot {
    const items = this.db
      .prepare('SELECT * FROM identities ORDER BY COALESCE(lastUsedAt, updatedAt) DESC, itemName ASC')
      .all() as Array<{
        id: string
        itemName: string
        username: string
        email?: string
        websites?: string
        notes?: string
        customFields?: string
        passwordPayload?: string
        otpPayload?: string
        hasPasskey: number
        lastUsedAt?: string
      }>
    const recents = this.db
      .prepare('SELECT id, actionId, identityId, label, usedAt FROM recent_actions ORDER BY usedAt DESC LIMIT 25')
      .all() as RecentAction[]

    return {
      items: items.map((item) => ({
        id: item.id,
        itemName: item.itemName,
        username: item.username,
        email: item.email,
        websites: item.websites ? (JSON.parse(item.websites) as string[]) : [],
        notes: item.notes,
        customFields: item.customFields
          ? (JSON.parse(item.customFields) as Array<{ id: string; label: string; value: string }>)
          : [],
        hasPassword: Boolean(item.passwordPayload),
        hasOtp: Boolean(item.otpPayload),
        hasPasskey: Boolean(item.hasPasskey),
        passwordPreview: item.passwordPayload ? '••••••••••' : undefined,
        lastUsedAt: item.lastUsedAt,
      })) satisfies IdentityProfile[],
      recents,
    }
  }

  createIdentity(input: CreateIdentityInput) {
    const itemName = input.itemName.trim()
    const username = input.username?.trim() || `${slug(itemName)}_${randomBytes(2).toString('hex')}`
    const password = input.password?.trim() || randomBytes(12).toString('base64url')
    const otp = new OTPAuth.Secret({ size: 20 }).base32
    const timestamp = now()
    const identityId = id('identity')

    this.db
      .prepare(
        `
        INSERT INTO identities (
          id, itemName, username, email, websites, notes, customFields, passwordPayload, otpPayload, hasPasskey, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        identityId,
        itemName,
        username,
        `${username}@klarkey.local`,
        JSON.stringify(input.websites ?? []),
        input.notes ?? null,
        JSON.stringify(input.customFields ?? []),
        JSON.stringify(encryptValue(this.key, password)),
        JSON.stringify(encryptValue(this.key, otp)),
        0,
        timestamp,
        timestamp,
      )

    return {
      status: 'success',
      title: 'Item created',
      message: `${itemName} is ready.`,
      identityId,
    } satisfies ActionExecutionResult
  }

  updateIdentity(input: UpdateIdentityInput) {
    const current = this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .get(input.identityId) as
      | {
          id: string
          itemName: string
          username: string
          email?: string
          websites?: string
          notes?: string
          customFields?: string
          passwordPayload?: string
        }
      | undefined

    if (!current) {
      return {
        status: 'error',
        title: 'Item missing',
        message: 'This item could not be found.',
      } satisfies ActionExecutionResult
    }

    const itemName = input.itemName?.trim() || current.itemName
    const username = input.username?.trim() || current.username
    const password =
      input.password === undefined
        ? current.passwordPayload
        : JSON.stringify(encryptValue(this.key, input.password.trim()))

    this.db
      .prepare(
        `
        UPDATE identities
        SET itemName = ?, username = ?, email = ?, websites = ?, notes = ?, customFields = ?, passwordPayload = ?, updatedAt = ?
        WHERE id = ?
      `,
      )
      .run(
        itemName,
        username,
        `${username}@klarkey.local`,
        JSON.stringify(input.websites ?? (current.websites ? JSON.parse(current.websites) : [])),
        input.notes ?? current.notes ?? null,
        JSON.stringify(input.customFields ?? (current.customFields ? JSON.parse(current.customFields) : [])),
        password ?? null,
        now(),
        input.identityId,
      )

    return {
      status: 'success',
      title: 'Item updated',
      message: `${itemName} was updated.`,
      identityId: input.identityId,
    } satisfies ActionExecutionResult
  }

  getIdentityDetails(identityId: string): ItemDetails | undefined {
    const row = this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .get(identityId) as
      | {
          id: string
          itemName: string
          username: string
          websites?: string
          notes?: string
          customFields?: string
          passwordPayload?: string
        }
      | undefined

    if (!row) {
      return undefined
    }

    return {
      identityId: row.id,
      itemName: row.itemName,
      username: row.username,
      password: tryDecrypt(this.key, row.passwordPayload),
      notes: row.notes ?? undefined,
      websites: row.websites ? (JSON.parse(row.websites) as string[]) : [],
      customFields: row.customFields
        ? (JSON.parse(row.customFields) as Array<{ id: string; label: string; value: string }>)
        : [],
    }
  }

  deleteIdentity(identityId: string) {
    const current = this.db.prepare('SELECT itemName FROM identities WHERE id = ?').get(identityId) as { itemName: string } | undefined

    if (!current) {
      return {
        status: 'error',
        title: 'Item missing',
        message: 'This item could not be found.',
      } satisfies ActionExecutionResult
    }

    this.db.prepare('DELETE FROM identities WHERE id = ?').run(identityId)
    this.db.prepare('DELETE FROM recent_actions WHERE identityId = ?').run(identityId)

    return {
      status: 'success',
      title: 'Item deleted',
      message: `${current.itemName} was deleted.`,
    } satisfies ActionExecutionResult
  }

  getPassword(identityId: string) {
    const row = this.db
      .prepare('SELECT passwordPayload FROM identities WHERE id = ?')
      .get(identityId) as { passwordPayload?: string } | undefined

    if (!row?.passwordPayload) {
      return undefined
    }

    return tryDecrypt(this.key, row.passwordPayload)
  }

  getOtp(identityId: string) {
    const row = this.db
      .prepare('SELECT otpPayload, username FROM identities WHERE id = ?')
      .get(identityId) as { otpPayload?: string; username: string } | undefined

    if (!row?.otpPayload) {
      return undefined
    }

    const secret = tryDecrypt(this.key, row.otpPayload)
    if (!secret) {
      return undefined
    }

    const totp = new OTPAuth.TOTP({
      secret,
      issuer: 'Klarkey',
      label: row.username,
      period: 30,
      digits: 6,
    })

    return totp.generate()
  }

  getUsername(identityId: string) {
    const row = this.db
      .prepare('SELECT username FROM identities WHERE id = ?')
      .get(identityId) as { username: string } | undefined
    return row?.username
  }

  remember(actionId: string, label: string, identityId?: string) {
    this.db
      .prepare(
        `
        INSERT INTO recent_actions(id, actionId, identityId, label, usedAt)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(id('recent'), actionId, identityId ?? null, label, now())

    if (identityId) {
      this.db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), identityId)
    }
  }

  markPasskey(identityId: string, label: string) {
    this.db
      .prepare('INSERT INTO passkeys(id, identityId, label, createdAt) VALUES (?, ?, ?, ?)')
      .run(id('passkey'), identityId, label, now())
    this.db.prepare('UPDATE identities SET hasPasskey = 1, updatedAt = ? WHERE id = ?').run(now(), identityId)
  }
}
