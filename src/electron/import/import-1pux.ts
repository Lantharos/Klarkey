import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import extract from 'extract-zip'
import type { ItemType } from '@/shared/item-types'
import type { CreateItemInput } from '@/shared/types'
import type { ImportResult } from '@/shared/import-export'
import type { VaultRepository } from '@/electron/repository'
import { importItems } from '@/electron/import/import-utils'

// --- Types for the real 1Password .1pux format ---

interface OnePuxLoginField {
  value?: string
  id?: string
  name?: string
  fieldType?: 'E' | 'P' | 'T' | 'N' | 'U' | string
  designation?: 'username' | 'password' | string
}

interface OnePuxSectionField {
  title?: string
  id?: string
  value?: {
    string?: string
    totp?: string
    ssoLogin?: {
      provider?: string
      item?: { vaultUuid: string; itemUuid: string }
    }
    concealed?: string
    phone?: string
    menu?: string
    email?: { email_address?: string; provider?: string }
    date?: number
    address?: unknown
    url?: string
    monthYear?: number
    creditCardType?: string
    creditCardNumber?: string
    creditCardExpiry?: string
    bankAccount?: unknown
    iban?: string
    routingNumber?: string
  }
  guarded?: boolean
  multiline?: boolean
  dontGenerate?: boolean
}

interface OnePuxSection {
  title?: string
  name?: string
  fields?: OnePuxSectionField[]
}

interface OnePuxUrl {
  label?: string
  url?: string
  mode?: string
}

interface OnePuxOverview {
  title?: string
  subtitle?: string
  ainfo?: string
  url?: string
  urls?: OnePuxUrl[]
}

interface OnePuxDetails {
  loginFields?: OnePuxLoginField[]
  fields?: OnePuxLoginField[]
  sections?: OnePuxSection[]
  passwordHistory?: unknown[]
  notesPlain?: string
  // Card
  ccnum?: string
  ccexp_m?: string
  ccexp_y?: string
  cvv?: string
  cardholder?: string
  // Identity
  firstname?: string
  initial?: string
  lastname?: string
  company?: string
  jobTitle?: string
  birthday?: string
  gender?: string
  street?: string
  city?: string
  country?: string
  zip?: string
  phone?: string
  email?: string
  username?: string
}

interface OnePuxItem {
  uuid?: string
  templateUuid?: string
  categoryUuid?: string
  trashed?: string | boolean
  state?: string
  createdAt?: number
  updatedAt?: number
  overview?: OnePuxOverview
  details?: OnePuxDetails
}

interface OnePuxVault {
  attrs?: { uuid?: string; name?: string; type?: string }
  items?: OnePuxItem[]
}

interface OnePuxAccount {
  attrs?: { accountName?: string; email?: string; uuid?: string }
  vaults?: OnePuxVault[]
}

interface OnePuxExport {
  accounts?: OnePuxAccount[]
}

const CATEGORY_MAP: Record<string, ItemType> = {
  '001': 'login',
  '002': 'card',
  '003': 'identity',
  '004': 'note',
  '005': 'login', // Password (no username)
  '006': 'note', // Document
}

function isTrashed(item: OnePuxItem): boolean {
  if (item.trashed === 'Y' || item.trashed === true) return true
  if (item.state === 'trashed') return true
  return false
}

function getItemName(item: OnePuxItem): string {
  const title = item.overview?.title?.trim()
  if (title) return title

  const subtitle = item.overview?.subtitle?.trim()
  if (subtitle) return subtitle

  const url = item.overview?.url
  if (url) {
    try { return new URL(url).hostname } catch { return url }
  }

  return 'Untitled'
}

function getWebsites(item: OnePuxItem): string[] | undefined {
  const urls: string[] = []
  const primary = item.overview?.url
  if (primary) urls.push(primary)
  for (const u of item.overview?.urls ?? []) {
    if (u.url && !urls.includes(u.url)) urls.push(u.url)
  }
  return urls.length > 0 ? urls : undefined
}

