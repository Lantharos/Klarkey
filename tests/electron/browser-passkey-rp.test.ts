import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildBrowserPasskeySavePlan,
  filterUsableBrowserPasskeys,
} from '@/electron/repository/browser-passkey-helpers'
import { isPendingBrowserPasskeyFresh, pendingBrowserPasskeyCutoffIso, resolveBrowserPasskeyItem } from '@/electron/repository/browser-site-passkey'
import type { PasskeyRow } from '@/electron/repository/helpers'
import type { ItemDetails } from '@/shared/types'

const passkeyRow = (overrides: Partial<PasskeyRow> = {}): PasskeyRow => ({
  id: 'passkey-1',
  itemId: 'item-1',
  label: 'Example',
  credentialId: 'credential-1',
  rpId: 'example.com',
  privateKeyPayload: 'encrypted',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const itemDetails = (websites: string[]): ItemDetails => ({
  itemId: 'item-1',
  itemType: 'login',
  itemName: 'Example',
  websites,
  customFields: [],
  recoveryCodes: [],
} as unknown as ItemDetails)

describe('browser passkey relying party filtering', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects passkey plans for cross-site relying party ids', () => {
    expect(() =>
      buildBrowserPasskeySavePlan(
        () => [],
        () => undefined,
        'https://evil.example.net/login',
        JSON.stringify({ rpId: 'example.com' }),
      ),
    ).toThrow('relying party id does not match')
  })

  it('does not list passkeys when the requested relying party id is cross-site', () => {
    expect(() =>
      filterUsableBrowserPasskeys(
        [passkeyRow()],
        'https://evil.example.net/login',
        JSON.stringify({ rpId: 'example.com' }),
        () => itemDetails(['https://evil.example.net']),
      ),
    ).toThrow('relying party id does not match')
  })

  it('allows a subdomain to use a valid parent-domain relying party id', () => {
    const result = filterUsableBrowserPasskeys(
      [passkeyRow()],
      'https://login.example.com/account',
      JSON.stringify({ rpId: 'example.com' }),
      () => itemDetails(['https://login.example.com']),
    )

    expect(result).toHaveLength(1)
  })

  it('does not fall back to website matching for a different saved relying party id', () => {
    const result = filterUsableBrowserPasskeys(
      [passkeyRow({ rpId: 'login.example.com' })],
      'https://example.com/login',
      JSON.stringify({}),
      () => itemDetails(['https://example.com']),
    )

    expect(result).toHaveLength(0)
  })

  it('does not save a prepared passkey under a different relying party context', () => {
    const result = resolveBrowserPasskeyItem(
      {
        listBrowserSiteMatches: () => [],
        getItemDetails: () => undefined,
        createItem: () => ({
          status: 'success',
          title: 'Created',
          message: 'Created.',
          itemId: 'item-1',
        }),
      },
      {
        label: 'Example',
        userName: 'kristof@example.com',
        rpId: 'example.com',
      },
      'https://evil.test/login',
      JSON.stringify({ rp: { id: 'evil.test', name: 'Evil' } }),
    )

    expect(result).toMatchObject({
      status: 'error',
      title: 'Passkey site changed',
    })
  })

  it('stores newly created passkey login websites as safe site origins', () => {
    let websites: string[] | undefined
    const result = resolveBrowserPasskeyItem(
      {
        listBrowserSiteMatches: () => [],
        getItemDetails: () => undefined,
        createItem: (input) => {
          websites = input.websites
          return {
            status: 'success',
            title: 'Created',
            message: 'Created.',
            itemId: 'item-1',
          }
        },
      },
      {
        label: 'Example',
        userName: 'kristof@example.com',
        rpId: 'example.com',
      },
      'https://example.com/reset/token?code=secret#fragment',
      JSON.stringify({ rp: { id: 'example.com', name: 'Example' } }),
    )

    expect(result).toMatchObject({ itemId: 'item-1' })
    expect(websites).toEqual(['https://example.com'])
  })

  it('expires browser-created pending passkeys quickly', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T12:00:00.000Z'))

    expect(isPendingBrowserPasskeyFresh('2026-05-04T11:51:00.000Z')).toBe(true)
    expect(isPendingBrowserPasskeyFresh('2026-05-04T11:49:59.999Z')).toBe(false)
    expect(isPendingBrowserPasskeyFresh('not-a-date')).toBe(false)
    expect(pendingBrowserPasskeyCutoffIso()).toBe('2026-05-04T11:50:00.000Z')
  })
})
