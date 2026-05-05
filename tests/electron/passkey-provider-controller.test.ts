import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadController(lockState: 'locked' | 'unlocked' = 'locked') {
  vi.resetModules()

  vi.doMock('@/electron/crypto', () => ({
    KeyManager: class {
      isSafeStorageAvailable() {
        return true
      }

      unlockFromSystem() {
        return lockState === 'unlocked'
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

  vi.doMock('@/electron/desktop-lock-lease', () => ({
    readTrustedDesktopLockState: vi.fn(() => lockState),
  }))

  vi.doMock('@/electron/repository', () => ({
    VaultRepository: class {
      setKey() {}
      clearKey() {}
      getPasskeysForBrowserRequest() {
        return {
          requestDetailsJson: '{"allowCredentials":[{"id":"credential-1"}]}',
          selectedCredentialIds: ['credential-1'],
        }
      }
    },
  }))

  const { PasskeyProviderBridgeController } = await import('@/electron/passkey-provider-controller')
  return new PasskeyProviderBridgeController()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('passkey provider controller', () => {
  it('finds credential ids from metadata while the vault is locked', async () => {
    const controller = await loadController('locked')

    await expect(controller.handle({
      id: 'find-request',
      type: 'find-credentials',
      url: 'https://example.com/login',
      requestDetailsJson: '{}',
    })).resolves.toMatchObject({
      ok: true,
      result: {
        requestDetailsJson: expect.stringContaining('credential-1'),
        selectedCredentialIds: ['credential-1'],
      },
    })

    controller.dispose()
  })
})
