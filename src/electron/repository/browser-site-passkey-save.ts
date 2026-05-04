import type Database from 'better-sqlite3'
import { normalizeCredentialId } from '@/shared/passkey-encoding'
import { toBrowserSiteUrl } from '@/shared/browser-url'
import { buildBrowserPasskeySavePlan } from '@/electron/repository/browser-passkey-helpers'
import { id, now, parseJson } from '@/electron/repository/helpers'
import type {
  ActionExecutionResult,
  BrowserSiteMatch,
  CreateItemInput,
  ItemDetails,
} from '@/shared/types'

type BrowserPasskeySaveBridge = {
  listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[]
  getItemDetails: (itemId: string) => ItemDetails | undefined
  createItem: (input: CreateItemInput) => ActionExecutionResult
}

type BrowserPasskeySaveMutations = {
  replaceItemPasskey: (itemId: string, keepPasskeyId?: string) => void
  syncItemPasskeyState: (itemId: string) => void
  remember: (actionId: string, label: string, itemId?: string) => void
}

const browserSiteUrlForStorage = (url: string) => toBrowserSiteUrl(url) ?? url

export function saveSitePasskeyFromBrowser(
  db: Database.Database,
  mutations: BrowserPasskeySaveMutations,
  bridge: BrowserPasskeySaveBridge,
  url: string,
  requestDetailsJson: string,
  responseJson: string,
  itemIdOverride?: string,
  createNew?: boolean,
): ActionExecutionResult {
  const response = parseJson<{ id?: unknown; rawId?: unknown; response?: { transports?: string[] } }>(responseJson, {})
  const credentialId = normalizeCredentialId(response.id ?? response.rawId)
  const plan = buildBrowserPasskeySavePlan(
    bridge.listBrowserSiteMatches,
    bridge.getItemDetails,
    url,
    requestDetailsJson,
  )
  if (!credentialId) {
    return {
      status: 'error',
      title: 'Passkey missing',
      message: 'The browser did not return a passkey credential id.',
    } satisfies ActionExecutionResult
  }

  const existing = db
    .prepare('SELECT id, itemId FROM passkeys WHERE credentialId = ?')
    .get(credentialId) as { id: string; itemId: string } | undefined
  let itemId = createNew ? undefined : itemIdOverride ?? plan.suggestedMatch?.itemId ?? existing?.itemId

  if (!itemId) {
    const createdItem = bridge.createItem({
      itemType: 'login',
      itemName: plan.itemName,
      username: plan.userName,
      preserveEmptyPassword: true,
      websites: [browserSiteUrlForStorage(url)],
    })

    if (!createdItem.itemId) {
      return createdItem
    }

    itemId = createdItem.itemId
  }

  const previousItemId = existing?.itemId

  if (existing) {
    mutations.replaceItemPasskey(itemId, existing.id)
    db.prepare(
      `
          UPDATE passkeys
          SET identityId = ?, itemId = ?, label = ?, rpId = ?, userName = ?, transports = ?, lastUsedAt = ?
          WHERE id = ?
        `,
    ).run(
      itemId,
      itemId,
      plan.itemName,
      plan.rpId,
      plan.userName ?? null,
      JSON.stringify(response.response?.transports ?? []),
      now(),
      existing.id,
    )
  } else {
    mutations.replaceItemPasskey(itemId)
    db.prepare(
      `
          INSERT INTO passkeys(id, identityId, itemId, label, credentialId, rpId, userName, transports, lastUsedAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
    ).run(
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

  const details = bridge.getItemDetails(itemId)
  const websites = Array.from(new Set([...(details?.websites ?? []), browserSiteUrlForStorage(url)]))
  db.prepare('UPDATE identities SET websites = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(websites), now(), itemId)
  mutations.syncItemPasskeyState(itemId)
  if (previousItemId && previousItemId !== itemId) {
    mutations.syncItemPasskeyState(previousItemId)
  }

  return {
    status: 'success',
    title: 'Passkey saved',
    message: `${plan.itemName} is now linked to this site in Klarkey.`,
    itemId,
  } satisfies ActionExecutionResult
}

export function rememberSitePasskeyAssertionResult(
  db: Database.Database,
  mutations: Pick<BrowserPasskeySaveMutations, 'remember'>,
  credentialId: string,
): ActionExecutionResult {
  const normalizedCredentialId = normalizeCredentialId(credentialId)
  if (!normalizedCredentialId) {
    return {
      status: 'error',
      title: 'Passkey missing',
      message: 'The selected passkey id is invalid.',
    } satisfies ActionExecutionResult
  }

  const current = db
    .prepare('SELECT itemId, label FROM passkeys WHERE credentialId = ?')
    .get(normalizedCredentialId) as { itemId: string; label: string } | undefined

  if (!current) {
    return {
      status: 'error',
      title: 'Passkey missing',
      message: 'The selected passkey is not known to Klarkey.',
    } satisfies ActionExecutionResult
  }

  db.prepare('UPDATE passkeys SET lastUsedAt = ? WHERE credentialId = ?').run(now(), normalizedCredentialId)
  db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), current.itemId)
  mutations.remember(`passkey:${normalizedCredentialId}`, current.label, current.itemId)

  return {
    status: 'success',
    title: 'Passkey approved',
    message: `${current.label} was used through the browser bridge.`,
    itemId: current.itemId,
  } satisfies ActionExecutionResult
}
