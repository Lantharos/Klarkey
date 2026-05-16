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

  it('retries active secret requests after an unlock signal', async () => {
    const requestTypes: string[] = []

    const port = createPortMock((payload) => {
      requestTypes.push(payload.type)
      if (payload.type === 'get-login' && requestTypes.filter((t) => t === 'get-login').length === 1) {
        return { id: payload.id, ok: true, result: { status: 'locked' } }
      }
      if (payload.type === 'ping') {
        return { id: payload.id, ok: true, result: { vaultUnlocked: true } }
      }
      return { id: payload.id, ok: true, result: { login: { itemId: 'item-1' } } }
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
    const response = await mod.requestHost({ type: 'get-login', itemId: 'item-1', url: 'https://example.com' })

    expect(response?.ok).toBe(true)
    expect(requestTypes).toEqual(['get-login', 'ping', 'get-login'])
  })

  it('retries passkey saves after an unlock signal', async () => {
    const requestTypes: string[] = []

    const port = createPortMock((payload) => {
      requestTypes.push(payload.type)
      if (payload.type === 'passkey-save-credential' && requestTypes.filter((t) => t === 'passkey-save-credential').length === 1) {
        return { id: payload.id, ok: true, result: { status: 'locked' } }
      }
      if (payload.type === 'ping') {
        return { id: payload.id, ok: true, result: { vaultUnlocked: true } }
      }
      return { id: payload.id, ok: true, result: { status: 'success', itemId: 'item-1' } }
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
    const response = await mod.requestHost({ type: 'passkey-save-credential', pendingPasskeyId: 'pending-1' })

    expect(response?.ok).toBe(true)
    expect(requestTypes).toEqual(['passkey-save-credential', 'ping', 'passkey-save-credential'])
  })

  it('does not unlock before returning passive passkey sign-in plans', async () => {
    const requestTypes: string[] = []

    const port = createPortMock((payload) => {
      requestTypes.push(payload.type)
      return { id: payload.id, ok: true, result: { locked: true, choices: [{ credentialId: 'credential-1' }] } }
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
    const response = await mod.requestHost({ type: 'passkey-get-plan', requestDetailsJson: '{}' })

    expect(response?.ok).toBe(true)
    if (!response?.ok) {
      throw new Error('Expected passive passkey plan request to succeed.')
    }
    expect(response.result).toEqual({ locked: true, choices: [{ credentialId: 'credential-1' }] })
    expect(requestTypes).toEqual(['passkey-get-plan'])
  })

  it('does not wait for unlock on passive locked status requests', async () => {
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
    const response = await mod.requestHost({ type: 'passkeys-status', url: 'https://example.com' })

    expect(response?.ok).toBe(true)
    if (!response?.ok) {
      throw new Error('Expected passive status request to return a locked result.')
    }
    expect(response.result).toEqual({ status: 'locked' })
    expect(requestTypes).toEqual(['passkeys-status'])
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
