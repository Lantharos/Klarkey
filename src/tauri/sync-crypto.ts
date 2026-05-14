import { normalizeAppKeyBase64 } from '@ave-id/sdk/app-key'
import { canonicalJson } from '@/shared/canonical-json'
import { SYNC_DERIVATION_LABEL, SYNC_KEY_ALGORITHM, SYNC_KEY_DERIVATION, SYNC_SCHEMA_VERSION, validatePlainVaultRecord, type LocalSyncRecord, type PlainVaultRecord, type SyncRecord, type WrappedVaultKey } from '@/shared/sync'

const GCM_IV_BYTES = 12
const GCM_AUTH_TAG_BYTES = 16
const WRAPPED_VAULT_KEY_BYTES = 32
const MAX_SYNC_RECORD_CIPHERTEXT_BYTES = 8 * 1024 * 1024
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const textBytes = (value: string) => new TextEncoder().encode(value)
const bytesText = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const bufferSource = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string, maxBytes: number, label: string) {
  if (!value || value.length % 4 !== 0 || value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !base64Pattern.test(value)) {
    throw new Error(`Invalid Klarkey sync ${label}.`)
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  if (bytes.byteLength > maxBytes) throw new Error(`Invalid Klarkey sync ${label}.`)
  return bytes
}

function decodeAppKey(appKey: string) {
  const normalized = normalizeAppKeyBase64(appKey)
  if (!normalized) throw new Error('Ave app_key is missing.')
  const bytes = base64ToBytes(normalized, 4096, 'app key')
  if (bytes.byteLength < 32) throw new Error('Ave app_key is too short for Klarkey sync.')
  return bytes
}

async function deriveSyncKek(appKey: string) {
  const source = decodeAppKey(appKey)
  const sourceKey = await crypto.subtle.importKey('raw', source, 'HKDF', false, ['deriveKey'])
  source.fill(0)
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: textBytes(SYNC_DERIVATION_LABEL) },
    sourceKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function vaultCryptoKey(vaultKey: Uint8Array) {
  if (vaultKey.byteLength !== WRAPPED_VAULT_KEY_BYTES) throw new Error('Invalid Klarkey sync vault key.')
  return crypto.subtle.importKey('raw', bufferSource(vaultKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function aadFor(identityId: string, recordId: string, revision: number, schemaVersion = SYNC_SCHEMA_VERSION) {
  return textBytes(canonicalJson({ identityId, recordId, revision, schemaVersion }))
}

function recordHashPayload(record: PlainVaultRecord) {
  if ('updatedAt' in record) {
    const { updatedAt, ...payload } = record
    void updatedAt
    return payload
  }
  return record
}

export async function hashPlainRecord(record: PlainVaultRecord) {
  const digest = await crypto.subtle.digest('SHA-256', textBytes(canonicalJson(recordHashPayload(record))))
  return bytesToBase64(new Uint8Array(digest))
}

function splitGcm(sealed: ArrayBuffer) {
  const bytes = new Uint8Array(sealed)
  if (bytes.byteLength < GCM_AUTH_TAG_BYTES) throw new Error('Invalid Klarkey sync sealed value.')
  return {
    ciphertext: bytes.slice(0, bytes.byteLength - GCM_AUTH_TAG_BYTES),
    authTag: bytes.slice(bytes.byteLength - GCM_AUTH_TAG_BYTES),
  }
}

function joinGcm(ciphertext: Uint8Array, authTag: Uint8Array) {
  const sealed = new Uint8Array(ciphertext.byteLength + authTag.byteLength)
  sealed.set(ciphertext)
  sealed.set(authTag, ciphertext.byteLength)
  return sealed
}

export async function wrapVaultKey(appKey: string, vaultKey: Uint8Array): Promise<WrappedVaultKey> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await deriveSyncKek(appKey), bufferSource(vaultKey))
  const { ciphertext, authTag } = splitGcm(sealed)
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext), authTag: bytesToBase64(authTag), algorithm: SYNC_KEY_ALGORITHM, derivation: SYNC_KEY_DERIVATION, wrappedAt: Date.now() }
}

export async function unwrapVaultKey(appKey: string, wrapped: WrappedVaultKey) {
  if (wrapped.algorithm !== SYNC_KEY_ALGORITHM || wrapped.derivation !== SYNC_KEY_DERIVATION) throw new Error('Unsupported Klarkey sync key envelope.')
  const iv = base64ToBytes(wrapped.iv, GCM_IV_BYTES, 'key envelope IV')
  const authTag = base64ToBytes(wrapped.authTag, GCM_AUTH_TAG_BYTES, 'key envelope tag')
  const ciphertext = base64ToBytes(wrapped.ciphertext, WRAPPED_VAULT_KEY_BYTES, 'key envelope ciphertext')
  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES || ciphertext.byteLength !== WRAPPED_VAULT_KEY_BYTES) throw new Error('Invalid Klarkey sync key envelope.')
  const vaultKey = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await deriveSyncKek(appKey), joinGcm(ciphertext, authTag)))
  if (vaultKey.byteLength !== WRAPPED_VAULT_KEY_BYTES) throw new Error('Invalid Klarkey sync vault key.')
  return vaultKey
}

export async function encryptPlainRecord(vaultKey: Uint8Array, identityId: string, deviceId: string, revision: number, record: PlainVaultRecord): Promise<LocalSyncRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(identityId, record.recordId, revision), tagLength: 128 }, await vaultCryptoKey(vaultKey), textBytes(canonicalJson(record)))
  const { ciphertext, authTag } = splitGcm(sealed)
  return { recordId: record.recordId, revision, deviceId, deletedAt: record.deletedAt, ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv), authTag: bytesToBase64(authTag), contentHash: await hashPlainRecord(record), schemaVersion: SYNC_SCHEMA_VERSION }
}

export async function decryptSyncRecord(vaultKey: Uint8Array, identityId: string, record: SyncRecord): Promise<PlainVaultRecord> {
  if (record.schemaVersion !== SYNC_SCHEMA_VERSION) throw new Error('Unsupported Klarkey sync record schema.')
  const iv = base64ToBytes(record.iv, GCM_IV_BYTES, 'record IV')
  const authTag = base64ToBytes(record.authTag, GCM_AUTH_TAG_BYTES, 'record tag')
  const ciphertext = base64ToBytes(record.ciphertext, MAX_SYNC_RECORD_CIPHERTEXT_BYTES, 'record ciphertext')
  if (iv.byteLength !== GCM_IV_BYTES || authTag.byteLength !== GCM_AUTH_TAG_BYTES) throw new Error('Invalid Klarkey sync record envelope.')
  const plaintext = bytesText(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadFor(identityId, record.recordId, record.revision, record.schemaVersion), tagLength: 128 }, await vaultCryptoKey(vaultKey), joinGcm(ciphertext, authTag))))
  const parsed = JSON.parse(plaintext) as PlainVaultRecord
  if (!validatePlainVaultRecord(parsed) || parsed.recordId !== record.recordId || parsed.deletedAt !== record.deletedAt) throw new Error('Klarkey sync record payload is invalid.')
  if (!constantTimeEqual(base64ToBytes(await hashPlainRecord(parsed), 32, 'record hash'), base64ToBytes(record.contentHash, 32, 'record hash'))) throw new Error('Klarkey sync record hash mismatch.')
  return parsed
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  let diff = 0
  for (let index = 0; index < left.byteLength; index++) diff |= left[index]! ^ right[index]!
  return diff === 0
}
