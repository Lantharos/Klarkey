import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ExtensionGlobal = typeof globalThis & {
  browser?: unknown
  chrome?: unknown
}

const extensionGlobal = globalThis as ExtensionGlobal

const clearExtensionGlobals = () => {
  delete extensionGlobal.browser
  delete extensionGlobal.chrome
}

beforeEach(() => {
  vi.resetModules()
  clearExtensionGlobals()
})

afterEach(() => {
  clearExtensionGlobals()
  vi.restoreAllMocks()
})

describe('Chromium WebAuthenticationProxy attachment', () => {
  it('detaches instead of enabling the dormant proxy bridge', async () => {
    const attach = vi.fn(async () => undefined)
    const detach = vi.fn(async () => undefined)
    extensionGlobal.chrome = {
      webAuthenticationProxy: {
        attach,
        detach,
        onRemoteSessionStateChange: {
          addListener: vi.fn(),
        },
      },
      runtime: {
        onStartup: {
          addListener: vi.fn(),
        },
        onInstalled: {
          addListener: vi.fn(),
        },
      },
    }

    const { syncProxyAttachment } = await import('../../extension/shared/background/webauthn-proxy.js')

    await expect(syncProxyAttachment()).resolves.toBe(false)
    expect(attach).not.toHaveBeenCalled()
    expect(detach).toHaveBeenCalled()
  })

  it('stays disabled outside Chromium', async () => {
    const { syncProxyAttachment } = await import('../../extension/shared/background/webauthn-proxy.js')

    await expect(syncProxyAttachment()).resolves.toBe(false)
  })

  it('does not require the Chromium webAuthenticationProxy permission to load', async () => {
    extensionGlobal.chrome = {
      runtime: {
        onStartup: {
          addListener: vi.fn(),
        },
        onInstalled: {
          addListener: vi.fn(),
        },
      },
    }

    const { syncProxyAttachment } = await import('../../extension/shared/background/webauthn-proxy.js')

    await expect(syncProxyAttachment()).resolves.toBe(false)
  })
})
