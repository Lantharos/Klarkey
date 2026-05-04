import type Database from 'better-sqlite3'
import { toBrowserSiteUrl } from '@/shared/browser-extension'
import {
  buildBrowserPasskeySavePlan,
  filterUsableBrowserPasskeys,
  loadKnownPasskeyCredentialIds,
  queryPasskeyRowsForBrowser,
} from '@/electron/repository/browser-passkey-helpers'
import {
  type BrowserRequestOptions,
  type PendingPasskeyRow,
  id,
  now,
  parseJson,
  parseOptionalJson,
  tryDecrypt,
} from '@/electron/repository/helpers'
import { encryptValue } from '@/electron/crypto'
import { createSitePasskeyCredential, getSitePasskeyAssertion } from '@/electron/site-passkey-authenticator'
import type {
  ActionExecutionResult,
  BrowserPasskeyChoice,
  BrowserPasskeySavePlan,
  BrowserSiteMatch,
  CreateItemInput,
  ItemDetails,
} from '@/shared/types'

const maxBrowserPasskeyChoices = 20
const pendingBrowserPasskeyTtlMs = 10 * 60 * 1000

const browserSiteUrlForStorage = (url: string) => toBrowserSiteUrl(url) ?? url

export const pendingBrowserPasskeyCutoffIso = () => new Date(Date.now() - pendingBrowserPasskeyTtlMs).toISOString()

export function isPendingBrowserPasskeyFresh(createdAt: string) {
  const createdAtMs = Date.parse(createdAt)
  if (!Number.isFinite(createdAtMs)) {
    return false
  }
  return createdAtMs >= Date.now() - pendingBrowserPasskeyTtlMs && createdAtMs <= Date.now() + 60_000
}

export type BrowserPasskeyBridge = {
  listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[]
  getItemDetails: (itemId: string) => ItemDetails | undefined
  createItem: (input: CreateItemInput) => ActionExecutionResult
}

export type BrowserPasskeyMutations = {
  replaceItemPasskey: (itemId: string, keepPasskeyId?: string) => void
  syncItemPasskeyState: (itemId: string) => void
  remember: (actionId: string, label: string, itemId?: string) => void
}

export function listUsableSitePasskeys(
  db: Database.Database,
  url: string,
  requestDetailsJson: string,
  getItemDetails: (itemId: string) => ItemDetails | undefined,
) {
  return filterUsableBrowserPasskeys(queryPasskeyRowsForBrowser(db), url, requestDetailsJson, getItemDetails)
}

