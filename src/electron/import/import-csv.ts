import type { CreateItemInput } from '@/shared/types'
import type { ImportResult } from '@/shared/import-export'
import type { VaultRepository } from '@/electron/repository'
import { importItems, MAX_IMPORT_ITEMS, parseCsv, readImportFileText, tooManyImportItemsResult } from '@/electron/import/import-utils'

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9]/g, '_')
}

function getColumn(row: Record<string, string>, ...candidates: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key)
    if (candidates.includes(normalized)) {
      const value = row[key]?.trim()
      if (value) return value
    }
  }
  return undefined
}

function detectFormat(headers: string[]): 'lastpass' | 'chrome' | 'dashlane' | 'nordpass' | 'keeper' | 'generic' {
  const normalized = headers.map(normalizeHeader)

  if (normalized.includes('url') && normalized.includes('username') && normalized.includes('password') && normalized.includes('name')) {
    if (normalized.includes('grouping') || normalized.includes('fav')) {
      return 'lastpass'
    }
    return 'chrome'
  }

  if (normalized.includes('name') && normalized.includes('website') && normalized.includes('login') && normalized.includes('password')) {
    return 'dashlane'
  }

  if (normalized.includes('name') && normalized.includes('url') && normalized.includes('username') && normalized.includes('password') && normalized.includes('note')) {
    return 'nordpass'
  }

  if (normalized.includes('title') && normalized.includes('login') && normalized.includes('password') && normalized.includes('url')) {
    return 'keeper'
  }

  return 'generic'
}

export async function importCsv(repository: VaultRepository, filePath: string): Promise<ImportResult> {
  const content = readImportFileText(filePath)
  const rows = parseCsv(content, MAX_IMPORT_ITEMS)

  if (rows.length > MAX_IMPORT_ITEMS) {
    return tooManyImportItemsResult()
  }

  if (rows.length === 0) {
    return {
      success: false,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      message: 'CSV file is empty or has no data rows.',
    }
  }

  const headers = Object.keys(rows[0]!)
  const format = detectFormat(headers)

  const inputs: CreateItemInput[] = rows.map((row) => rowToLoginInput(row, format)).filter((input): input is CreateItemInput => Boolean(input.itemName))

  return importItems(repository, inputs)
}

function rowToLoginInput(row: Record<string, string>, format: string): CreateItemInput {
  if (format === 'lastpass') {
    const url = getColumn(row, 'url') || ''
    const username = getColumn(row, 'username') || ''
    const password = getColumn(row, 'password') || ''
    const notes = getColumn(row, 'extra') || ''
    const name = getColumn(row, 'name') || ''

    return {
      itemType: 'login',
      itemName: name || username || url || 'Untitled',
      username,
      password,
      notes,
      websites: url ? [url] : undefined,
    }
  }

  if (format === 'chrome') {
    const url = getColumn(row, 'url') || ''
    const username = getColumn(row, 'username') || ''
    const password = getColumn(row, 'password') || ''
    const name = getColumn(row, 'name') || ''

    return {
      itemType: 'login',
      itemName: name || username || url || 'Untitled',
      username,
      password,
      websites: url ? [url] : undefined,
    }
  }

  if (format === 'dashlane') {
    const url = getColumn(row, 'website') || ''
    const username = getColumn(row, 'login') || getColumn(row, 'username') || ''
    const password = getColumn(row, 'password') || ''
    const name = getColumn(row, 'name') || ''
    const notes = getColumn(row, 'note') || ''

    return {
      itemType: 'login',
      itemName: name || username || url || 'Untitled',
      username,
      password,
      notes,
      websites: url ? [url] : undefined,
    }
  }

  if (format === 'nordpass') {
    const url = getColumn(row, 'url') || ''
    const username = getColumn(row, 'username') || ''
    const password = getColumn(row, 'password') || ''
    const name = getColumn(row, 'name') || ''
    const notes = getColumn(row, 'note') || ''

    return {
      itemType: 'login',
      itemName: name || username || url || 'Untitled',
      username,
      password,
      notes,
      websites: url ? [url] : undefined,
    }
  }

  if (format === 'keeper') {
    const url = getColumn(row, 'url') || ''
    const username = getColumn(row, 'login') || getColumn(row, 'username') || ''
    const password = getColumn(row, 'password') || ''
    const name = getColumn(row, 'title') || ''
    const notes = getColumn(row, 'notes') || ''

    return {
      itemType: 'login',
      itemName: name || username || url || 'Untitled',
      username,
      password,
      notes,
      websites: url ? [url] : undefined,
    }
  }

  // Generic fallback
  const url = getColumn(row, 'url', 'website', 'websites', 'uri', 'domain', 'hostname') || ''
  const username = getColumn(row, 'username', 'user', 'login', 'email', 'e_mail', 'account') || ''
  const password = getColumn(row, 'password', 'pass', 'passwd', 'secret', 'pwd') || ''
  const name = getColumn(row, 'name', 'title', 'item_name', 'sitename', 'site', 'entry') || ''
  const notes = getColumn(row, 'notes', 'note', 'extra', 'comment', 'comments', 'memo') || ''
  const otp = getColumn(row, 'otp', 'totp', 'otpauth', '2fa', 'twofactor', 'mfa') || ''

  return {
    itemType: 'login',
    itemName: name || username || url || 'Untitled',
    username,
    password,
    notes,
    otp: otp || undefined,
    websites: url ? [url] : undefined,
  }
}
