import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

const KEY_FILE = 'vault.key'
const algorithm = 'aes-256-gcm'
const KEY_FILE_VERSION = 2
const PASSWORD_KEY_FILE_VERSION = 3
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 3
const SCRYPT_KEY_LENGTH = 32
const SCRYPT_MAXMEM = 128 * 1024 * 1024
const SCRYPT_MAX_N = 65536
const SCRYPT_MAX_P = 8
const PASSWORD_FILE_MIN_SCRYPT_N = 16384
const PASSWORD_FILE_MIN_SALT_LENGTH = 16
const PASSWORD_FILE_MAX_SALT_LENGTH = 64
const KEY_FILE_MAX_BYTES = 256 * 1024
const GCM_IV_BYTES = 12
const GCM_AUTH_TAG_BYTES = 16
const MAX_ENCRYPTED_VALUE_BYTES = 16 * 1024 * 1024
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const decode = (value: string) => Buffer.from(value, 'base64')
const encode = (value: Buffer) => value.toString('base64')

function decodeBase64Bytes(value: string, maxBytes: number, label: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    !base64Pattern.test(value)
  ) {
    throw new Error(`Invalid Klarkey encrypted ${label}.`)
  }

  const decoded = decode(value)
  if (decoded.length > maxBytes) {
    throw new Error(`Invalid Klarkey encrypted ${label}.`)
  }
  return decoded
}

function expectByteLength(value: Buffer, length: number, label: string) {
  if (value.length !== length) {
    value.fill(0)
    throw new Error(`Invalid Klarkey encrypted ${label}.`)
  }
  return value
}

function assertReadablePrivateFile(filePath: string) {
  const stats = lstatSync(filePath)
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > KEY_FILE_MAX_BYTES) {
    throw new Error('Invalid Klarkey key file.')
  }
}

function openReadablePrivateFile(filePath: string) {
  assertReadablePrivateFile(filePath)
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const fd = openSync(filePath, constants.O_RDONLY | noFollow)
  const stats = fstatSync(fd)
  if (!stats.isFile() || stats.size <= 0 || stats.size > KEY_FILE_MAX_BYTES) {
    closeSync(fd)
    throw new Error('Invalid Klarkey key file.')
  }
  return fd
}

