import * as OTPAuth from 'otpauth'
import type { TotpAlgorithm, TotpDetails } from '@/shared/types'

type TotpFallback = Partial<Pick<TotpDetails, 'issuer' | 'accountName' | 'digits' | 'period' | 'algorithm'>>

const defaultAlgorithm: TotpAlgorithm = 'SHA1'
const defaultDigits = 6
const defaultPeriod = 30
const maxTotpInputLength = 4096
const maxTotpSecretLength = 512
const maxTotpLabelLength = 256

const normalizeAlgorithm = (value?: string): TotpAlgorithm => {
  if (value === 'SHA256' || value === 'SHA512') {
    return value
  }

  return defaultAlgorithm
}

const normalizeDigits = (value?: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 6 && value <= 8 ? value : defaultDigits

const normalizePeriod = (value?: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 300 ? value : defaultPeriod

const normalizeLabel = (value: string | undefined, fallback: string) => {
  const normalized = value?.trim()
  return normalized ? normalized.slice(0, maxTotpLabelLength) : fallback
}

export const isTotpUri = (value: string) => /^otpauth:\/\//i.test(value.trim())

export const normalizeTotpSecret = (value: string) => value.replace(/[\s-]+/g, '').toUpperCase()

const canonicalizeTotp = (totp: OTPAuth.TOTP): TotpDetails => {
  const secret = totp.secret.base32
  if (secret.length === 0 || secret.length > maxTotpSecretLength) {
    throw new Error('The one-time password secret is too large.')
  }

  const issuer = normalizeLabel(totp.issuer, '') || undefined
  const accountName = normalizeLabel(totp.label, 'OTP')
  const digits = normalizeDigits(totp.digits)
  const period = normalizePeriod(totp.period)
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
  if (trimmed.length > maxTotpInputLength) {
    throw new Error('The one-time password input is too large.')
  }

  if (isTotpUri(trimmed)) {
    const parsed = OTPAuth.URI.parse(trimmed)

    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('Only time-based one-time passwords are supported.')
    }

    return canonicalizeTotp(parsed)
  }

  const normalizedSecret = normalizeTotpSecret(trimmed)
  if (normalizedSecret.length > maxTotpSecretLength) {
    throw new Error('The one-time password secret is too large.')
  }

  const secret = OTPAuth.Secret.fromBase32(normalizedSecret)
  const totp = new OTPAuth.TOTP({
    issuer: normalizeLabel(fallback.issuer, ''),
    label: normalizeLabel(fallback.accountName, 'OTP'),
    secret,
    digits: normalizeDigits(fallback.digits),
    period: normalizePeriod(fallback.period),
    algorithm: normalizeAlgorithm(fallback.algorithm),
  })

  return canonicalizeTotp(totp)
}

export function parseStoredTotp(value: string | undefined, fallback: TotpFallback = {}) {
  if (!value) {
    return undefined
  }
  if (value.length > maxTotpInputLength) {
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
    try {
      return parseTotpInput(value, fallback)
    } catch {
      return undefined
    }
  }

  try {
    return parseTotpInput(value, fallback)
  } catch {
    return undefined
  }
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
