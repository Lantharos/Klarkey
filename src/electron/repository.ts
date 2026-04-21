import type Database from 'better-sqlite3'
import { buildBrowserFieldSuggestions } from '@/electron/repository/browser-field-suggestions'
import { buildBrowserFillCard, buildBrowserFillIdentity, buildBrowserFillLogin } from '@/electron/repository/browser-fill'
import { buildBrowserPasskeySavePlan } from '@/electron/repository/browser-passkey-helpers'
import { saveBrowserLoginWithBridge } from '@/electron/repository/browser-save-login'
import { buildBrowserSiteMatches } from '@/electron/repository/browser-site-matches'
import {
  discardPreparedBrowserSitePasskey as runDiscardPreparedBrowserSitePasskey,
  getBrowserSitePasskeyResult,
  getPasskeysForBrowserRequestPayload,
  listBrowserPasskeyChoicesForSite,
  prepareBrowserSitePasskey as runPrepareBrowserSitePasskey,
  rememberSitePasskeyAssertionResult,
  savePreparedBrowserSitePasskey as runSavePreparedBrowserSitePasskey,
  saveSitePasskeyFromBrowser,
  type BrowserPasskeyBridge,
  type BrowserPasskeyMutations,
} from '@/electron/repository/browser-site-passkey'
import { computeBrowserPasskeyStatus } from '@/electron/repository/browser-site-passkey-status'
import { insertIdentity, updateIdentity } from '@/electron/repository/identity-crud'
import { loadItemDetails } from '@/electron/repository/item-details'
import { id, now, tryDecrypt } from '@/electron/repository/helpers'
import { mergeVaultSettings, readVaultSettings } from '@/electron/repository/vault-settings'
import { buildVaultSnapshot } from '@/electron/repository/vault-snapshot'
import {
  createVaultDevicePasskey,
  deleteVaultDevicePasskey,
  listVaultDevicePasskeys,
  touchVaultDevicePasskey,
} from '@/electron/repository/vault-device-passkeys'
import { toSshIdentityRecord, type SshIdentityRecord, type SshPrivateIdentityRecord } from '@/electron/ssh'
import { getTotpCode, parseStoredTotp } from '@/shared/totp'
import {
  type ActionExecutionResult,
  type BrowserAuthFlow,
  type BrowserSaveLoginInput,
  type BrowserSuggestionField,
  type CreateVaultPasskeyInput,
  type CreateItemInput,
  type ItemDetails,
  type SettingsUpdate,
  type UpdateItemInput,
  type UserSettings,
  type VaultPasskeyRecord,
  type VaultSnapshot,
} from '@/shared/types'

export class VaultRepository {
  private db: Database.Database
  private key: Buffer

  constructor(
    db: Database.Database,
    key: Buffer,
  ) {
    this.db = db
    this.key = key
    this.prunePendingPasskeys()
  }

  setKey(key: Buffer) {
    this.key = key
  }

  clearKey() {
    if (this.key && this.key.length > 0) {
      this.key.fill(0)
    }
    this.key = Buffer.alloc(0)
  }

  isLocked(): boolean {
    return this.key.length !== 32
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
    return readVaultSettings(this.db)
  }

  updateSettings(update: SettingsUpdate) {
    return mergeVaultSettings(this.db, update)
  }

  getSnapshot(): VaultSnapshot {
    return buildVaultSnapshot(this.db)
  }

  createItem(input: CreateItemInput) {
    return insertIdentity(this.db, this.key, input)
  }

  updateItem(input: UpdateItemInput) {
    return updateIdentity(this.db, this.key, input)
  }

  getItemDetails(itemId: string): ItemDetails | undefined {
    return loadItemDetails(this.db, this.key, itemId)
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
    return listVaultDevicePasskeys(this.db)
  }

  createVaultPasskey(input: CreateVaultPasskeyInput) {
    return createVaultDevicePasskey(this.db, input)
  }

  touchVaultPasskey(credentialId: string) {
    return touchVaultDevicePasskey(this.db, credentialId)
  }

  deleteVaultPasskey(passkeyId: string) {
    return deleteVaultDevicePasskey(this.db, passkeyId)
  }

  listBrowserSiteMatches(url: string, title?: string) {
    return buildBrowserSiteMatches(this.getSnapshot(), url, title)
  }

  listBrowserFieldSuggestions(field: BrowserSuggestionField, flow: BrowserAuthFlow, url: string, title?: string) {
    return buildBrowserFieldSuggestions(
      {
        getSnapshot: () => this.getSnapshot(),
        listBrowserSiteMatches: (u, t) => this.listBrowserSiteMatches(u, t),
      },
      field,
      flow,
      url,
      title,
    )
  }

  getBrowserFillLogin(itemId: string) {
    const item = this.getItemDetails(itemId)
    const hasPasskey = this.getSnapshot().items.find((candidate) => candidate.id === itemId)?.hasPasskey ?? false
    return buildBrowserFillLogin(item, hasPasskey)
  }

  getBrowserFillIdentity(itemId: string) {
    return buildBrowserFillIdentity(this.getItemDetails(itemId))
  }

