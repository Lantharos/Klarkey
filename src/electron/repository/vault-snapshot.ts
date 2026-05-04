import type Database from 'better-sqlite3'
import {
  type ItemDataPayload,
  getCardLastFour,
  joinCardExpiry,
  joinIdentityAddress,
  joinIdentityFullName,
  parseJson,
  readEncryptedJsonPayload,
} from '@/electron/repository/helpers'
import type { ItemProfile, RecentAction, VaultSnapshot } from '@/shared/types'

export function buildVaultSnapshot(db: Database.Database, key?: Buffer): VaultSnapshot {
  const items = db
    .prepare('SELECT * FROM identities ORDER BY COALESCE(lastUsedAt, updatedAt) DESC, itemName ASC')
    .all() as Array<{
      id: string
      itemType?: string
      itemName: string
      username: string
      email?: string
      websites?: string
      notes?: string
      customFields?: string
      itemData?: string
      passwordPayload?: string
      otpPayload?: string
      hasPasskey: number
      lastUsedAt?: string
    }>
  const passkeyRows = db.prepare('SELECT DISTINCT itemId FROM passkeys WHERE itemId IS NOT NULL').all() as Array<{ itemId: string }>
  const passkeyItemIds = new Set(passkeyRows.map((row) => row.itemId))
  const recents = db
    .prepare('SELECT id, actionId, itemId, label, usedAt FROM recent_actions ORDER BY usedAt DESC LIMIT 25')
    .all() as RecentAction[]

  return {
    items: items.map((item) => {
      const itemData = readEncryptedJsonPayload<ItemDataPayload>(key, item.itemData, {})
      const fullName = joinIdentityFullName(itemData)
      const address = joinIdentityAddress(itemData)
      const cardExpiry = joinCardExpiry(itemData)
      const cardLastFour = getCardLastFour(itemData.cardNumber)

      return {
        id: item.id,
        itemType: (item.itemType ?? 'login') as ItemProfile['itemType'],
        itemName: item.itemName,
        username: item.username || undefined,
        fullName,
        firstName: itemData.firstName,
        middleName: itemData.middleName,
        lastName: itemData.lastName,
        company: itemData.company,
        jobTitle: itemData.jobTitle,
        birthDate: itemData.birthDate,
        email: itemData.email ?? (key ? item.email : undefined),
        phone: itemData.phone,
        address,
        addressLine1: itemData.addressLine1,
        addressLine2: itemData.addressLine2,
        city: itemData.city,
        state: itemData.state,
        postalCode: itemData.postalCode,
        country: itemData.country,
        cardholderName: itemData.cardholderName,
        cardNumber: itemData.cardNumber,
        cardLastFour,
        cardExpiry,
        cardExpiryMonth: itemData.cardExpiryMonth,
        cardExpiryYear: itemData.cardExpiryYear,
        cardCvc: itemData.cardCvc,
        cardBrand: itemData.cardBrand,
        billingPostalCode: itemData.billingPostalCode,
        sshAlgorithm: itemData.sshAlgorithm,
        sshFingerprint: itemData.sshFingerprint,
        sshPublicKey: itemData.sshPublicKey,
        sshComment: itemData.sshComment,
        content: itemData.content,
        websites: parseJson<string[]>(item.websites, []),
        notes: itemData.notes,
        customFields: itemData.customFields ?? [],
        hasPassword: Boolean(item.passwordPayload),
        hasOtp: Boolean(item.otpPayload),
        hasPasskey: passkeyItemIds.has(item.id),
        hasRecoveryCodes: Boolean(itemData.recoveryCodes && itemData.recoveryCodes.length > 0),
        ssoProvider: itemData.ssoProvider,
        passwordPreview: item.passwordPayload ? '**********' : undefined,
        lastUsedAt: item.lastUsedAt,
      }
    }),
    recents,
  }
}
