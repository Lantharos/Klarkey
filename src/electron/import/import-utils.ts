import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import type { VaultRepository } from '@/electron/repository'
import type { CreateItemInput, ActionExecutionResult } from '@/shared/types'
import type { ImportResult } from '@/shared/import-export'
import { sanitizeCreateItemInput } from '@/electron/ipc-validation'

export const MAX_IMPORT_ITEMS = 10_000
export const MAX_IMPORT_FILE_BYTES = 128 * 1024 * 1024
const windowsNamespacePrefix = /^\\\\[?.]\\/

export function isWindowsAlternateDataStreamImportPath(filePath: string) {
  if (process.platform !== 'win32') {
    return false
  }

  const path = filePath.replace(windowsNamespacePrefix, '')
  const drivePrefixLength = /^[a-zA-Z]:/.test(path) ? 2 : 0
  return path.slice(drivePrefixLength).includes(':')
}

export function validateImportFilePath(filePath: string, maxBytes = MAX_IMPORT_FILE_BYTES): string | undefined {
  try {
    if (isWindowsAlternateDataStreamImportPath(filePath)) {
      return 'Choose a normal vault export file to import.'
    }

    const stats = lstatSync(filePath)
    if (stats.isSymbolicLink()) {
      return 'Choose a normal vault export file to import.'
    }
    if (!stats.isFile()) {
      return 'Choose a vault export file to import.'
    }
    if (stats.size > maxBytes) {
      return 'That vault export is too large to import safely.'
    }
    return undefined
  } catch {
    return 'Klarkey could not read that vault file.'
  }
}

export function readImportFileText(filePath: string, maxBytes = MAX_IMPORT_FILE_BYTES) {
  const pathError = validateImportFilePath(filePath, maxBytes)
  if (pathError) {
    throw new Error(pathError)
  }

  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const fd = openSync(filePath, constants.O_RDONLY | noFollow)
  try {
    const stats = fstatSync(fd)
    if (!stats.isFile()) {
      throw new Error('Choose a vault export file to import.')
    }
    if (stats.size > maxBytes) {
      throw new Error('That vault export is too large to import safely.')
    }
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

export function tooManyImportItemsResult(): ImportResult {
  return {
    success: false,
    importedCount: 0,
    skippedCount: 0,
    errorCount: 1,
    message: `That export contains more than ${MAX_IMPORT_ITEMS} items.`,
  }
}

export function importItems(repository: VaultRepository, inputs: CreateItemInput[]): ImportResult {
  if (inputs.length > MAX_IMPORT_ITEMS) {
    return tooManyImportItemsResult()
  }

  let importedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const input of inputs) {
    if (typeof input.itemName === 'string' && input.itemName.trim().length === 0) {
      skippedCount++
      continue
    }

    try {
      const result: ActionExecutionResult = repository.createItem(sanitizeCreateItemInput(input))
      if (result.status === 'success') {
        importedCount++
      } else {
        errorCount++
      }
    } catch (error) {
      void error
      errorCount++
    }
  }

  const messageParts: string[] = []
  if (importedCount > 0) messageParts.push(`Imported ${importedCount} items.`)
  if (skippedCount > 0) messageParts.push(`Skipped ${skippedCount} items.`)
  if (errorCount > 0) messageParts.push(`${errorCount} errors.`)

  return {
    success: errorCount === 0 || importedCount > 0,
    importedCount,
    skippedCount,
    errorCount,
    message: messageParts.join(' ') || 'No items processed.',
  }
}

export function parseCsv(content: string, maxRows = Number.POSITIVE_INFINITY): Record<string, string>[] {
  const records = parseCsvRecords(content, maxRows + 1)
  if (records.length === 0) return []

  const headers = records[0]!
  const rows: Record<string, string>[] = []

  for (let i = 1; i < records.length; i++) {
    const values = records[i]!
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? ''
    }
    rows.push(row)
  }

  return rows
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
    if (record.some((value) => value.trim().length > 0)) {
      records.push(record)
    }
    record = []
    return records.length > maxRecords
  }

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!
    const nextChar = content[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        field += '"'
        i++
        continue
      }

      if (char === '"') {
        inQuotes = false
        continue
      }

      field += char
      continue
    }

    if (char === '"' && field.length === 0 && !quotedField) {
      inQuotes = true
      quotedField = true
      continue
    }

    if (char === ',') {
      pushField()
      continue
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && nextChar === '\n') {
        i++
      }
      if (pushRecord()) {
        return records
      }
      continue
    }

    field += char
  }

  if (field.length > 0 || quotedField || record.length > 0) {
    pushRecord()
  }

  return records
}
