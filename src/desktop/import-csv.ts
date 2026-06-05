import type { CreateItemInput } from '@/shared/types'
import { MAX_IMPORT_ITEMS, parseCsv } from '@/desktop/import-utils'

type CsvSource = 'generic' | '1password' | 'bitwarden' | 'lastpass' | 'dashlane' | 'browser' | 'firefox' | 'keeper' | 'keepass' | 'nordpass' | 'protonpass'

const normalizeHeader = (header: string) =>
  header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

function getColumn(row: Record<string, string>, ...candidates: string[]) {
  const wanted = new Set(candidates.map(normalizeHeader))
  for (const key of Object.keys(row)) {
    if (wanted.has(normalizeHeader(key))) {
      const value = row[key]?.trim()
      if (value) return value
    }
  }
  return undefined
}

function getPreferredColumn(row: Record<string, string>, ...candidates: string[]) {
  for (const candidate of candidates) {
    const value = getColumn(row, candidate)
    if (value) return value
  }
  return undefined
}

function hasHeaders(normalized: Set<string>, ...headers: string[]) {
  return headers.every((header) => normalized.has(normalizeHeader(header)))
}

function detectCsvFormat(headers: string[]): CsvSource {
  const normalized = new Set(headers.map(normalizeHeader))
  if (hasHeaders(normalized, 'name', 'url', 'password') && (normalized.has('email') || normalized.has('item_email')) && (normalized.has('username') || normalized.has('note') || normalized.has('totp'))) return 'protonpass'
  if (normalized.has('login_uri') || normalized.has('login_username') || normalized.has('login_password') || normalized.has('login_totp')) return 'bitwarden'
  if (hasHeaders(normalized, 'title', 'username', 'password') && (normalized.has('website') || normalized.has('url') || normalized.has('one_time_password'))) return '1password'
  if (hasHeaders(normalized, 'url', 'username', 'password') && (normalized.has('grouping') || normalized.has('fav') || normalized.has('extra'))) return 'lastpass'
  if (hasHeaders(normalized, 'name', 'website', 'login', 'password') || hasHeaders(normalized, 'type', 'name', 'username', 'password', 'url')) return 'dashlane'
  if (hasHeaders(normalized, 'folder', 'title', 'login', 'password', 'website_address')) return 'keeper'
  if (hasHeaders(normalized, 'account', 'login_name', 'password', 'web_site') || hasHeaders(normalized, 'title', 'user_name', 'password', 'url')) return 'keepass'
  if (hasHeaders(normalized, 'url', 'username', 'password') && (normalized.has('httprealm') || normalized.has('formactionorigin') || normalized.has('guid'))) return 'firefox'
  if (hasHeaders(normalized, 'name', 'url', 'username', 'password') && normalized.has('note')) return 'nordpass'
  if (hasHeaders(normalized, 'name', 'url', 'username', 'password')) return 'browser'
  if (hasHeaders(normalized, 'url', 'username', 'password')) return 'browser'
  return 'generic'
}

export function parseCsvImport(contents: string, format: string): CreateItemInput[] {
  const rows = parseCsv(contents, MAX_IMPORT_ITEMS)
  if (rows.length === 0) throw new Error('CSV file is empty or has no data rows.')
  const detected = format === 'csv' || format === 'auto' ? detectCsvFormat(Object.keys(rows[0]!)) : csvSourceFromFormat(format)
  return rows.map((row) => rowToCsvInput(row, detected))
}

function csvSourceFromFormat(format: string): CsvSource {
  if (format === 'chrome-csv') return 'browser'
  if (format === 'firefox-csv') return 'firefox'
  if (format === '1password-csv') return '1password'
  if (format === 'bitwarden-csv') return 'bitwarden'
  if (format === 'lastpass-csv') return 'lastpass'
  if (format === 'dashlane-csv') return 'dashlane'
  if (format === 'keeper-csv') return 'keeper'
  if (format === 'keepass-csv') return 'keepass'
  if (format === 'nordpass-csv') return 'nordpass'
  if (format === 'proton-pass-csv' || format === 'proton-pass') return 'protonpass'
  return 'generic'
}

