import {
  KLARKEY_CHROMIUM_EXTENSION_ORIGIN,
  KLARKEY_CHROMIUM_EXTENSION_ORIGINS,
  KLARKEY_FIREFOX_EXTENSION_ID,
  hasAllowedNativeMessagingCaller,
  isAllowedNativeMessagingCaller,
  isHostnameMatch,
  normalizeBrowserHostname,
  scoreWebsiteMatch,
  toBrowserSiteUrl,
  validateBrowserPasskeyOrigin,
  validateBrowserExtensionRequest,
} from '@/shared/browser-extension'

describe('browser extension site matching', () => {
  it('normalizes full urls and hostnames', () => {
    expect(normalizeBrowserHostname('https://accounts.example.com/login')).toBe('accounts.example.com')
    expect(normalizeBrowserHostname('example.com')).toBe('example.com')
  })

  it('matches exact hosts and saved parent domains without widening child domains', () => {
    expect(isHostnameMatch('example.com', 'accounts.example.com')).toBe(true)
    expect(isHostnameMatch('accounts.example.com', 'example.com')).toBe(false)
    expect(isHostnameMatch('com', 'accounts.example.com')).toBe(false)
    expect(isHostnameMatch('127.0.0.1', 'app.127.0.0.1')).toBe(false)
  })

  it('scores exact host matches above subdomain matches', () => {
    expect(scoreWebsiteMatch(['https://accounts.example.com'], 'https://accounts.example.com')).toBe(100)
    expect(scoreWebsiteMatch(['example.com'], 'https://accounts.example.com')).toBe(80)
  })

  it('canonicalizes browser page urls to safe site origins', () => {
    expect(toBrowserSiteUrl('https://person:secret@example.com/reset/token?code=secret#fragment')).toBe('https://example.com')
    expect(toBrowserSiteUrl('http://localhost:5173/account?token=secret')).toBe('http://localhost:5173')
    expect(toBrowserSiteUrl('file:///tmp/secret.html')).toBeUndefined()
  })

  it('accepts only the known browser native messaging callers', () => {
    expect(KLARKEY_CHROMIUM_EXTENSION_ORIGINS).toContain(KLARKEY_CHROMIUM_EXTENSION_ORIGIN)
    expect(isAllowedNativeMessagingCaller(KLARKEY_CHROMIUM_EXTENSION_ORIGIN)).toBe(true)
    expect(isAllowedNativeMessagingCaller(KLARKEY_CHROMIUM_EXTENSION_ORIGIN.replace(/\/$/, ''))).toBe(true)
    expect(isAllowedNativeMessagingCaller(KLARKEY_FIREFOX_EXTENSION_ID)).toBe(true)
    expect(isAllowedNativeMessagingCaller('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/')).toBe(false)
    expect(isAllowedNativeMessagingCaller('klarkey@example.invalid')).toBe(false)
    expect(hasAllowedNativeMessagingCaller(['electron.exe', '--native-messaging-host'])).toBe(false)
    expect(hasAllowedNativeMessagingCaller(['electron.exe', '--native-messaging-host', KLARKEY_CHROMIUM_EXTENSION_ORIGIN, '--parent-window=0'])).toBe(true)
    expect(hasAllowedNativeMessagingCaller(['Klarkey.exe', KLARKEY_FIREFOX_EXTENSION_ID])).toBe(true)
  })

  it('requires passkey operations to come from the exact secure page origin', () => {
    expect(validateBrowserPasskeyOrigin('https://login.example.com', 'https://login.example.com/account')).toBe('login.example.com')
    expect(validateBrowserPasskeyOrigin('https://evil.example.com', 'https://example.com/account')).toBeUndefined()
    expect(validateBrowserPasskeyOrigin('https://example.com', 'https://evil.example.com/account')).toBeUndefined()
    expect(validateBrowserPasskeyOrigin('http://example.com', 'http://example.com/account')).toBeUndefined()
    expect(validateBrowserPasskeyOrigin('http://localhost:5173', 'http://localhost:5173/account')).toBe('localhost')
    expect(validateBrowserPasskeyOrigin('http://[::1]:5173', 'http://[::1]:5173/account')).toBe('[::1]')
  })

  it('validates native-host browser extension requests before dispatch', () => {
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'ping' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'list-logins', url: 'https://example.com' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'list-logins', url: 'http://localhost:5173' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'list-logins', url: 'http://[::1]:5173' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'list-logins', url: 'http://example.com' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'list-logins', url: 'file:///tmp/secret.html' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'get-login', itemId: '' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'get-login', itemId: 'item_1' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'get-login', itemId: 'item_1', url: 'https://example.com' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'get-login', itemId: 'item_1', url: 'file:///tmp/secret.html' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'get-identity', itemId: 'item_1' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'get-card', itemId: 'item_1' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'save-login', payload: { url: 'https://example.com', password: 'x' } }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'save-login', payload: { url: 'http://localhost:5173', password: 'x' } }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'save-login', payload: { url: 'http://example.com', password: 'x' } }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'save-login', payload: { url: 'https://example.com', password: 10 } }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-get-credential', url: 'https://example.com', origin: 'https://example.com', requestDetailsJson: '{}', credentialId: 'cred' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-get-credential', url: 'https://example.com', origin: 'https://evil.example.com', requestDetailsJson: '{}', credentialId: 'cred' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-get-credential', url: 'https://example.com', origin: 'https://example.com', requestDetailsJson: 'not json', credentialId: 'cred' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-create-plan', url: 'https://example.com', requestDetailsJson: '[]' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-create-credential', url: 'http://example.com', origin: 'http://example.com', requestDetailsJson: '{}' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-get-credential', url: 'http://example.com', origin: 'http://example.com', requestDetailsJson: '{}', credentialId: 'cred' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkeys-status', url: 'http://example.com' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-get-plan', url: 'http://example.com', requestDetailsJson: '{}' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-get-plan', url: 'http://localhost:5173', requestDetailsJson: '{}' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-save-credential', url: 'http://example.com', requestDetailsJson: '{}', pendingPasskeyId: 'pending' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-save-credential', url: 'http://localhost:5173', requestDetailsJson: '{}', pendingPasskeyId: 'pending' }).ok).toBe(true)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-discard-credential', url: 'file:///tmp/passkey.html', pendingPasskeyId: 'pending' }).ok).toBe(false)
    expect(validateBrowserExtensionRequest({ id: 'req', type: 'passkey-discard-credential', pendingPasskeyId: 'pending' }).ok).toBe(true)
  })

  it('sanitizes browser request urls before desktop dispatch', () => {
    const listResult = validateBrowserExtensionRequest({
      id: 'req',
      type: 'list-logins',
      url: 'https://person:secret@example.com/reset/token?code=secret#fragment',
    })
    expect(listResult.ok).toBe(true)
    if (listResult.ok && listResult.request.type === 'list-logins') {
      expect(listResult.request.url).toBe('https://example.com')
    }

    const saveResult = validateBrowserExtensionRequest({
      id: 'req',
      type: 'save-login',
      payload: {
        url: 'https://example.com/oauth/callback?code=secret#fragment',
        password: 'x',
      },
    })
    expect(saveResult.ok).toBe(true)
    if (saveResult.ok && saveResult.request.type === 'save-login') {
      expect(saveResult.request.payload.url).toBe('https://example.com')
    }
  })
})
