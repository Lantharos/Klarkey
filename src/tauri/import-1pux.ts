import { strFromU8, unzipSync, type UnzipFileInfo } from 'fflate'
import type { CreateItemInput } from '@/shared/types'
import { MAX_IMPORT_ITEMS, sanitizeImportInput } from '@/tauri/import-utils'
import { CATEGORY_MAP, type OnePuxDetails, type OnePuxExport, type OnePuxItem, type OnePuxLoginField, type OnePuxSection } from '@/tauri/import-1pux-types'

const MAX_1PUX_BYTES = 128 * 1024 * 1024
const MAX_1PUX_ENTRIES = 2048
const MAX_1PUX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const MAX_1PUX_EXPORT_DATA_BYTES = 32 * 1024 * 1024

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
      return field.value?.string ?? field.value?.concealed ?? field.value?.phone ?? field.value?.url ?? field.value?.email?.email_address ?? field.value?.totp
    }
  }
  return undefined
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
      const value = field.value?.string ?? field.value?.concealed ?? field.value?.phone ?? field.value?.url ?? field.value?.email?.email_address ?? field.value?.menu ?? field.value?.creditCardNumber ?? field.value?.creditCardExpiry ?? field.value?.iban ?? field.value?.routingNumber ?? (field.value?.date !== undefined ? String(field.value.date) : undefined) ?? (field.value?.monthYear !== undefined ? String(field.value.monthYear) : undefined)
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

function getRecoveryCodes(sections: OnePuxSection[] | undefined) {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      const title = field.title?.toLowerCase().trim() || ''
      if (!field.value?.string || (!title.includes('recovery') && !title.includes('backup') && !title.includes('restore') && !title.includes('2fa'))) continue
      const codes = field.value.string
        .split(/\r?\n/)
        .map((line) => line.replace(/^[\s\-*\u2022\u25e6\u2023\u2043\u2013\u2014]+/g, '').replace(/\s+/g, ' ').trim())
        .filter((line) => line && !line.toLowerCase().includes('recovery'))
      return codes.length > 0 ? codes : undefined
    }
  }
  return undefined
}

function parseCardExpiry(expiry: string | undefined) {
  const parts = expiry?.trim().split(/[/-]/) ?? []
  return parts.length >= 2 ? { month: parts[0]?.trim(), year: parts[1]?.trim() } : {}
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

function convert1PasswordItem(item: OnePuxItem): CreateItemInput | undefined {
  const itemType = CATEGORY_MAP[item.templateUuid ?? item.categoryUuid ?? '001'] || 'login'
  const itemName = getItemName(item)
  const details = item.details
  const sections = details?.sections
  const notes = extractNotes(details, sections)
  if (itemType === 'card') return cardItem(itemName, details, sections, notes)
  if (itemType === 'identity') return { itemType, itemName, firstName: details?.firstname, lastName: details?.lastname, company: details?.company, jobTitle: details?.jobTitle, email: details?.email, phone: details?.phone, address: details?.street, city: details?.city, postalCode: details?.zip, country: details?.country, notes, customFields: getCustomFields(sections) }
  if (itemType === 'note') return { itemType, itemName, content: notes || itemName }
  return loginItem(item, itemName, details, sections, notes)
}

function cardItem(itemName: string, details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined, notes: string | undefined): CreateItemInput {
  const expiry = parseCardExpiry(details?.ccexp_m && details?.ccexp_y ? `${details.ccexp_m}/${details.ccexp_y}` : getSectionTextValue(sections, 'expiry date', 'expiration date', 'valid thru'))
  return { itemType: 'card', itemName, cardholderName: details?.cardholder || getSectionTextValue(sections, 'cardholder name', 'cardholder'), cardNumber: details?.ccnum || getSectionTextValue(sections, 'card number', 'number'), cardExpiryMonth: expiry.month, cardExpiryYear: expiry.year, cardCvc: details?.cvv || getSectionTextValue(sections, 'cvv', 'cvc', 'security code', 'verification number'), cardBrand: getSectionTextValue(sections, 'type', 'card type'), notes }
}

function loginItem(item: OnePuxItem, itemName: string, details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined, notes: string | undefined): CreateItemInput {
  const loginFields = details?.loginFields ?? details?.fields
  let username = getLoginField(loginFields, (field) => field.designation === 'username') || getLoginField(loginFields, (field) => field.fieldType === 'E') || getLoginField(loginFields, (field) => field.fieldType === 'T' && field.name?.toLowerCase() === 'username') || ''
  if (/^(?:-|\u2013|\u2014)$/.test(username)) username = ''
  const ssoInfo = getSsoInfo(sections)
  if (!username && item.overview?.subtitle && !item.overview.subtitle.toLowerCase().includes('signs in with')) username = item.overview.subtitle
  const totp = getSectionTotp(sections)
  const otp = totp ? totp.startsWith('otpauth://') ? totp : `otpauth://totp/${encodeURIComponent(itemName)}?secret=${encodeURIComponent(totp)}&issuer=${encodeURIComponent(itemName)}` : undefined
  const ssoProvider = getSsoProvider(sections)
  return {
    itemType: 'login',
    itemName,
    username,
    password: getLoginField(loginFields, (field) => field.designation === 'password') || getLoginField(loginFields, (field) => field.fieldType === 'P') || '',
    otp,
    notes: ssoInfo && !ssoProvider ? [ssoInfo, notes].filter(Boolean).join('\n\n') : notes,
    websites: getWebsites(item),
    customFields: getCustomFields(sections),
    recoveryCodes: getRecoveryCodes(sections),
    ssoProvider,
  }
}
