import { describe, expect, it, vi } from 'vitest'
import { ImportExportPathGrants, isExportOptions, isImportOptions } from '@/electron/import-export-access'

describe('import/export path grants', () => {
  it('accepts only known import and export formats', () => {
    expect(isImportOptions({ format: 'auto', filePath: 'vault.csv' })).toBe(true)
    expect(isImportOptions({ format: 'exe', filePath: 'vault.exe' })).toBe(false)
    expect(isExportOptions({ format: 'csv', filePath: 'vault.csv' })).toBe(true)
    expect(isExportOptions({ format: '1pux', filePath: 'vault.1pux' })).toBe(false)
  })

  it('requires a matching picker grant before import or export', () => {
    const grants = new ImportExportPathGrants()
    const importPath = grants.grantImportPath('C:\\Users\\krist\\Downloads\\vault.csv', 'csv')
    const exportPath = grants.grantExportPath('C:\\Users\\krist\\Downloads\\vault.json', 'klarkey-json')

    expect(grants.consumeImportPath({ format: 'csv', filePath: importPath })).toBe(true)
    expect(grants.consumeImportPath({ format: 'csv', filePath: importPath })).toBe(false)
    expect(grants.consumeExportPath({ format: 'klarkey-json', filePath: exportPath })).toBe(true)
    expect(grants.consumeExportPath({ format: 'klarkey-json', filePath: exportPath })).toBe(false)
  })

  it('does not let an import grant authorize an export', () => {
    const grants = new ImportExportPathGrants()
    const importPath = grants.grantImportPath('C:\\Users\\krist\\Downloads\\vault.csv', 'csv')

    expect(grants.consumeExportPath({ format: 'csv', filePath: importPath })).toBe(false)
    expect(grants.consumeImportPath({ format: 'csv', filePath: importPath })).toBe(false)
  })

  it('requires the granted import and export format to match the consumed request', () => {
    const grants = new ImportExportPathGrants()
    const importPath = grants.grantImportPath('C:\\Users\\krist\\Downloads\\vault.csv', 'csv')
    const exportPath = grants.grantExportPath('C:\\Users\\krist\\Downloads\\vault-export.csv', 'csv')

    expect(grants.consumeImportPath({ format: 'bitwarden-json', filePath: importPath })).toBe(false)
    expect(grants.consumeImportPath({ format: 'csv', filePath: importPath })).toBe(false)
    expect(grants.consumeExportPath({ format: 'klarkey-json', filePath: exportPath })).toBe(false)
    expect(grants.consumeExportPath({ format: 'csv', filePath: exportPath })).toBe(false)
  })

  it('expires stale import and export grants', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const grants = new ImportExportPathGrants()
      const importPath = grants.grantImportPath('C:\\Users\\krist\\Downloads\\vault.csv', 'csv')
      const exportPath = grants.grantExportPath('C:\\Users\\krist\\Downloads\\vault.json', 'klarkey-json')

      vi.advanceTimersByTime(10 * 60 * 1000 + 1)

      expect(grants.consumeImportPath({ format: 'csv', filePath: importPath })).toBe(false)
      expect(grants.consumeExportPath({ format: 'klarkey-json', filePath: exportPath })).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
