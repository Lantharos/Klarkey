import { toBrowserSiteUrl } from '@/shared/browser-url'
import type { BrowserFieldSuggestion, BrowserFieldSuggestionSource } from '@/shared/types'

type BrowserFillGrantSource = Extract<BrowserFieldSuggestionSource, 'identity' | 'card'>

const grantTtlMs = 2 * 60 * 1000

const grantKey = (source: BrowserFillGrantSource, itemId: string, url: string) =>
  `${source}:${itemId}:${toBrowserSiteUrl(url) ?? url.trim()}`

export class BrowserFillGrantStore {
  private readonly grants = new Map<string, number>()

  remember(url: string, suggestions: readonly BrowserFieldSuggestion[], now = Date.now()) {
    this.prune(now)
    for (const suggestion of suggestions) {
      if (suggestion.source !== 'identity' && suggestion.source !== 'card') {
        continue
      }

      this.grants.set(grantKey(suggestion.source, suggestion.itemId, url), now + grantTtlMs)
    }
  }

  allows(source: BrowserFillGrantSource, itemId: string, url: string, now = Date.now()) {
    this.prune(now)
    return (this.grants.get(grantKey(source, itemId, url)) ?? 0) > now
  }

  clear() {
    this.grants.clear()
  }

  private prune(now: number) {
    for (const [key, expiresAt] of this.grants) {
      if (expiresAt <= now) {
        this.grants.delete(key)
      }
    }
  }
}
