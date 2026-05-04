import { decodeBase64Url, encodeBase64Url, normalizeCredentialId } from '@/shared/passkey-encoding'

describe('passkey credential id normalization', () => {
  it('round-trips base64url values', () => {
    const bytes = Uint8Array.from([1, 2, 3, 250, 251, 252])
    const encoded = encodeBase64Url(bytes)

    expect(encoded).toBe('AQID-vv8')
    expect(Array.from(decodeBase64Url(encoded))).toEqual(Array.from(bytes))
  })

  it('normalizes base64 and base64url strings to base64url', () => {
    expect(normalizeCredentialId('+/8=')).toBe('-_8')
    expect(normalizeCredentialId('-_8')).toBe('-_8')
  })

  it('rejects malformed base64url values without rewriting raw credential ids', () => {
    expect(() => decodeBase64Url('not base64!')).toThrow('Invalid base64url value')
    expect(normalizeCredentialId('not base64!')).toBe('not base64!')
  })

  it('converts byte arrays and structured payloads into base64url ids', () => {
    expect(normalizeCredentialId([1, 2, 3, 4])).toBe('AQIDBA')
    expect(normalizeCredentialId({ data: [1, 2, 3, 4] })).toBe('AQIDBA')
    expect(normalizeCredentialId({ buffer: 'AQIDBA==' })).toBe('AQIDBA')
  })
})