function getLoginField(
  fields: OnePuxLoginField[] | undefined,
  predicate: (f: OnePuxLoginField) => boolean,
): string | undefined {
  for (const f of fields ?? []) {
    if (predicate(f) && f.value) return f.value
  }
  return undefined
}

function getSectionTextValue(sections: OnePuxSection[] | undefined, ...titles: string[]): string | undefined {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      const t = field.title?.toLowerCase().trim() || ''
      if (titles.map((x) => x.toLowerCase()).includes(t)) {
        if (field.value?.string) return field.value.string
        if (field.value?.concealed) return field.value.concealed
        if (field.value?.phone) return field.value.phone
        if (field.value?.url) return field.value.url
        if (field.value?.email?.email_address) return field.value.email.email_address
        if (field.value?.totp) return field.value.totp
      }
    }
  }
  return undefined
}

function getSectionTotp(sections: OnePuxSection[] | undefined): string | undefined {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.value?.totp) {
        return field.value.totp
      }
    }
  }
  return undefined
}

function getCustomFields(
  sections: OnePuxSection[] | undefined,
): Array<{ id: string; label: string; value: string }> | undefined {
  const result: Array<{ id: string; label: string; value: string }> = []

  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      // Skip TOTP fields (handled separately)
      if (field.value?.totp) continue
      // Skip SSO login fields
      if (field.value?.ssoLogin) continue

      const label = field.title?.trim() || 'Field'
      let value: string | undefined

      if (field.value?.string) value = field.value.string
      else if (field.value?.concealed) value = field.value.concealed
      else if (field.value?.phone) value = field.value.phone
      else if (field.value?.url) value = field.value.url
      else if (field.value?.email?.email_address) value = field.value.email.email_address
      else if (field.value?.menu) value = field.value.menu
      else if (field.value?.creditCardNumber) value = field.value.creditCardNumber
      else if (field.value?.creditCardExpiry) value = field.value.creditCardExpiry
      else if (field.value?.iban) value = field.value.iban
      else if (field.value?.routingNumber) value = field.value.routingNumber
      else if (field.value?.date) value = String(field.value.date)
      else if (field.value?.monthYear) value = String(field.value.monthYear)

      if (value) {
        result.push({ id: field.id || `cf_${result.length}`, label, value })
      }
    }
  }

  return result.length > 0 ? result : undefined
}

function getSsoInfo(sections: OnePuxSection[] | undefined): string | undefined {
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.value?.ssoLogin?.provider) {
        return `Sign in with ${field.value.ssoLogin.provider}`
      }
    }
  }
  return undefined
}

function parseCardExpiry(expiry: string | undefined): { month?: string; year?: string } {
  if (!expiry) return {}
  const cleaned = expiry.trim()
  if (!cleaned) return {}
  const parts = cleaned.split(/[\/\-]/)
  if (parts.length >= 2) {
    return { month: parts[0]?.trim(), year: parts[1]?.trim() }
  }
  return {}
}

