import type { CreateItemInput } from '@/shared/types'

type ProtonPassExport = {
  encrypted?: boolean
  userId?: string
  version?: string
  vaults?: Record<string, ProtonPassVault>
}

type ProtonPassVault = {
  name?: string
  items?: ProtonPassItem[]
}

type ProtonPassItem = {
  data?: ProtonPassItemData
  state?: number | string
  aliasEmail?: string | null
}

type ProtonPassItemData = {
  metadata?: {
    name?: string
    note?: string
  }
  extraFields?: ProtonPassExtraField[]
  type?: string
  content?: Record<string, unknown>
}

type ProtonPassExtraField = {
  fieldName?: string
  type?: string
  data?: {
    content?: string
    totpUri?: string
  }
}

export function looksLikeProtonPassJson(data: Record<string, unknown>) {
  return typeof data.vaults === 'object' && data.vaults !== null && (data.userId !== undefined || data.version !== undefined || data.encrypted !== undefined)
}

export function parseProtonPassJson(contents: string): CreateItemInput[] {
  const data = JSON.parse(contents) as ProtonPassExport
  if (data.encrypted) throw new Error('Encrypted Proton Pass exports must be decrypted before Klarkey can import them.')
  if (!data.vaults || typeof data.vaults !== 'object') throw new Error('Invalid Proton Pass export file.')

  const inputs: CreateItemInput[] = []
  for (const vault of Object.values(data.vaults)) {
    for (const item of vault.items ?? []) {
      if (isTrashed(item)) continue
      const input = convertProtonPassItem(item)
      if (input) inputs.push(input)
    }
  }
  return inputs
}

function convertProtonPassItem(item: ProtonPassItem): CreateItemInput | undefined {
  const data = item.data
  if (!data) return undefined

  const metadata = data.metadata ?? {}
  const itemName = metadata.name?.trim() || item.aliasEmail?.trim() || 'Untitled'
  const notes = metadata.note?.trim() || undefined
  const content = data.content ?? {}

  if (data.type === 'login') return convertLogin(itemName, notes, content, data.extraFields ?? [])
  if (data.type === 'alias') return convertAlias(itemName, notes, item.aliasEmail)
  if (data.type === 'note') return { itemType: 'note', itemName, content: notes || itemName }
  if (data.type === 'creditCard') return convertCreditCard(itemName, notes, content)
  if (data.type === 'identity') return convertIdentity(itemName, notes, content, data.extraFields ?? [])
  return { itemType: 'note', itemName, content: notes || `Unsupported Proton Pass item type: ${data.type || 'unknown'}.` }
}

function convertLogin(
  itemName: string,
  notes: string | undefined,
  content: Record<string, unknown>,
  extraFields: ProtonPassExtraField[],
): CreateItemInput {
  const itemUsername = stringValue(content.itemUsername)
  const itemEmail = stringValue(content.itemEmail)
  const extraTotp = firstExtraTotp(extraFields)
  const customFields = [
    ...(itemUsername && itemEmail && itemUsername !== itemEmail ? [{ id: 'proton_email', label: 'Email', value: itemEmail }] : []),
    ...protonExtraFields(extraFields),
    ...protonPasskeyFields(content),
  ]

  return {
    itemType: 'login',
    itemName,
    username: itemUsername || itemEmail,
    password: stringValue(content.password),
    otp: stringValue(content.totpUri) || extraTotp,
    websites: stringArray(content.urls),
    notes,
    customFields: customFields.length > 0 ? customFields : undefined,
  }
}

function convertAlias(itemName: string, notes: string | undefined, aliasEmail: string | null | undefined): CreateItemInput {
  return {
    itemType: 'login',
    itemName,
    username: aliasEmail?.trim() || undefined,
    notes,
  }
}

function convertCreditCard(itemName: string, notes: string | undefined, content: Record<string, unknown>): CreateItemInput {
  const expiry = stringValue(content.expirationDate)
  const customFields = stringValue(content.pin) ? [{ id: 'proton_pin', label: 'PIN', value: stringValue(content.pin)! }] : undefined
  return {
    itemType: 'card',
    itemName,
    cardholderName: stringValue(content.cardholderName),
    cardNumber: stringValue(content.number),
    cardExpiryMonth: expiryMonth(expiry),
    cardExpiryYear: expiryYear(expiry),
    cardCvc: stringValue(content.verificationNumber),
    notes,
    customFields,
  }
}

