import { isHostnameMatch, normalizeBrowserHostname, scoreWebsiteMatch } from '@/shared/browser-extension'

describe('browser extension site matching', () => {
  it('normalizes full urls and hostnames', () => {
    expect(normalizeBrowserHostname('https://accounts.example.com/login')).toBe('accounts.example.com')
    expect(normalizeBrowserHostname('example.com')).toBe('example.com')
  })

  it('matches subdomains in either direction', () => {
    expect(isHostnameMatch('accounts.example.com', 'example.com')).toBe(true)
    expect(isHostnameMatch('example.com', 'accounts.example.com')).toBe(true)
  })

  it('scores exact host matches above subdomain matches', () => {
    expect(scoreWebsiteMatch(['https://accounts.example.com'], 'https://accounts.example.com')).toBe(100)
    expect(scoreWebsiteMatch(['example.com'], 'https://accounts.example.com')).toBe(80)
  })
})
