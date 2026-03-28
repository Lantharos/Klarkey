import * as OTPAuth from 'otpauth'
import type { TotpAlgorithm, TotpDetails } from '@/shared/types'

type TotpFallback = Partial<Pick<TotpDetails, 'issuer' | 'accountName' | 'digits' | 'period' | 'algorithm'>>

const defaultAlgorithm: TotpAlgorithm = 'SHA1'

const normalizeAlgorithm = (value?: string): TotpAlgorithm => {
  if (value === 'SHA256' || value === 'SHA512') {
    return value
  }

  return defaultAlgorithm
}

export const isTotpUri = (value: string) => /^otpauth:\/\//i.test(value.trim())

export const normalizeTotpSecret = (value: string) => value.replace(/[\s-]+/g, '').toUpperCase()

const canonicalizeTotp = (totp: OTPAuth.TOTP): TotpDetails => {
  const secret = totp.secret.base32
  const issuer = totp.issuer?.trim() || undefined
  const accountName = totp.label.trim() || 'OTP'
  const digits = totp.digits
  const period = totp.period
  const algorithm = normalizeAlgorithm(totp.algorithm)
  const uri = new OTPAuth.TOTP({
    issuer: issuer ?? '',
    label: accountName,
    secret: OTPAuth.Secret.fromBase32(secret),
    digits,
    period,
    algorithm,
  }).toString()

  return {
    secret,
    issuer,
    accountName,
    digits,
    period,
    algorithm,
    uri,
  }
}

export const createTotpFromDetails = (details: TotpDetails) =>
  new OTPAuth.TOTP({
    issuer: details.issuer ?? '',
    label: details.accountName,
    secret: OTPAuth.Secret.fromBase32(details.secret),
    digits: details.digits,
    period: details.period,
    algorithm: details.algorithm,
  })

export function parseTotpInput(rawValue: string | undefined, fallback: TotpFallback = {}) {
  const trimmed = rawValue?.trim()

  if (!trimmed) {
    return undefined
  }

  if (isTotpUri(trimmed)) {
    const parsed = OTPAuth.URI.parse(trimmed)

    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('Only time-based one-time passwords are supported.')
    }

    return canonicalizeTotp(parsed)
  }

  const secret = OTPAuth.Secret.fromBase32(normalizeTotpSecret(trimmed))
  const totp = new OTPAuth.TOTP({
    issuer: fallback.issuer ?? '',
    label: fallback.accountName ?? 'OTP',
    secret,
    digits: fallback.digits ?? 6,
    period: fallback.period ?? 30,
    algorithm: fallback.algorithm ?? defaultAlgorithm,
  })

  return canonicalizeTotp(totp)
}

export function parseStoredTotp(value: string | undefined, fallback: TotpFallback = {}) {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as Partial<TotpDetails>
    if (typeof parsed.secret === 'string') {
      return parseTotpInput(parsed.uri ?? parsed.secret, {
        issuer: parsed.issuer ?? fallback.issuer,
        accountName: parsed.accountName ?? fallback.accountName,
        digits: parsed.digits ?? fallback.digits,
        period: parsed.period ?? fallback.period,
        algorithm: parsed.algorithm ?? fallback.algorithm,
      })
    }
  } catch {
    return parseTotpInput(value, fallback)
  }

  return parseTotpInput(value, fallback)
}

export function getTotpCode(details: TotpDetails, timestamp = Date.now()) {
  const totp = createTotpFromDetails(details)
  const remainingMs = totp.remaining({ timestamp })
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000))

  return {
    value: totp.generate({ timestamp }),
    remainingSeconds,
    period: details.period,
    progress: (details.period - remainingSeconds) / details.period,
  }
}
