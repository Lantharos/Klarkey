import type Database from 'better-sqlite3'
import {
  type ItemDataPayload,
  decryptPrivateKeyPayload,
  getCardLastFour,
  joinCardExpiry,
  joinIdentityAddress,
  joinIdentityFullName,
  parseJson,
  tryDecrypt,
} from '@/electron/repository/helpers'
import { parseStoredTotp } from '@/shared/totp'
import type { ItemDetails } from '@/shared/types'

export function loadItemDetails(db: Database.Database, key: Buffer, itemId: string): ItemDetails | undefined {
  const row = db
    .prepare('SELECT * FROM identities WHERE id = ?')
    .get(itemId) as
    | {
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
        updatedAt?: string
      }
    | undefined

  if (!row) {
    return undefined
  }

  const passkeys = db
    .prepare(
      `
        SELECT id, label, credentialId, rpId, userName, createdAt, lastUsedAt
        FROM passkeys
        WHERE itemId = ?
        ORDER BY COALESCE(lastUsedAt, createdAt) DESC, createdAt DESC
      `,
    )
    .all(itemId) as Array<{
      id: string
      label: string
      credentialId?: string
      rpId?: string
      userName?: string
      createdAt: string
      lastUsedAt?: string
    }>

  const itemData = parseJson<ItemDataPayload>(row.itemData, {})
  const fullName = joinIdentityFullName(itemData)
  const address = joinIdentityAddress(itemData)
  const cardExpiry = joinCardExpiry(itemData)
  const otp = parseStoredTotp(tryDecrypt(key, row.otpPayload), {
    issuer: row.itemName,
    accountName: row.username || row.itemName,
  })

  return {
    itemId: row.id,
    itemType: (row.itemType ?? 'login') as ItemDetails['itemType'],
    itemName: row.itemName,
    updatedAt: row.updatedAt,
    username: row.username,
    password: tryDecrypt(key, row.passwordPayload),
    otp,
    fullName,
    firstName: itemData.firstName,
    middleName: itemData.middleName,
    lastName: itemData.lastName,
    company: itemData.company,
    jobTitle: itemData.jobTitle,
    birthDate: itemData.birthDate,
    email: row.email ?? undefined,
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
    cardLastFour: getCardLastFour(itemData.cardNumber),
    cardExpiry,
    cardExpiryMonth: itemData.cardExpiryMonth,
    cardExpiryYear: itemData.cardExpiryYear,
    cardCvc: itemData.cardCvc,
    cardBrand: itemData.cardBrand,
    billingPostalCode: itemData.billingPostalCode,
    sshAlgorithm: itemData.sshAlgorithm,
    sshFingerprint: itemData.sshFingerprint,
    sshPublicKey: itemData.sshPublicKey,
    sshPrivateKey: decryptPrivateKeyPayload(key, itemData.sshPrivateKeyPayload),
    sshComment: itemData.sshComment,
    content: itemData.content,
    notes: row.notes ?? undefined,
    websites: parseJson<string[]>(row.websites, []),
    customFields: parseJson<Array<{ id: string; label: string; value: string }>>(row.customFields, []),
    recoveryCodes: itemData.recoveryCodes ?? [],
    ssoProvider: itemData.ssoProvider,
    passkeys,
  }
}
