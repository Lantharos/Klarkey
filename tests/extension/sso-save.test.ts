import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const overlayRoot = () => document.querySelector<HTMLElement>('[data-klarkey-inline-host="true"]')?.shadowRoot ?? document

function installRuntime(tracking?: Record<string, unknown>) {
  const messages: unknown[] = []
  let storedTracking = tracking

  ;(globalThis as unknown as { browser: unknown }).browser = {
    runtime: {
      sendMessage: vi.fn(async (message: { type?: string }) => {
        messages.push(message)
        if (message.type === 'sso-tracking-get') {
          return { ok: Boolean(storedTracking), tracking: storedTracking }
        }
        if (message.type === 'sso-tracking-clear') {
          storedTracking = undefined
          return { ok: true }
        }
        if (message.type === 'list-logins-for-url') {
          return { ok: true, matches: [] }
        }
        if (message.type === 'transient-state-set') {
          return { ok: true }
        }
        if (message.type === 'transient-state-clear') {
          return { ok: true }
        }
        return { ok: true }
      }),
    },
  }

  return messages
}

describe('extension SSO save tracking', () => {
  beforeEach(() => {
    vi.resetModules()
    document.documentElement.innerHTML = '<html><head></head><body></body></html>'
    document.title = 'Cloudflare'
  })

  afterEach(() => {
    delete (globalThis as unknown as { browser?: unknown }).browser
    vi.restoreAllMocks()
  })

  it('does not show an SSO save prompt before the provider was actually visited', async () => {
    const messages = installRuntime({
      provider: 'Google',
      originUrl: window.location.href,
      originTitle: document.title,
      originHostname: window.location.hostname,
      startedAt: Date.now(),
    })
    const { maybePromptSsoSave } = await import('../../extension/shared/content/page/sso/save.js')

    await maybePromptSsoSave()

    expect(overlayRoot().querySelector('.klarkey-save-banner')).toBeNull()
    expect(messages).not.toContainEqual({ type: 'sso-tracking-clear' })
  })

  it('shows the SSO save prompt after a confirmed provider hop', async () => {
    installRuntime({
      provider: 'Google',
      originUrl: window.location.href,
      originTitle: document.title,
      originHostname: window.location.hostname,
      startedAt: Date.now(),
      providerSeen: true,
    })
    const { maybePromptSsoSave } = await import('../../extension/shared/content/page/sso/save.js')

    await maybePromptSsoSave()

    expect(overlayRoot().querySelector('.klarkey-save-copy')?.textContent).toBe(`Google was used on ${window.location.hostname}.`)
  })

  it('does not treat ordinary continue-to buttons as Google SSO', async () => {
    installRuntime()
    document.body.innerHTML = '<button>Continue to Google Analytics</button>'
    const { findSsoButtons } = await import('../../extension/shared/content/page/sso/common.js')

    expect(findSsoButtons()).toEqual([])
  })

  it('still detects real Google OAuth links', async () => {
    installRuntime()
    document.body.innerHTML = '<a href="https://accounts.google.com/o/oauth2/v2/auth">Continue</a>'
    const { findSsoButtons } = await import('../../extension/shared/content/page/sso/common.js')

    expect(findSsoButtons()).toHaveLength(1)
    expect(findSsoButtons()[0]?.provider).toBe('Google')
  })

  it('detects Ave SSO links', async () => {
    installRuntime()
    document.body.innerHTML = '<a href="https://login.aveid.net/oauth/authorize">Continue</a>'
    const { findSsoButtons } = await import('../../extension/shared/content/page/sso/common.js')

    expect(findSsoButtons()).toHaveLength(1)
    expect(findSsoButtons()[0]?.provider).toBe('Ave')
  })
})
