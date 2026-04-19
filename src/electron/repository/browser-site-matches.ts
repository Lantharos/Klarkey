import { scoreWebsiteMatch } from '@/shared/browser-extension'
import { getHostnameLabel, normalizeSearchText, scoreTextHit } from '@/electron/repository/helpers'
import type { BrowserSiteMatch, VaultSnapshot } from '@/shared/types'

export function buildBrowserSiteMatches(snapshot: VaultSnapshot, url: string, title?: string): BrowserSiteMatch[] {
  const siteLabel = getHostnameLabel(url)
  const titleText = normalizeSearchText(title)
  const urlText = normalizeSearchText(url)
  const matches = snapshot.items
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