function rowToCsvInput(row: Record<string, string>, source: CsvSource): CreateItemInput {
  if (source === 'bitwarden') return rowToBitwardenCsvInput(row)
  if (source === 'lastpass') return rowToLastPassCsvInput(row)
  if (source === 'dashlane') return rowToDashlaneCsvInput(row)
  if (source === 'keeper') return rowToKeeperCsvInput(row)
  if (source === 'keepass') return rowToKeepassCsvInput(row)
  if (source === '1password') return rowToOnePasswordCsvInput(row)
  if (source === 'nordpass') return rowToNordPassCsvInput(row)
  if (source === 'protonpass') return rowToProtonPassCsvInput(row)
  if (source === 'browser' || source === 'firefox') return rowToBrowserCsvInput(row)
  return rowToGenericCsvInput(row)
}

function rowToBitwardenCsvInput(row: Record<string, string>): CreateItemInput {
  const type = getColumn(row, 'type')?.toLowerCase()
  const name = getColumn(row, 'name', 'title', 'item_name') || 'Untitled'
  const notes = getColumn(row, 'notes', 'note')
  if (type === 'note' || type === 'secure_note') return { itemType: 'note', itemName: name, content: notes || name }
  return {
    itemType: 'login',
    itemName: name,
    username: getColumn(row, 'login_username', 'username', 'login', 'email'),
    password: getColumn(row, 'login_password', 'password'),
    otp: getColumn(row, 'login_totp', 'totp', 'otp'),
    websites: websitesFromValue(getColumn(row, 'login_uri', 'url', 'website')),
    notes,
    customFields: optionalCustomFields(customFieldsFromDelimitedText(getColumn(row, 'fields'))),
  }
}

function rowToLastPassCsvInput(row: Record<string, string>): CreateItemInput {
  const name = getColumn(row, 'name', 'title') || getColumn(row, 'url') || 'Untitled'
  const url = getColumn(row, 'url', 'website')
  const username = getColumn(row, 'username', 'email', 'login')
  const password = getColumn(row, 'password')
  const notes = getColumn(row, 'extra', 'notes', 'note')
  if ((!password && notes) || url?.toLowerCase().startsWith('http://sn')) {
    return { itemType: 'note', itemName: name, content: notes || name }
  }
  return {
    itemType: 'login',
    itemName: name || username || url || 'Untitled',
    username,
    password,
    websites: websitesFromValue(url),
    notes,
  }
}

function rowToDashlaneCsvInput(row: Record<string, string>): CreateItemInput {
  const type = getColumn(row, 'type')?.toLowerCase()
  const name = getColumn(row, 'name', 'title') || getColumn(row, 'login', 'username', 'email') || getColumn(row, 'url', 'website') || 'Untitled'
  const notes = getColumn(row, 'note', 'notes', 'notefields', 'extra')
  if (type === 'secure note' || type === 'secure_note' || type === 'note') return { itemType: 'note', itemName: name, content: notes || name }
  return {
    itemType: 'login',
    itemName: name,
    username: getColumn(row, 'login', 'username', 'login_user', 'email'),
    password: getColumn(row, 'password'),
    otp: getColumn(row, 'totp', 'otp', 'otp_secret'),
    websites: websitesFromValue(getColumn(row, 'url', 'website')),
    notes,
    customFields: optionalCustomFields(collectNamedColumns(row, [
      ['username2', 'Username 2'],
      ['username3', 'Username 3'],
      ['collections', 'Collection'],
    ])),
  }
}

