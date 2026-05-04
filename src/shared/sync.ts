import { ALL_ITEM_TYPES, type ItemType } from '@/shared/item-types'
import { decodeBase64Url } from '@/shared/passkey-encoding'
import { normalizeHotkeyAccelerator } from '@/shared/hotkey-accelerator'
import { AUTO_LOCK_MINUTE_OPTIONS, CLIPBOARD_CLEAR_OPTIONS } from '@/shared/settings-options'
import type { CreateItemInput, ItemDetails, UserSettings } from '@/shared/types'

export const SYNC_SCHEMA_VERSION = 1
export const SYNC_DERIVATION_LABEL = 'klarkey-sync-v1'
export const SYNC_KEY_DERIVATION = 'HKDF-SHA256-klarkey-sync-v1'
export const SYNC_KEY_ALGORITHM = 'AES-256-GCM'

export interface WrappedVaultKey {
  iv: string
  ciphertext: string
  authTag: string
  algorithm: typeof SYNC_KEY_ALGORITHM
  derivation: typeof SYNC_KEY_DERIVATION
  wrappedAt: number
}

export interface SyncRecord {
  recordId: string
  revision: number
  serverSequence: number
  deviceId: string
  deletedAt?: number
  ciphertext: string
  iv: string
  authTag: string
  contentHash: string
  schemaVersion: number
}

export interface LocalSyncRecord {
  recordId: string
  revision: number
  deviceId: string
  deletedAt?: number
  ciphertext: string
  iv: string
  authTag: string
  contentHash: string
  schemaVersion: number
}

export interface DeviceRecord {
  deviceId: string
  name: string
  platform: string
  lastSeen: number
}

export type PlainVaultRecord =
  | {
      kind: 'item'
      recordId: string
      itemId: string
      itemType: ItemType
      item: CreateItemInput & { itemId: string }
      updatedAt: string
      deletedAt?: number
    }
  | {
      kind: 'site-passkey'
      recordId: string
      passkeyId: string
      itemId: string
      credentialId: string
      label: string
      rpId?: string
      userName?: string
      userHandle?: string
      transports: string[]
      privateKeyJwk?: JsonWebKey
      signCount: number
      createdAt: string
      lastUsedAt?: string
      syncedCounter: true
      deletedAt?: number
    }
  | {
      kind: 'settings'
      recordId: 'settings:user'
      settings: UserSettings
      updatedAt: string
      deletedAt?: number
    }

export interface SyncAccount {
  aveIdentityId: string
  displayName?: string
  email?: string
}

export interface SyncStatus {
  configured: boolean
  signedIn: boolean
  syncing: boolean
  deviceId: string
  deviceName: string
  account?: SyncAccount
  lastSyncAt?: string
  lastError?: string
  conflictCount: number
  serverSequence: number
}

export interface SyncUpdateEvent {
  status: SyncStatus
  vaultChanged: boolean
  returnHome?: boolean
}

export interface SyncRunOptions {
  fullPull?: boolean
}

export type SyncPushAccepted = {
  recordId: string
  revision: number
  serverSequence: number
  contentHash: string
}

export interface SyncPushResult {
  sequence: number
  accepted: SyncPushAccepted[]
  conflicts: SyncRecord[]
}

const itemTypes = new Set<ItemType>(ALL_ITEM_TYPES)
const MAX_ID_LENGTH = 160
const MAX_LABEL_LENGTH = 256
const MAX_SMALL_TEXT_LENGTH = 4096
const MAX_LARGE_TEXT_LENGTH = 100_000
const MAX_URL_LENGTH = 2048
const MAX_ARRAY_ITEMS = 128
const MAX_CUSTOM_FIELDS = 64

const itemStringFields = [
  'username',
  'password',
  'otp',
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'company',
  'jobTitle',
  'birthDate',
  'email',
  'phone',
  'address',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'cardholderName',
  'cardNumber',
  'cardExpiry',
  'cardExpiryMonth',
  'cardExpiryYear',
  'cardCvc',
  'cardBrand',
  'billingPostalCode',
  'sshPublicKey',
  'sshPrivateKey',
  'sshComment',
  'sshAlgorithm',
  'sshFingerprint',
  'content',
  'notes',
  'ssoProvider',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBoundedString = (value: unknown, maxLength: number, allowEmpty = false): value is string =>
  typeof value === 'string' &&
  value.length <= maxLength &&
  (allowEmpty || value.trim().length > 0) &&
  !value.includes('\0')

const isOptionalBoundedString = (value: unknown, maxLength: number) =>
  value === undefined || isBoundedString(value, maxLength, true)

const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'

const isSafeIntegerInRange = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max

const isP256Coordinate = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    return false
  }

  try {
    return decodeBase64Url(value).length === 32
  } catch {
    return false
  }
}

const hasValidDeletedAt = (record: Record<string, unknown>) =>
  record.deletedAt === undefined || isSafeIntegerInRange(record.deletedAt, 1)

const hasValidStringArray = (value: unknown, maxItems: number, maxLength: number) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => isBoundedString(entry, maxLength, true)))

const hasValidCustomFields = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length <= MAX_CUSTOM_FIELDS &&
    value.every((field) =>
      isRecord(field) &&
      isBoundedString(field.id, MAX_ID_LENGTH) &&
      isBoundedString(field.label, MAX_LABEL_LENGTH, true) &&
      isBoundedString(field.value, MAX_LARGE_TEXT_LENGTH, true),
    ))

const hasValidJwk = (value: unknown) =>
  value === undefined ||
  (isRecord(value) &&
    value.kty === 'EC' &&
    value.crv === 'P-256' &&
    isP256Coordinate(value.x) &&
    isP256Coordinate(value.y) &&
    isP256Coordinate(value.d))