function readPrivateFileText(filePath: string) {
  const fd = openReadablePrivateFile(filePath)
  try {
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function writePrivateFile(filePath: string, value: Buffer | string, encoding?: BufferEncoding) {
  const folder = dirname(filePath)
  mkdirSync(folder, { recursive: true })
  const tempPath = join(folder, `.klarkey-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
  const fd = openSync(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try {
    writeFileSync(fd, value, encoding ? { encoding } : undefined)
    try {
      fchmodSync(fd, 0o600)
    } catch {
      void 0
    }
  } finally {
    closeSync(fd)
  }

  try {
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error('Refusing to replace a linked Klarkey key file.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      try {
        unlinkSync(tempPath)
      } catch {
        void 0
      }
      throw error
    }
  }

  try {
    renameSync(tempPath, filePath)
    try {
      chmodSync(filePath, 0o600)
    } catch {
      void 0
    }
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      void 0
    }
    throw error
  }
}

export function writePrivateTextFile(filePath: string, value: string) {
  writePrivateFile(filePath, value, 'utf8')
}

export interface EncryptedPayload {
  iv: string
  ciphertext: string
  authTag: string
}

type ScryptPasswordKdf = {
  name: 'scrypt'
  N: number
  r: number
  p: number
  keyLength: number
}

type KeyFileFormat =
  | { version: 2; method: 'safeStorage'; data: string }
  | { version: 3; method: 'password'; salt: string; kdf: ScryptPasswordKdf; encryptedKey: EncryptedPayload }

const defaultPasswordKdf = (): ScryptPasswordKdf => ({
  name: 'scrypt',
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  keyLength: SCRYPT_KEY_LENGTH,
})

export const encodeVaultKeyForPasswordFile = (key: Buffer) => encode(key)

export const decodeVaultKeyFromPasswordFile = (value: string) => {
  const decoded = decode(value)
  if (decoded.length === 32) {
    return decoded
  }

  throw new Error('Invalid Klarkey vault key.')
}

const isPowerOfTwo = (value: number) => value > 1 && (value & (value - 1)) === 0
const isSafePositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0

function assertScryptKdf(kdf: ScryptPasswordKdf) {
  if (
    kdf.name !== 'scrypt' ||
    !isSafePositiveInteger(kdf.N) ||
    !isSafePositiveInteger(kdf.r) ||
    !isSafePositiveInteger(kdf.p) ||
    kdf.keyLength !== SCRYPT_KEY_LENGTH ||
    !isPowerOfTwo(kdf.N) ||
    kdf.N > SCRYPT_MAX_N ||
    kdf.p > SCRYPT_MAX_P ||
    128 * kdf.N * kdf.r > SCRYPT_MAXMEM
  ) {
    throw new Error('Unsupported Klarkey password KDF.')
  }
}

function isSupportedPasswordFileScryptKdf(kdf: ScryptPasswordKdf, salt: Buffer) {
  try {
    assertScryptKdf(kdf)
  } catch {
    return false
  }

  return kdf.N >= PASSWORD_FILE_MIN_SCRYPT_N &&
    salt.length >= PASSWORD_FILE_MIN_SALT_LENGTH &&
    salt.length <= PASSWORD_FILE_MAX_SALT_LENGTH
}

export const deriveScryptPasswordKey = (password: string, salt: Buffer, kdf: ScryptPasswordKdf = defaultPasswordKdf()) => {
  assertScryptKdf(kdf)
  return scryptSync(password, salt, kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT_MAXMEM,
  })
}

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
      const raw = readPrivateFileText(filePath)
      const parsed = JSON.parse(raw)
      return (parsed?.version === KEY_FILE_VERSION || parsed?.version === PASSWORD_KEY_FILE_VERSION) && parsed?.method === 'password'
    } catch {
      return false
    }
  }

  unlockFromSystem(): boolean {
    const filePath = this.getPath()
    if (!existsSync(filePath)) {
      return false
    }

    let raw: string
    try {
      raw = readPrivateFileText(filePath)
    } catch {
      return false
    }

    try {
      const parsed = JSON.parse(raw) as KeyFileFormat
      if (parsed.version !== KEY_FILE_VERSION || parsed.method !== 'safeStorage' || !safeStorage.isEncryptionAvailable()) {
        return false
      }
      const key = decode(safeStorage.decryptString(Buffer.from(parsed.data, 'base64')))
      if (key.length !== 32) {
        return false
      }
      this.cachedKey = key
      return true
    } catch {
      return false
    }
  }

  unlockWithPassword(password: string): boolean {
    const filePath = this.getPath()
    if (!existsSync(filePath)) {
      return false
    }

    try {
      const parsed = JSON.parse(readPrivateFileText(filePath)) as KeyFileFormat
      const result = this.decryptPasswordProtectedKey(password, parsed)
      if (!result) {
        return false
      }

      this.cachedKey = result.key
      if (result.shouldMigrate) {
        this.persistKeyWithPassword(result.key, password)
      }
      return true
    } catch {
      return false
    }
  }

  setupNewVault(): Buffer {
    if (this.hasKeyFile()) {
      throw new Error('A Klarkey vault key already exists.')
    }

    const key = randomBytes(32)
    this.persistKey(key)
    this.cachedKey = key
    return key
  }

  setupWithMasterPassword(password: string): Buffer {
    if (this.isKeyInMemory()) {
      this.persistKeyWithPassword(this.cachedKey!, password)
      return this.cachedKey!
    }

    const key = this.hasKeyFile() ? null : randomBytes(32)
    if (!key) {
      throw new Error('Vault must be unlocked before changing key protection.')
    }

    this.persistKeyWithPassword(key, password)
    this.cachedKey = key
    return key
  }

  changeMasterPassword(currentPassword: string, newPassword: string): boolean {
    const parsed = this.readPasswordKeyFile()
    if (!parsed) {
      return false
    }

    const decrypted = this.decryptPasswordProtectedKey(currentPassword, parsed)
    if (!decrypted) {
      return false
    }

    const actualKey = this.isKeyInMemory() ? this.cachedKey! : decrypted.key
    this.persistKeyWithPassword(actualKey, newPassword)
    this.cachedKey = actualKey
    if (decrypted.key !== actualKey) {
      decrypted.key.fill(0)
    }
    return true
  }

  removeMasterPassword(currentPassword: string): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }

    const parsed = this.readPasswordKeyFile()
    if (!parsed) {
      return false
    }

    const decrypted = this.decryptPasswordProtectedKey(currentPassword, parsed)
    if (!decrypted) {
      return false
    }

    const actualKey = this.isKeyInMemory() ? this.cachedKey! : decrypted.key
    this.persistKey(actualKey)
    this.cachedKey = actualKey
    if (decrypted.key !== actualKey) {
      decrypted.key.fill(0)
    }
    return true
  }

  evictKey() {
    if (this.cachedKey) {
      this.cachedKey.fill(0)
      this.cachedKey = null
    }
  }

  private readPasswordKeyFile(): KeyFileFormat | undefined {
    const filePath = this.getPath()
    try {
      return JSON.parse(readPrivateFileText(filePath)) as KeyFileFormat
    } catch {
      return undefined
    }
  }

  private decryptPasswordProtectedKey(password: string, parsed: KeyFileFormat): { key: Buffer; shouldMigrate: boolean } | undefined {
    if (parsed.method !== 'password') {
      return undefined
    }

    let derivedKey: Buffer | undefined
    try {
      if (parsed.version !== PASSWORD_KEY_FILE_VERSION) {
        return undefined
      }
      const salt = decode(parsed.salt)
      if (!isSupportedPasswordFileScryptKdf(parsed.kdf, salt)) {
        return undefined
      }
      derivedKey = deriveScryptPasswordKey(password, salt, parsed.kdf)

      const decryptedKey = decryptValue(derivedKey, parsed.encryptedKey)
      return {
        key: decodeVaultKeyFromPasswordFile(decryptedKey),
        shouldMigrate: false,
      }
    } catch {
      return undefined
    } finally {
      derivedKey?.fill(0)
    }
  }

  private persistKey(key: Buffer) {
    const filePath = this.getPath()
    mkdirSync(dirname(filePath), { recursive: true })

    if (safeStorage.isEncryptionAvailable()) {
      this.persistKeyWithSafeStorage(key)
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
    const kdf = defaultPasswordKdf()
    const derivedKey = deriveScryptPasswordKey(password, salt, kdf)
    const encryptedKey = encryptValue(derivedKey, encodeVaultKeyForPasswordFile(key))
    derivedKey.fill(0)

    const payload: KeyFileFormat = {
      version: PASSWORD_KEY_FILE_VERSION,
      method: 'password',
      salt: encode(salt),
      kdf,
      encryptedKey,
    }

    writePrivateTextFile(filePath, JSON.stringify(payload, null, 2))
  }

  private persistKeyWithSafeStorage(key: Buffer) {
    const filePath = this.getPath()
    mkdirSync(dirname(filePath), { recursive: true })

    const encryptedData = safeStorage.encryptString(encode(key))
    const payload: KeyFileFormat = {
      version: KEY_FILE_VERSION,
      method: 'safeStorage',
      data: encryptedData.toString('base64'),
    }

    writePrivateTextFile(filePath, JSON.stringify(payload, null, 2))
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
  const iv = expectByteLength(decodeBase64Bytes(payload.iv, GCM_IV_BYTES, 'IV'), GCM_IV_BYTES, 'IV')
  const authTag = expectByteLength(decodeBase64Bytes(payload.authTag, GCM_AUTH_TAG_BYTES, 'tag'), GCM_AUTH_TAG_BYTES, 'tag')
  const ciphertext = decodeBase64Bytes(payload.ciphertext, MAX_ENCRYPTED_VALUE_BYTES, 'ciphertext')
  try {
    const decipher = createDecipheriv(algorithm, key, iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
  } finally {
    iv.fill(0)
    authTag.fill(0)
    ciphertext.fill(0)
  }
}
