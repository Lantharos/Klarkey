import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const makeVisible = (element: Element) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 180,
      bottom: 40,
      width: 180,
      height: 40,
      toJSON: () => ({}),
    }),
  })
}

describe('extension OTP autofill', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete (globalThis as unknown as { browser?: unknown }).browser
  })

  it('fills a focused one-time-code field from pending state', async () => {
    document.body.innerHTML = '<form><input id="otp" autocomplete="one-time-code" type="text" placeholder="123456" maxlength="6"></form>'
    const input = document.querySelector<HTMLInputElement>('#otp')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { setPendingOtp, getPendingOtp } = await import('../../extension/shared/content/page/forms/forms.js')
    const { consumePendingOtp } = await import('../../extension/shared/content/page/otp-autofill.js')

    await setPendingOtp('123456')

    expect(consumePendingOtp(input!)).toBe(true)
    expect(input).toHaveValue('123456')
    await vi.advanceTimersByTimeAsync(60)
    expect(getPendingOtp()).toBe('')
  })

  it('hydrates a pending one-time code before filling a redirected OTP page', async () => {
    const sendMessage = vi.fn(async (message: { type?: string }) => {
      if (message.type === 'transient-state-get') {
        return { ok: true, entry: { value: '654321', expiresAt: Date.now() + 60_000 } }
      }
      if (message.type === 'transient-state-clear') {
        return { ok: true }
      }
      return { ok: true }
    })
    ;(globalThis as unknown as { browser: unknown }).browser = {
      runtime: {
        sendMessage,
      },
    }

    document.body.innerHTML = '<form><input id="otp" class="two-factor-authentication-code" autocomplete="one-time-code" type="text"></form>'
    const input = document.querySelector<HTMLInputElement>('#otp')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { hydratePendingAuthState } = await import('../../extension/shared/content/page/forms/forms.js')
    const { consumePendingOtp } = await import('../../extension/shared/content/page/otp-autofill.js')

    await hydratePendingAuthState()

    expect(consumePendingOtp(input!)).toBe(true)
    expect(input).toHaveValue('654321')
  })

  it('recognizes numeric two-factor fields without autocomplete', async () => {
    document.body.innerHTML = '<form><label>Two factor authentication code <input id="otp" class="two-factor-authentication-code" inputmode="numeric" maxlength="6" type="text"></label></form>'
    const input = document.querySelector<HTMLInputElement>('#otp')
    expect(input).not.toBeNull()

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBe('otp')
  })

  it('ignores API key name fields without autocomplete', async () => {
    document.body.innerHTML = `
      <main>
        <h1>Developers</h1>
        <section>
          <h2>Create restricted API key</h2>
          <label>Key name<input id="key-name" type="text"></label>
          <p>Use verification codes and restricted keys to secure developer access.</p>
          <button type="submit">Create key</button>
        </section>
      </main>
    `
    const input = document.querySelector<HTMLInputElement>('#key-name')
    expect(input).not.toBeNull()

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBeUndefined()
  })

  it('fills split OTP boxes without focusing every digit field', async () => {
    document.body.innerHTML = `
      <form>
        <label>Authenticator code
          <input maxlength="1" inputmode="numeric">
          <input maxlength="1" inputmode="numeric">
          <input maxlength="1" inputmode="numeric">
          <input maxlength="1" inputmode="numeric">
          <input maxlength="1" inputmode="numeric">
          <input maxlength="1" inputmode="numeric">
        </label>
      </form>
    `
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
    inputs.forEach(makeVisible)
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')

    const { writeSplitOtp } = await import('../../extension/shared/content/page/autofill/write-submit.js')

    expect(writeSplitOtp(inputs, '666667')).toBe(true)
    expect(inputs.map((input) => input.value).join('')).toBe('666667')
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })
})
