import { afterEach, describe, expect, it, vi } from 'vitest'

const fillLogin = {
  itemId: 'item-1',
  itemName: 'Example',
  username: 'person@example.com',
  password: 'secret',
  websites: ['https://example.com'],
  hasPasskey: false,
}

const fillIdentity = {
  itemId: 'identity-1',
  itemName: 'Person',
  email: 'person@example.com',
}

const fillCard = {
  itemId: 'card-1',
  itemName: 'Card',
  cardNumber: '4111111111111111',
}

const browserMatch = {
  itemId: 'item-1',
  itemName: 'Example',
  username: 'person@example.com',
  websites: ['https://example.com'],
  hasPassword: true,
  hasOtp: false,
  hasPasskey: false,
}

const browserSuggestion = {
  id: 'item-1:login-username:username',
  itemId: 'item-1',
  itemName: 'Example',
  value: 'person@example.com',
  field: 'username',
  source: 'login-username',
  fromSiteMatch: true,
}

async function loadController(options: { lockState?: 'locked' | 'unlocked' } = {}) {
  vi.resetModules()
  const lockState = options.lockState ?? 'unlocked'
  const spawn = vi.fn(() => ({ unref: vi.fn() }))

  const resolveBrowserUserVerification = vi.fn(async () => ({
    ok: false,
    result: {
      status: 'error',
      title: 'Unexpected verification',
      message: 'Normal autofill should not request passkey verification.',
    },
  }))

  vi.doMock('node:child_process', () => ({
    default: { spawn },
    spawn,
  }))

  vi.doMock('electron', () => ({
    app: {
      getAppPath: vi.fn(() => process.cwd()),
    },
  }))

  vi.doMock('@/electron/browser-user-verification', () => ({
    resolveBrowserUserVerification,
  }))

  vi.doMock('@/electron/crypto', () => ({
    KeyManager: class {
      isSafeStorageAvailable() {
        return true
      }

      unlockFromSystem() {
        return true
      }

      isKeyInMemory() {
        return lockState === 'unlocked'
      }

      getKey() {
        return Buffer.alloc(32, 1)
      }

      evictKey() {}
    },
  }))

  vi.doMock('@/electron/database', () => ({
    createDatabase: vi.fn(() => ({
      db: {},
      close: vi.fn(),
    })),
  }))

  vi.doMock('@/electron/runtime-state', () => ({
    markRuntimeBusy: vi.fn(),
    noteExtensionActivity: vi.fn(),
    readRuntimeState: vi.fn(() => ({
      update: {
        availability: 'online',
        targetVersion: undefined,
        retryAfterSeconds: undefined,
      },
    })),
  }))

  vi.doMock('@/electron/desktop-lock-lease', () => ({
    readTrustedDesktopLockState: vi.fn(() => lockState),
  }))

  vi.doMock('@/electron/windows-hello-verifier', () => ({
    getWindowsHelloAvailability: vi.fn(async () => ({ available: true })),
  }))

  vi.doMock('@/electron/browser-fill-grants', () => ({
    BrowserFillGrantStore: class {
      remember = vi.fn()
      clear() {}
      allows() {
        return true
      }
    },
  }))

  vi.doMock('@/electron/repository/browser-site-matches', () => ({
    hasBrowserSiteAccess: vi.fn(() => true),
  }))

  vi.doMock('@/electron/repository', () => ({
    VaultRepository: class {
      setKey() {}
      clearKey() {}
      getSnapshot() {
        return { items: [] }
      }
      listBrowserSiteMatches() {
        return [browserMatch]
      }
      listBrowserFieldSuggestions() {
        return [browserSuggestion]
      }
      getBrowserFillLogin() {
        return fillLogin
      }
      getBrowserFillIdentity() {
        return fillIdentity
      }
      getBrowserFillCard() {
        return fillCard
      }
      getBrowserPasskeyStatus() {
        return {
          supported: true,
          browser: 'other',
          mode: 'browser-limited',
          conditionalUi: false,
          availablePasskeyCount: 2,
          exactMatchCount: 1,
          linkedMatchCount: 0,
        }
      }
      planBrowserPasskeyCreate() {
        return {
          rpId: 'example.com',
          itemName: 'Example',
        }
      }
      listBrowserPasskeyChoices() {
        return [
          {
            credentialId: 'credential-1',
            itemId: 'item-1',
            itemName: 'Example',
            rpId: 'example.com',
          },
        ]
      }
    },
  }))

  const { BrowserExtensionController } = await import('@/electron/extension-controller')
  return {
    controller: new BrowserExtensionController(),
    resolveBrowserUserVerification,
    spawn,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('browser extension controller autofill', () => {
  it('does not ask for passkey-style user verification after normal vault autofill unlock', async () => {
    const { controller, resolveBrowserUserVerification } = await loadController()

    await expect(controller.handle({
      id: 'login-request',
      type: 'get-login',
      itemId: 'item-1',
      url: 'https://example.com',
      title: 'Example',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        login: fillLogin,
      },
    })

    await expect(controller.handle({
      id: 'identity-request',
      type: 'get-identity',
      itemId: 'identity-1',
      url: 'https://example.com',
      title: 'Example',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        identity: fillIdentity,
      },
    })

    await expect(controller.handle({
      id: 'card-request',
      type: 'get-card',
      itemId: 'card-1',
      url: 'https://example.com',
      title: 'Example',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        card: fillCard,
      },
    })

    expect(resolveBrowserUserVerification).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('answers passkey discovery while locked without opening an unlock prompt', async () => {
    const { controller, spawn } = await loadController({ lockState: 'locked' })

    await expect(controller.handle({
      id: 'status-request',
      type: 'passkeys-status',
      url: 'https://example.com/login',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'locked',
        locked: true,
        supported: true,
        exactMatchCount: 1,
      },
    })

    await expect(controller.handle({
      id: 'plan-request',
      type: 'passkey-get-plan',
      url: 'https://example.com/login',
      title: 'Example',
      requestDetailsJson: '{}',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        locked: true,
        choices: [
          expect.objectContaining({
            credentialId: 'credential-1',
          }),
        ],
      },
    })

    expect(spawn).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('answers autofill discovery while locked without opening an unlock prompt', async () => {
    const { controller, spawn } = await loadController({ lockState: 'locked' })

    await expect(controller.handle({
      id: 'matches-request',
      type: 'list-logins',
      url: 'https://example.com/login',
      title: 'Example',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        locked: true,
        matches: [
          expect.objectContaining({
            itemId: 'item-1',
            itemName: 'Example',
          }),
        ],
      },
    })

    await expect(controller.handle({
      id: 'suggestions-request',
      type: 'list-field-suggestions',
      field: 'username',
      flow: 'login',
      url: 'https://example.com/login',
      title: 'Example',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        locked: true,
        suggestions: [
          expect.objectContaining({
            itemId: 'item-1',
            value: 'person@example.com',
          }),
        ],
      },
    })

    expect(spawn).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('starts direct Windows Hello unlock for active locked autofill without opening Klarkey', async () => {
    const { controller, spawn } = await loadController({ lockState: 'locked' })

    await expect(controller.handle({
      id: 'login-request',
      type: 'get-login',
      itemId: 'item-1',
      url: 'https://example.com/login',
      title: 'Example',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'locked',
      },
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const [, args, options] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(args).toContain('--external-unlock')
    expect(args).not.toContain('--open-palette')
    expect(options).toMatchObject({
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    controller.dispose()
  })
})
