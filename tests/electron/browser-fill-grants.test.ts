import { describe, expect, it } from 'vitest'
import { BrowserFillGrantStore } from '@/electron/browser-fill-grants'
import type { BrowserFieldSuggestion } from '@/shared/types'

const suggestion = (source: BrowserFieldSuggestion['source'], itemId: string): BrowserFieldSuggestion => ({
  id: `${source}:${itemId}`,
  itemId,
  itemName: 'Personal',
  value: 'Personal',
  field: source === 'card' ? 'cardNumber' : 'email',
  source,
  fromSiteMatch: false,
})

describe('browser fill grants', () => {
  it('allows identity and card fetches only after a same-site suggestion', () => {
    const grants = new BrowserFillGrantStore()
    grants.remember('https://shop.example/checkout?token=secret', [
      suggestion('identity', 'identity_1'),
      suggestion('card', 'card_1'),
      suggestion('login-username', 'login_1'),
    ], 1000)

    expect(grants.allows('identity', 'identity_1', 'https://shop.example/profile', 1001)).toBe(true)
    expect(grants.allows('card', 'card_1', 'https://shop.example/pay', 1001)).toBe(true)
    expect(grants.allows('identity', 'login_1', 'https://shop.example', 1001)).toBe(false)
    expect(grants.allows('card', 'card_1', 'https://evil.example', 1001)).toBe(false)
  })

  it('expires grants quickly and clears them on lock', () => {
    const grants = new BrowserFillGrantStore()
    grants.remember('https://shop.example', [suggestion('card', 'card_1')], 1000)

    expect(grants.allows('card', 'card_1', 'https://shop.example', 1000 + 119_999)).toBe(true)
    expect(grants.allows('card', 'card_1', 'https://shop.example', 1000 + 120_001)).toBe(false)

    grants.remember('https://shop.example', [suggestion('card', 'card_1')], 200_000)
    grants.clear()
    expect(grants.allows('card', 'card_1', 'https://shop.example', 200_001)).toBe(false)
  })
})
