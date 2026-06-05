import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | undefined

const ssoTrackingKey = 'klarkey:sso-tracking'

async function loadBackground() {
  let listener: RuntimeListener | undefined
  const storage = new Map<string, unknown>()
  const nativeMessageListeners: Array<(response: unknown) => void> = []

  ;(globalThis as unknown as { browser: unknown; chrome?: unknown }).browser = {
    runtime: {
      onMessage: {
        addListener(nextListener: RuntimeListener) {
          listener = nextListener
        },
      },
      onStartup: {
        addListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      connectNative: vi.fn(() => ({
        onMessage: {
          addListener(nextListener: (response: unknown) => void) {
            nativeMessageListeners.push(nextListener)
          },
        },
        onDisconnect: {
          addListener: vi.fn(),
        },
        postMessage(payload: { id?: string }) {
          queueMicrotask(() => {
            for (const nextListener of nativeMessageListeners) {
              nextListener({ id: payload.id, ok: true, result: { matches: [] } })
            }
          })
        },
      })),
      id: 'klarkey-extension',
      lastError: undefined,
    },
    storage: {
      local: {
        get(keys: string[], callback: (result: Record<string, unknown>) => void) {
          callback(Object.fromEntries(keys.map((key) => [key, storage.get(key)])))
        },
        set(values: Record<string, unknown>, callback: () => void) {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value)
          }
          callback()
        },
        remove(keys: string[], callback: () => void) {
          for (const key of keys) {
            storage.delete(key)
          }
          callback()
        },
      },
    },
    tabs: {
      query: vi.fn(function query(queryInfo: unknown) {
        void queryInfo
        return Promise.resolve([])
      }),
      sendMessage: vi.fn(async () => undefined),
    },
  }
  delete (globalThis as unknown as { chrome?: unknown }).chrome

  const backgroundScript = '../../extension/shared/background/index.js'
  await import(backgroundScript)

  const send = (message: unknown) =>
    sendFrom(message, 'https://example.com/login')

  const sendFrom = (message: unknown, url: string) =>
    new Promise((resolve) => {
      if (!listener) {
        throw new Error('Background listener was not registered.')
      }
      listener(message, { url, tab: { url } }, resolve)
    })

  const sendFromExtensionUi = (message: unknown) =>
    new Promise((resolve) => {
      if (!listener) {
        throw new Error('Background listener was not registered.')
      }
      listener(message, {
        id: 'klarkey-extension',
        url: 'moz-extension://klarkey-extension/popup.html',
      }, resolve)
    })

  return { send, sendFrom, sendFromExtensionUi, storage }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as unknown as { browser?: unknown }).browser
  delete (globalThis as unknown as { chrome?: unknown }).chrome
  vi.restoreAllMocks()
})

