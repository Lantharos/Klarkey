import { buildBrowserFieldSuggestions } from '@/electron/repository/browser-field-suggestions'
import { saveBrowserLoginWithBridge } from '@/electron/repository/browser-save-login'
import { buildBrowserSiteMatches, hasBrowserSiteAccess } from '@/electron/repository/browser-site-matches'
import { scoreWebsiteMatch } from '@/shared/browser-url'
import type { CreateItemInput, ItemProfile, VaultSnapshot } from '@/shared/types'

const createItem = (index: number, itemType: ItemProfile['itemType']): ItemProfile => ({
  id: `item_${index}`,
  itemType,
  itemName: `Example ${index}`,
  username: itemType === 'login' ? `person${index}@example.com` : undefined,
  email: itemType === 'identity' ? `person${index}@example.com` : undefined,
  websites: itemType === 'login' ? ['https://example.com'] : [],
  hasPassword: itemType === 'login',
  hasOtp: false,
  hasPasskey: false,
  hasRecoveryCodes: false,
})

describe('browser extension response limits', () => {
  it('caps site match responses before they cross the native messaging boundary', () => {
    const snapshot: VaultSnapshot = {
      items: Array.from({ length: 25 }, (_, index) => createItem(index, 'login')),
      recents: [],
    }

    expect(buildBrowserSiteMatches(snapshot, 'https://example.com/login')).toHaveLength(20)
  })

  it('does not score browser matches from sensitive url query text', () => {
    const snapshot: VaultSnapshot = {
      items: [
        {
          ...createItem(1, 'login'),
          itemName: 'secret',
          websites: ['https://other.example'],
        },
      ],
      recents: [],
    }

    expect(buildBrowserSiteMatches(snapshot, 'https://example.com/login?code=secret')).toEqual([])
  })

  it('requires a saved hostname match before releasing login fill material', () => {
    const snapshot: VaultSnapshot = {
      items: [
        {
          ...createItem(1, 'login'),
          itemName: 'Example',
          websites: ['https://accounts.example.com'],
        },
      ],
      recents: [],
    }

    expect(buildBrowserSiteMatches(snapshot, 'https://evil.test/login', 'Example sign in')).toHaveLength(1)
    expect(hasBrowserSiteAccess(snapshot, 'item_1', 'https://evil.test/login')).toBe(false)
    expect(hasBrowserSiteAccess(snapshot, 'item_1', 'https://accounts.example.com/login')).toBe(true)
  })

  it('does not grant autofill access from public suffix website entries', () => {
    expect(scoreWebsiteMatch(['https://co.uk'], 'https://bank.co.uk/login')).toBe(0)
    expect(scoreWebsiteMatch(['https://github.io'], 'https://project.github.io/login')).toBe(0)
    expect(scoreWebsiteMatch(['https://example.co.uk'], 'https://accounts.example.co.uk/login')).toBe(80)
  })

  it('caps field suggestion responses before they cross the native messaging boundary', () => {
    const snapshot: VaultSnapshot = {
      items: Array.from({ length: 40 }, (_, index) => createItem(index, 'identity')),
      recents: [],
    }

    const suggestions = buildBrowserFieldSuggestions(
      {
        getSnapshot: () => snapshot,
        listBrowserSiteMatches: () => [],
      },
      'email',
      'register',
      'https://example.com/signup',
    )

    expect(suggestions).toHaveLength(30)
  })

  it('keeps raw field values out of suggestion identifiers', () => {
    const snapshot: VaultSnapshot = {
      items: [
        {
          ...createItem(1, 'identity'),
          id: 'identity_1',
          itemName: 'Personal identity',
          email: 'person@example.com',
          address: '123 Secret Street',
        },
      ],
      recents: [],
    }

    const ctx = {
      getSnapshot: () => snapshot,
      listBrowserSiteMatches: () => [],
    }

    const [emailSuggestion] = buildBrowserFieldSuggestions(
      ctx,
      'email',
      'register',
      'https://example.com/signup',
    )
    const [addressSuggestion] = buildBrowserFieldSuggestions(
      ctx,
      'address',
      'register',
      'https://example.com/signup',
    )

    expect(emailSuggestion).toEqual(expect.objectContaining({
      id: 'identity_1:identity:email',
      value: 'person@example.com',
    }))
    expect(emailSuggestion?.id).not.toContain('person')
    expect(emailSuggestion?.id).not.toContain('@')
    expect(addressSuggestion).toEqual(expect.objectContaining({
      id: 'identity_1:identity:address',
      value: '123 Secret Street',
    }))
    expect(addressSuggestion?.id.toLowerCase()).not.toContain('secret')
  })

  it('masks payment secrets in field suggestions before click-to-fill', () => {
    const snapshot: VaultSnapshot = {
      items: [
        {
          id: 'card_1',
          itemType: 'card',
          itemName: 'Personal Visa',
          username: undefined,
          email: undefined,
          websites: [],
          hasPassword: false,
          hasOtp: false,
          hasPasskey: false,
          hasRecoveryCodes: false,
          cardNumber: '4111 1111 1111 1111',
          cardCvc: '123',
        },
      ],
      recents: [],
    }

    const ctx = {
      getSnapshot: () => snapshot,
      listBrowserSiteMatches: () => [],
    }

    const cardNumberSuggestions = buildBrowserFieldSuggestions(ctx, 'cardNumber', 'payment', 'https://checkout.example')
    const cardCvcSuggestions = buildBrowserFieldSuggestions(ctx, 'cardCvc', 'payment', 'https://checkout.example')

    expect(cardNumberSuggestions).toEqual([
      expect.objectContaining({ value: 'Card ending 1111' }),
    ])
    expect(cardCvcSuggestions).toEqual([
      expect.objectContaining({ value: 'Security code' }),
    ])
    expect(cardNumberSuggestions[0]?.id).not.toContain('4111')
    expect(cardCvcSuggestions[0]?.id).not.toContain('123')
  })

  it('stores browser-saved login websites as safe site origins', () => {
    let createdItem: CreateItemInput | undefined
    const result = saveBrowserLoginWithBridge(
      {
        listBrowserSiteMatches: () => [],
        getItemDetails: () => undefined,
        createItem: (input) => {
          createdItem = input
          return {
            status: 'success',
            title: 'Created',
            message: 'Created.',
            itemId: 'item_1',
          }
        },
        updateItem: () => ({
          status: 'success',
          title: 'Updated',
          message: 'Updated.',
          itemId: 'item_1',
        }),
      },
      {
        url: 'https://example.com/reset/token?code=secret#fragment',
        username: 'person@example.com',
        password: 'password',
      },
    )

    expect(result.status).toBe('success')
    expect(createdItem?.websites).toEqual(['https://example.com'])
  })
})