function extractNotes(details: OnePuxDetails | undefined, sections: OnePuxSection[] | undefined): string | undefined {
  const parts: string[] = []

  if (details?.notesPlain) {
    parts.push(details.notesPlain)
  }

  // Include multiline text fields as notes too
  for (const section of sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.multiline && field.value?.string) {
        parts.push(`${field.title || 'Note'}:\n${field.value.string}`)
      }
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

export async function import1pux(repository: VaultRepository, filePath: string): Promise<ImportResult> {
  const extractDir = join(tmpdir(), `klarkey-1pux-${Date.now()}`)
  mkdirSync(extractDir, { recursive: true })

  try {
    await extract(filePath, { dir: extractDir })
    const dataPath = join(extractDir, 'export.data')
    const content = readFileSync(dataPath, 'utf-8')
    const data = JSON.parse(content) as OnePuxExport

    const inputs: CreateItemInput[] = []

    for (const account of data.accounts ?? []) {
      for (const vault of account.vaults ?? []) {
        for (const item of vault.items ?? []) {
          if (isTrashed(item)) continue
          const input = convert1PasswordItem(item)
          if (input) inputs.push(input)
        }
      }
    }

    return importItems(repository, inputs)
  } finally {
    try { rmSync(extractDir, { recursive: true }) } catch { /* ignore */ }
  }
}

function convert1PasswordItem(item: OnePuxItem): CreateItemInput | null {
  const category = item.templateUuid ?? item.categoryUuid ?? '001'
  const itemType = CATEGORY_MAP[category] || 'login'
  const itemName = getItemName(item)
  const details = item.details
  const loginFields = details?.loginFields ?? details?.fields
  const sections = details?.sections
  const notes = extractNotes(details, sections)

  // --- Card ---
  if (itemType === 'card') {
    const expiry = parseCardExpiry(
      details?.ccexp_m && details?.ccexp_y
        ? `${details.ccexp_m}/${details.ccexp_y}`
        : getSectionTextValue(sections, 'expiry date', 'expiration date', 'valid thru'),
    )
    return {
      itemType: 'card',
      itemName,
      cardholderName: details?.cardholder || getSectionTextValue(sections, 'cardholder name', 'cardholder'),
      cardNumber: details?.ccnum || getSectionTextValue(sections, 'card number', 'number'),
      cardExpiryMonth: expiry.month,
      cardExpiryYear: expiry.year,
      cardCvc: details?.cvv || getSectionTextValue(sections, 'cvv', 'cvc', 'security code', 'verification number'),
      cardBrand: getSectionTextValue(sections, 'type', 'card type'),
      notes,
    }
  }

  // --- Identity ---
  if (itemType === 'identity') {
    return {
      itemType: 'identity',
      itemName,
      firstName: details?.firstname,
      lastName: details?.lastname,
      company: details?.company,
      jobTitle: details?.jobTitle,
      email: details?.email,
      phone: details?.phone,
      address: details?.street,
      city: details?.city,
      postalCode: details?.zip,
      country: details?.country,
      notes,
      customFields: getCustomFields(sections),
    }
  }

  // --- Note ---
  if (itemType === 'note') {
    return {
      itemType: 'note',
      itemName,
      content: notes || itemName,
    }
  }

  // --- Login / Password ---

  // Extract username: try designation first, then fieldType E (email), then T (text)
  const username =
    getLoginField(loginFields, (f) => f.designation === 'username') ||
    getLoginField(loginFields, (f) => f.fieldType === 'E') ||
    getLoginField(loginFields, (f) => f.fieldType === 'T' && f.name?.toLowerCase() === 'username') ||
    item.overview?.subtitle ||
    ''

  // Extract password
  const password =
    getLoginField(loginFields, (f) => f.designation === 'password') ||
    getLoginField(loginFields, (f) => f.fieldType === 'P') ||
    ''

  // Extract TOTP from section fields
  const totpSecret = getSectionTotp(sections)
  let otp: string | undefined
  if (totpSecret) {
    if (totpSecret.startsWith('otpauth://')) {
      otp = totpSecret
    } else {
      otp = `otpauth://totp/${encodeURIComponent(itemName)}?secret=${encodeURIComponent(totpSecret)}&issuer=${encodeURIComponent(itemName)}`
    }
  }

  // Handle SSO-only items (no username/password, just "Sign in with X")
  const ssoInfo = getSsoInfo(sections)
  const finalNotes = ssoInfo ? [ssoInfo, notes].filter(Boolean).join('\n\n') : notes

  // Custom fields from sections
  const customFields = getCustomFields(sections)

  return {
    itemType: 'login',
    itemName,
    username,
    password,
    otp,
    notes: finalNotes,
    websites: getWebsites(item),
    customFields,
  }
}
