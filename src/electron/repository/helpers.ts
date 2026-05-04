import { randomBytes } from 'node:crypto'
import { decryptValue, encryptValue, type EncryptedPayload } from '@/electron/crypto'
import type { CreatableItemType } from '@/shared/item-types'
import type { CreateItemInput, ItemDetails } from '@/shared/types'

export const now = () => new Date().toISOString()
export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
export const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`
export const tryDecrypt = (key: Buffer, payload?: string) => {
  if (!payload) {
    return undefined
  }

  try {
    return decryptValue(key, JSON.parse(payload) as EncryptedPayload)
  } catch {
    return undefined
  }
}

export const hasVaultKey = (key?: Buffer) => Boolean(key && key.length === 32)

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const payload = value as Partial<EncryptedPayload>
  return typeof payload.iv === 'string' && typeof payload.ciphertext === 'string' && typeof payload.authTag === 'string'
}

export function encryptJsonPayload(key: Buffer, value: unknown) {
  return JSON.stringify(encryptValue(key, JSON.stringify(value)))
}

export function readEncryptedJsonPayload<Value>(key: Buffer | undefined, payload: string | undefined, fallback: Value): Value {
  if (!payload) {
    return fallback
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return fallback
  }

  if (isEncryptedPayload(parsed)) {
    if (!key || !hasVaultKey(key)) {
      return fallback
    }
    return parseJson<Value>(tryDecrypt(key, payload), fallback)
  }

  return fallback
}

export const decryptPrivateKeyPayload = (key: Buffer, payload?: string) => {
  if (!payload) {
    return undefined
  }

  return tryDecrypt(key, payload)
}

export const getOtpFallback = ({
  itemName,
  username,
  existing,
}: {
  itemName: string
  username: string
  existing?: ItemDetails['otp']
}) => ({
  issuer: existing?.issuer ?? itemName,
  accountName: existing?.accountName ?? username ?? itemName,
  digits: existing?.digits,
  period: existing?.period,
  algorithm: existing?.algorithm,
})

export const parseJson = <Value>(payload: string | undefined, fallback: Value) => {
  if (!payload) {
    return fallback
  }

  try {
    return JSON.parse(payload) as Value
  } catch {
    return fallback
  }
}

export const parseOptionalJson = <Value>(payload?: string) => {
  if (!payload) {
    return undefined
  }

  try {
    return JSON.parse(payload) as Value
  } catch {
    return undefined
  }
}

export const getHostname = (value: string) => {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

export const hasText = (value?: string) => Boolean(value?.trim())
export const getHostnameLabel = (value: string) => {
  const hostname = getHostname(value) ?? value
  const [label] = hostname.toLowerCase().split('.')
  return label || ''
}
export const normalizeSearchText = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || ''
export const normalizeLooseDigits = (value?: string) => value?.replace(/\D+/g, '') || ''
export const isExactBrowserAccountMatch = (existingValue: string | undefined, nextValue: string | undefined) =>
  Boolean(normalizeSearchText(existingValue) && normalizeSearchText(existingValue) === normalizeSearchText(nextValue))
export const joinIdentityFullName = (value: Pick<ItemDataPayload, 'fullName' | 'firstName' | 'middleName' | 'lastName'>) =>
  value.fullName?.trim() ||
  [value.firstName, value.middleName, value.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ') ||
  undefined
export const joinIdentityAddress = (
  value: Pick<ItemDataPayload, 'address' | 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode' | 'country'>,
) =>
  value.address?.trim() ||
  [
    [value.addressLine1, value.addressLine2].map((part) => part?.trim()).filter(Boolean).join(', '),
    [value.city, value.state, value.postalCode].map((part) => part?.trim()).filter(Boolean).join(', '),
    value.country?.trim(),
  ]
    .filter(Boolean)
    .join(', ') ||
  undefined
export const splitCardExpiry = (value?: string) => {
  const cleaned = value?.trim()
  if (!cleaned) {
    return { month: undefined, year: undefined }
  }

  const [rawMonth, rawYear] = cleaned.split(/[/-]/).map((part) => part?.trim())
  const month = rawMonth?.replace(/\D+/g, '') || undefined
  const year = rawYear?.replace(/\D+/g, '') || undefined
  return { month, year }
}
export const joinCardExpiry = (value: Pick<ItemDataPayload, 'cardExpiry' | 'cardExpiryMonth' | 'cardExpiryYear'>) =>
  value.cardExpiry?.trim() ||
  (value.cardExpiryMonth?.trim() && value.cardExpiryYear?.trim()
    ? `${value.cardExpiryMonth.trim()}/${value.cardExpiryYear.trim()}`
    : undefined)
export const getCardLastFour = (value?: string) => {
  const digits = normalizeLooseDigits(value)
  return digits.length >= 4 ? digits.slice(-4) : undefined
}
export const scoreTextHit = (target: string, query: string, exactScore: number, includesScore: number) => {
  if (!target || !query) {
    return 0
  }

  if (target === query) {
    return exactScore
  }

  return target.includes(query) ? includesScore : 0
}

export type ItemDataPayload = {
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  email?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  sshAlgorithm?: string
  sshFingerprint?: string
  sshPublicKey?: string
  sshComment?: string
  sshPrivateKeyPayload?: string
  content?: string
  notes?: string
  customFields?: Array<{ id: string; label: string; value: string }>
  recoveryCodes?: string[]
  ssoProvider?: string
}

export type PasskeyRow = {
  id: string
  itemId: string
  label: string
  credentialId?: string
  rpId?: string
  userName?: string
  userHandle?: string
  transports?: string
  privateKeyPayload?: string
  signCount?: number
  createdAt: string
  lastUsedAt?: string
}

export type PendingPasskeyRow = {
  id: string
  label: string
  credentialId: string
  rpId?: string
  userName?: string
  userHandle?: string
  transports?: string
  privateKeyPayload: string
  createdAt: string
}

export type BrowserRequestCredential = {
  id: unknown
  type: 'public-key'
  transports?: string[]
}

export type BrowserRequestOptions = {
  rpId?: string
  allowCredentials?: BrowserRequestCredential[]
  user?: {
    name?: string
    displayName?: string
  }
  rp?: {
    id?: string
    name?: string
  }
}

export function sanitizeItemData(itemType: CreatableItemType, input: Partial<CreateItemInput>) {
  const sharedData = {
    ...(input.notes !== undefined ? { notes: input.notes.trim() || undefined } : {}),
    ...(input.customFields !== undefined ? { customFields: sanitizeCustomFields(input.customFields) } : {}),
  } satisfies Partial<ItemDataPayload>

  if (itemType === 'identity') {
    const itemData = {
      ...sharedData,
      fullName: input.fullName?.trim() || undefined,
      firstName: input.firstName?.trim() || undefined,
      middleName: input.middleName?.trim() || undefined,
      lastName: input.lastName?.trim() || undefined,
      company: input.company?.trim() || undefined,
      jobTitle: input.jobTitle?.trim() || undefined,
      birthDate: input.birthDate?.trim() || undefined,
      email: input.email?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
      address: input.address?.trim() || undefined,
      addressLine1: input.addressLine1?.trim() || undefined,
      addressLine2: input.addressLine2?.trim() || undefined,
      city: input.city?.trim() || undefined,
      state: input.state?.trim() || undefined,
      postalCode: input.postalCode?.trim() || undefined,
      country: input.country?.trim() || undefined,
    } satisfies ItemDataPayload

    return {
      ...itemData,
      fullName: joinIdentityFullName(itemData),
      address: joinIdentityAddress(itemData),
      recoveryCodes: input.recoveryCodes?.filter(Boolean),
    } satisfies ItemDataPayload
  }

  if (itemType === 'note') {
    return {
      ...sharedData,
      content: input.content?.trim() || undefined,
      recoveryCodes: input.recoveryCodes?.filter(Boolean),
    } satisfies ItemDataPayload
  }

  if (itemType === 'card') {
    const parsedExpiry = splitCardExpiry(input.cardExpiry)
    const itemData = {
      ...sharedData,
      cardholderName: input.cardholderName?.trim() || undefined,
      cardNumber: normalizeLooseDigits(input.cardNumber?.trim()),
      cardExpiry: input.cardExpiry?.trim() || undefined,
      cardExpiryMonth: input.cardExpiryMonth?.trim() || parsedExpiry.month,
      cardExpiryYear: input.cardExpiryYear?.trim() || parsedExpiry.year,
      cardCvc: input.cardCvc?.trim() || undefined,
      cardBrand: input.cardBrand?.trim() || undefined,
      billingPostalCode: input.billingPostalCode?.trim() || undefined,
    } satisfies ItemDataPayload

    return {
      ...itemData,
      cardExpiry: joinCardExpiry(itemData),
      recoveryCodes: input.recoveryCodes?.filter(Boolean),
    } satisfies ItemDataPayload
  }

  if (itemType === 'ssh-key') {
    return {
      ...sharedData,
      sshAlgorithm: input.sshAlgorithm?.trim() || undefined,
      sshFingerprint: input.sshFingerprint?.trim() || undefined,
      sshPublicKey: input.sshPublicKey?.trim() || undefined,
      sshComment: input.sshComment?.trim() || undefined,
    } satisfies ItemDataPayload
  }

  return {
    ...sharedData,
    ...(input.recoveryCodes !== undefined ? { recoveryCodes: input.recoveryCodes.filter(Boolean) } : {}),
    ...(input.ssoProvider !== undefined ? { ssoProvider: input.ssoProvider.trim() || undefined } : {}),
  } satisfies ItemDataPayload
}

function sanitizeCustomFields(fields: Array<{ id: string; label: string; value: string }>) {
  return fields
    .map((field) => ({
      id: field.id || id('field'),
      label: field.label.trim(),
      value: field.value.trim(),
    }))
    .filter((field) => field.label || field.value)
}
