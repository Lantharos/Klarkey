import { resolveExactBrowserLoginMatch } from '@/electron/repository/browser-passkey-helpers'
import { normalizeBrowserHostname, primarySiteLabelFromHostname } from '@/shared/browser-extension'
import type {
  ActionExecutionResult,
  BrowserSaveLoginInput,
  BrowserSiteMatch,
  CreateItemInput,
  ItemDetails,
  UpdateItemInput,
} from '@/shared/types'

export type BrowserSaveLoginBridge = {
  listBrowserSiteMatches: (url: string, title?: string) => BrowserSiteMatch[]
  getItemDetails: (itemId: string) => ItemDetails | undefined
  createItem: (input: CreateItemInput) => ActionExecutionResult
  updateItem: (input: UpdateItemInput) => ActionExecutionResult
}

const ENTERPRISE_SSO_PROVIDERS = new Set(['Okta', 'Auth0', 'SSO', 'SAML'])

function ssoProvidersCompatible(left?: string, right?: string) {
  if (!left || !right) {
    return false
  }

  if (left.toLowerCase() === right.toLowerCase()) {
    return true
  }

  return ENTERPRISE_SSO_PROVIDERS.has(left) && ENTERPRISE_SSO_PROVIDERS.has(right)
}

function deriveItemName(url: string, title?: string): string {
  const hostname = normalizeBrowserHostname(url)
  const siteLabel = hostname ? primarySiteLabelFromHostname(hostname) : undefined
  if (siteLabel && siteLabel.length >= 2) {
    return siteLabel.charAt(0).toUpperCase() + siteLabel.slice(1)
  }
  return title?.trim() || url.replace(/^https?:\/\//i, '')
}

export function saveBrowserLoginWithBridge(bridge: BrowserSaveLoginBridge, input: BrowserSaveLoginInput): ActionExecutionResult {
  const url = input.url.trim()
  const username = input.username?.trim() || undefined
  const password = input.password?.trim() || undefined
  const ssoProvider = input.ssoProvider?.trim() || undefined

  // SSO login: no username/password, just provider + site
  if (ssoProvider) {
    const matches = bridge.listBrowserSiteMatches(url, input.title)
      .filter((match) => ssoProvidersCompatible(match.ssoProvider, ssoProvider))
    const exact = username
      ? matches.find((match) => (match.username || '').toLowerCase() === username.toLowerCase())
      : matches[0]

    if (exact) {
      return {
        status: 'info',
        title: 'Already saved',
        message: `${exact.itemName} is already saved as a ${ssoProvider} login.`,
        itemId: exact.itemId,
      } satisfies ActionExecutionResult
    }

    const incomplete = username ? matches.find((match) => !match.username) : undefined
    if (incomplete && incomplete.itemId) {
      const current = bridge.getItemDetails(incomplete.itemId)
      return bridge.updateItem({
        itemId: incomplete.itemId,
        itemType: 'login',
        itemName: current?.itemName || deriveItemName(url, input.title),
        username,
        password: current?.password,
        otp: current?.otp?.uri,
        notes: current?.notes,
        websites: Array.from(new Set([...(current?.websites ?? []), url].filter(Boolean))),
        customFields: current?.customFields,
        ssoProvider,
      })
    }

    return bridge.createItem({
      itemType: 'login',
      itemName: deriveItemName(url, input.title),
      username: username || '',
      password: '',
      preserveEmptyPassword: true,
      websites: [url],
      ssoProvider,
    })
  }

  const existing = resolveExactBrowserLoginMatch(
    bridge.listBrowserSiteMatches,
    bridge.getItemDetails,
    url,
    input.title,
    username,
    password,
  )

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
    return bridge.updateItem({
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
  return bridge.createItem({
    itemType: 'login',
    itemName: fallbackName,
    username,
    password,
    preserveEmptyPassword: !password,
    websites: [url],
  })
}
