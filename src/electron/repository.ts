import { randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { scoreWebsiteMatch } from '@/shared/browser-extension'
import { normalizeCredentialId } from '@/shared/passkey-encoding'
import { decryptValue, encryptValue, type EncryptedPayload } from '@/electron/crypto'
import type { CreatableItemType } from '@/shared/item-types'
import { getTotpCode, parseStoredTotp, parseTotpInput } from '@/shared/totp'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type BrowserFillLogin,
  type BrowserSaveLoginInput,
  type BrowserSiteMatch,
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

const getHostname = (value: string) => {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

type ItemDataPayload = {
  fullName?: string
  phone?: string
  address?: string
  content?: string
}

type PasskeyRow = {
  id: string
  itemId: string
  label: string
  credentialId?: string
  rpId?: string
  userName?: string
  transports?: string
  createdAt: string
  lastUsedAt?: string
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
    const username = itemType === 'login' ? input.username?.trim() || current.username : ''
    const password =
      input.password === undefined
        ? current.passwordPayload
        : JSON.stringify(encryptValue(this.key, input.password.trim()))
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

    const itemData = parseJson<ItemDataPayload>(row.itemData, {})
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
    this.db
      .prepare('INSERT INTO passkeys(id, itemId, label, createdAt) VALUES (?, ?, ?, ?)')
      .run(id('passkey'), itemId, label, now())
    this.db.prepare('UPDATE identities SET hasPasskey = 1, updatedAt = ? WHERE id = ?').run(now(), itemId)
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

  listBrowserSiteMatches(url: string) {
    const matches = this.getSnapshot()
      .items
      .filter((item) => item.itemType === 'login')
      .map((item) => ({
        item,
        score: scoreWebsiteMatch(item.websites ?? [], url),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score
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

  saveBrowserLogin(input: BrowserSaveLoginInput) {
    const url = input.url.trim()
    const username = input.username?.trim() || undefined
    const password = input.password?.trim() || undefined
    const matches = this.listBrowserSiteMatches(url)
    const existing = matches.find((match) => match.username === username)

    if (existing) {
      const current = this.getItemDetails(existing.itemId)
      if (!current || current.itemType !== 'login') {
        return {
          status: 'error',
          title: 'Item missing',
          message: 'The matching login could not be updated.',
        } satisfies ActionExecutionResult
      }

      const nextWebsites = Array.from(new Set([...current.websites, url].filter(Boolean)))
      return this.updateItem({
        itemId: existing.itemId,
        itemType: 'login',
        itemName: current.itemName,
        username: username ?? current.username,
        password: password ?? current.password,
        otp: undefined,
        notes: current.notes,
        websites: nextWebsites,
        customFields: current.customFields,
      })
    }

    const title = input.title?.trim()
    const fallbackName = title || username || url.replace(/^https?:\/\//i, '')
    return this.createItem({
      itemType: 'login',
      itemName: fallbackName,
      username,
      password,
      websites: [url],
    })
  }

  getPasskeysForBrowserRequest(url: string, requestDetailsJson: string) {
    const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
    const rpId = request.rpId?.trim() || request.rp?.id?.trim()
    const knownPasskeys = this.db
      .prepare(
        `
        SELECT p.id, p.itemId, p.label, p.credentialId, p.rpId, p.userName, p.transports, p.createdAt, p.lastUsedAt
        FROM passkeys p
        INNER JOIN identities i ON i.id = p.itemId
        WHERE p.credentialId IS NOT NULL
          AND (p.rpId = ? OR p.rpId IS NULL)
        ORDER BY COALESCE(p.lastUsedAt, i.lastUsedAt, p.createdAt) DESC
      `,
      )
      .all(rpId ?? null) as PasskeyRow[]

    const relevant = knownPasskeys.filter((passkey) => {
      const item = this.getSnapshot().items.find((candidate) => candidate.id === passkey.itemId)
      if (!item) {
        return false
      }

      return scoreWebsiteMatch(item.websites ?? [], url) > 0 || (rpId ? passkey.rpId === rpId : false)
    })

    const requestedIds = new Set(
      (request.allowCredentials ?? [])
        .map((credential) => normalizeCredentialId(credential.id))
        .filter((credentialId): credentialId is string => Boolean(credentialId)),
    )
    const filtered = requestedIds.size
      ? relevant.filter((passkey) => passkey.credentialId && requestedIds.has(passkey.credentialId))
      : relevant

    if (filtered.length === 0) {
      return {
        status: 'error',
        title: 'No passkey saved',
        message: 'Klarkey does not have a saved passkey for this site yet.',
      } satisfies ActionExecutionResult
    }

    const nextRequest = {
      ...request,
      allowCredentials: filtered
        .filter((passkey) => passkey.credentialId)
        .map((passkey) => ({
          id: passkey.credentialId!,
          type: 'public-key',
          transports: parseJson<string[]>(passkey.transports, []),
        })),
    }

    return {
      requestDetailsJson: JSON.stringify(nextRequest),
      selectedCredentialIds: filtered.flatMap((passkey) => (passkey.credentialId ? [passkey.credentialId] : [])),
    }
  }

  saveSitePasskey(url: string, requestDetailsJson: string, responseJson: string) {
    const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
    const response = parseJson<{ id?: unknown; rawId?: unknown; response?: { transports?: string[] } }>(responseJson, {})
    const credentialId = normalizeCredentialId(response.id ?? response.rawId)
    const rpId = request.rp?.id?.trim() || request.rpId?.trim() || getHostname(url)
    const userName = request.user?.name?.trim() || undefined
    const itemName = request.rp?.name?.trim() || rpId || 'Saved passkey'

    if (!credentialId) {
      return {
        status: 'error',
        title: 'Passkey missing',
        message: 'The browser did not return a passkey credential id.',
      } satisfies ActionExecutionResult
    }

    const existing = this.db
      .prepare('SELECT id, itemId, label FROM passkeys WHERE credentialId = ?')
      .get(credentialId) as { id: string; itemId: string; label: string } | undefined

    const siteMatches = this.listBrowserSiteMatches(url)
    const linkedItem =
      siteMatches.find((match) => match.username === userName) ??
      siteMatches[0]

    let itemId = linkedItem?.itemId
    if (!itemId) {
      const created = this.createItem({
        itemType: 'login',
        itemName,
        username: userName,
        websites: [url],
      })

      if (!created.itemId) {
        return created
      }

      itemId = created.itemId
    }

    if (existing) {
      this.db
        .prepare(
          `
          UPDATE passkeys
          SET itemId = ?, label = ?, rpId = ?, userName = ?, transports = ?, lastUsedAt = ?
          WHERE id = ?
        `,
        )
        .run(
          itemId,
          itemName,
          rpId,
          userName ?? null,
          JSON.stringify(response.response?.transports ?? []),
          now(),
          existing.id,
        )
    } else {
      this.db
        .prepare(
          `
          INSERT INTO passkeys(id, itemId, label, credentialId, rpId, userName, transports, lastUsedAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id('passkey'),
          itemId,
          itemName,
          credentialId,
          rpId,
          userName ?? null,
          JSON.stringify(response.response?.transports ?? []),
          now(),
          now(),
        )
    }

    const details = this.getItemDetails(itemId)
    const websites = Array.from(new Set([...(details?.websites ?? []), url]))
    this.db.prepare('UPDATE identities SET hasPasskey = 1, websites = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(websites), now(), itemId)

    return {
      status: 'success',
      title: 'Passkey saved',
      message: `${itemName} is now linked to this site in Klarkey.`,
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
    this.remember(`passkey:${normalizedCredentialId}`, current.label, current.itemId)

    return {
      status: 'success',
      title: 'Passkey approved',
      message: `${current.label} was used through the browser bridge.`,
      itemId: current.itemId,
    } satisfies ActionExecutionResult
  }
}
