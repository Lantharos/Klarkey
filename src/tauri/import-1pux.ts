import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate'
import type { CreateItemInput } from '@/shared/types'
import { MAX_IMPORT_ITEMS, sanitizeImportInput } from '@/tauri/import-utils'
import { CATEGORY_MAP, type OnePuxDetails, type OnePuxExport, type OnePuxItem, type OnePuxLoginField, type OnePuxSection, type OnePuxSectionField } from '@/tauri/import-1pux-types'

const MAX_1PUX_BYTES = 128 * 1024 * 1024
const MAX_1PUX_ENTRIES = 2048
const MAX_1PUX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_1PUX_EXPORT_DATA_BYTES = 32 * 1024 * 1024
type OnePuxAddress = NonNullable<NonNullable<OnePuxSectionField['value']>['address']>

export function parseOnePux(bytes: Uint8Array): CreateItemInput[] {
  if (bytes.byteLength > MAX_1PUX_BYTES) throw new Error('That vault export is too large to import safely.')
  const archive = unzipSync(bytes, { filter: onePuxFilter() })
  const exportData = archive['export.data']
  if (!exportData || exportData.byteLength > MAX_1PUX_EXPORT_DATA_BYTES) {
    throw new Error('The 1Password export data file is invalid.')
  }
  const data = JSON.parse(strFromU8(exportData)) as OnePuxExport
  const inputs: CreateItemInput[] = []
  for (const account of data.accounts ?? []) {
    for (const vault of account.vaults ?? []) {
      for (const item of vault.items ?? []) {
        if (isTrashed(item)) continue
        const input = convert1PasswordItem(item)
        const sanitized = input ? sanitizeImportInput(input) : undefined
        if (sanitized) inputs.push(sanitized)
        if (inputs.length > MAX_IMPORT_ITEMS) throw new Error(`That export contains more than ${MAX_IMPORT_ITEMS} items.`)
      }
    }
  }
  return inputs
}

function onePuxFilter() {
  let entryCount = 0
  let totalUncompressedBytes = 0
  return (file: UnzipFileInfo) => {
    entryCount += 1
    if (entryCount > MAX_1PUX_ENTRIES) throw new Error('The 1Password export contains too many files.')
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0) throw new Error('The 1Password export contains an invalid file.')
    totalUncompressedBytes += file.originalSize
    if (totalUncompressedBytes > MAX_1PUX_TOTAL_UNCOMPRESSED_BYTES) throw new Error('The 1Password export is too large to import safely.')
    const normalizedName = file.name.replace(/\\/g, '/')
    const segments = normalizedName.split('/')
    if (normalizedName.startsWith('/') || segments.includes('..') || /^[a-z]:/i.test(normalizedName)) {
      throw new Error('The 1Password export contains an unsafe file path.')
    }
    if (normalizedName === 'export.data' && file.originalSize > MAX_1PUX_EXPORT_DATA_BYTES) {
      throw new Error('The 1Password export data file is too large to import safely.')
    }
    return normalizedName === 'export.data'
  }
}

function isTrashed(item: OnePuxItem) {
  return item.trashed === 'Y' || item.trashed === true || item.state === 'trashed'
}

function getItemName(item: OnePuxItem) {
  const title = item.overview?.title?.trim()
  if (title) return title
  const subtitle = item.overview?.subtitle?.trim()
  if (subtitle) return subtitle
  const url = item.overview?.url
  if (!url) return 'Untitled'
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function getWebsites(item: OnePuxItem) {
  const urls: string[] = []
  if (item.overview?.url) urls.push(item.overview.url)
  for (const entry of item.overview?.urls ?? []) {
    if (entry.url && !urls.includes(entry.url)) urls.push(entry.url)
  }
  return urls.length > 0 ? urls : undefined
}

function getLoginField(fields: OnePuxLoginField[] | undefined, predicate: (field: OnePuxLoginField) => boolean) {
  for (const field of fields ?? []) {
    if (predicate(field) && field.value) return field.value
  }
  return undefined
}

function getSectionTextValue(sections: OnePuxSection[] | undefined, ...titles: string[]) {
  const wanted = titles.map((title) => title.toLowerCase())
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      const title = field.title?.toLowerCase().trim() || ''
      if (!wanted.includes(title)) continue
      return fieldTextValue(field)
    }
  }
  return undefined
}

