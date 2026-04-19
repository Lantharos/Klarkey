import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

const KEY_FILE = 'vault.key'
const algorithm = 'aes-256-gcm'
const KEY_FILE_VERSION = 2
const PBKDF2_ITERATIONS = 600000
const PBKDF2_KEY_LENGTH = 32
const PBKDF2_DIGEST = 'sha256'

const decode = (value: string) => Buffer.from(value, 'base64')
const encode = (value: Buffer) => value.toString('base64')

export interface EncryptedPayload {
  iv: string
  ciphertext: string
  authTag: string
}

type KeyFileFormat =
  | { version: 2; method: 'safeStorage'; data: string }
  | { version: 2; method: 'password'; salt: string; keyVerification: string; encryptedKey: EncryptedPayload }

export class KeyManager {
  private cachedKey: Buffer | null = null
  private keyFolderPath: string

  constructor() {
    this.keyFolderPath = app.getPath('userData')
  }

  private getPath() {
    return join(this.keyFolderPath, KEY_FILE)
  }

  isKeyInMemory(): boolean {
    return this.cachedKey !== null && this.cachedKey.length === 32
  }

  getKey(): Buffer {
    if (!this.isKeyInMemory()) {
      throw new Error('Vault is locked. Unlock the vault before accessing the key.')
    }
    return this.cachedKey!
  }

  isSafeStorageAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  hasKeyFile(): boolean {
    return existsSync(this.getPath())
  }

