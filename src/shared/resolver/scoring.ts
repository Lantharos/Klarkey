import { normalizeBrowserHostname, primarySiteLabelFromHostname } from '@/shared/browser-extension'
import { normalizeLoginLogoDomain } from '@/shared/login-logo'
import type { ExternalWindowContext, ItemProfile, RecentAction } from '@/shared/types'

const genericBrowserAppNames = new Set([
  'brave',
  'chrome',
  'chromium',
  'firefox',
  'iexplore',
  'microsoftedge',
  'msedge',
  'opera',
  'vivaldi',
  'waterfox',
  'zen',
  'zenbrowser',
  'arc',
])

const stripTrailingBrowserFromTitle = (title: string) =>
  title
    .replace(/\s*[-—|]\s*(Google Chrome|Chromium|Microsoft Edge|Mozilla Firefox|Opera|Brave Browser|Brave|Vivaldi|Zen Browser|Arc)\s*$/i, '')
    .trim()

export function scoreForegroundMatch(item: ItemProfile, context?: ExternalWindowContext) {
  if (!context) {
    return 0
  }

  const appKey = context.appName?.replace(/\.exe$/i, '').toLowerCase() ?? ''
  const isGenericBrowser = appKey.length > 0 && genericBrowserAppNames.has(appKey)
  const titleRaw = context.windowTitle?.trim()

  let bonus = 0

  if (!isGenericBrowser && appKey.length >= 2) {
    const name = item.itemName.toLowerCase()
    if (name === appKey || name.includes(appKey) || appKey.includes(name)) {
      bonus = Math.max(bonus, 55)
    }
  }

  if (!titleRaw) {
    return bonus
  }

  const titleBlob = stripTrailingBrowserFromTitle(titleRaw).toLowerCase()

  if (item.itemType === 'login') {
    for (const site of item.websites ?? []) {
      const host = normalizeBrowserHostname(site)
      if (!host || host.length < 4) {
        continue
      }
      if (titleBlob.includes(host)) {
        bonus = Math.max(bonus, 70)
      } else {
        const primaryLabel = primarySiteLabelFromHostname(host)
        if (primaryLabel && titleBlob.includes(primaryLabel)) {
          bonus = Math.max(bonus, 66)
        }
      }
    }

    const logoDomain = (item.websites ?? []).map((w) => normalizeLoginLogoDomain(w)).find(Boolean)
    if (logoDomain && titleBlob.includes(logoDomain)) {
      bonus = Math.max(bonus, 68)
    }
  }

  const nameWords = item.itemName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)

  for (const word of nameWords) {
    if (titleBlob.includes(word)) {
      bonus = Math.max(bonus, 38)
      break
    }
  }

  return bonus
}

export const includes = (haystack: string | undefined, needle: string) =>
  (haystack ?? '').toLowerCase().includes(needle.toLowerCase())

export function scoreRecent(recents: RecentAction[], itemId?: string) {
  const hit = recents.find((recent) => recent.itemId === itemId)

  if (!hit) {
    return 0
  }

  const ageHours = (Date.now() - new Date(hit.usedAt).getTime()) / 3_600_000
  return Math.max(0, 40 - ageHours)
}

const searchableFields = (item: ItemProfile) =>
  [
    item.itemName,
    item.username,
    item.fullName,
    item.firstName,
    item.middleName,
    item.lastName,
    item.company,
    item.jobTitle,
    item.birthDate,
    item.email,
    item.phone,
    item.address,
    item.addressLine1,
    item.addressLine2,
    item.city,
    item.state,
    item.postalCode,
    item.country,
    item.cardholderName,
    item.cardNumber,
    item.cardLastFour,
    item.cardExpiry,
    item.cardExpiryMonth,
    item.cardExpiryYear,
    item.cardBrand,
    item.billingPostalCode,
    item.sshAlgorithm,
    item.sshFingerprint,
    item.sshPublicKey,
    item.sshComment,
    item.content,
    item.notes,
    ...(item.websites ?? []),
    ...(item.customFields?.flatMap((field) => [field.label, field.value]) ?? []),
  ].filter(Boolean) as string[]

export function itemScore(item: ItemProfile, query: string) {
  if (!query) {
    return 0
  }

  if (includes(item.itemName, query)) {
    return 32
  }

  const matchingField = searchableFields(item).find((value) => includes(value, query))

  if (!matchingField) {
    return 0
  }

  if (matchingField === item.username || matchingField === item.fullName || matchingField === item.email) {
    return 24
  }

  if (matchingField === item.content || matchingField === item.notes) {
    return 14
  }

  return 18
}
