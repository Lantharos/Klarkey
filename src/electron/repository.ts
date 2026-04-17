import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { scoreWebsiteMatch } from '@/shared/browser-extension'
import { normalizeCredentialId } from '@/shared/passkey-encoding'
import { decryptValue, encryptValue, type EncryptedPayload } from '@/electron/crypto'
import { createSitePasskeyCredential, getSitePasskeyAssertion } from '@/electron/site-passkey-authenticator'
import type { CreatableItemType } from '@/shared/item-types'
import { getTotpCode, parseStoredTotp, parseTotpInput } from '@/shared/totp'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type BrowserAuthFlow,
  type BrowserFillCard,
  type BrowserFieldSuggestion,
  type BrowserFillLogin,
  type BrowserPasskeyChoice,
  type BrowserPasskeySavePlan,
  type BrowserPasskeyStatus,
  type BrowserSaveLoginInput,
  type BrowserSiteMatch,
  type BrowserSuggestionField,
  type CreateVaultPasskeyInput,
  type CreateItemInput,
  type ItemDetails,
  type ItemProfile,
  type RecentAction,
  type SettingsUpdate,
  type UpdateItemInput,
  type UserSettings,
  type VaultPasskeyRecord,
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

const getOtpFallback = ({
  itemName,
  username,
  existing,
}: {
  itemName: string
  username: string
  existing?: ItemDetails['otp']
}) => ({
  issuer: existing?.issuer ?? itemName,
  accountName: existing?.accountName ?? username ?? itemName,
  digits: existing?.digits,
  period: existing?.period,
  algorithm: existing?.algorithm,
})

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

const parseOptionalJson = <Value>(payload?: string) => {
  if (!payload) {
    return undefined
  }

  try {
    return JSON.parse(payload) as Value
  } catch {
    return undefined
  }
}

