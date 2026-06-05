import { afterEach, describe, expect, it, vi } from 'vitest'

const makeVisible = (element: Element) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 240,
      bottom: 40,
      width: 240,
      height: 40,
      toJSON: () => ({}),
    }),
  })
}

const setFormText = (form: HTMLFormElement, text: string) => {
  Object.defineProperty(form, 'innerText', {
    configurable: true,
    value: text,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('extension suggested password generator', () => {
  it('generates category-complete passwords with bounded unbiased sampling', async () => {
    const source = await import('../../extension/shared/content/page/forms/forms.js')
    const password = source.randomPassword()
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'

    expect(password).toHaveLength(24)
    expect(password).toMatch(/[ABCDEFGHJKLMNPQRSTUVWXYZ]/)
    expect(password).toMatch(/[abcdefghijkmnopqrstuvwxyz]/)
    expect(password).toMatch(/[23456789]/)
    expect(password).toMatch(/[!@#$%^&*]/)
    expect([...password].every((character) => alphabet.includes(character))).toBe(true)
  })

  it('keeps short requested passwords long enough to include every required category', async () => {
    const source = await import('../../extension/shared/content/page/forms/forms.js')
    const password = source.randomPassword(3)

    expect(password).toHaveLength(4)
    expect(password).toMatch(/[ABCDEFGHJKLMNPQRSTUVWXYZ]/)
    expect(password).toMatch(/[abcdefghijkmnopqrstuvwxyz]/)
    expect(password).toMatch(/[23456789]/)
    expect(password).toMatch(/[!@#$%^&*]/)
  })

  it('treats login forms with register links as login fields', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="login-form" action="/login">
        <label>Login<input name="username" value="krissedout"></label>
        <label>Password<input id="password" type="password"></label>
        <a href="/register">Register</a>
        <button type="submit">Login</button>
      </form>
    `

    const form = document.querySelector<HTMLFormElement>('#login-form')
    const password = document.querySelector<HTMLInputElement>('#password')
    expect(form).not.toBeNull()
    expect(password).not.toBeNull()
    setFormText(form!, 'Login Password Register')
    document.querySelectorAll('input').forEach(makeVisible)

    const { detectAuthFlow } = await import('../../extension/shared/content/page/forms/forms.js')
    const { fieldKindFor, shouldOfferSuggestedPassword, suggestionFlowFor } = await import('../../extension/shared/content/page/field-meta.js')
    const username = document.querySelector<HTMLInputElement>('input[name="username"]')

    expect(detectAuthFlow(password!)).toBe('login')
    expect(shouldOfferSuggestedPassword(password!)).toBe(false)
    expect(fieldKindFor(username!)).toBe('username')
    expect(suggestionFlowFor(username!, 'username')).toBe('login')
  })

  it('does not attach Klarkey to generic site search fields', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="search-form" role="search" action="/results">
        <input
          id="search"
          class="ytd-searchbox"
          name="search_query"
          type="text"
          aria-label="Search"
          placeholder="Search"
          autocomplete="off"
        >
      </form>
    `

    const input = document.querySelector<HTMLInputElement>('#search')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBeUndefined()
  })

  it('does not attach Klarkey to nickname fields in unrelated settings flows', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="card-settings">
        <label>Nickname<input id="nickname" autocomplete="name" value="Subscriptions"></label>
        <button type="submit">Save</button>
      </form>
    `

    const form = document.querySelector<HTMLFormElement>('#card-settings')
    const input = document.querySelector<HTMLInputElement>('#nickname')
    expect(form).not.toBeNull()
    expect(input).not.toBeNull()
    setFormText(form!, 'Nickname Save')
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBeUndefined()
  })

  it('does not attach Klarkey to generic rename project dialogs', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true">
        <h2>Rename project</h2>
        <p>Used to identify your project in the dashboard and Wrangler CLI.</p>
        <label>Name<input id="project-name" autocomplete="name" value="ave-business"></label>
        <button type="submit">Save</button>
      </div>
    `

    const input = document.querySelector<HTMLInputElement>('#project-name')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBeUndefined()
  })

  it('does not attach Klarkey to generic create app dialogs', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true">
        <h2>Create App</h2>
        <label>Name *<input id="app-name" placeholder="My RealtimeKit app" value=""></label>
        <button type="submit">Create</button>
      </div>
    `

    const input = document.querySelector<HTMLInputElement>('#app-name')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBeUndefined()
  })

  it('does not attach Klarkey to product naming dialogs', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true">
        <h2>Add a product</h2>
        <label>Name (required)<input id="product-name"></label>
        <p>Name of the product or service, visible to customers.</p>
        <button type="submit">Create</button>
      </div>
    `

    const input = document.querySelector<HTMLInputElement>('#product-name')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBeUndefined()
  })

  it('detects username fields in form-less login dialogs', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true">
        <h2>Sign in</h2>
        <label>Account<input id="identifier" name="identifier"></label>
        <label>Password<input id="password" type="password"></label>
        <button type="button">Log in</button>
      </div>
    `

    const identifier = document.querySelector<HTMLInputElement>('#identifier')
    const password = document.querySelector<HTMLInputElement>('#password')
    expect(identifier).not.toBeNull()
    expect(password).not.toBeNull()
    makeVisible(identifier!)
    makeVisible(password!)

    const { fieldKindFor, suggestionFlowFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(identifier!)).toBe('username')
    expect(suggestionFlowFor(identifier!, 'username')).toBe('login')
  })

  it('keeps identity autofill available in contact flows', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="contact-form">
        <label>Contact name<input id="contact-name"></label>
        <button type="submit">Continue</button>
      </form>
    `

    const form = document.querySelector<HTMLFormElement>('#contact-form')
    const input = document.querySelector<HTMLInputElement>('#contact-name')
    expect(form).not.toBeNull()
    expect(input).not.toBeNull()
    setFormText(form!, 'Contact name Continue')
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBe('fullName')
  })

  it('treats slash-style expiration inputs as combined card expiry fields', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="payment-form">
        <label>Expiration date<input id="expiry" placeholder="MM / YY"></label>
      </form>
    `

    const input = document.querySelector<HTMLInputElement>('#expiry')
    expect(input).not.toBeNull()
    makeVisible(input!)

    const { fieldKindFor } = await import('../../extension/shared/content/page/field-meta.js')

    expect(fieldKindFor(input!)).toBe('cardExpiry')
  })

  it('fills combined card expiry fields from imported month and year parts', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="payment-form">
        <label>Card number<input id="card-number" autocomplete="cc-number"></label>
        <label>Expiration date<input id="expiry" placeholder="MM / YY"></label>
        <label>Security code<input id="cvc" autocomplete="cc-csc"></label>
      </form>
    `

    document.querySelectorAll('input').forEach(makeVisible)
    const cardNumber = document.querySelector<HTMLInputElement>('#card-number')
    const expiry = document.querySelector<HTMLInputElement>('#expiry')
    expect(cardNumber).not.toBeNull()
    expect(expiry).not.toBeNull()

    const { applyCardFill } = await import('../../extension/shared/content/page/ui/fill-actions.js')

    applyCardFill(cardNumber!, {
      cardNumber: '5424023100408367',
      cardExpiryMonth: '08',
      cardExpiryYear: '2057',
      cardCvc: '057',
    })

    expect(expiry!.value).toBe('08 / 57')
  })

  it('does not suppress the next password step after filling an email-only login step', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="login-email">
        <label>Email<input id="email" autocomplete="username"></label>
      </form>
    `

    const email = document.querySelector<HTMLInputElement>('#email')
    expect(email).not.toBeNull()
    makeVisible(email!)

    const { applyLoginFill } = await import('../../extension/shared/content/page/ui/fill-actions.js')
    const { isAutomaticInlineMenuSuppressed } = await import('../../extension/shared/content/page/menu-suppress.js')

    await applyLoginFill(email!, {
      username: 'person@example.com',
      password: 'correct horse battery staple',
    })

    document.body.innerHTML = `
      <form id="login-password">
        <label>Password<input id="password" type="password" autocomplete="current-password"></label>
      </form>
    `
    const password = document.querySelector<HTMLInputElement>('#password')
    expect(password).not.toBeNull()
    makeVisible(password!)

    expect(isAutomaticInlineMenuSuppressed(password)).toBe(false)
  })

  it('normalizes card brand casing from older display metadata', async () => {
    vi.resetModules()
    const globalWithChrome = globalThis as typeof globalThis & {
      chrome?: { runtime: { getURL: (path: string) => string; sendMessage: (message: unknown, callback: (result: unknown) => void) => void } }
    }
    const previousChrome = globalWithChrome.chrome
    globalWithChrome.chrome = {
      runtime: {
        getURL: (path) => `chrome-extension://klarkey/${path}`,
        sendMessage: (_message, callback) => callback({ ok: true, locked: false, suggestions: [] }),
      },
    }
    try {
      document.body.innerHTML = '<input id="card-number" autocomplete="cc-number">'

      const input = document.querySelector<HTMLInputElement>('#card-number')
      expect(input).not.toBeNull()
      makeVisible(input!)

      const { pageState } = await import('../../extension/shared/content/page/state.js')
      const { overlayRoot } = await import('../../extension/shared/content/page/overlay.js')
      const { renderFieldMenu } = await import('../../extension/shared/content/page/ui/menu.js')

      pageState.fieldSuggestions = [{
        source: 'card',
        displayValue: 'Subscriptions Jr',
        displaySecondary: 'mc ending in 8367',
        itemName: 'Subscriptions Jr',
        value: 'Subscriptions Jr',
        fromSiteMatch: false,
      }]
      pageState.fieldSuggestionsLocked = false
      renderFieldMenu(input!, { loading: false })

      expect(overlayRoot.textContent).toContain('Mastercard ending in 8367')
      expect(overlayRoot.textContent).not.toContain('mc ending in 8367')
    } finally {
      globalWithChrome.chrome = previousChrome
    }
  })

  it('shows an unlock action instead of an empty card list while Klarkey is locked', async () => {
    vi.resetModules()
    const globalWithChrome = globalThis as typeof globalThis & {
      chrome?: { runtime: { getURL: (path: string) => string; sendMessage: (message: unknown, callback: (result: unknown) => void) => void } }
    }
    const previousChrome = globalWithChrome.chrome
    globalWithChrome.chrome = {
      runtime: {
        getURL: (path) => `chrome-extension://klarkey/${path}`,
        sendMessage: (_message, callback) => callback({ ok: true, locked: false, suggestions: [] }),
      },
    }
    try {
      document.body.innerHTML = '<input id="card-number" autocomplete="cc-number">'

      const input = document.querySelector<HTMLInputElement>('#card-number')
      expect(input).not.toBeNull()
      makeVisible(input!)

      const { pageState } = await import('../../extension/shared/content/page/state.js')
      const { overlayRoot } = await import('../../extension/shared/content/page/overlay.js')
      const { renderFieldMenu } = await import('../../extension/shared/content/page/ui/menu.js')

      pageState.fieldSuggestions = []
      pageState.fieldSuggestionsLocked = true
      renderFieldMenu(input!, { loading: false })

      expect(overlayRoot.textContent).toContain('Unlock Klarkey')
      expect(overlayRoot.textContent).toContain('Show saved cards.')
      expect(overlayRoot.textContent).not.toContain('No cards found.')
    } finally {
      globalWithChrome.chrome = previousChrome
    }
  })

  it('still offers generated passwords on single-password signup forms', async () => {
    vi.resetModules()
    document.body.innerHTML = `
      <form id="signup-form" action="/register">
        <label>Email<input name="email" type="email"></label>
        <label>Password<input id="password" type="password"></label>
        <a href="/login">Already have an account? Log in</a>
        <button type="submit">Create account</button>
      </form>
    `

    const form = document.querySelector<HTMLFormElement>('#signup-form')
    const password = document.querySelector<HTMLInputElement>('#password')
    expect(form).not.toBeNull()
    expect(password).not.toBeNull()
    setFormText(form!, 'Email Password Already have an account? Log in Create account')
    document.querySelectorAll('input').forEach(makeVisible)

    const { detectAuthFlow } = await import('../../extension/shared/content/page/forms/forms.js')
    const { shouldOfferSuggestedPassword } = await import('../../extension/shared/content/page/field-meta.js')

    expect(detectAuthFlow(password!)).toBe('register')
    expect(shouldOfferSuggestedPassword(password!)).toBe(true)
  })
})
