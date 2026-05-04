import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { normalizeAppKeyBase64 } from '@ave-id/sdk/app-key'
import { canonicalJson } from '@/shared/canonical-json'
import {
  SYNC_DERIVATION_LABEL,
  SYNC_KEY_ALGORITHM,
  SYNC_KEY_DERIVATION,
  SYNC_SCHEMA_VERSION,
  validatePlainVaultRecord,
  type LocalSyncRecord,
  type PlainVaultRecord,
  type SyncRecord,
  type WrappedVaultKey,
} from '@/shared/sync'

const decode = (value: string) => Buffer.from(value, 'base64')
const encode = (value: Buffer) => value.toString('base64')
const GCM_IV_BYTES = 12
const GCM_AUTH_TAG_BYTES = 16
const WRAPPED_VAULT_KEY_BYTES = 32
const MAX_SYNC_RECORD_CIPHERTEXT_BYTES = 8 * 1024 * 1024
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function decodeBase64Bytes(value: string, maxBytes: number, label: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    !base64Pattern.test(value)
  ) {
    throw new Error(`Invalid Klarkey sync ${label}.`)
  }

  const decoded = decode(value)
  if (decoded.length > maxBytes) {
    throw new Error(`Invalid Klarkey sync ${label}.`)
  }
  return decoded
}

function expectByteLength(value: Buffer, length: number, label: string) {
  if (value.length !== length) {
    value.fill(0)
    throw new Error(`Invalid Klarkey sync ${label}.`)
  }
  return value
}

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
  const sourceKey = decodeAppKey(appKey)
  try {
    return Buffer.from(hkdfSync('sha256', sourceKey, Buffer.alloc(0), SYNC_DERIVATION_LABEL, 32))
  } finally {
    sourceKey.fill(0)
  }
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
  try {
    const iv = randomBytes(GCM_IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', kek, iv)
    const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()])
    const authTag = cipher.getAuthTag()

    return {
      iv: encode(iv),
      ciphertext: encode(ciphertext),
      authTag: encode(authTag),
      algorithm: SYNC_KEY_ALGORITHM,
      derivation: SYNC_KEY_DERIVATION,
      wrappedAt: Date.now(),
    }
  } finally {
    kek.fill(0)
  }
}

export function unwrapVaultKey(appKey: string, wrapped: WrappedVaultKey) {
  if (wrapped.algorithm !== SYNC_KEY_ALGORITHM || wrapped.derivation !== SYNC_KEY_DERIVATION) {
    throw new Error('Unsupported Klarkey sync key envelope.')
  }

  const iv = expectByteLength(decodeBase64Bytes(wrapped.iv, GCM_IV_BYTES, 'key envelope IV'), GCM_IV_BYTES, 'key envelope IV')
  const authTag = expectByteLength(decodeBase64Bytes(wrapped.authTag, GCM_AUTH_TAG_BYTES, 'key envelope tag'), GCM_AUTH_TAG_BYTES, 'key envelope tag')
  const ciphertext = expectByteLength(
    decodeBase64Bytes(wrapped.ciphertext, WRAPPED_VAULT_KEY_BYTES, 'key envelope ciphertext'),
    WRAPPED_VAULT_KEY_BYTES,
    'key envelope ciphertext',
  )

  const kek = deriveSyncKek(appKey)
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, iv)
    decipher.setAuthTag(authTag)
    const vaultKey = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    if (vaultKey.length !== WRAPPED_VAULT_KEY_BYTES) {
      vaultKey.fill(0)
      throw new Error('Invalid Klarkey sync vault key.')
    }

    return vaultKey
  } finally {
    kek.fill(0)
    iv.fill(0)
    authTag.fill(0)
    ciphertext.fill(0)
  }
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
  if (record.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new Error('Unsupported Klarkey sync record schema.')
  }

  const iv = expectByteLength(decodeBase64Bytes(record.iv, GCM_IV_BYTES, 'record IV'), GCM_IV_BYTES, 'record IV')
  const authTag = expectByteLength(decodeBase64Bytes(record.authTag, GCM_AUTH_TAG_BYTES, 'record tag'), GCM_AUTH_TAG_BYTES, 'record tag')
  const ciphertext = decodeBase64Bytes(record.ciphertext, MAX_SYNC_RECORD_CIPHERTEXT_BYTES, 'record ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', vaultKey, iv)
  let plaintext: string
  try {
    decipher.setAAD(aadFor(identityId, record.recordId, record.revision, record.schemaVersion))
    decipher.setAuthTag(authTag)
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } finally {
    iv.fill(0)
    authTag.fill(0)
    ciphertext.fill(0)
  }
  const parsed = JSON.parse(plaintext) as PlainVaultRecord
  if (!validatePlainVaultRecord(parsed)) {
    throw new Error('Klarkey sync record payload is invalid.')
  }
  if (parsed.recordId !== record.recordId || parsed.deletedAt !== record.deletedAt) {
    throw new Error('Klarkey sync record metadata mismatch.')
  }
  const actualHash = decode(hashPlainRecord(parsed))
  const expectedHash = expectByteLength(decodeBase64Bytes(record.contentHash, 32, 'record hash'), 32, 'record hash')
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    actualHash.fill(0)
    expectedHash.fill(0)
    throw new Error('Klarkey sync record hash mismatch.')
  }
  actualHash.fill(0)
  expectedHash.fill(0)
  return parsed
}
