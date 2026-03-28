import { randomBytes } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import type Database from 'better-sqlite3'
import { decryptValue, encryptValue, type EncryptedPayload } from '@/electron/crypto'
import { seedIdentities, seedServices } from '@/electron/seed'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type CreateIdentityInput,
  type ItemDetails,
  type RecentAction,
  type Service,
  type ServiceRecord,
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

  ensureSeedData(enabled: boolean) {
    const existing = this.db.prepare('SELECT COUNT(*) as count FROM services').get() as { count: number }
    if (existing.count > 0 || !enabled) {
      return
    }

    for (const serviceName of seedServices) {
      this.upsertService(serviceName)
    }

    for (const seed of seedIdentities) {
      this.createIdentity(seed)
    }

    this.db.prepare('UPDATE services SET pinned = 1 WHERE name IN (?, ?, ?)').run(
      'GitHub',
      'Discord',
      'Stripe',
    )
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
      demoDataEnabled: fromDb.demoDataEnabled === 'false' ? false : DEFAULT_SETTINGS.demoDataEnabled,
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
    statement.run('demoDataEnabled', String(next.demoDataEnabled))

    return next
  }

  getSnapshot(): VaultSnapshot {
    const services = this.db.prepare('SELECT * FROM services ORDER BY pinned DESC, name ASC').all() as Array<{
      id: string
      name: string
      aliases: string
      pinned: number
    }>
    const identities = this.db
      .prepare('SELECT * FROM identities ORDER BY COALESCE(lastUsedAt, updatedAt) DESC, label ASC')
      .all() as Array<{
        id: string
        serviceId: string
        label: string
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
      .prepare('SELECT * FROM recent_actions ORDER BY usedAt DESC LIMIT 25')
      .all() as RecentAction[]

    const records: ServiceRecord[] = services.map((service) => ({
      service: {
        id: service.id,
        name: service.name,
        aliases: JSON.parse(service.aliases) as string[],
        pinned: Boolean(service.pinned),
      },
      identities: identities
        .filter((identity) => identity.serviceId === service.id)
        .map((identity) => ({
          id: identity.id,
          serviceId: identity.serviceId,
          label: identity.label,
          username: identity.username,
          email: identity.email,
          websites: identity.websites ? (JSON.parse(identity.websites) as string[]) : [],
          notes: identity.notes,
          customFields: identity.customFields
            ? (JSON.parse(identity.customFields) as Array<{ id: string; label: string; value: string }>)
            : [],
          hasPassword: Boolean(identity.passwordPayload),
          hasOtp: Boolean(identity.otpPayload),
          hasPasskey: Boolean(identity.hasPasskey),
          passwordPreview: identity.passwordPayload ? '••••••••••' : undefined,
          lastUsedAt: identity.lastUsedAt,
        })),
    }))

    return { records, recents }
  }

  createIdentity(input: CreateIdentityInput) {
    const service = this.upsertService(input.serviceName)
    const label = input.preferredLabel?.trim() || ''
    const username = input.username?.trim() || `${slug(service.name)}_${randomBytes(2).toString('hex')}`
    const password = input.password?.trim() || randomBytes(12).toString('base64url')
    const otp = new OTPAuth.Secret({ size: 20 }).base32
    const timestamp = now()
    const identityId = id('identity')

    this.db
      .prepare(
        `
        INSERT INTO identities (
          id, serviceId, label, username, email, websites, notes, customFields, passwordPayload, otpPayload, hasPasskey, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        identityId,
        service.id,
        label,
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
      title: 'Login item created',
      message: `${service.name} is ready.`,
      identityId,
      serviceId: service.id,
    } satisfies ActionExecutionResult
  }

  updateIdentity(input: UpdateIdentityInput) {
    const current = this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .get(input.identityId) as
      | {
          id: string
          serviceId: string
          label: string
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

    const serviceName =
      input.serviceName?.trim() ||
      (this.db.prepare('SELECT name FROM services WHERE id = ?').get(current.serviceId) as { name: string }).name
    const service = this.upsertService(serviceName)
    const password =
      input.password === undefined
        ? current.passwordPayload
        : JSON.stringify(encryptValue(this.key, input.password.trim()))

    this.db
      .prepare(
        `
        UPDATE identities
        SET serviceId = ?, label = ?, username = ?, email = ?, websites = ?, notes = ?, customFields = ?, passwordPayload = ?, updatedAt = ?
        WHERE id = ?
      `,
      )
      .run(
        service.id,
        input.preferredLabel?.trim() || current.label,
        input.username?.trim() || current.username,
        `${(input.username?.trim() || current.username)}@klarkey.local`,
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
      message: `${service.name} was updated.`,
      identityId: input.identityId,
      serviceId: service.id,
    } satisfies ActionExecutionResult
  }

  getIdentityDetails(identityId: string): ItemDetails | undefined {
    const row = this.db
      .prepare(
        `
        SELECT identities.*, services.name as serviceName
        FROM identities
        JOIN services ON services.id = identities.serviceId
        WHERE identities.id = ?
      `,
      )
      .get(identityId) as
      | {
          id: string
          serviceId: string
          serviceName: string
          label: string
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
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      preferredLabel: row.label,
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
    const current = this.db.prepare('SELECT label FROM identities WHERE id = ?').get(identityId) as { label: string } | undefined
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
      message: `${current.label} was deleted.`,
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

  remember(actionId: string, label: string, serviceId?: string, identityId?: string) {
    this.db
      .prepare(
        `
        INSERT INTO recent_actions(id, actionId, serviceId, identityId, label, usedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(id('recent'), actionId, serviceId ?? null, identityId ?? null, label, now())

    if (identityId) {
      this.db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), identityId)
    }
  }

  markPasskey(identityId: string, serviceId: string, label: string) {
    this.db
      .prepare('INSERT INTO passkeys(id, identityId, serviceId, label, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id('passkey'), identityId, serviceId, label, now())
    this.db.prepare('UPDATE identities SET hasPasskey = 1, updatedAt = ? WHERE id = ?').run(now(), identityId)
  }

  private upsertService(name: string): Service {
    const existing = this.db.prepare('SELECT * FROM services WHERE LOWER(name) = LOWER(?)').get(name) as
      | {
          id: string
          name: string
          aliases: string
          pinned: number
        }
      | undefined

    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        aliases: JSON.parse(existing.aliases) as string[],
        pinned: Boolean(existing.pinned),
      }
    }

    const service: Service = {
      id: id('service'),
      name,
      aliases: [slug(name), name.toLowerCase()],
      pinned: false,
    }

    this.db
      .prepare('INSERT INTO services(id, name, aliases, pinned) VALUES (?, ?, ?, ?)')
      .run(service.id, service.name, JSON.stringify(service.aliases), 0)

    return service
  }
}