function rowToKeeperCsvInput(row: Record<string, string>): CreateItemInput {
  const name = getColumn(row, 'title', 'name') || getColumn(row, 'login') || getColumn(row, 'website_address', 'url') || 'Untitled'
  const notes = getColumn(row, 'notes', 'note')
  const customFields = [
    ...keeperCustomFieldPairs(row),
    ...customFieldsFromDelimitedText(getColumn(row, 'custom_fields', 'customfields', 'custom field', 'custom fields')),
  ]
  return {
    itemType: 'login',
    itemName: name,
    username: getColumn(row, 'login', 'username', 'email'),
    password: getColumn(row, 'password'),
    otp: getColumn(row, 'onetimecode', 'one_time_code', 'one_time_password', 'totp', 'otp'),
    websites: websitesFromValue(getColumn(row, 'website_address', 'website', 'url', 'host')),
    notes,
    customFields: customFields.length > 0 ? customFields : undefined,
  }
}

function rowToKeepassCsvInput(row: Record<string, string>): CreateItemInput {
  const name = getColumn(row, 'account', 'title', 'name') || getColumn(row, 'web_site', 'url') || 'Untitled'
  return {
    itemType: 'login',
    itemName: name,
    username: getColumn(row, 'login_name', 'user_name', 'username', 'login'),
    password: getColumn(row, 'password'),
    websites: websitesFromValue(getColumn(row, 'web_site', 'url', 'website')),
    notes: getColumn(row, 'comments', 'notes', 'comment'),
  }
}

function rowToOnePasswordCsvInput(row: Record<string, string>): CreateItemInput {
  const name = getColumn(row, 'title', 'name') || getColumn(row, 'website', 'url') || 'Untitled'
  return {
    itemType: 'login',
    itemName: name,
    username: getColumn(row, 'username', 'login', 'email'),
    password: getColumn(row, 'password'),
    otp: getColumn(row, 'one_time_password', 'one_time_passcode', 'otpauth', 'otp', 'totp'),
    websites: websitesFromValue(getColumn(row, 'website', 'url')),
    notes: getColumn(row, 'notes', 'note'),
  }
}

function rowToNordPassCsvInput(row: Record<string, string>): CreateItemInput {
  const name = getColumn(row, 'name', 'title') || getColumn(row, 'url') || 'Untitled'
  return {
    itemType: 'login',
    itemName: name,
    username: getColumn(row, 'username', 'login', 'email'),
    password: getColumn(row, 'password'),
    websites: websitesFromValue(getColumn(row, 'url', 'website')),
    notes: getColumn(row, 'note', 'notes'),
  }
}

function rowToProtonPassCsvInput(row: Record<string, string>): CreateItemInput {
  const type = getColumn(row, 'type', 'item_type')?.toLowerCase()
  if (type === 'note') return rowToNoteCsvInput(row)
  if (type === 'creditcard' || type === 'credit_card' || type === 'card') return rowToCardCsvInput(row)
  if (type === 'identity') return rowToIdentityCsvInput(row)
  const username = getPreferredColumn(row, 'item_username', 'username', 'login', 'item_email', 'email')
  const email = getPreferredColumn(row, 'item_email', 'email')
  const customFields = username && email && username !== email ? [{ id: 'proton_email', label: 'Email', value: email }] : undefined
  return {
    itemType: 'login',
    itemName: getColumn(row, 'name', 'title') || nameFromUrl(getColumn(row, 'url', 'urls', 'website')) || username || 'Untitled',
    username,
    password: getColumn(row, 'password'),
    otp: getColumn(row, 'totp', 'totp_uri', 'otp', 'otpauth'),
    websites: websitesFromValue(getColumn(row, 'url', 'urls', 'website')),
    notes: getColumn(row, 'note', 'notes'),
    customFields,
  }
}

function rowToBrowserCsvInput(row: Record<string, string>): CreateItemInput {
  const url = getColumn(row, 'url', 'website')
  const username = getColumn(row, 'username', 'login', 'email')
  return {
    itemType: 'login',
    itemName: getColumn(row, 'name', 'title') || nameFromUrl(url) || username || 'Untitled',
    username,
    password: getColumn(row, 'password'),
    websites: websitesFromValue(url),
    notes: getColumn(row, 'note', 'notes', 'httprealm', 'formactionorigin'),
  }
}

