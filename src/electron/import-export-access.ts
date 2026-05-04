import { resolve } from 'node:path'
import type { ExportFormat, ExportOptions, ImportFormat, ImportOptions } from '@/shared/import-export'

const importFormats = new Set<ImportFormat>([
  'auto',
  'klarkey-json',
  'csv',
  '1pux',
  'bitwarden-json',
  'lastpass-csv',
  'dashlane-csv',
  'dashlane-json',
  'chrome-csv',
])

const exportFormats = new Set<ExportFormat>(['klarkey-json', 'csv'])
const PATH_GRANT_MAX_AGE_MS = 10 * 60 * 1000

const normalizeGrantedPath = (filePath: string) => resolve(filePath)

const isFilePath = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 4096

type ImportPathGrant = {
  format: ImportFormat
  expiresAt: number
}

type ExportPathGrant = {
  format: ExportFormat
  expiresAt: number
}

export const isImportOptions = (options: unknown): options is ImportOptions =>
  Boolean(
    options &&
    typeof options === 'object' &&
    'format' in options &&
    importFormats.has(options.format as ImportFormat) &&
    'filePath' in options &&
    isFilePath(options.filePath),
  )

export const isExportOptions = (options: unknown): options is ExportOptions =>
  Boolean(
    options &&
    typeof options === 'object' &&
    'format' in options &&
    exportFormats.has(options.format as ExportFormat) &&
    'filePath' in options &&
    isFilePath(options.filePath),
  )

export class ImportExportPathGrants {
  private readonly importPaths = new Map<string, ImportPathGrant>()
  private readonly exportPaths = new Map<string, ExportPathGrant>()

  grantImportPath(filePath: string, format: ImportFormat) {
    this.importPaths.set(normalizeGrantedPath(filePath), {
      format,
      expiresAt: Date.now() + PATH_GRANT_MAX_AGE_MS,
    })
    return filePath
  }

  grantExportPath(filePath: string, format: ExportFormat) {
    this.exportPaths.set(normalizeGrantedPath(filePath), {
      format,
      expiresAt: Date.now() + PATH_GRANT_MAX_AGE_MS,
    })
    return filePath
  }

  consumeImportPath(options: unknown): options is ImportOptions {
    if (!isImportOptions(options)) {
      return false
    }

    const path = normalizeGrantedPath(options.filePath)
    const granted = this.consumePath(this.importPaths, path, options.format)
    this.exportPaths.delete(path)
    return granted
  }

  consumeExportPath(options: unknown): options is ExportOptions {
    if (!isExportOptions(options)) {
      return false
    }

    const path = normalizeGrantedPath(options.filePath)
    const granted = this.consumePath(this.exportPaths, path, options.format)
    this.importPaths.delete(path)
    return granted
  }

  private consumePath<TFormat extends ImportFormat | ExportFormat>(
    paths: Map<string, { format: TFormat; expiresAt: number }>,
    path: string,
    format: TFormat,
  ) {
    const grant = paths.get(path)
    paths.delete(path)
    return grant !== undefined && grant.format === format && grant.expiresAt >= Date.now()
  }
}
