import { describe, expect, it } from 'vitest'
import { getTotpCode, parseStoredTotp, parseTotpInput } from '@/shared/totp'

const secret = 'JBSWY3DPEHPK3PXP'

describe('TOTP parsing', () => {
  it('canonicalizes otpauth URLs and base32 secrets', () => {
    const fromUri = parseTotpInput(`otpauth://totp/Klarkey:test@example.com?secret=${secret}&issuer=Klarkey&digits=8&period=60&algorithm=SHA256`)
    const fromSecret = parseTotpInput(secret, {
      issuer: 'Klarkey',
      accountName: 'test@example.com',
    })

    expect(fromUri).toMatchObject({
      secret,
      issuer: 'Klarkey',
      accountName: 'test@example.com',
      digits: 8,
      period: 60,
      algorithm: 'SHA256',
    })
    expect(fromSecret?.uri).toContain('otpauth://')
    expect(getTotpCode(fromSecret!, 1_700_000_000_000).value).toMatch(/^\d{6}$/)
  })

  it('rejects oversized user-provided OTP material', () => {
    expect(() => parseTotpInput('A'.repeat(4097))).toThrow('too large')
    expect(() => parseTotpInput(`otpauth://totp/Klarkey?secret=${'A'.repeat(4097)}`)).toThrow('too large')
  })

  it('does not throw while reading corrupt stored OTP payloads', () => {
    expect(parseStoredTotp('{bad json')).toBeUndefined()
    expect(parseStoredTotp('A'.repeat(4097))).toBeUndefined()
    expect(parseStoredTotp(JSON.stringify({ secret: 'not base32!' }))).toBeUndefined()
  })

  it('normalizes unsafe stored TOTP parameters', () => {
    const stored = parseStoredTotp(JSON.stringify({
      secret,
      issuer: 'I'.repeat(400),
      accountName: 'A'.repeat(400),
      digits: 99,
      period: 9999,
      algorithm: 'MD5',
    }))

    expect(stored).toMatchObject({
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    })
    expect(stored?.issuer?.length).toBe(256)
    expect(stored?.accountName.length).toBe(256)
  })
})
