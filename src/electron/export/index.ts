import type { VaultRepository } from '@/electron/repository'
import { exportKlarkeyJson } from '@/electron/export/export-klarkey'
import { exportCsv } from '@/electron/export/export-csv'
import type { ExportOptions, ExportResult } from '@/shared/import-export'

export async function exportVault(repository: VaultRepository, options: ExportOptions): Promise<ExportResult> {
  if (options.format === 'klarkey-json') {
    return exportKlarkeyJson(repository, options.filePath)
  }

  if (options.format === 'csv') {
    return exportCsv(repository, options.filePath)
  }

  return {
    success: false,
    exportedCount: 0,
    message: `Unsupported export format: ${options.format}`,
  }
}
