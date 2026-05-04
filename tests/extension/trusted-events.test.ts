import { describe, expect, it, vi } from 'vitest'

describe('extension trusted user action guard', () => {
  it('rejects synthetic events before running sensitive actions', async () => {
    const { runTrustedUserAction } = await import('../../extension/shared/content/page/ui/trusted-events.js')
    const action = vi.fn()

    const ran = runTrustedUserAction({ isTrusted: false }, action)

    expect(ran).toBe(false)
    expect(action).not.toHaveBeenCalled()
  })

  it('runs actions for trusted events', async () => {
    const { runTrustedUserAction } = await import('../../extension/shared/content/page/ui/trusted-events.js')
    const action = vi.fn()

    const ran = runTrustedUserAction({ isTrusted: true }, action)

    expect(ran).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
  })
})

describe('extension prompt rendering', () => {
  it('renders page-controlled prompt text without html interpretation', async () => {
    vi.resetModules()
    document.documentElement.innerHTML = ''

    const { presentPasskeyBanner } = await import('../../extension/shared/content/page/ui/banners.js')
    void presentPasskeyBanner({
      promptKey: 'prompt',
      title: '<img src=x onerror=alert(1)>',
      copy: '<svg onload=alert(1)>',
      choices: [
        {
          value: 'credential',
          title: '<b>Credential</b>',
          copy: '<i>Account</i>',
        },
      ],
    })

    const banner = document.querySelector('.klarkey-save-banner')

    expect(banner?.querySelector('.klarkey-save-title')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(banner?.querySelector('.klarkey-save-copy')?.textContent).toBe('<svg onload=alert(1)>')
    expect(banner?.querySelector('.klarkey-save-choice-title')?.textContent).toBe('<b>Credential</b>')
    expect(banner?.querySelector('img')).toBeNull()
    expect(banner?.querySelector('svg')).toBeNull()
    expect(banner?.querySelector('b')).toBeNull()
    expect(banner?.querySelector('i')).toBeNull()
  })

  it('renders inline menu text without html interpretation', async () => {
    vi.resetModules()
    document.documentElement.innerHTML = ''

    const { appendFieldMenuButton } = await import('../../extension/shared/content/page/ui/menu.js')
    const container = document.createElement('div')
    appendFieldMenuButton({
      container,
      title: '<img src=x onerror=alert(1)>',
      secondary: '<svg onload=alert(1)>',
      onClick: vi.fn(),
    })

    expect(container.querySelector('.klarkey-inline-title')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(container.querySelector('.klarkey-inline-secondary')?.textContent).toBe('<svg onload=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('requires a prompt for one matching sign-in passkey', async () => {
    vi.resetModules()
    document.documentElement.innerHTML = ''

    const { promptPasskeyGetChoice } = await import('../../extension/shared/content/page/ui/banners.js')
    let settled = false
    void promptPasskeyGetChoice([
      {
        credentialId: 'credential',
        itemName: 'Example',
        userName: 'person@example.com',
      },
    ]).then(() => {
      settled = true
    })

    await Promise.resolve()

    expect(settled).toBe(false)
    expect(document.querySelector('.klarkey-save-banner')).not.toBeNull()
    expect(document.querySelector('.klarkey-save-title')?.textContent).toBe('Use passkey?')
  })

  it('requires a prompt before creating a single suggested passkey', async () => {
    vi.resetModules()
    document.documentElement.innerHTML = ''

    const { promptPasskeyCreateChoice } = await import('../../extension/shared/content/page/ui/banners.js')
    let settled = false
    void promptPasskeyCreateChoice({
      rpId: 'example.com',
      userName: 'person@example.com',
    }).then(() => {
      settled = true
    })

    await Promise.resolve()

    expect(settled).toBe(false)
    expect(document.querySelector('.klarkey-save-banner')).not.toBeNull()
    expect(document.querySelector('.klarkey-save-title')?.textContent).toBe('Save passkey in Klarkey?')
  })
})
