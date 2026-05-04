import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createOnePuxEntryValidator } from '@/electron/import/import-1pux'
import { importCsv } from '@/electron/import/import-csv'
import { importKlarkeyJson } from '@/electron/import/import-klarkey'
import { importItems, MAX_IMPORT_ITEMS, readImportFileText } from '@/electron/import/import-utils'
import { importVault, isWindowsAlternateDataStreamImportPath } from '@/electron/import'
import type { VaultRepository } from '@/electron/repository'
import type { CreateItemInput } from '@/shared/types'

describe('import hardening', () => {
  it('rejects unsafe 1Password archive entries before extraction', () => {
    const validate = createOnePuxEntryValidator()

    expect(() => validate({ fileName: 'export.data', uncompressedSize: 1024 })).not.toThrow()
    expect(() => validate({ fileName: '../export.data', uncompressedSize: 1 })).toThrow('unsafe file path')
    expect(() => validate({ fileName: 'safe/..', uncompressedSize: 1 })).toThrow('unsafe file path')
    expect(() => validate({ fileName: 'C:/Users/person/export.data', uncompressedSize: 1 })).toThrow('unsafe file path')
    expect(() => validate({ fileName: 'export.data', uncompressedSize: 11, externalFileAttributes: 0o120000 * 0x10000 })).toThrow('unsafe file path')
    expect(() => validate({ fileName: 'secret.txt', uncompressedSize: 1, isEncrypted: () => true })).toThrow('Encrypted')
  })

  it('rejects oversized 1Password exports before extraction', () => {
    const validate = createOnePuxEntryValidator()

    expect(() => validate({ fileName: 'export.data', uncompressedSize: 33 * 1024 * 1024 })).toThrow('too large')
  })

  it('validates extracted 1Password export data before reading it', async () => {
    const source = await import('@/electron/import/import-1pux')
    const text = source.import1pux.toString()

    expect(text).toContain('lstatSync(dataPath)')
    expect(text).toContain('dataStats.isSymbolicLink()')
    expect(text).toContain('dataStats.size > MAX_1PUX_EXPORT_DATA_BYTES')
  })

  it('returns a failed import result for malformed importer input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const filePath = join(dir, 'vault.json')
    writeFileSync(filePath, '{bad json', 'utf8')

    try {
      const result = await importVault({} as VaultRepository, {
        format: 'bitwarden-json',
        filePath,
      })

      expect(result).toMatchObject({
        success: false,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects oversized import files before format detection reads them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const filePath = join(dir, 'huge.json')
    const fd = openSync(filePath, 'w')
    try {
      ftruncateSync(fd, 129 * 1024 * 1024)
    } finally {
      closeSync(fd)
    }

    try {
      const result = await importVault({} as VaultRepository, {
        format: 'auto',
        filePath,
      })

      expect(result).toMatchObject({
        success: false,
        errorCount: 1,
        message: 'That vault export is too large to import safely.',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects import file symlinks before reading them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const target = join(dir, 'target.csv')
    const link = join(dir, 'vault.csv')

    try {
      writeFileSync(target, 'url,username,password\nhttps://example.com,person,secret', 'utf8')
      try {
        symlinkSync(target, link)
      } catch {
        return
      }

      const result = await importVault({} as VaultRepository, {
        format: 'csv',
        filePath: link,
      })

      expect(result).toMatchObject({
        success: false,
        importedCount: 0,
        errorCount: 1,
        message: 'Choose a normal vault export file to import.',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the same no-follow import reader inside direct importers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const target = join(dir, 'target.csv')
    const link = join(dir, 'vault.csv')

    try {
      writeFileSync(target, 'url,username,password\nhttps://example.com,person,secret', 'utf8')
      try {
        symlinkSync(target, link)
      } catch {
        return
      }

      expect(() => readImportFileText(link)).toThrow('normal vault export file')
      await expect(importCsv({} as VaultRepository, link)).rejects.toThrow('normal vault export file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects Windows alternate data stream import paths', () => {
    const streamPath = 'C:\\Users\\krist\\Downloads\\vault.csv:hidden'

    if (process.platform === 'win32') {
      expect(isWindowsAlternateDataStreamImportPath(streamPath)).toBe(true)
    } else {
      expect(isWindowsAlternateDataStreamImportPath(streamPath)).toBe(false)
    }
  })

  it('rejects imported items that fail create-item bounds before repository writes', () => {
    const createItem = vi.fn()
    const repository = { createItem } as unknown as VaultRepository

    const result = importItems(repository, [
      {
        itemType: 'login',
        itemName: 'x'.repeat(257),
        username: 'person@example.com',
      } as CreateItemInput,
    ])

    expect(createItem).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      importedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      message: '1 errors.',
    })
  })

  it('passes sanitized imported items through to the repository', () => {
    const createItem = vi.fn(() => ({
      status: 'success',
      title: 'Item imported',
      message: 'Item imported.',
    }))
    const repository = { createItem } as unknown as VaultRepository
    const input = {
      itemType: 'login',
      itemName: 'Example',
      username: 'person@example.com',
      websites: ['https://example.com'],
    } satisfies CreateItemInput

    const result = importItems(repository, [input])

    expect(createItem).toHaveBeenCalledWith(input)
    expect(result).toMatchObject({
      success: true,
      importedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      message: 'Imported 1 items.',
    })
  })

  it('preserves quoted CSV commas, escaped quotes, and embedded newlines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const filePath = join(dir, 'vault.csv')
    const createItem = vi.fn(() => ({
      status: 'success',
      title: 'Item imported',
      message: 'Item imported.',
    }))
    const repository = { createItem } as unknown as VaultRepository

    writeFileSync(
      filePath,
      'item_name,account,secret,notes,website\r\n"Example, Inc","person@example.com","p""ass","line one\r\nline two","https://example.com"',
      'utf8',
    )

    try {
      const result = await importCsv(repository, filePath)

      expect(result.importedCount).toBe(1)
      expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
        itemName: 'Example, Inc',
        username: 'person@example.com',
        password: 'p"ass',
        notes: 'line one\r\nline two',
        websites: ['https://example.com'],
      }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects oversized item batches before repository writes', () => {
    const createItem = vi.fn()
    const repository = { createItem } as unknown as VaultRepository
    const inputs = Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, index) => ({
      itemType: 'login',
      itemName: `Imported ${index}`,
    })) as CreateItemInput[]

    const result = importItems(repository, inputs)

    expect(createItem).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: false,
      importedCount: 0,
      errorCount: 1,
      message: `That export contains more than ${MAX_IMPORT_ITEMS} items.`,
    })
  })

  it('counts malformed imported item names as row errors without aborting the batch', () => {
    const createItem = vi.fn(() => ({
      status: 'success',
      title: 'Item imported',
      message: 'Item imported.',
    }))
    const repository = { createItem } as unknown as VaultRepository
    const validInput = {
      itemType: 'login',
      itemName: 'Still imported',
      username: 'person@example.com',
    } satisfies CreateItemInput

    const result = importItems(repository, [
      {
        itemType: 'login',
        itemName: { label: 'not a string' } as unknown as string,
      } as CreateItemInput,
      validInput,
    ])

    expect(createItem).toHaveBeenCalledTimes(1)
    expect(createItem).toHaveBeenCalledWith(validInput)
    expect(result).toMatchObject({
      success: true,
      importedCount: 1,
      skippedCount: 0,
      errorCount: 1,
      message: 'Imported 1 items. 1 errors.',
    })
  })

  it('restores SSH private keys from Klarkey JSON exports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const filePath = join(dir, 'vault.json')
    const createItem = vi.fn(() => ({
      status: 'success',
      title: 'Item imported',
      message: 'Item imported.',
    }))
    const repository = { createItem } as unknown as VaultRepository

    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        app: 'klarkey',
        exportedAt: new Date().toISOString(),
        items: [
          {
            id: 'item_ssh',
            itemType: 'ssh-key',
            itemName: 'Deploy key',
            sshAlgorithm: 'ed25519',
            sshFingerprint: 'SHA256:abc',
            sshPublicKey: 'ssh-ed25519 AAAA person@example.com',
            sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----',
            sshComment: 'person@example.com',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
      'utf8',
    )

    try {
      const result = await importKlarkeyJson(repository, filePath)

      expect(result.importedCount).toBe(1)
      expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
        itemType: 'ssh-key',
        itemName: 'Deploy key',
        sshPrivateKey: expect.stringContaining('OPENSSH PRIVATE KEY'),
      }))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects Klarkey JSON exports with too many items before repository writes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-import-'))
    const filePath = join(dir, 'vault.json')
    const createItem = vi.fn()
    const repository = { createItem } as unknown as VaultRepository

    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        app: 'klarkey',
        exportedAt: new Date().toISOString(),
        items: Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, index) => ({
          id: `item_${index}`,
          itemType: 'login',
          itemName: `Login ${index}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      }),
      'utf8',
    )

    try {
      const result = await importKlarkeyJson(repository, filePath)

      expect(createItem).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        success: false,
        importedCount: 0,
        errorCount: 1,
        message: `That export contains more than ${MAX_IMPORT_ITEMS} items.`,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
