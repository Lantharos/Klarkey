import type { ItemType } from '@/shared/item-types'
import type { CreateItemInput } from '@/shared/types'

export const MAX_IMPORT_ITEMS = 10_000
const MAX_LABEL_LENGTH = 256
const MAX_SMALL_TEXT_LENGTH = 4096
const MAX_LARGE_TEXT_LENGTH = 100_000
const MAX_URL_LENGTH = 2048
const MAX_ARRAY_ITEMS = 128
const MAX_CUSTOM_FIELDS = 64
const itemTypes = new Set<ItemType>(['login', 'note', 'identity', 'card', 'ssh-key'])

const text = (value: unknown, maxLength: number, allowEmpty = true) => {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) return undefined
  const trimmed = value.trim()
  if (!allowEmpty && !trimmed) return undefined
  return value
}

const textArray = (value: unknown, maxItems: number, maxLength: number) =>
  Array.isArray(value)
    ? value.slice(0, maxItems).map((entry) => text(entry, maxLength)).filter((entry): entry is string => entry !== undefined)
    : undefined

export function sanitizeImportInput(input: CreateItemInput): CreateItemInput | undefined {
  const itemName = text(input.itemName, MAX_LABEL_LENGTH, false)
  if (!itemName) return undefined
  const itemType = itemTypes.has(input.itemType as ItemType) ? input.itemType : 'login'
  return {
    itemType,
    itemName,
    username: text(input.username, MAX_SMALL_TEXT_LENGTH),
    password: text(input.password, MAX_SMALL_TEXT_LENGTH),
    otp: text(input.otp, MAX_LARGE_TEXT_LENGTH),
    fullName: text(input.fullName, MAX_SMALL_TEXT_LENGTH),
    firstName: text(input.firstName, MAX_SMALL_TEXT_LENGTH),
    middleName: text(input.middleName, MAX_SMALL_TEXT_LENGTH),
    lastName: text(input.lastName, MAX_SMALL_TEXT_LENGTH),
    company: text(input.company, MAX_SMALL_TEXT_LENGTH),
    jobTitle: text(input.jobTitle, MAX_SMALL_TEXT_LENGTH),
    birthDate: text(input.birthDate, MAX_SMALL_TEXT_LENGTH),
    email: text(input.email, MAX_SMALL_TEXT_LENGTH),
    phone: text(input.phone, MAX_SMALL_TEXT_LENGTH),
    address: text(input.address, MAX_SMALL_TEXT_LENGTH),
    addressLine1: text(input.addressLine1, MAX_SMALL_TEXT_LENGTH),
    addressLine2: text(input.addressLine2, MAX_SMALL_TEXT_LENGTH),
    city: text(input.city, MAX_SMALL_TEXT_LENGTH),
    state: text(input.state, MAX_SMALL_TEXT_LENGTH),
    postalCode: text(input.postalCode, MAX_SMALL_TEXT_LENGTH),
    country: text(input.country, MAX_SMALL_TEXT_LENGTH),
    cardholderName: text(input.cardholderName, MAX_SMALL_TEXT_LENGTH),
    cardNumber: text(input.cardNumber, MAX_SMALL_TEXT_LENGTH),
    cardExpiry: text(input.cardExpiry, MAX_SMALL_TEXT_LENGTH),
    cardExpiryMonth: text(input.cardExpiryMonth, MAX_SMALL_TEXT_LENGTH),
    cardExpiryYear: text(input.cardExpiryYear, MAX_SMALL_TEXT_LENGTH),
    cardCvc: text(input.cardCvc, MAX_SMALL_TEXT_LENGTH),
    cardBrand: text(input.cardBrand, MAX_SMALL_TEXT_LENGTH),
    billingPostalCode: text(input.billingPostalCode, MAX_SMALL_TEXT_LENGTH),
    sshAlgorithm: text(input.sshAlgorithm, MAX_SMALL_TEXT_LENGTH),
    sshFingerprint: text(input.sshFingerprint, MAX_SMALL_TEXT_LENGTH),
    sshPublicKey: text(input.sshPublicKey, MAX_LARGE_TEXT_LENGTH),
    sshPrivateKey: text(input.sshPrivateKey, MAX_LARGE_TEXT_LENGTH),
    sshComment: text(input.sshComment, MAX_SMALL_TEXT_LENGTH),
    content: text(input.content, MAX_LARGE_TEXT_LENGTH),
    notes: text(input.notes, MAX_LARGE_TEXT_LENGTH),
    websites: textArray(input.websites, 32, MAX_URL_LENGTH),
    customFields: Array.isArray(input.customFields)
      ? input.customFields.slice(0, MAX_CUSTOM_FIELDS).flatMap((field, index) => {
        const label = text(field.label, MAX_LABEL_LENGTH)
        const value = text(field.value, MAX_LARGE_TEXT_LENGTH)
        if (label === undefined || value === undefined) return []
        return [{ id: text(field.id, MAX_LABEL_LENGTH) ?? `field_${index}`, label, value }]
      })
      : undefined,
    recoveryCodes: textArray(input.recoveryCodes, MAX_ARRAY_ITEMS, MAX_SMALL_TEXT_LENGTH),
    ssoProvider: text(input.ssoProvider, MAX_SMALL_TEXT_LENGTH),
  }
}

export function parseCsv(content: string, maxRows = Number.POSITIVE_INFINITY): Record<string, string>[] {
  const records = parseCsvRecords(content, maxRows + 1)
  if (records.length === 0) return []
  const headers = records[0]!
  return records.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

function parseCsvRecords(content: string, maxRecords: number): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let quotedField = false

  const pushField = () => {
    record.push(field)
    field = ''
    quotedField = false
  }
  const pushRecord = () => {
    pushField()
    if (record.some((value) => value.trim())) records.push(record)
    record = []
    return records.length > maxRecords
  }

  for (let index = 0; index < content.length; index++) {
    const char = content[index]!
    const nextChar = content[index + 1]
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"'
        index++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
    } else if (char === '"' && field.length === 0 && !quotedField) {
      inQuotes = true
      quotedField = true
    } else if (char === ',') {
      pushField()
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && nextChar === '\n') index++
      if (pushRecord()) return records
    } else {
      field += char
    }
  }

  if (field.length > 0 || quotedField || record.length > 0) pushRecord()
  return records
}
