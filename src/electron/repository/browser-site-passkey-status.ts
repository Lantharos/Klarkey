import type Database from 'better-sqlite3'
import { scoreWebsiteMatch } from '@/shared/browser-extension'
import type { BrowserPasskeyStatus } from '@/shared/types'
import { getHostname, parseJson } from '@/electron/repository/helpers'

export function computeBrowserPasskeyStatus(db: Database.Database, url: string): BrowserPasskeyStatus {
  const hostname = getHostname(url)
  const savedPasskeys = db
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