function convertIdentity(
  itemName: string,
  notes: string | undefined,
  content: Record<string, unknown>,
  extraFields: ProtonPassExtraField[],
): CreateItemInput {
  const fullName = stringValue(content.fullName)
  const firstName = stringValue(content.firstName)
  const middleName = stringValue(content.middleName)
  const lastName = stringValue(content.lastName)
  const customFields = [
    ...protonIdentityKnownCustomFields(content),
    ...protonIdentityExtraSections(content),
    ...protonExtraFields(extraFields),
  ]

  return {
    itemType: 'identity',
    itemName,
    fullName,
    firstName,
    middleName,
    lastName,
    birthDate: stringValue(content.birthdate),
    email: stringValue(content.email),
    phone: stringValue(content.phoneNumber),
    company: stringValue(content.company) || stringValue(content.organization),
    jobTitle: stringValue(content.jobTitle),
    addressLine1: stringValue(content.streetAddress),
    addressLine2: [stringValue(content.floor), stringValue(content.county)].filter(Boolean).join(', ') || undefined,
    city: stringValue(content.city),
    state: stringValue(content.stateOrProvince),
    postalCode: stringValue(content.zipOrPostalCode),
    country: stringValue(content.countryOrRegion),
    notes,
    customFields: customFields.length > 0 ? customFields : undefined,
  }
}

function protonExtraFields(fields: ProtonPassExtraField[]) {
  return fields.flatMap((field, index) => {
    const value = field.type === 'totp' ? field.data?.totpUri : field.data?.content || field.data?.totpUri
    const label = field.fieldName?.trim() || importedFieldLabel(index)
    return value ? [{ id: `proton_field_${index}`, label, value }] : []
  })
}

function protonIdentityKnownCustomFields(content: Record<string, unknown>) {
  const fields: Array<[string, string]> = [
    ['gender', 'Gender'],
    ['socialSecurityNumber', 'Social security number'],
    ['passportNumber', 'Passport number'],
    ['licenseNumber', 'License number'],
    ['website', 'Website'],
    ['xHandle', 'X handle'],
    ['secondPhoneNumber', 'Second phone number'],
    ['linkedin', 'LinkedIn'],
    ['reddit', 'Reddit'],
    ['facebook', 'Facebook'],
    ['yahoo', 'Yahoo'],
    ['instagram', 'Instagram'],
    ['personalWebsite', 'Personal website'],
    ['workPhoneNumber', 'Work phone'],
    ['workEmail', 'Work email'],
  ]
  return fields.flatMap(([key, label], index) => {
    const value = stringValue(content[key])
    return value ? [{ id: `proton_identity_${index}`, label, value }] : []
  })
}

function protonIdentityExtraSections(content: Record<string, unknown>) {
  const directExtraKeys = ['extraPersonalDetails', 'extraAddressDetails', 'extraContactDetails', 'extraWorkDetails']
  const fields = directExtraKeys.flatMap((key) => protonExtraFields(arrayValue(content[key]) as ProtonPassExtraField[]))
  for (const section of arrayValue(content.extraSections)) {
    const sectionRecord = recordValue(section)
    const sectionName = stringValue(sectionRecord?.sectionName)
    for (const field of protonExtraFields(arrayValue(sectionRecord?.sectionFields) as ProtonPassExtraField[])) {
      fields.push({ ...field, label: sectionName ? `${sectionName}: ${field.label}` : field.label })
    }
  }
  return fields.map((field, index) => ({ ...field, id: `proton_identity_extra_${index}` }))
}

function protonPasskeyFields(content: Record<string, unknown>) {
  const passkeys = arrayValue(content.passkeys)
  if (passkeys.length === 0) return []
  return [{
    id: 'proton_passkeys',
    label: 'Proton Pass passkeys',
    value: `${passkeys.length} passkey${passkeys.length === 1 ? '' : 's'} present in the export; Proton Pass passkey material is not imported yet.`,
  }]
}

function firstExtraTotp(fields: ProtonPassExtraField[]) {
  for (const field of fields) {
    if (field.type === 'totp' && field.data?.totpUri) return field.data.totpUri
  }
  return undefined
}

function isTrashed(item: ProtonPassItem) {
  return item.state === 2 || item.state === 'trashed'
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.flatMap((entry) => typeof entry === 'string' && entry.trim() ? [entry.trim()] : [])))
    : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function expiryMonth(expiry: string | undefined) {
  const match = expiry?.match(/^\d{4}-(\d{1,2})/)
  return match ? match[1]!.replace(/^0+/, '') || '0' : undefined
}

function expiryYear(expiry: string | undefined) {
  const match = expiry?.match(/^(\d{4})-/)
  return match?.[1]
}

function importedFieldLabel(index: number) {
  return `Imported field ${index + 1}`
}
