import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate'
import type { ImportFormat, ImportOptions, KlarkeyExportVault } from '@/shared/import-export'
import type { CreateItemInput } from '@/shared/types'
import { parseCsvImport } from '@/desktop/import-csv'
import { MAX_IMPORT_ITEMS, sanitizeImportInput } from '@/desktop/import-utils'
import { looksLikeProtonPassJson, parseProtonPassJson } from '@/desktop/import-proton-pass'

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

const MAX_IMPORT_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_IMPORT_ARCHIVE_ENTRIES = 4096
const MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES = 96 * 1024 * 1024
const MAX_IMPORT_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024

const stringValue = (value: unknown) => typeof value === 'string' ? value : undefined

export function parseVaultImport(options: ImportOptions, contents: string): CreateItemInput[] {
  const format = resolveFormat(options, contents)
  const inputs =
    format === 'klarkey-json' ? parseKlarkeyJson(contents)
      : format === 'bitwarden-json' ? parseBitwardenJson(contents)
        : format === 'dashlane-json' ? parseDashlaneJson(contents)
          : format === 'proton-pass-json' ? parseProtonPassJson(contents)
            : parseCsvImport(contents, format)
  if (inputs.length > MAX_IMPORT_ITEMS) throw new Error(`That export contains more than ${MAX_IMPORT_ITEMS} items.`)
  return inputs.flatMap((input) => {
    const sanitized = sanitizeImportInput(input)
    return sanitized ? [sanitized] : []
  })
}

export function parseVaultArchive(options: ImportOptions, bytes: Uint8Array): CreateItemInput[] {
  if (bytes.byteLength > MAX_IMPORT_ARCHIVE_BYTES) throw new Error('That vault export archive is too large to import safely.')
  const archive = unzipSync(bytes, { filter: importArchiveFilter() })
  const importableEntries = Object.entries(archive)
    .map(([name, data]) => ({ name: name.replace(/\\/g, '/'), data }))
    .filter(({ name }) => isParsableArchiveEntry(name))
    .sort((a, b) => archiveEntryPriority(a.name) - archiveEntryPriority(b.name) || a.name.localeCompare(b.name))

  if (importableEntries.length === 0) {
    const encrypted = Object.keys(archive).some((name) => isEncryptedArchiveEntry(name))
    if (encrypted) throw new Error('Encrypted Proton Pass exports must be decrypted before Klarkey can import them.')
    throw new Error('That archive does not contain a supported import file.')
  }

  const inputs: CreateItemInput[] = []
  const errors: string[] = []
  for (const entry of importableEntries) {
    try {
      const contents = strFromU8(entry.data)
      const format = archiveEntryFormat(options.format, entry.name)
      inputs.push(...parseVaultImport({ format, filePath: entry.name }, contents))
      if (inputs.length > MAX_IMPORT_ITEMS) throw new Error(`That export contains more than ${MAX_IMPORT_ITEMS} items.`)
    } catch (error) {
      if (error instanceof Error && error.message.includes(`more than ${MAX_IMPORT_ITEMS} items`)) throw error
      errors.push(error instanceof Error ? error.message : 'Unsupported archive entry.')
    }
  }

  if (inputs.length === 0) {
    throw new Error(errors[0] ?? 'That archive does not contain any importable vault items.')
  }
  return inputs
}

function resolveFormat(options: ImportOptions, contents: string): Exclude<ImportFormat, 'auto' | '1pux'> {
  if (options.format !== 'auto') {
    if (options.format === '1pux') throw new Error('1Password .1pux files must be imported as binary archives.')
    if (options.format === 'proton-pass') return options.filePath.toLowerCase().endsWith('.json') ? 'proton-pass-json' : 'proton-pass-csv'
    return options.format
  }
  const lower = options.filePath.toLowerCase()
  if (lower.endsWith('.csv')) return 'csv'
  if (!lower.endsWith('.json')) return 'csv'
  const parsed = JSON.parse(contents) as Record<string, unknown>
  if (parsed.app === 'klarkey') return 'klarkey-json'
  if (Array.isArray(parsed.credentials) || Array.isArray(parsed.paymentCards)) return 'dashlane-json'
  if (looksLikeProtonPassJson(parsed)) return 'proton-pass-json'
  if (parsed.encrypted !== undefined || Array.isArray(parsed.items)) return 'bitwarden-json'
  return 'klarkey-json'
}

function importArchiveFilter() {
  let entryCount = 0
  let totalUncompressedBytes = 0
  return (file: UnzipFileInfo) => {
    entryCount += 1
    if (entryCount > MAX_IMPORT_ARCHIVE_ENTRIES) throw new Error('That vault export archive contains too many files.')
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error('That vault export archive contains an invalid file.')
    totalUncompressedBytes += file.originalSize
    if (totalUncompressedBytes > MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES) throw new Error('That vault export archive is too large to import safely.')
    const normalizedName = file.name.replace(/\\/g, '/')
    const segments = normalizedName.split('/')
    if (normalizedName.startsWith('/') || segments.includes('..') || /^[a-z]:/i.test(normalizedName)) {
      throw new Error('That vault export archive contains an unsafe file path.')
    }
    if (file.originalSize > MAX_IMPORT_ARCHIVE_ENTRY_BYTES) return false
    return isImportArchiveEntry(normalizedName)
  }
}

function isImportArchiveEntry(name: string) {
  const lower = name.toLowerCase()
  return lower.endsWith('.csv') || lower.endsWith('.json') || lower.endsWith('.pgp')
}

function isParsableArchiveEntry(name: string) {
  const lower = name.toLowerCase()
  return lower.endsWith('.csv') || lower.endsWith('.json')
}

function isEncryptedArchiveEntry(name: string) {
  return name.toLowerCase().endsWith('.pgp')
}

function archiveEntryPriority(name: string) {
  const lower = name.toLowerCase()
  if (lower.includes('credential') || lower.includes('login') || lower.includes('password')) return 0
  if (lower.includes('secure') || lower.includes('note')) return 1
  if (lower.endsWith('.json')) return 2
  return 3
}

function archiveEntryFormat(format: ImportFormat, name: string): ImportFormat {
  const lower = name.toLowerCase()
  if (format === 'proton-pass') return lower.endsWith('.json') ? 'proton-pass-json' : 'proton-pass-csv'
  if (lower.includes('proton pass') || lower.includes('protonpass')) return lower.endsWith('.json') ? 'proton-pass-json' : 'proton-pass-csv'
  if (lower.includes('note') || lower.includes('identity') || lower.includes('personal') || lower.includes('payment') || lower.includes('card')) return 'csv'
  if (format !== 'auto' && format !== 'csv') return format
  if (lower.endsWith('.json')) return 'auto'
  if (lower.includes('dashlane')) return 'dashlane-csv'
  if (lower.includes('bitwarden')) return 'bitwarden-csv'
  if (lower.includes('lastpass')) return 'lastpass-csv'
  if (lower.includes('keeper')) return 'keeper-csv'
  if (lower.includes('keepass')) return 'keepass-csv'
  if (lower.includes('nordpass')) return 'nordpass-csv'
  if (lower.includes('1password')) return '1password-csv'
  return 'csv'
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
