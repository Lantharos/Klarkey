import type Database from 'better-sqlite3'
import { scoreWebsiteMatch } from '@/shared/browser-extension'
import { normalizeCredentialId } from '@/shared/passkey-encoding'
import type { BrowserPasskeySavePlan, BrowserSiteMatch, ItemDetails } from '@/shared/types'
import {
  type BrowserRequestCredential,
  type BrowserRequestOptions,
  type PasskeyRow,
  getHostname,
  isExactBrowserAccountMatch,
  parseJson,
} from '@/electron/repository/helpers'

export function resolveExactBrowserLoginMatch(
  listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[],
  getItemDetails: (itemId: string) => ItemDetails | undefined,
  url: string,
  title: string | undefined,
  username: string | undefined,
  password: string | undefined,
): ItemDetails | undefined {
  const matches = listBrowserSiteMatches(url, title)
  const logins = matches
    .map((match) => getItemDetails(match.itemId))
    .filter((item): item is ItemDetails => Boolean(item && item.itemType === 'login'))

  const exactAccountMatch = logins.find(
    (item) => isExactBrowserAccountMatch(item.username, username) || isExactBrowserAccountMatch(item.email, username),
  )
  if (exactAccountMatch) {
    return exactAccountMatch
  }

  const exactPasswordMatches = password ? logins.filter((item) => Boolean(item.password) && item.password === password) : []

  if (!username && exactPasswordMatches.length === 1) {
    return exactPasswordMatches[0]
  }

  return undefined
}

export function loadKnownPasskeyCredentialIds(db: Database.Database): string[] {
  const savedCredentialIds = db
    .prepare('SELECT credentialId FROM passkeys WHERE credentialId IS NOT NULL')
    .all() as Array<{ credentialId: string }>
  const pendingCredentialIds = db
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

export function buildBrowserPasskeySavePlan(
  listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[],
  getItemDetails: (itemId: string) => ItemDetails | undefined,
  url: string,
  requestDetailsJson: string,
): BrowserPasskeySavePlan {
  const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
  const rpId = request.rp?.id?.trim() || request.rpId?.trim() || getHostname(url)
  const userName = request.user?.name?.trim() || undefined
  const itemName = request.rp?.name?.trim() || rpId || 'Saved passkey'
  const siteMatches = listBrowserSiteMatches(url, request.rp?.name?.trim())
  const suggestedMatch = siteMatches.find(
    (match) =>
      isExactBrowserAccountMatch(match.username, userName) || isExactBrowserAccountMatch(getItemDetails(match.itemId)?.email, userName),
  )

  return {
    rpId,
    userName,
    itemName,
    suggestedMatch,
  } satisfies BrowserPasskeySavePlan
}

export function queryPasskeyRowsForBrowser(db: Database.Database): PasskeyRow[] {
  return db
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
}

export function filterUsableBrowserPasskeys(
  rows: PasskeyRow[],
  url: string,
  requestDetailsJson: string,
  getItemDetails: (itemId: string) => ItemDetails | undefined,
): PasskeyRow[] {
  const request = parseJson<BrowserRequestOptions>(requestDetailsJson, {})
  const rpId = request.rpId?.trim() || request.rp?.id?.trim() || getHostname(url)
  const requestedIds = new Set(
    (request.allowCredentials ?? [])
      .map((credential: BrowserRequestCredential) => normalizeCredentialId(credential.id))
      .filter((credentialId: string | undefined): credentialId is string => Boolean(credentialId)),
  )

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

    const item = getItemDetails(passkey.itemId)
    return Boolean(item && scoreWebsiteMatch(item.websites ?? [], url) > 0)
  })
}