function getSectionAddress(sections: OnePuxSection[] | undefined, ...titles: string[]) {
  const wanted = titles.map((title) => title.toLowerCase())
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      const title = field.title?.toLowerCase().trim() || ''
      if (wanted.includes(title) && field.value?.address) return field.value.address
    }
  }
  return undefined
}

function fieldTextValue(field: OnePuxSectionField) {
  const value = field.value
  if (!value) return undefined
  return value.string ??
    value.concealed ??
    value.phone ??
    value.url ??
    value.email?.email_address ??
    value.menu ??
    value.creditCardNumber ??
    value.creditCardExpiry ??
    value.iban ??
    value.routingNumber ??
    addressText(value.address) ??
    sshKeyText(value.sshKey) ??
    (value.date !== undefined ? formatDateValue(value.date) : undefined) ??
    (value.monthYear !== undefined ? formatMonthYear(value.monthYear) : undefined) ??
    value.totp
}

function addressText(address: OnePuxAddress | undefined) {
  if (!address || typeof address !== 'object') return undefined
  return [
    address.street,
    address.city,
    address.state,
    address.zip,
    address.country,
  ].filter(Boolean).join(', ') || undefined
}

function sshKeyText(sshKey: NonNullable<OnePuxSectionField['value']>['sshKey']) {
  if (!sshKey) return undefined
  if (typeof sshKey === 'string') return sshKey
  return sshKey.privateKey ??
    sshKey.metadata?.privateKey ??
    sshKey.publicKey ??
    sshKey.metadata?.publicKey ??
    sshKey.fingerprint ??
    sshKey.metadata?.fingerprint
}

function formatDateValue(value: number) {
  const text = String(value)
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  if (value > 1_000_000_000 && value < 10_000_000_000) return new Date(value * 1000).toISOString().slice(0, 10)
  if (value > 1_000_000_000_000 && value < 10_000_000_000_000) return new Date(value).toISOString().slice(0, 10)
  return text
}

function formatMonthYear(value: number | string) {
  const text = String(value).trim()
  if (/^\d{6}$/.test(text)) return `${text.slice(4, 6)}/${text.slice(0, 4)}`
  return text
}

function getSectionTotp(sections: OnePuxSection[] | undefined) {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.value?.totp) return field.value.totp
    }
  }
  return undefined
}

function getCustomFields(sections: OnePuxSection[] | undefined) {
  const result: Array<{ id: string; label: string; value: string }> = []
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.value?.totp || field.value?.ssoLogin) continue
      const value = fieldTextValue(field)
      if (value) result.push({ id: field.id || `cf_${result.length}`, label: field.title?.trim() || 'Field', value })
    }
  }
  return result.length > 0 ? result : undefined
}

function getSsoProvider(sections: OnePuxSection[] | undefined) {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.value?.ssoLogin?.provider) return field.value.ssoLogin.provider
    }
  }
  return undefined
}

function getSsoInfo(sections: OnePuxSection[] | undefined) {
  const provider = getSsoProvider(sections)
  return provider ? `Sign in with ${provider}` : undefined
}

function isPasswordOnlyItem(item: OnePuxItem) {
  return (item.templateUuid ?? item.categoryUuid) === '005'
}

function subtitleLooksLikeExportDate(value: string | undefined) {
  const subtitle = value?.trim()
  if (!subtitle) return false
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM|A\.?M\.?|P\.?M\.?|m\.d\.|p\.d\.))?)?$/i.test(subtitle)
}

function subtitleLooksUsableAsUsername(item: OnePuxItem) {
  const subtitle = item.overview?.subtitle?.trim()
  if (!subtitle || isPasswordOnlyItem(item) || subtitleLooksLikeExportDate(subtitle)) return false
  return !subtitle.toLowerCase().includes('signs in with')
}

