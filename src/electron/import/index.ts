import { readFileSync } from 'node:fs'
import type { VaultRepository } from '@/electron/repository'
import type { ImportOptions, ImportResult } from '@/shared/import-export'
import { importKlarkeyJson } from '@/electron/import/import-klarkey'
import { importCsv } from '@/electron/import/import-csv'
import { import1pux } from '@/electron/import/import-1pux'
import { importBitwardenJson } from '@/electron/import/import-bitwarden'
import { importDashlaneJson } from '@/electron/import/import-dashlane'

function detectFormat(filePath: string): string {
  const lower = filePath.toLowerCase()

  if (lower.endsWith('.1pux')) return '1pux'
  if (lower.endsWith('.csv')) return 'csv'

  if (lower.endsWith('.json')) {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)

      // Klarkey export: has our app marker or versioned items array
      if (data.app === 'klarkey') {
        return 'klarkey-json'
      }

      // Dashlane: has credentials / secureNotes / paymentCards arrays
      if (
        Array.isArray(data.credentials) ||
        Array.isArray(data.secureNotes) ||
        Array.isArray(data.paymentCards) ||
        Array.isArray(data.identities)
      ) {
        return 'dashlane-json'
      }

      // Bitwarden: has items array with type/name fields
      if (
        Array.isArray(data.items) &&
        data.items.length > 0 &&
        typeof data.items[0]?.type === 'number' &&
        typeof data.items[0]?.name === 'string'
      ) {
        return 'bitwarden-json'
      }

      // Klarkey fallback (version check without app marker)
      if (data.version === 1 && Array.isArray(data.items)) {
        return 'klarkey-json'
      }
    } catch {
      // ignore parse errors, fall through to CSV
    }
    return 'csv'
  }

  return 'csv'
}

export async function importVault(repository: VaultRepository, options: ImportOptions): Promise<ImportResult> {
  const format = options.format === 'auto' ? detectFormat(options.filePath) : options.format

  switch (format) {
    case 'klarkey-json':
      return importKlarkeyJson(repository, options.filePath)
    case 'csv':
    case 'lastpass-csv':
    case 'dashlane-csv':
    case 'chrome-csv':
      return importCsv(repository, options.filePath)
    case '1pux':
      return import1pux(repository, options.filePath)
    case 'bitwarden-json':
      return importBitwardenJson(repository, options.filePath)
    case 'dashlane-json':
      return importDashlaneJson(repository, options.filePath)
    default:
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        message: `Unsupported import format: ${format}`,
      }
  }
}
