import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataPath = ''

beforeEach(() => {
  vi.resetModules()
  userDataPath = mkdtempSync(join(tmpdir(), 'klarkey-key-manager-'))
  vi.doMock('electron', () => ({
    app: {
      getPath: vi.fn(() => userDataPath),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      decryptString: vi.fn(() => {
        throw new Error('decrypt failed')
      }),
      encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
    },
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  if (userDataPath) {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

describe('KeyManager keyfile recovery', () => {
  it('does not rotate to a new vault key when an existing keyfile is unrecoverable', async () => {
    const { KeyManager } = await import('@/electron/crypto')
    const keyPath = join(userDataPath, 'vault.key')
    writeFileSync(keyPath, 'not a recoverable vault key', 'utf8')

    const manager = new KeyManager()

    expect(manager.unlockFromSystem()).toBe(false)
    expect(manager.isKeyInMemory()).toBe(false)
    expect(readFileSync(keyPath, 'utf8')).toBe('not a recoverable vault key')
  })

  it('rejects oversized key files before decrypting', async () => {
    const { KeyManager } = await import('@/electron/crypto')
    const electron = await import('electron')
    const keyPath = join(userDataPath, 'vault.key')
    writeFileSync(keyPath, 'x'.repeat(256 * 1024 + 1), 'utf8')

    const manager = new KeyManager()

    expect(manager.unlockFromSystem()).toBe(false)
    expect(manager.isKeyInMemory()).toBe(false)
    expect(electron.safeStorage.decryptString).not.toHaveBeenCalled()
  })

  it('refuses to initialize a new vault over any existing keyfile', async () => {
    const { KeyManager } = await import('@/electron/crypto')
    const keyPath = join(userDataPath, 'vault.key')
    writeFileSync(keyPath, 'existing key material', 'utf8')

    const manager = new KeyManager()

    expect(() => manager.setupNewVault()).toThrow('vault key already exists')
    expect(readFileSync(keyPath, 'utf8')).toBe('existing key material')
  })

  it('does not set a master password over a locked existing keyfile', async () => {
    const { KeyManager } = await import('@/electron/crypto')
    const keyPath = join(userDataPath, 'vault.key')
    writeFileSync(keyPath, 'existing key material', 'utf8')

    const manager = new KeyManager()

    expect(() => manager.setupWithMasterPassword('correct horse battery staple')).toThrow('Vault must be unlocked')
    expect(readFileSync(keyPath, 'utf8')).toBe('existing key material')
  })

  it('rejects password keyfiles with downgraded scrypt parameters', async () => {
    const {
      KeyManager,
      deriveScryptPasswordKey,
      encodeVaultKeyForPasswordFile,
      encryptValue,
    } = await import('@/electron/crypto')
    const keyPath = join(userDataPath, 'vault.key')
    const vaultKey = Buffer.alloc(32, 7)
    const salt = Buffer.alloc(32, 5)
    const weakKdf = { name: 'scrypt' as const, N: 1024, r: 8, p: 1, keyLength: 32 }
    const derivedKey = deriveScryptPasswordKey('correct horse battery staple', salt, weakKdf)
    const encryptedKey = encryptValue(derivedKey, encodeVaultKeyForPasswordFile(vaultKey))
    derivedKey.fill(0)

    writeFileSync(
      keyPath,
      JSON.stringify({
        version: 3,
        method: 'password',
        salt: salt.toString('base64'),
        kdf: weakKdf,
        encryptedKey,
      }),
      'utf8',
    )

    const manager = new KeyManager()

    expect(manager.unlockWithPassword('correct horse battery staple')).toBe(false)
    expect(manager.isKeyInMemory()).toBe(false)
  })

  it('rejects password keyfiles with undersized scrypt salts', async () => {
    const {
      KeyManager,
      deriveScryptPasswordKey,
      encodeVaultKeyForPasswordFile,
      encryptValue,
    } = await import('@/electron/crypto')
    const keyPath = join(userDataPath, 'vault.key')
    const vaultKey = Buffer.alloc(32, 8)
    const salt = Buffer.alloc(8, 5)
    const kdf = { name: 'scrypt' as const, N: 16384, r: 8, p: 1, keyLength: 32 }
    const derivedKey = deriveScryptPasswordKey('correct horse battery staple', salt, kdf)
    const encryptedKey = encryptValue(derivedKey, encodeVaultKeyForPasswordFile(vaultKey))
    derivedKey.fill(0)

    writeFileSync(
      keyPath,
      JSON.stringify({
        version: 3,
        method: 'password',
        salt: salt.toString('base64'),
        kdf,
        encryptedKey,
      }),
      'utf8',
    )

    const manager = new KeyManager()

    expect(manager.unlockWithPassword('correct horse battery staple')).toBe(false)
    expect(manager.isKeyInMemory()).toBe(false)
  })
})