export function resolveBrowserPasskeyItem(
  bridge: BrowserPasskeyBridge,
  pendingPasskey: Pick<PendingPasskeyRow, 'label' | 'userName' | 'rpId'>,
  url: string,
  requestDetailsJson: string,
  itemIdOverride?: string,
  createNew?: boolean,
  existingItemId?: string,
): ActionExecutionResult | { itemId: string; plan: BrowserPasskeySavePlan } {
  const plan = buildBrowserPasskeySavePlan(
    bridge.listBrowserSiteMatches,
    bridge.getItemDetails,
    url,
    requestDetailsJson,
  )
  if (pendingPasskey.rpId && pendingPasskey.rpId !== plan.rpId) {
    return {
      status: 'error',
      title: 'Passkey site changed',
      message: 'Klarkey will not save a passkey outside the site that created it.',
    } satisfies ActionExecutionResult
  }

  const itemId = createNew ? undefined : itemIdOverride ?? existingItemId ?? plan.suggestedMatch?.itemId

  if (itemId) {
    const currentItem = bridge.getItemDetails(itemId)
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

  const createdItem = bridge.createItem({
    itemType: 'login',
    itemName: pendingPasskey.label || plan.itemName,
    username: pendingPasskey.userName || plan.userName,
    preserveEmptyPassword: true,
    websites: [browserSiteUrlForStorage(url)],
  })

  if (!createdItem.itemId) {
    return createdItem
  }

  return {
    itemId: createdItem.itemId,
    plan,
  }
}

export function prepareBrowserSitePasskey(
  db: Database.Database,
  key: Buffer,
  bridge: BrowserPasskeyBridge,
  url: string,
  origin: string,
  requestDetailsJson: string,
  userVerified = false,
): ActionExecutionResult {
  const plan = buildBrowserPasskeySavePlan(
    bridge.listBrowserSiteMatches,
    bridge.getItemDetails,
    url,
    requestDetailsJson,
  )
  const createdPasskey = createSitePasskeyCredential({
    origin,
    requestDetailsJson,
    existingCredentialIds: loadKnownPasskeyCredentialIds(db),
    userVerified,
  })
  const pendingPasskeyId = id('pending_passkey')

  db.prepare(
    `
        INSERT INTO pending_passkeys(
          id, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
  ).run(
    pendingPasskeyId,
    plan.itemName,
    createdPasskey.credentialId,
    plan.rpId,
    plan.userName ?? null,
    createdPasskey.userHandle,
    JSON.stringify(['internal']),
    JSON.stringify(encryptValue(key, JSON.stringify(createdPasskey.privateKeyJwk))),
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

export function savePreparedBrowserSitePasskey(
  db: Database.Database,
  mutations: BrowserPasskeyMutations,
  bridge: BrowserPasskeyBridge,
  pendingPasskeyId: string,
  url: string,
  requestDetailsJson: string,
  itemIdOverride?: string,
  createNew?: boolean,
): ActionExecutionResult {
  const pendingPasskey = db
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
  if (!isPendingBrowserPasskeyFresh(pendingPasskey.createdAt)) {
    db.prepare('DELETE FROM pending_passkeys WHERE id = ?').run(pendingPasskeyId)
    return {
      status: 'error',
      title: 'Passkey expired',
      message: 'Create the passkey again before saving it in Klarkey.',
    } satisfies ActionExecutionResult
  }

  const existing = db
    .prepare('SELECT id, itemId FROM passkeys WHERE credentialId = ?')
    .get(pendingPasskey.credentialId) as { id: string; itemId: string } | undefined
  const resolvedItem = resolveBrowserPasskeyItem(
    bridge,
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
    mutations.replaceItemPasskey(itemId, existing.id)
    db.prepare(
      `
          UPDATE passkeys
          SET identityId = ?, itemId = ?, label = ?, rpId = ?, userName = ?, userHandle = ?, transports = ?, privateKeyPayload = ?, signCount = 0, lastUsedAt = ?
          WHERE id = ?
        `,
    ).run(
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
    mutations.replaceItemPasskey(itemId)
    db.prepare(
      `
          INSERT INTO passkeys(
            id, identityId, itemId, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, signCount, lastUsedAt, createdAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
    ).run(
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

  const details = bridge.getItemDetails(itemId)
  const websites = Array.from(new Set([...(details?.websites ?? []), browserSiteUrlForStorage(url)]))
  db.prepare('UPDATE identities SET websites = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(websites), now(), itemId)
  mutations.syncItemPasskeyState(itemId)
  if (previousItemId && previousItemId !== itemId) {
    mutations.syncItemPasskeyState(previousItemId)
  }
  db.prepare('DELETE FROM pending_passkeys WHERE id = ?').run(pendingPasskeyId)

  return {
    status: 'success',
    title: 'Passkey saved',
    message: `${pendingPasskey.label} is now linked to this site in Klarkey.`,
    itemId,
  } satisfies ActionExecutionResult
}

export function discardPreparedBrowserSitePasskey(db: Database.Database, pendingPasskeyId: string): ActionExecutionResult {
  const deleted = db.prepare('DELETE FROM pending_passkeys WHERE id = ?').run(pendingPasskeyId)

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

export function listBrowserPasskeyChoicesForSite(
  db: Database.Database,
  url: string,
  requestDetailsJson: string,
  getItemDetails: (itemId: string) => ItemDetails | undefined,
): BrowserPasskeyChoice[] {
  return listUsableSitePasskeys(db, url, requestDetailsJson, getItemDetails)
    .slice(0, maxBrowserPasskeyChoices)
    .flatMap((passkey) =>
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

export function getPasskeysForBrowserRequestPayload(
  db: Database.Database,
  url: string,
  requestDetailsJson: string,
  getItemDetails: (itemId: string) => ItemDetails | undefined,
):
  | ActionExecutionResult
  | { requestDetailsJson: string; selectedCredentialIds: string[] } {
  const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
  const filtered = listUsableSitePasskeys(db, url, requestDetailsJson, getItemDetails).slice(0, maxBrowserPasskeyChoices)
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

export function getBrowserSitePasskeyResult(
  db: Database.Database,
  key: Buffer,
  mutations: BrowserPasskeyMutations,
  bridge: BrowserPasskeyBridge,
  url: string,
  origin: string,
  requestDetailsJson: string,
  credentialId?: string,
  userVerified = false,
): ActionExecutionResult {
  const usablePasskeys = listUsableSitePasskeys(db, url, requestDetailsJson, bridge.getItemDetails)
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
    tryDecrypt(key, selectedPasskey.privateKeyPayload) || undefined,
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
    userVerified,
    passkey: {
      credentialId: selectedPasskey.credentialId,
      rpId: selectedPasskey.rpId,
      userHandle: selectedPasskey.userHandle,
      signCount: selectedPasskey.signCount ?? 0,
      privateKeyJwk,
    },
  })

  db.prepare('UPDATE passkeys SET signCount = ?, lastUsedAt = ? WHERE credentialId = ?').run(
    assertion.signCount,
    now(),
    selectedPasskey.credentialId,
  )
  db.prepare('UPDATE identities SET lastUsedAt = ?, updatedAt = ? WHERE id = ?').run(now(), now(), selectedPasskey.itemId)
  mutations.remember(`passkey:${selectedPasskey.credentialId}`, selectedPasskey.label, selectedPasskey.itemId)

  return {
    status: 'success',
    title: 'Passkey approved',
    message: `${selectedPasskey.label} is ready.`,
    itemId: selectedPasskey.itemId,
    secret: assertion.responseJson,
  } satisfies ActionExecutionResult
}

export {
  rememberSitePasskeyAssertionResult,
  saveSitePasskeyFromBrowser,
} from '@/electron/repository/browser-site-passkey-save'