const getHostname = (value: string) => {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

const hasText = (value?: string) => Boolean(value?.trim())
const getHostnameLabel = (value: string) => {
  const hostname = getHostname(value) ?? value
  const [label] = hostname.toLowerCase().split('.')
  return label || ''
}
const normalizeSearchText = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || ''
const normalizeLooseDigits = (value?: string) => value?.replace(/\D+/g, '') || ''
const isExactBrowserAccountMatch = (existingValue: string | undefined, nextValue: string | undefined) =>
  Boolean(normalizeSearchText(existingValue) && normalizeSearchText(existingValue) === normalizeSearchText(nextValue))
const joinIdentityFullName = (value: Pick<ItemDataPayload, 'fullName' | 'firstName' | 'middleName' | 'lastName'>) =>
  value.fullName?.trim() ||
  [value.firstName, value.middleName, value.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ') ||
  undefined
const joinIdentityAddress = (
  value: Pick<ItemDataPayload, 'address' | 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country'>,
) =>
  value.address?.trim() ||
  [
    [value.addressLine1, value.addressLine2].map((part) => part?.trim()).filter(Boolean).join(', '),
    [value.city, value.state, value.postalCode].map((part) => part?.trim()).filter(Boolean).join(', '),
    value.country?.trim(),
  ]
    .filter(Boolean)
    .join(', ') ||
  undefined
const splitCardExpiry = (value?: string) => {
  const cleaned = value?.trim()
  if (!cleaned) {
    return { month: undefined, year: undefined }
  }

  const [rawMonth, rawYear] = cleaned.split(/[/-]/).map((part) => part?.trim())
  const month = rawMonth?.replace(/\D+/g, '') || undefined
  const year = rawYear?.replace(/\D+/g, '') || undefined
  return { month, year }
}
const joinCardExpiry = (value: Pick<ItemDataPayload, 'cardExpiry' | 'cardExpiryMonth' | 'cardExpiryYear'>) =>
  value.cardExpiry?.trim() ||
  (value.cardExpiryMonth?.trim() && value.cardExpiryYear?.trim()
    ? `${value.cardExpiryMonth.trim()}/${value.cardExpiryYear.trim()}`
    : undefined)
const getCardLastFour = (value?: string) => {
  const digits = normalizeLooseDigits(value)
  return digits.length >= 4 ? digits.slice(-4) : undefined
}
const scoreTextHit = (target: string, query: string, exactScore: number, includesScore: number) => {
  if (!target || !query) {
    return 0
  }

  if (target === query) {
    return exactScore
  }

  return target.includes(query) ? includesScore : 0
}

type ItemDataPayload = {
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  content?: string
}

type PasskeyRow = {
  id: string
  itemId: string
  label: string
  credentialId?: string
  rpId?: string
  userName?: string
  userHandle?: string
  transports?: string
  privateKeyPayload?: string
  signCount?: number
  createdAt: string
  lastUsedAt?: string
}

type PendingPasskeyRow = {
  id: string
  label: string
  credentialId: string
  rpId?: string
  userName?: string
  userHandle?: string
  transports?: string
  privateKeyPayload: string
  createdAt: string
}

type BrowserRequestCredential = {
  id: unknown
  type: 'public-key'
  transports?: string[]
}

type BrowserRequestOptions = {
  rpId?: string
  allowCredentials?: BrowserRequestCredential[]
  user?: {
    name?: string
    displayName?: string
  }
  rp?: {
    id?: string
    name?: string
  }
}

const sanitizeItemData = (itemType: CreatableItemType, input: Partial<CreateItemInput>) => {
  if (itemType === 'identity') {
    const itemData = {
      fullName: input.fullName?.trim() || undefined,
      firstName: input.firstName?.trim() || undefined,
      middleName: input.middleName?.trim() || undefined,
      lastName: input.lastName?.trim() || undefined,
      company: input.company?.trim() || undefined,
      jobTitle: input.jobTitle?.trim() || undefined,
      birthDate: input.birthDate?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      address: input.address?.trim() || undefined,
      addressLine1: input.addressLine1?.trim() || undefined,
      addressLine2: input.addressLine2?.trim() || undefined,
      city: input.city?.trim() || undefined,
      state: input.state?.trim() || undefined,
      postalCode: input.postalCode?.trim() || undefined,
      country: input.country?.trim() || undefined,
    } satisfies ItemDataPayload

    return {
      ...itemData,
      fullName: joinIdentityFullName(itemData),
      address: joinIdentityAddress(itemData),
    } satisfies ItemDataPayload
  }

  if (itemType === 'note') {
    return {
      content: input.content?.trim() || undefined,
    } satisfies ItemDataPayload
  }

  if (itemType === 'card') {
    const parsedExpiry = splitCardExpiry(input.cardExpiry)
    const itemData = {
      cardholderName: input.cardholderName?.trim() || undefined,
      cardNumber: normalizeLooseDigits(input.cardNumber?.trim()),
      cardExpiry: input.cardExpiry?.trim() || undefined,
      cardExpiryMonth: input.cardExpiryMonth?.trim() || parsedExpiry.month,
      cardExpiryYear: input.cardExpiryYear?.trim() || parsedExpiry.year,
      cardCvc: input.cardCvc?.trim() || undefined,
      cardBrand: input.cardBrand?.trim() || undefined,
      billingPostalCode: input.billingPostalCode?.trim() || undefined,
    } satisfies ItemDataPayload

    return {
      ...itemData,
      cardExpiry: joinCardExpiry(itemData),
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
    this.prunePendingPasskeys()
  }

  private prunePendingPasskeys() {
    const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
    this.db.prepare('DELETE FROM pending_passkeys WHERE createdAt < ?').run(cutoff)
  }

  private syncItemPasskeyState(itemId: string) {
    const hasPasskey = Boolean(this.db.prepare('SELECT 1 FROM passkeys WHERE itemId = ? LIMIT 1').get(itemId))
    this.db.prepare('UPDATE identities SET hasPasskey = ?, updatedAt = ? WHERE id = ?').run(hasPasskey ? 1 : 0, now(), itemId)
  }

  private replaceItemPasskey(itemId: string, keepPasskeyId?: string) {
    if (keepPasskeyId) {
      this.db.prepare('DELETE FROM passkeys WHERE itemId = ? AND id != ?').run(itemId, keepPasskeyId)
      return
    }

    this.db.prepare('DELETE FROM passkeys WHERE itemId = ?').run(itemId)
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
      browserAutoOpenMenu: fromDb.browserAutoOpenMenu === 'false' ? false : DEFAULT_SETTINGS.browserAutoOpenMenu,
      browserAutoSubmitLogin: fromDb.browserAutoSubmitLogin === 'false' ? false : DEFAULT_SETTINGS.browserAutoSubmitLogin,
      browserSavePrompts: fromDb.browserSavePrompts === 'false' ? false : DEFAULT_SETTINGS.browserSavePrompts,
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
    statement.run('browserAutoOpenMenu', String(next.browserAutoOpenMenu))
    statement.run('browserAutoSubmitLogin', String(next.browserAutoSubmitLogin))
    statement.run('browserSavePrompts', String(next.browserSavePrompts))

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
        const fullName = joinIdentityFullName(itemData)
        const address = joinIdentityAddress(itemData)
        const cardExpiry = joinCardExpiry(itemData)
        const cardLastFour = getCardLastFour(itemData.cardNumber)

        return {
          id: item.id,
          itemType: (item.itemType ?? 'login') as ItemProfile['itemType'],
          itemName: item.itemName,
          username: item.username || undefined,
          fullName,
          firstName: itemData.firstName,
          middleName: itemData.middleName,
          lastName: itemData.lastName,
          company: itemData.company,
          jobTitle: itemData.jobTitle,
          birthDate: itemData.birthDate,
          email: item.email,
          phone: itemData.phone,
          address,
          addressLine1: itemData.addressLine1,
          addressLine2: itemData.addressLine2,
          city: itemData.city,
          state: itemData.state,
          postalCode: itemData.postalCode,
          country: itemData.country,
          cardholderName: itemData.cardholderName,
          cardNumber: itemData.cardNumber,
          cardLastFour,
          cardExpiry,
          cardExpiryMonth: itemData.cardExpiryMonth,
          cardExpiryYear: itemData.cardExpiryYear,
          cardCvc: itemData.cardCvc,
          cardBrand: itemData.cardBrand,
          billingPostalCode: itemData.billingPostalCode,
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
      itemType === 'login'
        ? input.username?.trim() || `${slug(itemName)}_${randomBytes(2).toString('hex')}`
        : itemType === 'identity'
          ? input.username?.trim() || ''
          : ''
    const password =
      itemType === 'login'
        ? input.password?.trim() || (input.preserveEmptyPassword ? undefined : randomBytes(12).toString('base64url'))
        : undefined
    const otp =
      itemType === 'login'
        ? parseTotpInput(input.otp, {
            issuer: itemName,
            accountName: username || itemName,
          })
        : undefined
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
        otp ? JSON.stringify(encryptValue(this.key, JSON.stringify(otp))) : null,
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
          otpPayload?: string
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
    const username =
      itemType === 'login'
        ? input.username?.trim() || current.username
        : itemType === 'identity'
          ? input.username?.trim() || current.username
          : ''
    const password =
      input.password === undefined
        ? current.passwordPayload
        : input.password.trim()
          ? JSON.stringify(encryptValue(this.key, input.password.trim()))
          : null
    const currentOtp = parseStoredTotp(tryDecrypt(this.key, current.otpPayload), {
      issuer: itemName,
      accountName: username || itemName,
    })
    const otp =
      input.otp === undefined
        ? current.otpPayload
        : input.otp.trim()
          ? JSON.stringify(
              encryptValue(
                this.key,
                JSON.stringify(
                  parseTotpInput(
                    input.otp,
                    getOtpFallback({
                      itemName,
                      username,
                      existing: currentOtp,
                    }),
                  ),
                ),
              ),
            )
          : null

    this.db
      .prepare(
        `
        UPDATE identities
        SET itemType = ?, itemName = ?, username = ?, email = ?, websites = ?, notes = ?, customFields = ?, itemData = ?, passwordPayload = ?, otpPayload = ?, updatedAt = ?
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
        otp,
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
          otpPayload?: string
        }
      | undefined

    if (!row) {
      return undefined
    }

    const passkeys = this.db
      .prepare(
        `
        SELECT id, label, credentialId, rpId, userName, createdAt, lastUsedAt
        FROM passkeys
        WHERE itemId = ?
        ORDER BY COALESCE(lastUsedAt, createdAt) DESC, createdAt DESC
      `,
      )
      .all(itemId) as Array<{
        id: string
        label: string
        credentialId?: string
        rpId?: string
        userName?: string
        createdAt: string
        lastUsedAt?: string
      }>

    const itemData = parseJson<ItemDataPayload>(row.itemData, {})
    const fullName = joinIdentityFullName(itemData)
    const address = joinIdentityAddress(itemData)
    const cardExpiry = joinCardExpiry(itemData)
    const otp = parseStoredTotp(tryDecrypt(this.key, row.otpPayload), {
      issuer: row.itemName,
      accountName: row.username || row.itemName,
    })

    return {
      itemId: row.id,
      itemType: (row.itemType ?? 'login') as ItemDetails['itemType'],
      itemName: row.itemName,
      username: row.username,
      password: tryDecrypt(this.key, row.passwordPayload),
      otp,
      fullName,
      firstName: itemData.firstName,
      middleName: itemData.middleName,
      lastName: itemData.lastName,
      company: itemData.company,
      jobTitle: itemData.jobTitle,
      birthDate: itemData.birthDate,
      email: row.email ?? undefined,
      phone: itemData.phone,
      address,
      addressLine1: itemData.addressLine1,
      addressLine2: itemData.addressLine2,
      city: itemData.city,
      state: itemData.state,
      postalCode: itemData.postalCode,
      country: itemData.country,
      cardholderName: itemData.cardholderName,
      cardNumber: itemData.cardNumber,
      cardLastFour: getCardLastFour(itemData.cardNumber),
      cardExpiry,
      cardExpiryMonth: itemData.cardExpiryMonth,
      cardExpiryYear: itemData.cardExpiryYear,
      cardCvc: itemData.cardCvc,
      cardBrand: itemData.cardBrand,
      billingPostalCode: itemData.billingPostalCode,
      content: itemData.content,
      notes: row.notes ?? undefined,
      websites: parseJson<string[]>(row.websites, []),
      customFields: parseJson<Array<{ id: string; label: string; value: string }>>(row.customFields, []),
      passkeys,
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

    this.db.prepare('DELETE FROM passkeys WHERE itemId = ? OR identityId = ?').run(itemId, itemId)
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
      .prepare('SELECT otpPayload, itemName, username FROM identities WHERE id = ?')
      .get(itemId) as { otpPayload?: string; itemName: string; username: string } | undefined

    if (!row?.otpPayload) {
      return undefined
    }

    const details = parseStoredTotp(tryDecrypt(this.key, row.otpPayload), {
      issuer: row.itemName,
      accountName: row.username || row.itemName,
    })
    if (!details) {
      return undefined
    }

    return getTotpCode(details).value
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
    this.replaceItemPasskey(itemId)
    this.db
      .prepare('INSERT INTO passkeys(id, identityId, itemId, label, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(id('passkey'), itemId, itemId, label, now())
    this.syncItemPasskeyState(itemId)
  }

  listVaultPasskeys(): VaultPasskeyRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, label, credentialId, transports, createdAt, lastUsedAt
        FROM vault_passkeys
        ORDER BY COALESCE(lastUsedAt, createdAt) DESC, createdAt DESC
      `,
      )
      .all() as Array<{
        id: string
        label: string
        credentialId: string
        transports?: string
        createdAt: string
        lastUsedAt?: string
      }>

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      credentialId: row.credentialId,
      transports: parseJson<string[]>(row.transports, []),
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    }))
  }

  createVaultPasskey(input: CreateVaultPasskeyInput) {
    const label = input.label.trim() || 'Klarkey passkey'
    const existing = this.db
      .prepare('SELECT id, label FROM vault_passkeys WHERE credentialId = ?')
      .get(input.credentialId) as { id: string; label: string } | undefined

    if (existing) {
      this.db
        .prepare('UPDATE vault_passkeys SET label = ?, transports = ?, lastUsedAt = ? WHERE id = ?')
        .run(label, JSON.stringify(input.transports ?? []), now(), existing.id)

      return {
        status: 'success',
        title: 'Passkey ready',
        message: `${existing.label} is already enrolled on this device.`,
      } satisfies ActionExecutionResult
    }

    this.db
      .prepare(
        `
        INSERT INTO vault_passkeys(id, label, credentialId, transports, createdAt, lastUsedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(id('vault_passkey'), label, input.credentialId, JSON.stringify(input.transports ?? []), now(), now())

    return {
      status: 'success',
      title: 'Passkey created',
      message: `${label} can now verify this Klarkey vault.`,
    } satisfies ActionExecutionResult
  }

  touchVaultPasskey(credentialId: string) {
    const current = this.db
      .prepare('SELECT id, label FROM vault_passkeys WHERE credentialId = ?')
      .get(credentialId) as { id: string; label: string } | undefined

    if (!current) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'That passkey is not enrolled in this vault yet.',
      } satisfies ActionExecutionResult
    }

    this.db.prepare('UPDATE vault_passkeys SET lastUsedAt = ? WHERE id = ?').run(now(), current.id)

    return {
      status: 'success',
      title: 'Passkey verified',
      message: `${current.label} completed a provider-backed passkey check.`,
    } satisfies ActionExecutionResult
  }

  deleteVaultPasskey(passkeyId: string) {
    const current = this.db
      .prepare('SELECT label FROM vault_passkeys WHERE id = ?')
      .get(passkeyId) as { label: string } | undefined

    if (!current) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'This passkey could not be found.',
      } satisfies ActionExecutionResult
    }

    this.db.prepare('DELETE FROM vault_passkeys WHERE id = ?').run(passkeyId)

    return {
      status: 'success',
      title: 'Passkey removed',
      message: `${current.label} was removed from this vault.`,
    } satisfies ActionExecutionResult
  }

  listBrowserSiteMatches(url: string, title?: string) {
    const siteLabel = getHostnameLabel(url)
    const titleText = normalizeSearchText(title)
    const urlText = normalizeSearchText(url)
    const matches = this.getSnapshot()
      .items
      .filter((item) => item.itemType === 'login')
      .map((item) => ({
        item,
        score: (() => {
          const siteScore = scoreWebsiteMatch(item.websites ?? [], url)
          const itemName = normalizeSearchText(item.itemName)
          const username = normalizeSearchText(item.username)
          const labelScore = siteLabel ? scoreTextHit(itemName, siteLabel, 28, 20) : 0
          const titleScore = itemName ? scoreTextHit(titleText, itemName, 26, 18) : 0
          const urlScore = itemName ? scoreTextHit(urlText, itemName, 20, 14) : 0
          const usernameTitleScore = username ? scoreTextHit(titleText, username, 18, 12) : 0
          return siteScore + labelScore + titleScore + urlScore + usernameTitleScore
        })(),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }

        const leftTime = left.item.lastUsedAt ? Date.parse(left.item.lastUsedAt) : 0
        const rightTime = right.item.lastUsedAt ? Date.parse(right.item.lastUsedAt) : 0
        if (rightTime !== leftTime) {
          return rightTime - leftTime
        }

        return left.item.itemName.localeCompare(right.item.itemName)
      })

    return matches.map(({ item }) => ({
      itemId: item.id,
      itemName: item.itemName,
      username: item.username,
      websites: item.websites ?? [],
      hasPassword: item.hasPassword,
      hasOtp: item.hasOtp,
      hasPasskey: item.hasPasskey,
      lastUsedAt: item.lastUsedAt,
    })) satisfies BrowserSiteMatch[]
  }

  listBrowserFieldSuggestions(field: BrowserSuggestionField, flow: BrowserAuthFlow, url: string, title?: string) {
    const suggestions = new Map<
      string,
      BrowserFieldSuggestion & {
        score: number
        priority: number
      }
    >()
    const siteMatches = flow === 'login' ? this.listBrowserSiteMatches(url, title) : []

    const pushSuggestion = ({
      itemId,
      itemName,
      value,
      source,
      lastUsedAt,
      fromSiteMatch,
      score,
      priority,
    }: {
      itemId: string
      itemName: string
      value?: string
      source: BrowserFieldSuggestion['source']
      lastUsedAt?: string
      fromSiteMatch: boolean
      score: number
      priority: number
    }) => {
      const nextValue = value?.trim()
      if (!nextValue) {
        return
      }

      if (field === 'email' && !nextValue.includes('@')) {
        return
      }

      const key = nextValue.toLowerCase()
      const current = suggestions.get(key)
      if (current && (current.score > score || (current.score === score && current.priority <= priority))) {
        return
      }

      suggestions.set(key, {
        id: `${itemId}:${source}:${key}`,
        itemId,
        itemName,
        value: nextValue,
        field,
        source,
        lastUsedAt,
        fromSiteMatch,
        score,
        priority,
      })
    }

    for (const item of this.getSnapshot().items) {
      if (flow === 'login' && item.itemType === 'login' && hasText(item.username)) {
        const score = siteMatches.find((match) => match.itemId === item.id)
          ? scoreWebsiteMatch(item.websites ?? [], url) || 24
          : 0

        if (score > 0) {
          pushSuggestion({
            itemId: item.id,
            itemName: item.itemName,
            value: item.username,
            source: 'login-username',
            lastUsedAt: item.lastUsedAt,
            fromSiteMatch: score >= 80,
            score,
            priority: 0,
          })
        }
      }

      if (flow === 'register' && item.itemType === 'identity') {
        const identityValue = (() => {
          switch (field) {
            case 'username':
              return item.username
            case 'email':
              return item.email
            case 'fullName':
              return item.fullName
            case 'firstName':
              return item.firstName
            case 'middleName':
              return item.middleName
            case 'lastName':
              return item.lastName
            case 'company':
              return item.company
            case 'jobTitle':
              return item.jobTitle
            case 'birthDate':
              return item.birthDate
            case 'phone':
              return item.phone
            case 'address':
              return item.address
            case 'addressLine1':
              return item.addressLine1 || item.address
            case 'addressLine2':
              return item.addressLine2
            case 'city':
              return item.city
            case 'state':
              return item.state
            case 'postalCode':
              return item.postalCode
            case 'country':
              return item.country
            default:
              return undefined
          }
        })()

        if (hasText(identityValue)) {
          pushSuggestion({
            itemId: item.id,
            itemName: item.itemName,
            value: identityValue,
            source: 'identity',
            lastUsedAt: item.lastUsedAt,
            fromSiteMatch: false,
            score: field === 'email' || field === 'username' ? 40 : 34,
            priority: 1,
          })
        }
      }

      if (flow === 'payment' && item.itemType === 'card') {
        const cardValue = (() => {
          switch (field) {
            case 'cardholderName':
              return item.cardholderName
            case 'cardNumber':
              return item.cardNumber
            case 'cardExpiry':
              return item.cardExpiry
            case 'cardExpiryMonth':
              return item.cardExpiryMonth
            case 'cardExpiryYear':
              return item.cardExpiryYear
            case 'cardCvc':
              return item.cardCvc
            case 'cardBrand':
              return item.cardBrand
            case 'postalCode':
              return item.billingPostalCode
            default:
              return undefined
          }
        })()

        if (hasText(cardValue)) {
          pushSuggestion({
            itemId: item.id,
            itemName: item.itemName,
            value: cardValue,
            source: 'card',
            lastUsedAt: item.lastUsedAt,
            fromSiteMatch: false,
            score: field === 'cardNumber' || field === 'cardholderName' ? 44 : 36,
            priority: 1,
          })
        }
      }
    }

    return Array.from(suggestions.values())
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
        }

        const leftTime = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0
        const rightTime = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0
        if (rightTime !== leftTime) {
          return rightTime - leftTime
        }

        if (left.priority !== right.priority) {
          return left.priority - right.priority
        }

        return left.value.localeCompare(right.value)
      })
      .map((suggestion) => ({
        id: suggestion.id,
        itemId: suggestion.itemId,
        itemName: suggestion.itemName,
        value: suggestion.value,
        field: suggestion.field,
        source: suggestion.source,
        lastUsedAt: suggestion.lastUsedAt,
        fromSiteMatch: suggestion.fromSiteMatch,
      })) satisfies BrowserFieldSuggestion[]
  }

  getBrowserFillLogin(itemId: string) {
    const item = this.getItemDetails(itemId)
    if (!item || item.itemType !== 'login') {
      return undefined
    }

    return {
      itemId: item.itemId,
      itemName: item.itemName,
      username: item.username || undefined,
      password: item.password,
      otp: item.otp ? getTotpCode(item.otp).value : undefined,
      websites: item.websites,
      hasPasskey: this.getSnapshot().items.find((candidate) => candidate.id === itemId)?.hasPasskey ?? false,
    } satisfies BrowserFillLogin
  }

  getBrowserFillIdentity(itemId: string) {
    const item = this.getItemDetails(itemId)
    if (!item || item.itemType !== 'identity') {
      return undefined
    }

    return {
      itemId: item.itemId,
      itemName: item.itemName,
      username: item.username || undefined,
      fullName: item.fullName,
      firstName: item.firstName,
      middleName: item.middleName,
      lastName: item.lastName,
      company: item.company,
      jobTitle: item.jobTitle,
      birthDate: item.birthDate,
      email: item.email,
      phone: item.phone,
      address: item.address,
      addressLine1: item.addressLine1,
      addressLine2: item.addressLine2,
      city: item.city,
      state: item.state,
      postalCode: item.postalCode,
      country: item.country,
    }
  }

  getBrowserFillCard(itemId: string) {
    const item = this.getItemDetails(itemId)
    if (!item || item.itemType !== 'card') {
      return undefined
    }

    return {
      itemId: item.itemId,
      itemName: item.itemName,
      cardholderName: item.cardholderName,
      cardNumber: item.cardNumber,
      cardLastFour: item.cardLastFour,
      cardExpiry: item.cardExpiry,
      cardExpiryMonth: item.cardExpiryMonth,
      cardExpiryYear: item.cardExpiryYear,
      cardCvc: item.cardCvc,
      cardBrand: item.cardBrand,
      billingPostalCode: item.billingPostalCode,
    } satisfies BrowserFillCard
  }

  private findExactBrowserLoginMatch(url: string, title: string | undefined, username: string | undefined, password: string | undefined) {
    const matches = this.listBrowserSiteMatches(url, title)
    const logins = matches
      .map((match) => this.getItemDetails(match.itemId))
      .filter((item): item is ItemDetails => Boolean(item && item.itemType === 'login'))

    const exactAccountMatch = logins.find(
      (item) => isExactBrowserAccountMatch(item.username, username) || isExactBrowserAccountMatch(item.email, username),
    )
    if (exactAccountMatch) {
      return exactAccountMatch
    }

    const exactPasswordMatches = password
      ? logins.filter((item) => Boolean(item.password) && item.password === password)
      : []

    if (!username && exactPasswordMatches.length === 1) {
      return exactPasswordMatches[0]
    }

    return undefined
  }

  private getKnownPasskeyCredentialIds() {
    const savedCredentialIds = this.db
      .prepare('SELECT credentialId FROM passkeys WHERE credentialId IS NOT NULL')
      .all() as Array<{ credentialId: string }>
    const pendingCredentialIds = this.db
      .prepare('SELECT credentialId FROM pending_passkeys')
      .all() as Array<{ credentialId: string }>

    return Array.from(
      new Set(
        [...savedCredentialIds, ...pendingCredentialIds]
          .map((passkey) => passkey.credentialId)
          .filter((credentialId): credentialId is string => Boolean(credentialId)),
      ),
    )
  }

  private resolveBrowserPasskeyItem(
    pendingPasskey: Pick<PendingPasskeyRow, 'label' | 'userName' | 'rpId'>,
    url: string,
    requestDetailsJson: string,
    itemIdOverride?: string,
    createNew?: boolean,
    existingItemId?: string,
  ) {
    const plan = this.planBrowserPasskeySave(url, requestDetailsJson)
    const itemId = createNew ? undefined : itemIdOverride ?? existingItemId ?? plan.suggestedMatch?.itemId

    if (itemId) {
      const currentItem = this.getItemDetails(itemId)
      if (!currentItem || currentItem.itemType !== 'login') {
        return {
          status: 'error',
          title: 'Item missing',
          message: 'Klarkey could not find the selected login for this passkey.',
        } satisfies ActionExecutionResult
      }

      return {
        itemId,
        plan,
      }
    }

    const createdItem = this.createItem({
      itemType: 'login',
      itemName: pendingPasskey.label || plan.itemName,
      username: pendingPasskey.userName || plan.userName,
      preserveEmptyPassword: true,
      websites: [url],
    })

    if (!createdItem.itemId) {
      return createdItem
    }

    return {
      itemId: createdItem.itemId,
      plan,
    }
  }

  private planBrowserPasskeySave(url: string, requestDetailsJson: string) {
    const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
    const rpId = request.rp?.id?.trim() || request.rpId?.trim() || getHostname(url)
    const userName = request.user?.name?.trim() || undefined
    const itemName = request.rp?.name?.trim() || rpId || 'Saved passkey'
    const siteMatches = this.listBrowserSiteMatches(url, request.rp?.name?.trim())
    const suggestedMatch = siteMatches.find(
      (match) =>
        isExactBrowserAccountMatch(match.username, userName) ||
        isExactBrowserAccountMatch(this.getItemDetails(match.itemId)?.email, userName),
    )

    return {
      rpId,
      userName,
      itemName,
      suggestedMatch,
    } satisfies BrowserPasskeySavePlan
  }

  private listUsableBrowserPasskeys(url: string, requestDetailsJson: string) {
    const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
    const rpId = request.rpId?.trim() || request.rp?.id?.trim() || getHostname(url)
    const requestedIds = new Set(
      (request.allowCredentials ?? [])
        .map((credential) => normalizeCredentialId(credential.id))
        .filter((credentialId): credentialId is string => Boolean(credentialId)),
    )
    const rows = this.db
      .prepare(
        `
        SELECT p.id, p.itemId, p.label, p.credentialId, p.rpId, p.userName, p.userHandle, p.transports, p.privateKeyPayload, p.signCount, p.createdAt, p.lastUsedAt
        FROM passkeys p
        INNER JOIN identities i ON i.id = p.itemId
        WHERE p.credentialId IS NOT NULL
          AND p.privateKeyPayload IS NOT NULL
        ORDER BY COALESCE(p.lastUsedAt, i.lastUsedAt, p.createdAt) DESC
      `,
      )
      .all() as PasskeyRow[]

    return rows.filter((passkey) => {
      if (!passkey.credentialId) {
        return false
      }

      if (requestedIds.size && !requestedIds.has(passkey.credentialId)) {
        return false
      }

      if (rpId && passkey.rpId === rpId) {
        return true
      }

      const item = this.getItemDetails(passkey.itemId)
      return Boolean(item && scoreWebsiteMatch(item.websites ?? [], url) > 0)
    })
  }

  getBrowserPasskeyStatus(url: string) {
    const hostname = getHostname(url)
    const savedPasskeys = this.db
      .prepare(
        `
        SELECT p.credentialId, p.rpId, p.privateKeyPayload, i.websites
        FROM passkeys p
        INNER JOIN identities i ON i.id = p.itemId
        WHERE p.credentialId IS NOT NULL
      `,
      )
      .all() as Array<{ credentialId: string; rpId?: string | null; privateKeyPayload?: string | null; websites?: string | null }>

    const usablePasskeys = savedPasskeys.filter((passkey) => Boolean(passkey.privateKeyPayload))

    const exactMatchCount = hostname
      ? usablePasskeys.filter((passkey) => (passkey.rpId?.trim() || '') === hostname).length
      : 0
    const linkedMatchCount = hostname
      ? usablePasskeys.filter((passkey) => scoreWebsiteMatch(parseJson<string[]>(passkey.websites ?? undefined, []), url) > 0).length
      : 0
    const availablePasskeyCount = usablePasskeys.length

    return {
      supported: true,
      browser: 'other',
      mode: 'browser-limited',
      conditionalUi: false,
      availablePasskeyCount,
      exactMatchCount,
      linkedMatchCount,
      reason:
        availablePasskeyCount > 0
          ? 'Klarkey can create and use saved passkeys through the browser extension on this site.'
          : 'Klarkey can create a new passkey here through the browser extension.',
    } satisfies BrowserPasskeyStatus
  }

  saveBrowserLogin(input: BrowserSaveLoginInput) {
    const url = input.url.trim()
    const username = input.username?.trim() || undefined
    const password = input.password?.trim() || undefined
    const existing = this.findExactBrowserLoginMatch(url, input.title, username, password)

    if (existing) {
      const nextUsername = username ?? existing.username
      const nextPassword = password ?? existing.password

      if (!nextUsername && !nextPassword) {
        return {
          status: 'info',
          title: 'Nothing changed',
          message: 'Klarkey did not detect a complete account to update.',
          itemId: existing.itemId,
        } satisfies ActionExecutionResult
      }

      const nextWebsites = Array.from(new Set([...existing.websites, url].filter(Boolean)))
      return this.updateItem({
        itemId: existing.itemId,
        itemType: 'login',
        itemName: existing.itemName,
        username: nextUsername,
        password: nextPassword,
        otp: undefined,
        notes: existing.notes,
        websites: nextWebsites,
        customFields: existing.customFields,
      })
    }

    const title = input.title?.trim()
    const fallbackName = title || username || url.replace(/^https?:\/\//i, '')
    return this.createItem({
      itemType: 'login',
      itemName: fallbackName,
      username,
      password,
      preserveEmptyPassword: !password,
      websites: [url],
    })
  }

  planBrowserPasskeyCreate(url: string, requestDetailsJson: string) {
    return this.planBrowserPasskeySave(url, requestDetailsJson)
  }

  prepareBrowserSitePasskey(url: string, origin: string, requestDetailsJson: string) {
    const plan = this.planBrowserPasskeySave(url, requestDetailsJson)
    const createdPasskey = createSitePasskeyCredential({
      origin,
      requestDetailsJson,
      existingCredentialIds: this.getKnownPasskeyCredentialIds(),
    })
    const pendingPasskeyId = id('pending_passkey')

    this.db
      .prepare(
        `
        INSERT INTO pending_passkeys(
          id, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        pendingPasskeyId,
        plan.itemName,
        createdPasskey.credentialId,
        plan.rpId,
        plan.userName ?? null,
        createdPasskey.userHandle,
        JSON.stringify(['internal']),
        JSON.stringify(encryptValue(this.key, JSON.stringify(createdPasskey.privateKeyJwk))),
        now(),
      )

    return {
      status: 'info',
      title: 'Passkey ready',
      message: `${plan.itemName} is ready to save in Klarkey.`,
      secret: createdPasskey.responseJson,
      pendingPasskeyId,
    } satisfies ActionExecutionResult
  }

  savePreparedBrowserSitePasskey(
    pendingPasskeyId: string,
    url: string,
    requestDetailsJson: string,
    itemIdOverride?: string,
    createNew?: boolean,
  ) {
    const pendingPasskey = this.db
      .prepare(
        `
        SELECT id, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, createdAt
        FROM pending_passkeys
        WHERE id = ?
      `,
      )
      .get(pendingPasskeyId) as PendingPasskeyRow | undefined

    if (!pendingPasskey) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'Klarkey could not find the pending passkey to save.',
      } satisfies ActionExecutionResult
    }

    const existing = this.db
      .prepare('SELECT id, itemId FROM passkeys WHERE credentialId = ?')
      .get(pendingPasskey.credentialId) as { id: string; itemId: string } | undefined
    const resolvedItem = this.resolveBrowserPasskeyItem(
      pendingPasskey,
      url,
      requestDetailsJson,
      itemIdOverride,
      createNew,
      existing?.itemId,
    )

    if ('status' in resolvedItem) {
      return resolvedItem
    }

    const { itemId } = resolvedItem
    const previousItemId = existing?.itemId

    if (existing) {
      this.replaceItemPasskey(itemId, existing.id)
      this.db
        .prepare(
          `
          UPDATE passkeys
          SET identityId = ?, itemId = ?, label = ?, rpId = ?, userName = ?, userHandle = ?, transports = ?, privateKeyPayload = ?, signCount = 0, lastUsedAt = ?
          WHERE id = ?
        `,
        )
        .run(
          itemId,
          itemId,
          pendingPasskey.label,
          pendingPasskey.rpId ?? null,
          pendingPasskey.userName ?? null,
          pendingPasskey.userHandle ?? null,
          pendingPasskey.transports ?? JSON.stringify(['internal']),
          pendingPasskey.privateKeyPayload,
          now(),
          existing.id,
        )
    } else {
      this.replaceItemPasskey(itemId)
      this.db
        .prepare(
          `
          INSERT INTO passkeys(
            id, identityId, itemId, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, signCount, lastUsedAt, createdAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id('passkey'),
          itemId,
          itemId,
          pendingPasskey.label,
          pendingPasskey.credentialId,
          pendingPasskey.rpId ?? null,
          pendingPasskey.userName ?? null,
          pendingPasskey.userHandle ?? null,
          pendingPasskey.transports ?? JSON.stringify(['internal']),
          pendingPasskey.privateKeyPayload,
          0,
          now(),
          now(),
        )
    }

    const details = this.getItemDetails(itemId)
    const websites = Array.from(new Set([...(details?.websites ?? []), url]))
    this.db.prepare('UPDATE identities SET websites = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(websites), now(), itemId)
    this.syncItemPasskeyState(itemId)
    if (previousItemId && previousItemId !== itemId) {
      this.syncItemPasskeyState(previousItemId)
    }
    this.db.prepare('DELETE FROM pending_passkeys WHERE id = ?').run(pendingPasskeyId)

    return {
      status: 'success',
      title: 'Passkey saved',
      message: `${pendingPasskey.label} is now linked to this site in Klarkey.`,
      itemId,
    } satisfies ActionExecutionResult
  }

  discardPreparedBrowserSitePasskey(pendingPasskeyId: string) {
    const deleted = this.db.prepare('DELETE FROM pending_passkeys WHERE id = ?').run(pendingPasskeyId)

    if (!deleted.changes) {
      return {
        status: 'info',
        title: 'Passkey cleared',
        message: 'There was no pending passkey left to remove.',
      } satisfies ActionExecutionResult
    }

    return {
      status: 'success',
      title: 'Passkey cleared',
      message: 'The pending passkey was removed from Klarkey.',
    } satisfies ActionExecutionResult
  }

  listBrowserPasskeyChoices(url: string, requestDetailsJson: string) {
    return this.listUsableBrowserPasskeys(url, requestDetailsJson).flatMap((passkey) =>
      passkey.credentialId
        ? [
            {
              credentialId: passkey.credentialId,
              itemId: passkey.itemId,
              itemName: passkey.label,
              userName: passkey.userName,
              rpId: passkey.rpId,
              lastUsedAt: passkey.lastUsedAt,
            } satisfies BrowserPasskeyChoice,
          ]
        : [],
    )
  }

  getPasskeysForBrowserRequest(url: string, requestDetailsJson: string) {
    const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
    const filtered = this.listUsableBrowserPasskeys(url, requestDetailsJson)
    if (!filtered.length) {
      return {
        status: 'error',
        title: 'No passkey saved',
        message: 'Klarkey does not have a saved passkey for this site yet.',
      } satisfies ActionExecutionResult
    }

    return {
      requestDetailsJson: JSON.stringify({
        ...request,
        allowCredentials: filtered.flatMap((passkey) =>
          passkey.credentialId
            ? [
                {
                  id: passkey.credentialId,
                  type: 'public-key',
                  transports: parseJson<string[]>(passkey.transports, []),
                },
              ]
            : [],
        ),
      }),
      selectedCredentialIds: filtered.flatMap((passkey) => (passkey.credentialId ? [passkey.credentialId] : [])),
    }
  }

  getBrowserSitePasskey(url: string, origin: string, requestDetailsJson: string, credentialId?: string) {
    const usablePasskeys = this.listUsableBrowserPasskeys(url, requestDetailsJson)
    const selectedPasskey = credentialId
      ? usablePasskeys.find((passkey) => passkey.credentialId === credentialId)
      : usablePasskeys[0]

    if (!selectedPasskey?.credentialId || !selectedPasskey.privateKeyPayload || !selectedPasskey.rpId) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'Klarkey does not have a usable passkey for this site yet.',
      } satisfies ActionExecutionResult
    }

    const privateKeyJwk = parseOptionalJson<JsonWebKey>(
      tryDecrypt(this.key, selectedPasskey.privateKeyPayload) || undefined,
    )
    if (!privateKeyJwk) {
      return {
        status: 'error',
        title: 'Passkey unavailable',
        message: 'Klarkey could not unlock the saved passkey for this site.',
      } satisfies ActionExecutionResult
    }

    const assertion = getSitePasskeyAssertion({
      origin,
      requestDetailsJson,
      passkey: {
        credentialId: selectedPasskey.credentialId,
        rpId: selectedPasskey.rpId,
        userHandle: selectedPasskey.userHandle,
        signCount: selectedPasskey.signCount ?? 0,
        privateKeyJwk,
      },
    })

    this.db
      .prepare('UPDATE passkeys SET signCount = ?, lastUsedAt = ? WHERE credentialId = ?')
      .run(assertion.signCount, now(), selectedPasskey.credentialId)
    this.db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), selectedPasskey.itemId)
    this.remember(`passkey:${selectedPasskey.credentialId}`, selectedPasskey.label, selectedPasskey.itemId)

    return {
      status: 'success',
      title: 'Passkey approved',
      message: `${selectedPasskey.label} is ready.`,
      itemId: selectedPasskey.itemId,
      secret: assertion.responseJson,
    } satisfies ActionExecutionResult
  }

  saveSitePasskey(url: string, requestDetailsJson: string, responseJson: string, itemIdOverride?: string, createNew?: boolean) {
    const response = parseJson<{ id?: unknown; rawId?: unknown; response?: { transports?: string[] } }>(responseJson, {})
    const credentialId = normalizeCredentialId(response.id ?? response.rawId)
    const plan = this.planBrowserPasskeySave(url, requestDetailsJson)
    if (!credentialId) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'The browser did not return a passkey credential id.',
      } satisfies ActionExecutionResult
    }

    const existing = this.db
      .prepare('SELECT id, itemId FROM passkeys WHERE credentialId = ?')
      .get(credentialId) as { id: string; itemId: string } | undefined
    let itemId = createNew ? undefined : itemIdOverride ?? plan.suggestedMatch?.itemId ?? existing?.itemId

    if (!itemId) {
      const createdItem = this.createItem({
        itemType: 'login',
        itemName: plan.itemName,
        username: plan.userName,
        preserveEmptyPassword: true,
        websites: [url],
      })

      if (!createdItem.itemId) {
        return createdItem
      }

      itemId = createdItem.itemId
    }

    const previousItemId = existing?.itemId

    if (existing) {
      this.replaceItemPasskey(itemId, existing.id)
      this.db
        .prepare(
          `
          UPDATE passkeys
          SET identityId = ?, itemId = ?, label = ?, rpId = ?, userName = ?, transports = ?, lastUsedAt = ?
          WHERE id = ?
        `,
        )
        .run(itemId, itemId, plan.itemName, plan.rpId, plan.userName ?? null, JSON.stringify(response.response?.transports ?? []), now(), existing.id)
    } else {
      this.replaceItemPasskey(itemId)
      this.db
        .prepare(
          `
          INSERT INTO passkeys(id, identityId, itemId, label, credentialId, rpId, userName, transports, lastUsedAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id('passkey'),
          itemId,
          itemId,
          plan.itemName,
          credentialId,
          plan.rpId,
          plan.userName ?? null,
          JSON.stringify(response.response?.transports ?? []),
          now(),
          now(),
        )
    }

    const details = this.getItemDetails(itemId)
    const websites = Array.from(new Set([...(details?.websites ?? []), url]))
    this.db.prepare('UPDATE identities SET websites = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(websites), now(), itemId)
    this.syncItemPasskeyState(itemId)
    if (previousItemId && previousItemId !== itemId) {
      this.syncItemPasskeyState(previousItemId)
    }

    return {
      status: 'success',
      title: 'Passkey saved',
      message: `${plan.itemName} is now linked to this site in Klarkey.`,
      itemId,
    } satisfies ActionExecutionResult
  }

  rememberSitePasskeyAssertion(credentialId: string) {
    const normalizedCredentialId = normalizeCredentialId(credentialId)
    if (!normalizedCredentialId) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'The selected passkey id is invalid.',
      } satisfies ActionExecutionResult
    }

    const current = this.db
      .prepare('SELECT itemId, label FROM passkeys WHERE credentialId = ?')
      .get(normalizedCredentialId) as { itemId: string; label: string } | undefined

    if (!current) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'The selected passkey is not known to Klarkey.',
      } satisfies ActionExecutionResult
    }

    this.db.prepare('UPDATE passkeys SET lastUsedAt = ? WHERE credentialId = ?').run(now(), normalizedCredentialId)
    this.db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), current.itemId)
    this.remember(`passkey:${normalizedCredentialId}`, current.label, current.itemId)

    return {
      status: 'success',
      title: 'Passkey approved',
      message: `${current.label} was used through the browser bridge.`,
      itemId: current.itemId,
    } satisfies ActionExecutionResult
  }
}