  getBrowserFillCard(itemId: string) {
    return buildBrowserFillCard(this.getItemDetails(itemId))
  }

  private browserPasskeyBridge(): BrowserPasskeyBridge {
    return {
      listBrowserSiteMatches: (u, t) => this.listBrowserSiteMatches(u, t),
      getItemDetails: (itemId) => this.getItemDetails(itemId),
      createItem: (input) => this.createItem(input),
    }
  }

  private browserPasskeyMutations(): BrowserPasskeyMutations {
    return {
      replaceItemPasskey: (itemId, keepPasskeyId) => this.replaceItemPasskey(itemId, keepPasskeyId),
      syncItemPasskeyState: (itemId) => this.syncItemPasskeyState(itemId),
      remember: (actionId, label, itemId) => this.remember(actionId, label, itemId),
    }
  }

  getBrowserPasskeyStatus(url: string) {
    return computeBrowserPasskeyStatus(this.db, url)
  }

  saveBrowserLogin(input: BrowserSaveLoginInput) {
    return saveBrowserLoginWithBridge(
      {
        listBrowserSiteMatches: (u, t) => this.listBrowserSiteMatches(u, t),
        getItemDetails: (itemId) => this.getItemDetails(itemId),
        createItem: (input) => this.createItem(input),
        updateItem: (input) => this.updateItem(input),
      },
      input,
    )
  }

  planBrowserPasskeyCreate(url: string, requestDetailsJson: string) {
    return buildBrowserPasskeySavePlan(
      (u, t) => this.listBrowserSiteMatches(u, t),
      (id) => this.getItemDetails(id),
      url,
      requestDetailsJson,
    )
  }

  prepareBrowserSitePasskey(url: string, origin: string, requestDetailsJson: string, userVerified = false) {
    return runPrepareBrowserSitePasskey(this.db, this.key, this.browserPasskeyBridge(), url, origin, requestDetailsJson, userVerified)
  }

  savePreparedBrowserSitePasskey(
    pendingPasskeyId: string,
    url: string,
    requestDetailsJson: string,
    itemIdOverride?: string,
    createNew?: boolean,
  ) {
    return runSavePreparedBrowserSitePasskey(
      this.db,
      this.browserPasskeyMutations(),
      this.browserPasskeyBridge(),
      pendingPasskeyId,
      url,
      requestDetailsJson,
      itemIdOverride,
      createNew,
    )
  }

  discardPreparedBrowserSitePasskey(pendingPasskeyId: string) {
    return runDiscardPreparedBrowserSitePasskey(this.db, pendingPasskeyId)
  }

  listBrowserPasskeyChoices(url: string, requestDetailsJson: string) {
    return listBrowserPasskeyChoicesForSite(this.db, url, requestDetailsJson, (itemId) => this.getItemDetails(itemId))
  }

  getPasskeysForBrowserRequest(url: string, requestDetailsJson: string) {
    return getPasskeysForBrowserRequestPayload(this.db, url, requestDetailsJson, (itemId) => this.getItemDetails(itemId))
  }

  getBrowserSitePasskey(url: string, origin: string, requestDetailsJson: string, credentialId?: string, userVerified = false) {
    return getBrowserSitePasskeyResult(
      this.db,
      this.key,
      this.browserPasskeyMutations(),
      this.browserPasskeyBridge(),
      url,
      origin,
      requestDetailsJson,
      credentialId,
      userVerified,
    )
  }

  saveSitePasskey(url: string, requestDetailsJson: string, responseJson: string, itemIdOverride?: string, createNew?: boolean) {
    return saveSitePasskeyFromBrowser(
      this.db,
      this.browserPasskeyMutations(),
      this.browserPasskeyBridge(),
      url,
      requestDetailsJson,
      responseJson,
      itemIdOverride,
      createNew,
    )
  }

  rememberSitePasskeyAssertion(credentialId: string) {
    return rememberSitePasskeyAssertionResult(this.db, this.browserPasskeyMutations(), credentialId)
  }

  listSshPublicIdentities(): SshIdentityRecord[] {
    return this.getSnapshot().items
      .filter((item) => item.itemType === 'ssh-key' && item.sshAlgorithm && item.sshFingerprint && item.sshPublicKey && item.sshComment)
      .map((item) => ({
        itemId: item.id,
        itemName: item.itemName,
        algorithm: item.sshAlgorithm as SshIdentityRecord['algorithm'],
        fingerprint: item.sshFingerprint!,
        publicKey: item.sshPublicKey!,
        comment: item.sshComment!,
      }))
  }

  listSshIdentities(): SshPrivateIdentityRecord[] {
    const items = this.db.prepare('SELECT id FROM identities WHERE itemType = ? ORDER BY itemName ASC').all('ssh-key') as Array<{ id: string }>
    return items
      .map(({ id }) => this.getItemDetails(id))
      .map((item) => (item ? toSshIdentityRecord(item) : undefined))
      .filter((item): item is SshPrivateIdentityRecord => Boolean(item))
  }
}
