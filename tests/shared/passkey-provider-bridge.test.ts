import { describe, expect, it } from 'vitest'
import { validatePasskeyProviderBridgeRequest } from '@/shared/passkey-provider-bridge'

describe('passkey provider bridge validation', () => {
  it('accepts and sanitizes valid provider requests', () => {
    expect(validatePasskeyProviderBridgeRequest({
      id: 'req-1',
      type: 'find-credentials',
      url: 'https://person:secret@example.com/login?token=secret#fragment',
      requestDetailsJson: '{}',
      extra: 'ignored',
    })).toEqual({
      ok: true,
      request: {
        id: 'req-1',
        type: 'find-credentials',
        url: 'https://example.com',
        requestDetailsJson: '{}',
      },
    })
  })

  it('rejects non-browser URLs before provider dispatch', () => {
    const result = validatePasskeyProviderBridgeRequest({
      id: 'req-1',
      type: 'store-credential',
      url: 'file:///Users/person/secrets.html',
      requestDetailsJson: '{}',
      responseJson: '{}',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects insecure non-local provider URLs', () => {
    expect(validatePasskeyProviderBridgeRequest({
      id: 'req-1',
      type: 'find-credentials',
      url: 'http://example.com/login',
      requestDetailsJson: '{}',
    }).ok).toBe(false)

    expect(validatePasskeyProviderBridgeRequest({
      id: 'req-1',
      type: 'find-credentials',
      url: 'http://localhost:3000/login',
      requestDetailsJson: '{}',
    }).ok).toBe(true)

    expect(validatePasskeyProviderBridgeRequest({
      id: 'req-1',
      type: 'find-credentials',
      url: 'http://dev.localhost:3000/login',
      requestDetailsJson: '{}',
    }).ok).toBe(true)
  })

  it('bounds large provider payloads', () => {
    const result = validatePasskeyProviderBridgeRequest({
      id: 'req-1',
      type: 'find-credentials',
      url: 'https://example.com',
      requestDetailsJson: 'x'.repeat(262_145),
    })

    expect(result.ok).toBe(false)
  })

  it('rejects malformed and unsupported provider messages', () => {
    expect(validatePasskeyProviderBridgeRequest({ id: '', type: 'ping' }).ok).toBe(false)
    expect(validatePasskeyProviderBridgeRequest({ id: 'req-1', type: 'delete-everything' }).ok).toBe(false)
  })
})