function getRecoveryCodes(sections: OnePuxSection[] | undefined) {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      const title = field.title?.toLowerCase().trim() || ''
      const value = field.value?.string ?? field.value?.concealed
      if (!value || (!title.includes('recovery') && !title.includes('backup') && !title.includes('restore') && !title.includes('2fa'))) continue
      const codes = value
        .split(/\r?\n/)
        .map((line) => line.replace(/^[\s\-*\u2022\u25e6\u2023\u2043\u2013\u2014]+/g, '').replace(/\s+/g, ' ').trim())
        .filter((line) => line && !line.toLowerCase().includes('recovery'))
      return codes.length > 0 ? codes : undefined
    }
  }
  return undefined
}

function parseCardExpiry(expiry: string | number | undefined) {
  const text = expiry === undefined ? undefined : formatMonthYear(expiry)
  if (!text) return {}
  const normalized = text.trim()
  if (/^\d{6}$/.test(normalized)) return { month: normalized.slice(4, 6), year: normalized.slice(0, 4) }
  const parts = normalized.split(/[/-]/)
  if (parts.length < 2) return {}
  const first = parts[0]?.trim() ?? ''
  const second = parts[1]?.trim() ?? ''
  return first.length === 4 ? { month: second, year: first } : { month: first, year: second }
}

function extractNotes(details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined) {
  const parts: string[] = []
  if (details?.notesPlain) parts.push(details.notesPlain)
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.multiline && field.value?.string) parts.push(`${field.title || 'Note'}:\n${field.value.string}`)
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

type ImportedSshKey = {
  privateKey?: string
  publicKey?: string
  fingerprint?: string
  keyType?: string
  comment?: string
}

function findSshKey(sections: OnePuxSection[] | undefined): ImportedSshKey | undefined {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      const sshKey = normalizeSshKey(field.value?.sshKey)
      if (sshKey) return sshKey
    }
  }
  return undefined
}

function normalizeSshKey(sshKey: NonNullable<OnePuxSectionField['value']>['sshKey']): ImportedSshKey | undefined {
  if (!sshKey) return undefined
  if (typeof sshKey === 'string') return { privateKey: sshKey }
  const metadata = sshKey.metadata
  return {
    privateKey: sshKey.privateKey ?? metadata?.privateKey,
    publicKey: sshKey.publicKey ?? metadata?.publicKey,
    fingerprint: sshKey.fingerprint ?? metadata?.fingerprint,
    keyType: sshKey.keyType ?? metadata?.keyType,
    comment: sshKey.comment ?? metadata?.comment,
  }
}

function getSectionSensitiveValue(sections: OnePuxSection[] | undefined) {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (!fieldTitleLooksSensitive(field.title)) continue
      const value = fieldTextValue(field)
      if (value) return value
    }
  }
  return undefined
}

function fieldTitleLooksSensitive(title: string | undefined) {
  const normalized = title?.toLowerCase().trim() || ''
  return normalized === 'password' ||
    normalized === 'credential' ||
    normalized === 'secret' ||
    normalized === 'pin' ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('api key') ||
    normalized.includes('access key') ||
    normalized.includes('private key') ||
    normalized.includes('recovery phrase')
}

function convert1PasswordItem(item: OnePuxItem): CreateItemInput | undefined {
  const itemType = CATEGORY_MAP[item.templateUuid ?? item.categoryUuid ?? '001'] || 'login'
  const itemName = getItemName(item)
  const details = item.details
  const sections = details?.sections
  const notes = extractNotes(details, sections)
  if (itemType === 'card') return cardItem(itemName, details, sections, notes)
  if (itemType === 'identity') return identityItem(itemName, details, sections, notes)
  if (itemType === 'ssh-key') return sshKeyItem(itemName, sections, notes)
  if (itemType === 'note') return { itemType, itemName, content: notes || itemName }
  return loginItem(item, itemName, details, sections, notes)
}

