import type { ItemType } from '@/shared/item-types'
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
