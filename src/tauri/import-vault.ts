import type { ImportOptions, KlarkeyExportVault } from '@/shared/import-export'
import type { CreateItemInput } from '@/shared/types'
import { MAX_IMPORT_ITEMS, parseCsv, sanitizeImportInput } from '@/tauri/import-utils'

type BitwardenItem = {
  type?: number
  name?: string
  notes?: string
  login?: { username?: string; password?: string; totp?: string; uris?: Array<{ uri?: string }> }
  card?: { cardholderName?: string; number?: string; brand?: string; expMonth?: string; expYear?: string; code?: string }
  identity?: Record<string, string | undefined>
  fields?: Array<{ name?: string; value?: string }>
}

type DashlaneExport = {
  credentials?: Array<Record<string, unknown>>
  secureNotes?: Array<Record<string, unknown>>
  identities?: Array<Record<string, unknown>>
  paymentCards?: Array<Record<string, unknown>>
}

const BW_TYPE_MAP = new Map<number, CreateItemInput['itemType']>([
  [1, 'login'],
  [2, 'note'],
  [3, 'card'],
  [4, 'identity'],
])

const normalizeHeader = (header: string) => header.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')
const stringValue = (value: unknown) => typeof value === 'string' ? value : undefined

function getColumn(row: Record<string, string>, ...candidates: string[]) {
  for (const key of Object.keys(row)) {
    if (candidates.includes(normalizeHeader(key))) {
      const value = row[key]?.trim()
      if (value) return value
    }
  }
  return undefined
}

function detectCsvFormat(headers: string[]) {
  const normalized = headers.map(normalizeHeader)
  if (normalized.includes('url') && normalized.includes('username') && normalized.includes('password') && normalized.includes('name')) {
    return normalized.includes('grouping') || normalized.includes('fav') ? 'lastpass' : 'chrome'
  }
  if (normalized.includes('name') && normalized.includes('website') && normalized.includes('login') && normalized.includes('password')) return 'dashlane'
  if (normalized.includes('name') && normalized.includes('url') && normalized.includes('username') && normalized.includes('password') && normalized.includes('note')) return 'nordpass'
  if (normalized.includes('title') && normalized.includes('login') && normalized.includes('password') && normalized.includes('url')) return 'keeper'
  return 'generic'
}

export function parseVaultImport(options: ImportOptions, contents: string): CreateItemInput[] {
  const format = resolveFormat(options, contents)
  const inputs =
    format === 'klarkey-json' ? parseKlarkeyJson(contents)
      : format === 'bitwarden-json' ? parseBitwardenJson(contents)
        : format === 'dashlane-json' ? parseDashlaneJson(contents)
          : parseCsvImport(contents, format)
  if (inputs.length > MAX_IMPORT_ITEMS) throw new Error(`That export contains more than ${MAX_IMPORT_ITEMS} items.`)
  return inputs.flatMap((input) => {
    const sanitized = sanitizeImportInput(input)
    return sanitized ? [sanitized] : []
  })
}

function resolveFormat(options: ImportOptions, contents: string) {
  if (options.format !== 'auto') return options.format
  const lower = options.filePath.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (!lower.endsWith('.json')) return 'csv'
  const parsed = JSON.parse(contents) as Record<string, unknown>
  if (parsed.app === 'klarkey') return 'klarkey-json'
  if (Array.isArray(parsed.credentials) || Array.isArray(parsed.paymentCards)) return 'dashlane-json'
  if (parsed.encrypted !== undefined || Array.isArray(parsed.items)) return 'bitwarden-json'
  return 'klarkey-json'
}

function parseKlarkeyJson(contents: string): CreateItemInput[] {
  const vault = JSON.parse(contents) as KlarkeyExportVault
  if (!Array.isArray(vault.items)) throw new Error('Invalid Klarkey export file.')
  return vault.items.map((item) => ({
    itemType: item.itemType as CreateItemInput['itemType'],
    itemName: item.itemName || 'Untitled',
    username: item.username,
    password: item.password,
    otp: item.otpUri,
    email: item.email,
    websites: item.websites,
    notes: item.notes,
    customFields: item.customFields,
    recoveryCodes: item.recoveryCodes,
    fullName: item.fullName,
    firstName: item.firstName,
    middleName: item.middleName,
    lastName: item.lastName,
    company: item.company,
    jobTitle: item.jobTitle,
    birthDate: item.birthDate,
    phone: item.phone,
    addressLine1: item.addressLine1,
    addressLine2: item.addressLine2,
    city: item.city,
    state: item.state,
    postalCode: item.postalCode,
    country: item.country,
    cardholderName: item.cardholderName,
    cardNumber: item.cardNumber,
    cardExpiryMonth: item.cardExpiryMonth,
    cardExpiryYear: item.cardExpiryYear,
    cardCvc: item.cardCvc,
    cardBrand: item.cardBrand,
    billingPostalCode: item.billingPostalCode,
    sshAlgorithm: item.sshAlgorithm,
    sshFingerprint: item.sshFingerprint,
    sshPublicKey: item.sshPublicKey,
    sshPrivateKey: item.sshPrivateKey,
    sshComment: item.sshComment,
    ssoProvider: item.ssoProvider,
    content: item.content,
  }))
}