function rowToGenericCsvInput(row: Record<string, string>): CreateItemInput {
  const type = getColumn(row, 'type', 'item_type', 'record_type')?.toLowerCase()
  if (type === 'card' || type === 'credit_card' || looksLikeCardRow(row)) return rowToCardCsvInput(row)
  if (type === 'identity' || looksLikeIdentityRow(row)) return rowToIdentityCsvInput(row)
  if (type === 'note' || type === 'secure note' || type === 'secure_note' || looksLikeNoteRow(row)) return rowToNoteCsvInput(row)
  const url = getColumn(row, 'login_uri', 'url', 'website_address', 'web_site', 'website', 'websites', 'uri', 'domain', 'hostname', 'login_url')
  const username = getColumn(row, 'login_username', 'username', 'login', 'login_name', 'user_name', 'user', 'email', 'e_mail')
  const password = getColumn(row, 'login_password', 'password', 'pass', 'passwd', 'secret', 'pwd')
  const name = getColumn(row, 'name', 'title', 'item_name', 'account', 'sitename', 'site', 'entry')
  return {
    itemType: 'login',
    itemName: name || nameFromUrl(url) || username || 'Untitled',
    username,
    password,
    otp: getColumn(row, 'login_totp', 'otp', 'totp', 'totp_uri', 'otpauth', '2fa', 'twofactor', 'mfa', 'one_time_password', 'onetimecode'),
    websites: websitesFromValue(url),
    notes: getColumn(row, 'notes', 'note', 'extra', 'comment', 'comments', 'memo', 'notefields'),
  }
}

function rowToNoteCsvInput(row: Record<string, string>): CreateItemInput {
  const name = getColumn(row, 'name', 'title', 'item_name', 'account') || 'Untitled note'
  return {
    itemType: 'note',
    itemName: name,
    content: getColumn(row, 'content', 'text', 'note', 'notes', 'extra', 'comments') || name,
  }
}

function rowToCardCsvInput(row: Record<string, string>): CreateItemInput {
  const cardholderName = getColumn(row, 'cardholder_name', 'cardholder', 'name_on_card', 'holder', 'full_name')
  const cardNumber = getColumn(row, 'card_number', 'cardnumber', 'number', 'cc_number')
  return {
    itemType: 'card',
    itemName: getColumn(row, 'title', 'name', 'card_name') || cardholderName || 'Untitled card',
    cardholderName,
    cardNumber,
    cardBrand: getColumn(row, 'brand', 'type', 'card_type'),
    cardExpiryMonth: getColumn(row, 'expiry_month', 'expiration_month', 'expire_month', 'exp_month'),
    cardExpiryYear: getColumn(row, 'expiry_year', 'expiration_year', 'expire_year', 'exp_year'),
    cardExpiry: getColumn(row, 'expiry', 'expiration', 'expiration_date', 'expire_date'),
    cardCvc: getColumn(row, 'cvc', 'cvv', 'security_code', 'code'),
    billingPostalCode: getColumn(row, 'billing_postal_code', 'postal_code', 'zip'),
    notes: getColumn(row, 'notes', 'note', 'comments'),
  }
}

