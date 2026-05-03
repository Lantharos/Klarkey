import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { normalizeAppKeyBase64 } from '@ave-id/sdk/app-key'
import { canonicalJson } from '@/shared/canonical-json'
import {
  SYNC_DERIVATION_LABEL,
  SYNC_KEY_ALGORITHM,
  SYNC_KEY_DERIVATION,
  SYNC_SCHEMA_VERSION,
  type LocalSyncRecord,
  type PlainVaultRecord,
  type SyncRecord,
  type WrappedVaultKey,
} from '@/shared/sync'

const decode = (value: string) => Buffer.from(value, 'base64')
const encode = (value: Buffer) => value.toString('base64')

function decodeAppKey(appKey: string) {
  const normalized = normalizeAppKeyBase64(appKey)
  if (!normalized) {
    throw new Error('Ave app_key is missing.')
  }
  const key = decode(normalized)
  if (key.length < 32) {
    throw new Error('Ave app_key is too short for Klarkey sync.')
  }
  return key
}

export function deriveSyncKek(appKey: string) {
  return Buffer.from(hkdfSync('sha256', decodeAppKey(appKey), Buffer.alloc(0), SYNC_DERIVATION_LABEL, 32))
}

function aadFor(identityId: string, recordId: string, revision: number, schemaVersion = SYNC_SCHEMA_VERSION) {
  return Buffer.from(canonicalJson({
    identityId,
    recordId,
    revision,
    schemaVersion,
  }))
}

function recordHashPayload(record: PlainVaultRecord) {
  if ('updatedAt' in record) {
    const { updatedAt, ...payload } = record
    void updatedAt
    return payload
  }
  return record
}

export function hashPlainRecord(record: PlainVaultRecord) {
  return createHash('sha256').update(canonicalJson(recordHashPayload(record))).digest('base64')
}

export function wrapVaultKey(appKey: string, vaultKey: Buffer): WrappedVaultKey {
  const kek = deriveSyncKek(appKey)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kek, iv)
  const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()])
  const authTag = cipher.getAuthTag()
  kek.fill(0)

  return {
    iv: encode(iv),
    ciphertext: encode(ciphertext),
    authTag: encode(authTag),
    algorithm: SYNC_KEY_ALGORITHM,
    derivation: SYNC_KEY_DERIVATION,
    wrappedAt: Date.now(),
  }
}

export function unwrapVaultKey(appKey: string, wrapped: WrappedVaultKey) {
  if (wrapped.algorithm !== SYNC_KEY_ALGORITHM || wrapped.derivation !== SYNC_KEY_DERIVATION) {
    throw new Error('Unsupported Klarkey sync key envelope.')
  }

  const kek = deriveSyncKek(appKey)
  const decipher = createDecipheriv('aes-256-gcm', kek, decode(wrapped.iv))
  decipher.setAuthTag(decode(wrapped.authTag))
  const vaultKey = Buffer.concat([decipher.update(decode(wrapped.ciphertext)), decipher.final()])
  kek.fill(0)

  if (vaultKey.length !== 32) {
    vaultKey.fill(0)
    throw new Error('Invalid Klarkey sync vault key.')
  }

  return vaultKey
}

export function encryptPlainRecord(
  vaultKey: Buffer,
  identityId: string,
  deviceId: string,
  revision: number,
  record: PlainVaultRecord,
): LocalSyncRecord {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', vaultKey, iv)
  cipher.setAAD(aadFor(identityId, record.recordId, revision))
  const ciphertext = Buffer.concat([cipher.update(canonicalJson(record), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    recordId: record.recordId,
    revision,
    deviceId,
    deletedAt: record.deletedAt,
    ciphertext: encode(ciphertext),
    iv: encode(iv),
    authTag: encode(authTag),
    contentHash: hashPlainRecord(record),
    schemaVersion: SYNC_SCHEMA_VERSION,
  }
}

export function decryptSyncRecord(vaultKey: Buffer, identityId: string, record: SyncRecord): PlainVaultRecord {
  const decipher = createDecipheriv('aes-256-gcm', vaultKey, decode(record.iv))
  decipher.setAAD(aadFor(identityId, record.recordId, record.revision, record.schemaVersion))
  decipher.setAuthTag(decode(record.authTag))
  const plaintext = Buffer.concat([decipher.update(decode(record.ciphertext)), decipher.final()]).toString('utf8')
  const parsed = JSON.parse(plaintext) as PlainVaultRecord
  const actualHash = decode(hashPlainRecord(parsed))
  const expectedHash = decode(record.contentHash)
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new Error('Klarkey sync record hash mismatch.')
  }
  return parsed
}
