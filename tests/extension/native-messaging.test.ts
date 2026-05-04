import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('redacts sensitive native messaging errors', async () => {
    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        connectNative: vi.fn(),
        lastError: undefined,
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
      },
    }

    const mod = await import('../../extension/shared/background/native-messaging.js')

    expect(mod.safeExtensionErrorMessage(new Error('Timed out'))).toBe('Timed out')
    expect(mod.safeExtensionErrorMessage(new Error('refresh_token=abc'), 'Fallback')).toBe('Fallback')
    expect(mod.safeExtensionErrorMessage(new Error('credentialId=abc'), 'Fallback')).toBe('Fallback')
    expect(mod.safeExtensionErrorMessage(new Error('privateKey=abc'), 'Fallback')).toBe('Fallback')
    expect(mod.safeExtensionErrorMessage('failed at https://id.example.test/callback?code=abc', 'Fallback')).toBe('Fallback')
  })

  it('rejects oversized native requests before connecting to the host', async () => {
    const connectNative = vi.fn()

    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        connectNative,
        lastError: undefined,
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
      },
    }

    const mod = await import('../../extension/shared/background/native-messaging.js')

    await expect(mod.requestHost({
      type: 'save-login',
      payload: {
        url: 'https://example.com',
        password: 'x'.repeat(mod.MAX_NATIVE_REQUEST_BYTES),
      },
    })).rejects.toThrow('too large')
    expect(connectNative).not.toHaveBeenCalled()
  })

  it('uses Web Crypto for native request ids', () => {
    const source = readFileSync(resolve(process.cwd(), 'extension/shared/background/native-messaging.js'), 'utf8')

    expect(source).toContain('crypto.getRandomValues')
    expect(source).not.toContain('Math.random')
  })
})
