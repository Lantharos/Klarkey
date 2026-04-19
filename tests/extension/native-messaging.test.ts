import { beforeEach, describe, expect, it, vi } from 'vitest'

type NativeRequest = { id: string; type: string }

function createPortMock(handler: (payload: NativeRequest) => unknown) {
  const messageListeners: Array<(message: unknown) => void> = []
  const disconnectListeners: Array<() => void> = []

  return {
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        messageListeners.push(listener)
      },
    },
    onDisconnect: {
      addListener(listener: () => void) {
        disconnectListeners.push(listener)
      },
    },
    postMessage(payload: NativeRequest) {
      const response = handler(payload)
      queueMicrotask(() => {
        for (const listener of messageListeners) {
          listener(response)
        }
      })
    },
    _disconnect() {
      for (const listener of disconnectListeners) {
        listener()
      }
    },
  }
}

describe('extension native messaging retry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('retries retryable request after unlock signal', async () => {
    const requestTypes: string[] = []

    const port = createPortMock((payload) => {
      requestTypes.push(payload.type)
      if (payload.type === 'list-logins' && requestTypes.filter((t) => t === 'list-logins').length === 1) {
        return { id: payload.id, ok: true, result: { status: 'locked' } }
      }
      if (payload.type === 'ping') {
        return { id: payload.id, ok: true, result: { vaultUnlocked: true } }
      }
      return { id: payload.id, ok: true, result: { matches: [] } }
    })

    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        connectNative: vi.fn(() => port),
        lastError: undefined,
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
      },
    }

    const mod = await import('../../extension/shared/background/native-messaging.js')
    const response = await mod.requestHost({ type: 'list-logins', url: 'https://example.com' })

    expect(response?.ok).toBe(true)
    expect(requestTypes).toEqual(['list-logins', 'ping', 'list-logins'])
  })

  it('does not retry non-retryable request types', async () => {
    const requestTypes: string[] = []

    const port = createPortMock((payload) => {
      requestTypes.push(payload.type)
      return { id: payload.id, ok: true, result: { status: 'locked' } }
    })

    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        connectNative: vi.fn(() => port),
        lastError: undefined,
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
      },
    }

    const mod = await import('../../extension/shared/background/native-messaging.js')
    await mod.requestHost({ type: 'save-login', payload: {} })

    expect(requestTypes).toEqual(['save-login'])
  })
})
