import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

const KEY_FILE = 'vault.key'
const algorithm = 'aes-256-gcm'

const decode = (value: string) => Buffer.from(value, 'base64')
const encode = (value: Buffer) => value.toString('base64')

export interface EncryptedPayload {
  iv: string
  ciphertext: string
  authTag: string
}

export class KeyManager {
  private cachedKey?: Buffer

  private getPath() {
    return join(app.getPath('userData'), KEY_FILE)
  }

  getKey() {
    if (this.cachedKey) {
      return this.cachedKey
    }

    const filePath = this.getPath()
    if (existsSync(filePath)) {
      const key = this.readExistingKey(filePath)
      this.cachedKey = key
      return key
    }

    const key = randomBytes(32)
    this.writeKey(filePath, key)
    this.cachedKey = key
    return key
  }

  private readExistingKey(filePath: string) {
    const stored = readFileSync(filePath)

    if (safeStorage.isEncryptionAvailable()) {
      try {
        return decode(safeStorage.decryptString(stored))
      } catch {
        const recovered = this.tryRecoverLegacyKey(stored)
        if (recovered) {
          this.writeKey(filePath, recovered)
          return recovered
        }

        copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`)
        const rotated = randomBytes(32)
        this.writeKey(filePath, rotated)
        return rotated
      }
    }

    return this.tryRecoverLegacyKey(stored) ?? stored
  }

  private tryRecoverLegacyKey(stored: Buffer) {
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

  private writeKey(filePath: string, key: Buffer) {
    mkdirSync(dirname(filePath), { recursive: true })
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(encode(key))
      : key
    writeFileSync(filePath, payload)
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
