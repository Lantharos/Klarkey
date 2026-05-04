import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeVaultKeyFromPasswordFile,
  decryptValue,
  deriveScryptPasswordKey,
  encodeVaultKeyForPasswordFile,
  encryptValue,
  writePrivateTextFile,
} from '@/electron/crypto'

describe('crypto helpers', () => {
  it('round-trips encrypted content', () => {
    const key = Buffer.alloc(32, 7)
    const payload = encryptValue(key, 'super-secret')

    expect(decryptValue(key, payload)).toBe('super-secret')
  })

  it('rejects malformed encrypted envelopes before decrypting', () => {
    const key = Buffer.alloc(32, 7)
    const payload = encryptValue(key, 'super-secret')

    expect(() => decryptValue(key, { ...payload, iv: Buffer.alloc(16).toString('base64') })).toThrow('encrypted IV')
    expect(() => decryptValue(key, { ...payload, authTag: '!!!!!!!!!!!!' })).toThrow('encrypted tag')
    expect(() => decryptValue(key, { ...payload, ciphertext: 'x'.repeat(24 * 1024 * 1024) })).toThrow('encrypted ciphertext')
  })

  it('encodes password-protected vault keys as base64 and decodes them back to 32 bytes', () => {
    const key = Buffer.alloc(32, 9)
    const encoded = encodeVaultKeyForPasswordFile(key)
    const decoded = decodeVaultKeyFromPasswordFile(encoded)

    expect(encoded).toHaveLength(44)
    expect(decoded.equals(key)).toBe(true)
  })

  it('rejects invalid password key payloads', () => {
    expect(() => decodeVaultKeyFromPasswordFile('not-a-valid-vault-key')).toThrow()
  })

  it('derives stable memory-hard password keys with stored scrypt parameters', () => {
    const salt = Buffer.alloc(32, 3)
    const kdf = { name: 'scrypt' as const, N: 1024, r: 8, p: 1, keyLength: 32 }
    const first = deriveScryptPasswordKey('correct horse battery staple', salt, kdf)
    const second = deriveScryptPasswordKey('correct horse battery staple', salt, kdf)

    expect(first.equals(second)).toBe(true)
    expect(first).toHaveLength(32)
  })

  it('writes private key files through private temp replacement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'klarkey-key-'))
    try {
      const keyPath = join(dir, 'vault.key')
      writePrivateTextFile(keyPath, 'first')
      writePrivateTextFile(keyPath, 'second')

      expect(readFileSync(keyPath, 'utf8')).toBe('second')
      if (process.platform !== 'win32') {
        expect(statSync(keyPath).mode & 0o077).toBe(0)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to replace linked key files on platforms with regular symlinks', () => {
    if (process.platform === 'win32') {
      return
    }

    const dir = mkdtempSync(join(tmpdir(), 'klarkey-key-link-'))
    try {
      const keyPath = join(dir, 'vault.key')
      const targetPath = join(dir, 'target.key')
      writeFileSync(targetPath, 'target', { encoding: 'utf8', mode: 0o600 })
      symlinkSync(targetPath, keyPath)

      expect(() => writePrivateTextFile(keyPath, 'replacement')).toThrow('linked Klarkey key file')
      expect(readFileSync(targetPath, 'utf8')).toBe('target')
      unlinkSync(keyPath)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