  hasMasterPassword(): boolean {
    const filePath = this.getPath()
    if (!existsSync(filePath)) {
      return false
    }

    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed?.version === KEY_FILE_VERSION && parsed?.method === 'password'
    } catch {
      return false
    }
  }

  unlockFromSystem(): boolean {
    const filePath = this.getPath()
    if (!existsSync(filePath)) {
      return false
    }

    const raw = readFileSync(filePath, 'utf8')

    try {
      const parsed = JSON.parse(raw)
      if (parsed?.version === KEY_FILE_VERSION) {
        if (parsed.method === 'safeStorage') {
          if (!safeStorage.isEncryptionAvailable()) {
            return false
          }
          const key = decode(safeStorage.decryptString(Buffer.from(parsed.data, 'base64')))
          if (key.length !== 32) {
            return false
          }
          this.cachedKey = key
          return true
        }

        if (parsed.method === 'password') {
          return false
        }
      }
    } catch {
      // Not versioned format, try legacy
    }

    return this.tryUnlockLegacy(filePath)
  }

  unlockWithPassword(password: string): boolean {
    const filePath = this.getPath()
    if (!existsSync(filePath)) {
      return false
    }

    const raw = readFileSync(filePath, 'utf8')

    try {
      const parsed = JSON.parse(raw)
      if (parsed?.version === KEY_FILE_VERSION && parsed.method === 'password') {
        const salt = decode(parsed.salt)
        const derivedKey = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
        const verificationHash = createHash('sha256').update(derivedKey).digest('base64')

        if (verificationHash !== parsed.keyVerification) {
          derivedKey.fill(0)
          return false
        }

        try {
          const decryptedKey = decryptValue(derivedKey, parsed.encryptedKey)
          this.cachedKey = Buffer.from(decryptedKey, 'utf8')
          return this.cachedKey.length === 32
        } finally {
          derivedKey.fill(0)
        }
      }
    } catch {
      return false
    }

    return false
  }

  setupNewVault(): Buffer {
    const key = randomBytes(32)
    this.persistKey(key)
    this.cachedKey = key
    return key
  }

  setupWithMasterPassword(password: string): Buffer {
    if (this.isKeyInMemory()) {
      this.migrateToPassword(this.cachedKey!, password)
      return this.cachedKey!
    }

    const key = this.hasKeyFile() ? null : randomBytes(32)
    if (!key) {
      return this.cachedKey!
    }

    this.persistKeyWithPassword(key, password)
    this.cachedKey = key
    return key
  }

  changeMasterPassword(currentPassword: string, newPassword: string): boolean {
    const currentSalt = this.readPasswordSalt()
    const currentDerivedKey = pbkdf2Sync(currentPassword, decode(currentSalt), PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    const verificationHash = createHash('sha256').update(currentDerivedKey).digest('base64')

    if (verificationHash !== this.readPasswordVerification()) {
      currentDerivedKey.fill(0)
      return false
    }

    const actualKey = this.isKeyInMemory()
      ? this.cachedKey!
      : Buffer.from(decryptValue(currentDerivedKey, this.readPasswordEncryptedKey()), 'utf8')

    currentDerivedKey.fill(0)
    this.persistKeyWithPassword(actualKey, newPassword)
    this.cachedKey = actualKey
    return true
  }

  removeMasterPassword(currentPassword: string): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }

    const currentSalt = this.readPasswordSalt()
    const currentDerivedKey = pbkdf2Sync(currentPassword, decode(currentSalt), PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    const verificationHash = createHash('sha256').update(currentDerivedKey).digest('base64')

    if (verificationHash !== this.readPasswordVerification()) {
      currentDerivedKey.fill(0)
      return false
    }

    const actualKey = this.isKeyInMemory()
      ? this.cachedKey!
      : Buffer.from(decryptValue(currentDerivedKey, this.readPasswordEncryptedKey()), 'utf8')

    currentDerivedKey.fill(0)
    this.persistKey(actualKey)
    this.cachedKey = actualKey
    return true
  }

  evictKey() {
    if (this.cachedKey) {
      this.cachedKey.fill(0)
      this.cachedKey = null
    }
  }

  private readPasswordSalt(): string {
    const filePath = this.getPath()
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.salt
  }

  private readPasswordVerification(): string {
    const filePath = this.getPath()
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.keyVerification
  }

  private readPasswordEncryptedKey(): EncryptedPayload {
    const filePath = this.getPath()
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed.encryptedKey as EncryptedPayload
  }

  private tryUnlockLegacy(filePath: string): boolean {
    const stored = readFileSync(filePath)

    if (safeStorage.isEncryptionAvailable()) {
      try {
        const key = decode(safeStorage.decryptString(stored))
        if (key.length === 32) {
          this.cachedKey = key
          this.migrateToSafeStorage(key)
          return true
        }
      } catch {
        const recovered = this.tryRecoverLegacyKey(stored)
        if (recovered) {
          this.persistKey(recovered)
          this.cachedKey = recovered
          return true
        }

        copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`)
        const rotated = randomBytes(32)
        this.persistKey(rotated)
        this.cachedKey = rotated
        return true
      }
    }

    const recovered = this.tryRecoverLegacyKey(stored)
    if (recovered) {
      this.persistKey(recovered)
      this.cachedKey = recovered
      return true
    }

    return false
  }

  private tryRecoverLegacyKey(stored: Buffer): Buffer | undefined {
    if (stored.length === 32) {
      return stored
    }

    const text = stored.toString('utf8').trim()
    if (!text) {
      return undefined
    }

    try {
      const recovered = decode(text)
      if (recovered.length === 32) {
        return recovered
      }
    } catch {
      return undefined
    }

    return undefined
  }

  private persistKey(key: Buffer) {
    const filePath = this.getPath()
    mkdirSync(dirname(filePath), { recursive: true })

    if (safeStorage.isEncryptionAvailable()) {
      this.migrateToSafeStorage(key)
      return
    }

    throw new Error(
      'Secure storage is not available on this system. Please set a master password to protect your vault.',
    )
  }

  private persistKeyWithPassword(key: Buffer, password: string) {
    const filePath = this.getPath()
    mkdirSync(dirname(filePath), { recursive: true })

    const salt = randomBytes(32)
    const derivedKey = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST)
    const keyVerification = createHash('sha256').update(derivedKey).digest('base64')
    const encryptedKey = encryptValue(derivedKey, key.toString('base64'))
    derivedKey.fill(0)

    const payload: KeyFileFormat = {
      version: KEY_FILE_VERSION,
      method: 'password',
      salt: encode(salt),
      keyVerification,
      encryptedKey,
    }

    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  }

  private migrateToSafeStorage(key: Buffer) {
    const filePath = this.getPath()
    mkdirSync(dirname(filePath), { recursive: true })

    const encryptedData = safeStorage.encryptString(encode(key))
    const payload: KeyFileFormat = {
      version: KEY_FILE_VERSION,
      method: 'safeStorage',
      data: encryptedData.toString('base64'),
    }

    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  }

  private migrateToPassword(key: Buffer, password: string) {
    this.persistKeyWithPassword(key, password)
  }
}

export const encryptValue = (key: Buffer, value: string): EncryptedPayload => {
  const iv = randomBytes(12)
  const cipher = createCipheriv(algorithm, key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    iv: encode(iv),
    ciphertext: encode(ciphertext),
    authTag: encode(authTag),
  }
}

export const decryptValue = (key: Buffer, payload: EncryptedPayload) => {
  const decipher = createDecipheriv(algorithm, key, decode(payload.iv))
  decipher.setAuthTag(decode(payload.authTag))
  const plaintext = Buffer.concat([
    decipher.update(decode(payload.ciphertext)),
    decipher.final(),
  ]).toString('utf8')

  return plaintext
}