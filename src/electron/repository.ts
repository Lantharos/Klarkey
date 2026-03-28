import { randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import type Database from 'better-sqlite3'
import { decryptValue, encryptValue, type EncryptedPayload } from '@/electron/crypto'
import type { CreatableItemType } from '@/shared/item-types'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type CreateItemInput,
  type ItemDetails,
  type ItemProfile,
  type RecentAction,
  type SettingsUpdate,
  type UpdateItemInput,
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

const parseJson = <Value>(payload: string | undefined, fallback: Value) => {
  if (!payload) {
    return fallback
  }

  try {
    return JSON.parse(payload) as Value
  } catch {
    return fallback
  }
}

type ItemDataPayload = {
  fullName?: string
  phone?: string
  address?: string
  content?: string
}

const sanitizeItemData = (itemType: CreatableItemType, input: Partial<CreateItemInput>) => {
  if (itemType === 'identity') {
    return {
      fullName: input.fullName?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      address: input.address?.trim() || undefined,
    } satisfies ItemDataPayload
  }

  if (itemType === 'note') {
    return {
      content: input.content?.trim() || undefined,
    } satisfies ItemDataPayload
  }

  return {} satisfies ItemDataPayload
}

export class VaultRepository {
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
        itemType?: string
        itemName: string
        username: string
        email?: string
        websites?: string
        notes?: string
        customFields?: string
        itemData?: string
        passwordPayload?: string
        otpPayload?: string
        hasPasskey: number
        lastUsedAt?: string
      }>
    const recents = this.db
      .prepare('SELECT id, actionId, itemId, label, usedAt FROM recent_actions ORDER BY usedAt DESC LIMIT 25')
      .all() as RecentAction[]

    return {
      items: items.map((item) => {
        const itemData = parseJson<ItemDataPayload>(item.itemData, {})

        return {
          id: item.id,
          itemType: (item.itemType ?? 'login') as ItemProfile['itemType'],
          itemName: item.itemName,
          username: item.username || undefined,
          fullName: itemData.fullName,
          email: item.email,
          phone: itemData.phone,
          address: itemData.address,
          content: itemData.content,
          websites: parseJson<string[]>(item.websites, []),
          notes: item.notes,
          customFields: parseJson<Array<{ id: string; label: string; value: string }>>(item.customFields, []),
          hasPassword: Boolean(item.passwordPayload),
          hasOtp: Boolean(item.otpPayload),
          hasPasskey: Boolean(item.hasPasskey),
          passwordPreview: item.passwordPayload ? '**********' : undefined,
          lastUsedAt: item.lastUsedAt,
        }
      }),
      recents,
    }
  }

  createItem(input: CreateItemInput) {
    const itemType = input.itemType
    const itemName = input.itemName.trim()
    const username =
      itemType === 'login' ? input.username?.trim() || `${slug(itemName)}_${randomBytes(2).toString('hex')}` : ''
    const password =
      itemType === 'login' ? input.password?.trim() || randomBytes(12).toString('base64url') : undefined
    const otp = itemType === 'login' ? new OTPAuth.Secret({ size: 20 }).base32 : undefined
    const timestamp = now()
    const itemId = id('item')

    this.db
      .prepare(
        `
        INSERT INTO identities (
          id, itemType, itemName, username, email, websites, notes, customFields, itemData, passwordPayload, otpPayload, hasPasskey, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        itemId,
        itemType,
        itemName,
        username,
        input.email?.trim() || (itemType === 'login' ? `${username}@klarkey.local` : null),
        JSON.stringify(input.websites ?? []),
        input.notes ?? null,
        JSON.stringify(input.customFields ?? []),
        JSON.stringify(sanitizeItemData(itemType, input)),
        password ? JSON.stringify(encryptValue(this.key, password)) : null,
        otp ? JSON.stringify(encryptValue(this.key, otp)) : null,
        0,
        timestamp,
        timestamp,
      )

    return {
      status: 'success',
      title: 'Item created',
      message: `${itemName} is ready.`,
      itemId,
    } satisfies ActionExecutionResult
  }

  updateItem(input: UpdateItemInput) {
    const current = this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .get(input.itemId) as
      | {
          id: string
          itemType?: string
          itemName: string
          username: string
          email?: string
          websites?: string
          notes?: string
          customFields?: string
          itemData?: string
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

    const itemType = (input.itemType ?? current.itemType ?? 'login') as CreatableItemType
    const itemName = input.itemName?.trim() || current.itemName
    const username = itemType === 'login' ? input.username?.trim() || current.username : ''
    const password =
      input.password === undefined
        ? current.passwordPayload
        : JSON.stringify(encryptValue(this.key, input.password.trim()))

    this.db
      .prepare(
        `
        UPDATE identities
        SET itemType = ?, itemName = ?, username = ?, email = ?, websites = ?, notes = ?, customFields = ?, itemData = ?, passwordPayload = ?, updatedAt = ?
        WHERE id = ?
      `,
      )
      .run(
        itemType,
        itemName,
        username,
        input.email?.trim() || (itemType === 'login' ? `${username}@klarkey.local` : current.email ?? null),
        JSON.stringify(input.websites ?? parseJson<string[]>(current.websites, [])),
        input.notes ?? current.notes ?? null,
        JSON.stringify(input.customFields ?? parseJson(current.customFields, [])),
        JSON.stringify({
          ...parseJson<ItemDataPayload>(current.itemData, {}),
          ...sanitizeItemData(itemType, input),
        }),
        password ?? null,
        now(),
        input.itemId,
      )

    return {
      status: 'success',
      title: 'Item updated',
      message: `${itemName} was updated.`,
      itemId: input.itemId,
    } satisfies ActionExecutionResult
  }

  getItemDetails(itemId: string): ItemDetails | undefined {
    const row = this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .get(itemId) as
      | {
          id: string
          itemType?: string
          itemName: string
          username: string
          email?: string
          websites?: string
          notes?: string
          customFields?: string
          itemData?: string
          passwordPayload?: string
        }
      | undefined

    if (!row) {
      return undefined
    }

    const itemData = parseJson<ItemDataPayload>(row.itemData, {})

    return {
      itemId: row.id,
      itemType: (row.itemType ?? 'login') as ItemDetails['itemType'],
      itemName: row.itemName,
      username: row.username,
      password: tryDecrypt(this.key, row.passwordPayload),
      fullName: itemData.fullName,
      email: row.email ?? undefined,
      phone: itemData.phone,
      address: itemData.address,
      content: itemData.content,
      notes: row.notes ?? undefined,
      websites: parseJson<string[]>(row.websites, []),
      customFields: parseJson<Array<{ id: string; label: string; value: string }>>(row.customFields, []),
    }
  }

  deleteItem(itemId: string) {
    const current = this.db.prepare('SELECT itemName FROM identities WHERE id = ?').get(itemId) as { itemName: string } | undefined

    if (!current) {
      return {
        status: 'error',
        title: 'Item missing',
        message: 'This item could not be found.',
      } satisfies ActionExecutionResult
    }

    this.db.prepare('DELETE FROM identities WHERE id = ?').run(itemId)
    this.db.prepare('DELETE FROM recent_actions WHERE itemId = ?').run(itemId)

    return {
      status: 'success',
      title: 'Item deleted',
      message: `${current.itemName} was deleted.`,
    } satisfies ActionExecutionResult
  }

  getPassword(itemId: string) {
    const row = this.db
      .prepare('SELECT passwordPayload FROM identities WHERE id = ?')
      .get(itemId) as { passwordPayload?: string } | undefined

    if (!row?.passwordPayload) {
      return undefined
    }

    return tryDecrypt(this.key, row.passwordPayload)
  }

  getOtp(itemId: string) {
    const row = this.db
      .prepare('SELECT otpPayload, username FROM identities WHERE id = ?')
      .get(itemId) as { otpPayload?: string; username: string } | undefined

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

  getUsername(itemId: string) {
    const row = this.db
      .prepare('SELECT username FROM identities WHERE id = ?')
      .get(itemId) as { username: string } | undefined
    return row?.username
  }

  remember(actionId: string, label: string, itemId?: string) {
    this.db
      .prepare(
        `
        INSERT INTO recent_actions(id, actionId, itemId, label, usedAt)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(id('recent'), actionId, itemId ?? null, label, now())

    if (itemId) {
      this.db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), itemId)
    }
  }

  markPasskey(itemId: string, label: string) {
    this.db
      .prepare('INSERT INTO passkeys(id, itemId, label, createdAt) VALUES (?, ?, ?, ?)')
      .run(id('passkey'), itemId, label, now())
    this.db.prepare('UPDATE identities SET hasPasskey = 1, updatedAt = ? WHERE id = ?').run(now(), itemId)
  }
}
