import type Database from 'better-sqlite3'
import {
  type ItemDataPayload,
  getCardLastFour,
  joinCardExpiry,
  joinIdentityAddress,
  joinIdentityFullName,
  parseJson,
} from '@/electron/repository/helpers'
import type { ItemProfile, RecentAction, VaultSnapshot } from '@/shared/types'

export function buildVaultSnapshot(db: Database.Database): VaultSnapshot {
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
  const recents = db
    .prepare('SELECT id, actionId, itemId, label, usedAt FROM recent_actions ORDER BY usedAt DESC LIMIT 25')
    .all() as RecentAction[]

  return {
    items: items.map((item) => {
      const itemData = parseJson<ItemDataPayload>(item.itemData, {})
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
        email: item.email,
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
        content: itemData.content,
        websites: parseJson<string[]>(item.websites, []),
        notes: item.notes,
        customFields: parseJson<Array<{ id: string; label: string; value: string }>>(item.customFields, []),
        hasPassword: Boolean(item.passwordPayload),
        hasOtp: Boolean(item.otpPayload),
        hasPasskey: Boolean(item.hasPasskey),
        passwordPreview: item.passwordPayload ? '**********' : undefined,
        lastUsedAt: item.lastUsedAt,
      }
    }),
    recents,
  }
}
