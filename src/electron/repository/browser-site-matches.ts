import { normalizeBrowserHostname, primarySiteLabelFromHostname, scoreWebsiteMatch, toBrowserSiteUrl } from '@/shared/browser-extension'
import { getHostnameLabel, normalizeSearchText, scoreTextHit } from '@/electron/repository/helpers'
import type { BrowserSiteMatch, VaultSnapshot } from '@/shared/types'

const maxBrowserSiteMatches = 20

export function hasBrowserSiteAccess(snapshot: VaultSnapshot, itemId: string, url: string) {
  const siteUrl = toBrowserSiteUrl(url) ?? url
  const item = snapshot.items.find((candidate) => candidate.id === itemId)
  return item?.itemType === 'login' && scoreWebsiteMatch(item.websites ?? [], siteUrl) > 0
}

export function buildBrowserSiteMatches(snapshot: VaultSnapshot, url: string, title?: string): BrowserSiteMatch[] {
  const siteUrl = toBrowserSiteUrl(url) ?? url
  const siteLabel = getHostnameLabel(siteUrl)
  const titleText = normalizeSearchText(title)
  const urlText = normalizeSearchText(siteUrl)
  const matches = snapshot.items
    .filter((item) => item.itemType === 'login')
    .map((item) => ({
      item,
      score: (() => {
        const siteScore = scoreWebsiteMatch(item.websites ?? [], siteUrl)
        const itemName = normalizeSearchText(item.itemName)
        const labelScore = siteLabel ? scoreTextHit(itemName, siteLabel, 28, 20) : 0
        const titleScore = itemName ? scoreTextHit(titleText, itemName, 26, 18) : 0
        const urlScore = itemName ? scoreTextHit(urlText, itemName, 20, 14) : 0
        let savedSiteLabelInTitleScore = 0
        for (const site of item.websites ?? []) {
          const host = normalizeBrowserHostname(site)
          if (!host) {
            continue
          }
          const primaryLabel = primarySiteLabelFromHostname(host)
          if (primaryLabel && titleText.includes(primaryLabel)) {
            savedSiteLabelInTitleScore = Math.max(savedSiteLabelInTitleScore, 28)
          }
        }
        return siteScore + labelScore + titleScore + urlScore + savedSiteLabelInTitleScore
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

  return matches.slice(0, maxBrowserSiteMatches).map(({ item }) => ({
    itemId: item.id,
    itemName: item.itemName,
    username: item.username,
    websites: item.websites ?? [],
    hasPassword: item.hasPassword,
    hasOtp: item.hasOtp,
    hasPasskey: item.hasPasskey,
    ssoProvider: item.ssoProvider,
    lastUsedAt: item.lastUsedAt,
  })) satisfies BrowserSiteMatch[]
}
