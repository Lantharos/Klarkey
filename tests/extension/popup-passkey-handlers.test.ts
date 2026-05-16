import { afterEach, describe, expect, it, vi } from 'vitest'

const loadPopupHandlers = async (requestHost: ReturnType<typeof vi.fn>) => {
  vi.resetModules()
  vi.doMock('../../extension/shared/background/native-messaging.js', () => ({
    browserKind: 'chromium',
    getActiveTab: vi.fn(),
    getPageContext: vi.fn(),
    isChromium: false,
    readDesktopConnectionState: vi.fn(),
    requestHost,
    sendTabMessage: vi.fn(),
    withTimeout: (promise: Promise<unknown>) => promise,
  }))
  vi.doMock('../../extension/shared/background/webauthn-proxy.js', () => ({
    syncProxyAttachment: vi.fn(async () => false),
  }))

  return import('../../extension/shared/background/popup-handlers.js')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('extension popup passkey handlers', () => {
  it('does not let passkey payloads override native request types', async () => {
    const requestHost = vi.fn(async (request: { type: string }) => ({
      ok: true,
      result: {
        plan: {},
        responseJson: '{}',
        credentialId: 'credential-1',
        pendingPasskeyId: 'pending-1',
        status: 'success',
        message: 'Done.',
        itemId: 'item-1',
        choices: [],
        observedType: request.type,
      },
    }))
    const handlers = await loadPopupHandlers(requestHost) as unknown as Record<string, (payload: unknown) => Promise<unknown>>

    const cases = [
      ['planPasskeyCreate', 'passkey-create-plan'],
      ['createPasskeyCredential', 'passkey-create-credential'],
      ['savePasskeyCredential', 'passkey-save-credential'],
      ['discardPasskeyCredential', 'passkey-discard-credential'],
      ['planPasskeyGet', 'passkey-get-plan'],
      ['getPasskeyCredential', 'passkey-get-credential'],
    ] as const

    for (const [handlerName, expectedType] of cases) {
      requestHost.mockClear()

      await handlers[handlerName]({
        type: 'get-login',
        challenge: 'challenge-1',
        pendingPasskeyId: 'pending-1',
      })

      expect(requestHost).toHaveBeenCalledWith(expect.objectContaining({
        type: expectedType,
        challenge: 'challenge-1',
        pendingPasskeyId: 'pending-1',
      }))
    }
  })

  it('reports native passkey save errors as failed saves', async () => {
    const requestHost = vi.fn(async () => ({
      ok: true,
      result: {
        status: 'error',
        message: 'Klarkey could not find the pending passkey to save.',
      },
    }))
    const { savePasskeyCredential } = await loadPopupHandlers(requestHost)

    await expect(savePasskeyCredential({ pendingPasskeyId: 'pending-1' })).resolves.toEqual({
      ok: false,
      message: 'Klarkey could not find the pending passkey to save.',
      itemId: undefined,
    })
  })

  it('reports locked passkey saves as failed saves', async () => {
    const requestHost = vi.fn(async () => ({
      ok: true,
      result: {
        status: 'locked',
        message: 'Unlock Klarkey to continue.',
      },
    }))
    const { savePasskeyCredential } = await loadPopupHandlers(requestHost)

    await expect(savePasskeyCredential({ pendingPasskeyId: 'pending-1' })).resolves.toEqual({
      ok: false,
      message: 'Unlock Klarkey to continue.',
      itemId: undefined,
    })
  })

  it('keeps successful passkey saves successful', async () => {
    const requestHost = vi.fn(async () => ({
      ok: true,
      result: {
        status: 'success',
        message: 'Passkey saved.',
        itemId: 'item-1',
      },
    }))
    const { savePasskeyCredential } = await loadPopupHandlers(requestHost)

    await expect(savePasskeyCredential({ pendingPasskeyId: 'pending-1' })).resolves.toEqual({
      ok: true,
      message: 'Passkey saved.',
      itemId: 'item-1',
    })
  })
})