function cardItem(itemName: string, details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined, notes: string | undefined): CreateItemInput {
  const expiry = parseCardExpiry(details?.ccexp_m && details?.ccexp_y ? `${details.ccexp_m}/${details.ccexp_y}` : getSectionTextValue(sections, 'expiry date', 'expiration date', 'valid thru'))
  return {
    itemType: 'card',
    itemName,
    cardholderName: details?.cardholder || getSectionTextValue(sections, 'cardholder name', 'cardholder'),
    cardNumber: details?.ccnum || getSectionTextValue(sections, 'card number', 'number'),
    cardExpiryMonth: expiry.month,
    cardExpiryYear: expiry.year,
    cardCvc: details?.cvv || getSectionTextValue(sections, 'cvv', 'cvc', 'security code', 'verification number'),
    cardBrand: getSectionTextValue(sections, 'type', 'card type'),
    billingPostalCode: getSectionTextValue(sections, 'zip', 'postal code', 'billing zip', 'billing postal code'),
    notes,
    customFields: getCustomFields(sections),
  }
}

function identityItem(itemName: string, details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined, notes: string | undefined): CreateItemInput {
  const address = getSectionAddress(sections, 'address')
  const firstName = details?.firstname || getSectionTextValue(sections, 'first name')
  const middleName = getSectionTextValue(sections, 'middle name', 'initial')
  const lastName = details?.lastname || getSectionTextValue(sections, 'last name')
  return {
    itemType: 'identity',
    itemName,
    firstName,
    middleName,
    lastName,
    fullName: [firstName, middleName, lastName].filter(Boolean).join(' ') || undefined,
    company: details?.company || getSectionTextValue(sections, 'company'),
    jobTitle: details?.jobTitle || getSectionTextValue(sections, 'job title', 'occupation'),
    birthDate: getSectionTextValue(sections, 'birth date', 'birthday'),
    email: details?.email || getSectionTextValue(sections, 'email', 'email address'),
    phone: details?.phone || getSectionTextValue(sections, 'default phone', 'phone', 'cell', 'home', 'business'),
    address: details?.street || addressText(address),
    addressLine1: details?.street || address?.street,
    city: details?.city || address?.city,
    state: address?.state,
    postalCode: details?.zip || address?.zip,
    country: details?.country || address?.country,
    notes,
    customFields: getCustomFields(sections),
  }
}

function sshKeyItem(itemName: string, sections: OnePuxSection[] | undefined, notes: string | undefined): CreateItemInput {
  const sshKey = findSshKey(sections)
  return {
    itemType: 'ssh-key',
    itemName,
    sshPrivateKey: sshKey?.privateKey,
    sshPublicKey: sshKey?.publicKey,
    sshFingerprint: sshKey?.fingerprint,
    sshAlgorithm: sshKey?.keyType,
    sshComment: sshKey?.comment,
    notes,
  }
}

function loginItem(item: OnePuxItem, itemName: string, details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined, notes: string | undefined): CreateItemInput {
  const loginFields = details?.loginFields ?? details?.fields
  let username = getLoginField(loginFields, (field) => field.designation === 'username') ||
    getLoginField(loginFields, (field) => field.fieldType === 'E') ||
    getLoginField(loginFields, (field) => field.fieldType === 'T' && field.name?.toLowerCase() === 'username') ||
    getSectionTextValue(sections, 'username', 'user name', 'email', 'account name') ||
    ''
  if (/^(?:-|\u2013|\u2014)$/.test(username)) username = ''
  const ssoInfo = getSsoInfo(sections)
  if (!username && subtitleLooksUsableAsUsername(item)) username = item.overview!.subtitle!.trim()
  const totp = getSectionTotp(sections)
  const otp = totp ? totp.startsWith('otpauth://') ? totp : `otpauth://totp/${encodeURIComponent(itemName)}?secret=${encodeURIComponent(totp)}&issuer=${encodeURIComponent(itemName)}` : undefined
  const ssoProvider = getSsoProvider(sections)
  const password = getLoginField(loginFields, (field) => field.designation === 'password') ||
    getLoginField(loginFields, (field) => field.fieldType === 'P') ||
    details?.password ||
    getSectionSensitiveValue(sections) ||
    ''
  return {
    itemType: 'login',
    itemName,
    username,
    password,
    otp,
    notes: ssoInfo && !ssoProvider ? [ssoInfo, notes].filter(Boolean).join('\n\n') : notes,
    websites: getWebsites(item),
    customFields: getCustomFields(sections),
    recoveryCodes: getRecoveryCodes(sections),
    ssoProvider,
  }
}