const hasValidSettings = (value: unknown): value is UserSettings =>
  isRecord(value) &&
  normalizeHotkeyAccelerator(String(value.hotkey)) === value.hotkey &&
  CLIPBOARD_CLEAR_OPTIONS.includes(value.clearClipboardSeconds as (typeof CLIPBOARD_CLEAR_OPTIONS)[number]) &&
  typeof value.launchOnStartup === 'boolean' &&
  typeof value.browserAutoOpenMenu === 'boolean' &&
  typeof value.browserAutoSubmitLogin === 'boolean' &&
  typeof value.browserSavePrompts === 'boolean' &&
  typeof value.passcodeEnabled === 'boolean' &&
  AUTO_LOCK_MINUTE_OPTIONS.includes(value.autoLockMinutes as (typeof AUTO_LOCK_MINUTE_OPTIONS)[number]) &&
  typeof value.sshAgentEnabled === 'boolean'

const hasValidItemPayload = (value: unknown, itemId: string, itemType: ItemType) => {
  if (!isRecord(value) || value.itemId !== itemId || value.itemType !== itemType) {
    return false
  }

  if (!isBoundedString(value.itemName, MAX_LABEL_LENGTH) || !isOptionalBoolean(value.preserveEmptyPassword)) {
    return false
  }

  for (const field of itemStringFields) {
    if (!isOptionalBoundedString(value[field], field === 'content' || field === 'notes' || field === 'sshPrivateKey' || field === 'otp' ? MAX_LARGE_TEXT_LENGTH : MAX_SMALL_TEXT_LENGTH)) {
      return false
    }
  }

  return hasValidStringArray(value.websites, 32, MAX_URL_LENGTH) &&
    hasValidStringArray(value.recoveryCodes, MAX_ARRAY_ITEMS, MAX_SMALL_TEXT_LENGTH) &&
    hasValidCustomFields(value.customFields)
}

export const validatePlainVaultRecord = (value: unknown): value is PlainVaultRecord => {
  if (!isRecord(value) || !isBoundedString(value.recordId, MAX_ID_LENGTH) || !hasValidDeletedAt(value)) {
    return false
  }

  if (value.kind === 'item') {
    return isBoundedString(value.itemId, MAX_ID_LENGTH) &&
      value.recordId === `item:${value.itemId}` &&
      typeof value.itemType === 'string' &&
      itemTypes.has(value.itemType as ItemType) &&
      isBoundedString(value.updatedAt, MAX_SMALL_TEXT_LENGTH) &&
      hasValidItemPayload(value.item, value.itemId, value.itemType as ItemType)
  }

  if (value.kind === 'site-passkey') {
    return isBoundedString(value.passkeyId, MAX_ID_LENGTH) &&
      isBoundedString(value.itemId, MAX_ID_LENGTH) &&
      isBoundedString(value.credentialId, MAX_SMALL_TEXT_LENGTH) &&
      value.recordId === `site-passkey:${value.credentialId}` &&
      isBoundedString(value.label, MAX_LABEL_LENGTH) &&
      isOptionalBoundedString(value.rpId, 253) &&
      isOptionalBoundedString(value.userName, MAX_SMALL_TEXT_LENGTH) &&
      isOptionalBoundedString(value.userHandle, MAX_SMALL_TEXT_LENGTH) &&
      hasValidStringArray(value.transports, 16, 32) &&
      hasValidJwk(value.privateKeyJwk) &&
      isSafeIntegerInRange(value.signCount, 0) &&
      isBoundedString(value.createdAt, MAX_SMALL_TEXT_LENGTH) &&
      isOptionalBoundedString(value.lastUsedAt, MAX_SMALL_TEXT_LENGTH) &&
      value.syncedCounter === true
  }

  if (value.kind === 'settings') {
    return value.recordId === 'settings:user' &&
      isBoundedString(value.updatedAt, MAX_SMALL_TEXT_LENGTH) &&
      hasValidSettings(value.settings)
  }

  return false
}

export const recordFromItemDetails = (details: ItemDetails, updatedAt: string): PlainVaultRecord => ({
  kind: 'item',
  recordId: `item:${details.itemId}`,
  itemId: details.itemId,
  itemType: details.itemType,
  item: {
    itemId: details.itemId,
    itemType: details.itemType as CreateItemInput['itemType'],
    itemName: details.itemName,
    username: details.username,
    password: details.password,
    otp: details.otp?.uri,
    fullName: details.fullName,
    firstName: details.firstName,
    middleName: details.middleName,
    lastName: details.lastName,
    company: details.company,
    jobTitle: details.jobTitle,
    birthDate: details.birthDate,
    email: details.email,
    phone: details.phone,
    addressLine1: details.addressLine1,
    addressLine2: details.addressLine2,
    city: details.city,
    state: details.state,
    postalCode: details.postalCode,
    country: details.country,
    cardholderName: details.cardholderName,
    cardNumber: details.cardNumber,
    cardExpiryMonth: details.cardExpiryMonth,
    cardExpiryYear: details.cardExpiryYear,
    cardCvc: details.cardCvc,
    cardBrand: details.cardBrand,
    billingPostalCode: details.billingPostalCode,
    sshPublicKey: details.sshPublicKey,
    sshPrivateKey: details.sshPrivateKey,
    sshComment: details.sshComment,
    sshAlgorithm: details.sshAlgorithm,
    sshFingerprint: details.sshFingerprint,
    content: details.content,
    notes: details.notes,
    websites: details.websites,
    customFields: details.customFields,
    recoveryCodes: details.recoveryCodes,
    ssoProvider: details.ssoProvider,
  },
  updatedAt,
})