describe('extension background SSO tracking storage', () => {
  it('keeps transient content-script secrets in extension memory only', async () => {
    const { send, storage } = await loadBackground()
    const expiresAt = Date.now() + 30_000

    await expect(send({
      type: 'transient-state-set',
      payload: {
        key: 'klarkey:pending-save:https://example.com',
        value: {
          username: 'person@example.com',
          password: 'generated-password',
        },
        expiresAt,
      },
    })).resolves.toEqual({ ok: true })

    await expect(send({
      type: 'transient-state-get',
      payload: { key: 'klarkey:pending-save:https://example.com' },
    })).resolves.toEqual({
      ok: true,
      entry: {
        value: {
          username: 'person@example.com',
          password: 'generated-password',
        },
        expiresAt,
      },
    })
    expect(storage.size).toBe(0)
  })

  it('rejects transient state access from a different tab host', async () => {
    const { sendFrom } = await loadBackground()

    await expect(sendFrom({
      type: 'transient-state-set',
      payload: {
        key: 'klarkey:pending-save:https://example.com',
        value: {
          password: 'generated-password',
        },
        expiresAt: Date.now() + 30_000,
      },
    }, 'https://evil.example/login')).resolves.toEqual({ ok: false })
  })

  it('keeps transient state isolated by origin, not just hostname', async () => {
    const { sendFrom } = await loadBackground()
    const expiresAt = Date.now() + 30_000

    await expect(sendFrom({
      type: 'transient-state-set',
      payload: {
        key: 'klarkey:pending-save:http://localhost:3000',
        value: {
          password: 'generated-password',
        },
        expiresAt,
      },
    }, 'http://localhost:3000/signup')).resolves.toEqual({ ok: true })

    await expect(sendFrom({
      type: 'transient-state-get',
      payload: { key: 'klarkey:pending-save:http://localhost:3000' },
    }, 'http://localhost:5173/signup')).resolves.toEqual({
      ok: false,
      entry: undefined,
    })

    await expect(sendFrom({
      type: 'transient-state-get',
      payload: { key: 'klarkey:pending-save:http://localhost:3000' },
    }, 'http://localhost:3000/signup')).resolves.toEqual({
      ok: true,
      entry: {
        value: {
          password: 'generated-password',
        },
        expiresAt,
      },
    })
  })

  it('rejects oversized transient content-script secrets', async () => {
    const { send } = await loadBackground()

    await expect(send({
      type: 'transient-state-set',
      payload: {
        key: 'klarkey:pending-save:https://example.com',
        value: 'x'.repeat(9000),
        expiresAt: Date.now() + 30_000,
      },
    })).resolves.toEqual({ ok: false })
  })

  it('evicts old transient entries when the in-memory cache reaches its cap', async () => {
    const { send } = await loadBackground()
    const expiresAt = Date.now() + 30_000

    for (let index = 0; index < 70; index += 1) {
      await expect(send({
        type: 'transient-state-set',
        payload: {
          key: `klarkey:pending-save-${index}:https://example.com`,
          value: { password: `generated-password-${index}` },
          expiresAt,
        },
      })).resolves.toEqual({ ok: true })
    }

    await expect(send({
      type: 'transient-state-get',
      payload: { key: 'klarkey:pending-save-0:https://example.com' },
    })).resolves.toEqual({ ok: true, entry: undefined })

    await expect(send({
      type: 'transient-state-get',
      payload: { key: 'klarkey:pending-save-69:https://example.com' },
    })).resolves.toEqual({
      ok: true,
      entry: {
        value: { password: 'generated-password-69' },
        expiresAt,
      },
    })
  })

  it('stores only a sanitized SSO tracking record', async () => {
    const { send, storage } = await loadBackground()
    const startedAt = Date.now()

    await expect(send({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'A'.repeat(600),
        originHostname: 'example.com',
        startedAt,
        selectedAccount: 'person@example.com',
        unexpected: 'drop-me',
      },
    })).resolves.toEqual({ ok: true })

    expect(storage.get(ssoTrackingKey)).toEqual({
      provider: 'Google',
      originUrl: 'https://example.com/login',
      originTitle: '',
      originHostname: 'example.com',
      startedAt,
      selectedAccount: 'person@example.com',
    })
  })

  it('stores the confirmed provider-hop marker for SSO tracking', async () => {
    const { send, sendFrom, storage } = await loadBackground()
    const startedAt = Date.now()

    await send({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
      },
    })

    await expect(sendFrom({
      type: 'sso-tracking-update',
      payload: {
        providerSeen: true,
      },
    }, 'https://accounts.google.com/signin')).resolves.toMatchObject({
      ok: true,
      tracking: {
        providerSeen: true,
      },
    })

    expect(storage.get(ssoTrackingKey)).toMatchObject({
      provider: 'Google',
      providerSeen: true,
    })
  })

  it('rejects tracking records whose URL and hostname disagree', async () => {
    const { send, storage } = await loadBackground()

    await expect(send({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'evil.example',
        startedAt: Date.now(),
      },
    })).resolves.toEqual({ ok: false })

    expect(storage.has(ssoTrackingKey)).toBe(false)
  })

  it('rejects future-dated SSO tracking records', async () => {
    const { send, storage } = await loadBackground()

    await expect(send({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt: Date.now() + 120_000,
      },
    })).resolves.toEqual({ ok: false })

    expect(storage.has(ssoTrackingKey)).toBe(false)
  })

  it('rejects URL-bearing requests whose payload URL does not match the sender tab', async () => {
    const { sendFrom } = await loadBackground()

    await expect(sendFrom({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt: Date.now(),
      },
    }, 'https://evil.example/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })
  })

  it('allows provider pages to read matches for the tracked SSO origin', async () => {
    const { sendFrom } = await loadBackground()
    const startedAt = Date.now()

    await sendFrom({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
      },
    }, 'https://example.com/login')

    await expect(sendFrom({
      type: 'list-logins-for-url',
      url: 'https://example.com/login',
      title: 'Example',
    }, 'https://accounts.google.com/signin')).resolves.toEqual({
      ok: true,
      matches: [],
    })
  })

  it('rejects lookups from hosts that only end with a provider domain string', async () => {
    const { sendFrom } = await loadBackground()
    const startedAt = Date.now()

    await sendFrom({
      type: 'sso-tracking-set',
      payload: {
        provider: 'GitHub',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
      },
    }, 'https://example.com/login')

    await expect(sendFrom({
      type: 'list-logins-for-url',
      url: 'https://example.com/login',
      title: 'Example',
    }, 'https://evilgithub.com/login/oauth')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })

    await expect(sendFrom({
      type: 'sso-tracking-update',
      payload: {
        selectedAccount: 'attacker@example.net',
      },
    }, 'https://evilgithub.com/login/oauth')).resolves.toEqual({
      ok: false,
      tracking: undefined,
    })
  })

  it('rejects tracked-origin lookups and reads from unrelated sender hosts', async () => {
    const { sendFrom } = await loadBackground()
    const startedAt = Date.now()

    await sendFrom({
      type: 'sso-tracking-set',
      payload: {
        provider: 'Google',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
      },
    }, 'https://example.com/login')

    await expect(sendFrom({
      type: 'sso-tracking-get',
    }, 'https://evil.example.net/login')).resolves.toEqual({
      ok: false,
      tracking: undefined,
    })

    await expect(sendFrom({
      type: 'list-logins-for-url',
      url: 'https://example.com/login',
      title: 'Example',
    }, 'https://evil.example.net/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })
  })

  it('rejects passkey requests whose URL or origin does not match the sender tab', async () => {
    const { sendFrom } = await loadBackground()

    await expect(sendFrom({
      type: 'plan-passkey-create',
      payload: {
        url: 'https://example.com/login',
        title: 'Example',
        requestDetailsJson: '{}',
      },
    }, 'https://evil.example/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })

    await expect(sendFrom({
      type: 'create-passkey-credential',
      payload: {
        origin: 'https://evil.example',
        url: 'https://example.com/login',
        title: 'Example',
        requestDetailsJson: '{}',
      },
    }, 'https://example.com/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })

    await expect(sendFrom({
      type: 'discard-passkey-credential',
      payload: {
        url: 'https://example.com/login',
        title: 'Example',
        pendingPasskeyId: 'pending-1',
      },
    }, 'https://evil.example/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })
  })

  it('rejects item fetch requests whose URL does not match the sender tab', async () => {
    const { sendFrom } = await loadBackground()

    await expect(sendFrom({
      type: 'fetch-login',
      itemId: 'item_1',
      url: 'https://example.com/login',
      title: 'Example',
    }, 'https://evil.example/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })
  })

  it('rejects popup-only commands from content-script senders', async () => {
    const { send } = await loadBackground()
    const expected = {
      ok: false,
      message: 'This extension action is only available from Klarkey.',
    }

    await expect(send({ type: 'popup-state' })).resolves.toEqual(expected)
    await expect(send({ type: 'fill-login', itemId: 'item_1' })).resolves.toEqual(expected)
    await expect(send({ type: 'save-current-login' })).resolves.toEqual(expected)
  })

  it('allows popup-only commands from extension UI senders', async () => {
    const { sendFromExtensionUi } = await loadBackground()

    await expect(sendFromExtensionUi({ type: 'fill-login', itemId: 'item_1' })).resolves.toMatchObject({
      ok: false,
    })
  })

  it('rejects URL-bearing requests when only the host matches the sender tab', async () => {
    const { sendFrom } = await loadBackground()

    await expect(sendFrom({
      type: 'fetch-login',
      itemId: 'item_1',
      url: 'https://example.com/login',
      title: 'Example',
    }, 'http://example.com/login')).resolves.toEqual({
      ok: false,
      message: 'The extension request did not match the current tab.',
    })
  })

  it('sanitizes SSO tracking updates before storage', async () => {
    const { send, sendFrom, storage } = await loadBackground()
    const startedAt = Date.now()

    await send({
      type: 'sso-tracking-set',
      payload: {
        provider: 'GitHub',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
      },
    })

    await expect(send({
      type: 'sso-tracking-update',
      payload: {
        selectedAccount: 'person@example.com',
        originHostname: 'evil.example',
      },
    })).resolves.toEqual({
      ok: true,
      tracking: {
        provider: 'GitHub',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
        selectedAccount: 'person@example.com',
      },
    })

    expect(storage.get(ssoTrackingKey)).toEqual({
      provider: 'GitHub',
      originUrl: 'https://example.com/login',
      originTitle: 'Example',
      originHostname: 'example.com',
      startedAt,
      selectedAccount: 'person@example.com',
    })

    await expect(sendFrom({
      type: 'sso-tracking-update',
      payload: {
        selectedAccount: 'attacker@example.net',
      },
    }, 'https://evil.example.net/login')).resolves.toEqual({
      ok: false,
      tracking: undefined,
    })

    expect(storage.get(ssoTrackingKey)).toEqual({
      provider: 'GitHub',
      originUrl: 'https://example.com/login',
      originTitle: 'Example',
      originHostname: 'example.com',
      startedAt,
      selectedAccount: 'person@example.com',
    })

    await expect(sendFrom({
      type: 'sso-tracking-update',
      payload: {
        selectedAccount: 'octo@example.com',
      },
    }, 'https://github.com/login/oauth')).resolves.toEqual({
      ok: true,
      tracking: {
        provider: 'GitHub',
        originUrl: 'https://example.com/login',
        originTitle: 'Example',
        originHostname: 'example.com',
        startedAt,
        selectedAccount: 'octo@example.com',
      },
    })

    await expect(sendFrom({
      type: 'sso-tracking-clear',
    }, 'https://evil.example.net/login')).resolves.toEqual({
      ok: false,
    })

    expect(storage.get(ssoTrackingKey)).toEqual({
      provider: 'GitHub',
      originUrl: 'https://example.com/login',
      originTitle: 'Example',
      originHostname: 'example.com',
      startedAt,
      selectedAccount: 'octo@example.com',
    })
  })
})
