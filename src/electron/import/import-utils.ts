import type { VaultRepository } from '@/electron/repository'
import type { CreateItemInput, ActionExecutionResult } from '@/shared/types'
import type { ImportResult } from '@/shared/import-export'

export function importItems(repository: VaultRepository, inputs: CreateItemInput[]): ImportResult {
  let importedCount = 0
  let skippedCount = 0
  let errorCount = 0
  const errors: string[] = []

  for (const input of inputs) {
    if (!input.itemName?.trim()) {
      skippedCount++
      continue
    }

    try {
      const result: ActionExecutionResult = repository.createItem(input)
      if (result.status === 'success') {
        importedCount++
      } else {
        errorCount++
        if (result.message) errors.push(result.message)
      }
    } catch (error) {
      errorCount++
      errors.push(error instanceof Error ? error.message : String(error))
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

export function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const headers = parseCsvLine(lines[0]!)
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = values[j] ?? ''
    }
    rows.push(row)
  }

  return rows
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }

  result.push(current)
  return result
}
