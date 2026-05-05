import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('extension popup state', () => {
  it('returns promptly when passkey state is locked on normal web pages', async () => {
    const requestHost = vi.fn(async () => ({
      ok: true,
      result: {
        status: 'locked',
        locked: true,
        supported: true,
        browser: 'other',
        mode: 'browser-limited',
        conditionalUi: false,
        availablePasskeyCount: 2,
        exactMatchCount: 1,
        linkedMatchCount: 0,
        reason: 'Windows Hello will unlock Klarkey when you use a saved passkey.',
      },
    }))

    vi.doMock('../../extension/shared/background/native-messaging.js', () => ({
      browserKind: 'chromium',
      getActiveTab: vi.fn(async () => ({ id: 1, url: 'https://example.com/login', title: 'Example' })),
      getPageContext: vi.fn(async () => ({ url: 'https://example.com/login', title: 'Example' })),
      isChromium: true,
      readDesktopConnectionState: vi.fn(async () => ({ connected: true, updating: false })),
      requestHost,
      safeExtensionErrorMessage: vi.fn((error: unknown, fallback: string) => error instanceof Error ? error.message : fallback),
      sendTabMessage: vi.fn(),
      withTimeout: (promise: Promise<unknown>) => promise,
    }))
    vi.doMock('../../extension/shared/background/webauthn-proxy.js', () => ({
      syncProxyAttachment: vi.fn(async () => false),
    }))

    const { loadPopupState } = await import('../../extension/shared/background/popup-handlers.js')
    const state = await loadPopupState()

    expect(requestHost).toHaveBeenCalledWith({ type: 'passkeys-status', url: 'https://example.com/login' })
    expect(state.connected).toBe(true)
    expect(state.passkeys).toMatchObject({
      status: 'locked',
      locked: true,
      supported: true,
      exactMatchCount: 1,
    })
  })
})