function rowToIdentityCsvInput(row: Record<string, string>): CreateItemInput {
  const firstName = getColumn(row, 'first_name', 'firstname')
  const middleName = getColumn(row, 'middle_name', 'middlename')
  const lastName = getColumn(row, 'last_name', 'lastname')
  const fullName = getColumn(row, 'full_name', 'fullname', 'name') || [firstName, middleName, lastName].filter(Boolean).join(' ')
  return {
    itemType: 'identity',
    itemName: getColumn(row, 'title', 'item_name') || fullName || getColumn(row, 'email') || 'Untitled identity',
    fullName: fullName || undefined,
    firstName,
    middleName,
    lastName,
    company: getColumn(row, 'company', 'organization'),
    jobTitle: getColumn(row, 'job_title', 'jobtitle', 'title_at_company'),
    birthDate: getColumn(row, 'birth_date', 'birthdate', 'date_of_birth'),
    email: getColumn(row, 'email', 'email_address', 'e_mail'),
    phone: getColumn(row, 'phone', 'phone_number', 'mobile'),
    address: getColumn(row, 'address', 'street_address'),
    addressLine1: getColumn(row, 'address_line_1', 'address1', 'street', 'street1'),
    addressLine2: getColumn(row, 'address_line_2', 'address2', 'street2'),
    city: getColumn(row, 'city'),
    state: getColumn(row, 'state', 'region', 'province'),
    postalCode: getColumn(row, 'postal_code', 'zip', 'zipcode', 'zip_or_postal_code'),
    country: getColumn(row, 'country', 'country_or_region'),
    notes: getColumn(row, 'notes', 'note', 'comments'),
  }
}

function looksLikeNoteRow(row: Record<string, string>) {
  return Boolean(getColumn(row, 'content', 'text') || (getColumn(row, 'note', 'notes') && !getColumn(row, 'password', 'login_password') && !getColumn(row, 'username', 'login_username', 'login')))
}

function looksLikeCardRow(row: Record<string, string>) {
  return Boolean(getColumn(row, 'card_number', 'cardnumber', 'cc_number') || (getColumn(row, 'number') && getColumn(row, 'security_code', 'cvc', 'cvv')))
}

function looksLikeIdentityRow(row: Record<string, string>) {
  const hasIdentityName = Boolean(getColumn(row, 'first_name', 'firstname', 'last_name', 'lastname', 'full_name', 'fullname'))
  const hasAddress = Boolean(getColumn(row, 'address', 'address_line_1', 'address1', 'city', 'postal_code', 'country'))
  return hasIdentityName && (hasAddress || Boolean(getColumn(row, 'phone', 'phone_number', 'email')))
}

function websitesFromValue(value: string | undefined) {
  if (!value) return undefined
  const websites = value
    .split(/\r?\n|\s*\|\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  return websites.length > 0 ? Array.from(new Set(websites)) : undefined
}

function nameFromUrl(url: string | undefined) {
  if (!url) return undefined
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function customFieldsFromDelimitedText(value: string | undefined) {
  if (!value) return []
  return value
    .split(/\r?\n|;(?=\s*[^:;]{1,80}:)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const separator = line.indexOf(':')
      if (separator <= 0) return [{ id: `field_${index}`, label: `Imported field ${index + 1}`, value: line }]
      const label = line.slice(0, separator).trim()
      const fieldValue = line.slice(separator + 1).trim()
      return label && fieldValue ? [{ id: `field_${index}`, label, value: fieldValue }] : []
    })
}

function optionalCustomFields(fields: Array<{ id: string; label: string; value: string }>) {
  return fields.length > 0 ? fields : undefined
}

function keeperCustomFieldPairs(row: Record<string, string>) {
  const fields: Array<{ id: string; label: string; value: string }> = []
  for (const [key, labelValue] of Object.entries(row)) {
    const normalized = normalizeHeader(key)
    const match = normalized.match(/^custom_?field_?(\d+)_?name$/)
    if (!match) continue
    const label = labelValue.trim()
    const value = getColumn(row, `customfield${match[1]}value`, `custom_field${match[1]}_value`, `custom_field_${match[1]}_value`)
    if (label && value) fields.push({ id: `custom_${match[1]}`, label, value })
  }
  return fields
}

function collectNamedColumns(row: Record<string, string>, columns: Array<[string, string]>) {
  return columns.flatMap(([column, label], index) => {
    const value = getColumn(row, column)
    return value ? [{ id: `field_${index}`, label, value }] : []
  })
}