function parseBitwardenJson(contents: string): CreateItemInput[] {
  const data = JSON.parse(contents) as { encrypted?: boolean; items?: BitwardenItem[] }
  if (data.encrypted) throw new Error('Encrypted Bitwarden exports are not supported.')
  return (data.items ?? []).map(convertBitwardenItem)
}

function convertBitwardenItem(item: BitwardenItem): CreateItemInput {
  const itemType = BW_TYPE_MAP.get(item.type ?? 1) ?? 'login'
  const itemName = item.name?.trim() || 'Untitled'
  if (itemType === 'card') return { itemType, itemName, cardholderName: item.card?.cardholderName, cardNumber: item.card?.number, cardBrand: item.card?.brand, cardExpiryMonth: item.card?.expMonth, cardExpiryYear: item.card?.expYear, cardCvc: item.card?.code, notes: item.notes }
  if (itemType === 'identity') {
    const identity = item.identity ?? {}
    return { itemType, itemName, firstName: identity.firstName, middleName: identity.middleName, lastName: identity.lastName, company: identity.company, jobTitle: identity.jobTitle, email: identity.email, phone: identity.phone, addressLine1: identity.address1, addressLine2: identity.address2, city: identity.city, state: identity.state, postalCode: identity.postalCode, country: identity.country, notes: item.notes }
  }
  if (itemType === 'note') return { itemType, itemName, content: item.notes || itemName }
  return {
    itemType: 'login',
    itemName,
    username: item.login?.username,
    password: item.login?.password,
    otp: item.login?.totp,
    websites: item.login?.uris?.map((uri) => uri.uri).filter((uri): uri is string => Boolean(uri)),
    notes: item.notes,
    customFields: item.fields?.filter((field) => field.name && field.value).map((field, index) => ({ id: `field_${index}`, label: field.name!, value: field.value! })),
  }
}

function parseDashlaneJson(contents: string): CreateItemInput[] {
  const data = JSON.parse(contents) as DashlaneExport
  return [
    ...(data.credentials ?? []).map((cred) => ({ itemType: 'login' as const, itemName: stringValue(cred.title)?.trim() || stringValue(cred.login)?.trim() || 'Untitled', username: stringValue(cred.login), password: stringValue(cred.password), websites: extractUrl(cred.url) ? [extractUrl(cred.url)!] : undefined, notes: stringValue(cred.note), otp: stringValue(cred.otpSecret) })),
    ...(data.secureNotes ?? []).map((note) => ({ itemType: 'note' as const, itemName: stringValue(note.title)?.trim() || 'Untitled note', content: stringValue(note.content) })),
    ...(data.identities ?? []).map((identity) => ({ itemType: 'identity' as const, itemName: stringValue(identity.fullName)?.trim() || `${stringValue(identity.firstName) ?? ''} ${stringValue(identity.lastName) ?? ''}`.trim() || 'Untitled identity', firstName: stringValue(identity.firstName), lastName: stringValue(identity.lastName), email: stringValue(identity.email), phone: stringValue(identity.phoneNumber), address: stringValue(identity.address), city: stringValue(identity.city), state: stringValue(identity.state), postalCode: stringValue(identity.zipCode), country: stringValue(identity.country), birthDate: stringValue(identity.birthDate) })),
    ...(data.paymentCards ?? []).map((card) => ({ itemType: 'card' as const, itemName: stringValue(card.name)?.trim() || 'Untitled card', cardNumber: stringValue(card.cardNumber), cardCvc: stringValue(card.securityCode), cardExpiryMonth: stringValue(card.expireMonth), cardExpiryYear: stringValue(card.expireYear) })),
  ]
}

function extractUrl(url: unknown) {
  if (typeof url === 'string') return url
  return url && typeof url === 'object' ? stringValue((url as { href?: unknown }).href) : undefined
}

function parseCsvImport(contents: string, format: string): CreateItemInput[] {
  const rows = parseCsv(contents, MAX_IMPORT_ITEMS)
  if (rows.length === 0) throw new Error('CSV file is empty or has no data rows.')
  const detected = format === 'csv' || format === 'auto' ? detectCsvFormat(Object.keys(rows[0]!)) : format.replace('-csv', '')
  return rows.map((row) => rowToLoginInput(row, detected))
}

function rowToLoginInput(row: Record<string, string>, format: string): CreateItemInput {
  const url = getColumn(row, format === 'dashlane' ? 'website' : 'url', 'website', 'websites', 'uri', 'domain', 'hostname') || ''
  const username = getColumn(row, format === 'dashlane' || format === 'keeper' ? 'login' : 'username', 'username', 'user', 'email', 'e_mail', 'account') || ''
  const password = getColumn(row, 'password', 'pass', 'passwd', 'secret', 'pwd') || ''
  const name = getColumn(row, format === 'keeper' ? 'title' : 'name', 'title', 'item_name', 'sitename', 'site', 'entry') || ''
  const notes = getColumn(row, 'notes', 'note', 'extra', 'comment', 'comments', 'memo') || ''
  const otp = getColumn(row, 'otp', 'totp', 'otpauth', '2fa', 'twofactor', 'mfa') || ''
  return { itemType: 'login', itemName: name || username || url || 'Untitled', username, password, notes, otp: otp || undefined, websites: url ? [url] : undefined }
}
