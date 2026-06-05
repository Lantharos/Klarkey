import { makeFunctionReference } from 'convex/server'
import { SYNC_KEY_ALGORITHM, SYNC_KEY_DERIVATION, SYNC_SCHEMA_VERSION, type SyncPushAccepted, type SyncPushResult, type SyncRecord, type WrappedVaultKey } from '@/shared/sync'

export const deviceRegistrationIntervalMs = 1000 * 60 * 60 * 6
export const maxPushBatchRecords = 100
export const syncFns = {
  bootstrapVault: makeFunctionReference<'mutation'>('sync:bootstrapVault'),
  registerDevice: makeFunctionReference<'mutation'>('sync:registerDevice'),
  getSyncStatus: makeFunctionReference<'query'>('sync:getSyncStatus'),
  pullSince: makeFunctionReference<'query'>('sync:pullSince'),
  pushBatch: makeFunctionReference<'mutation'>('sync:pushBatch'),
}

export type BootstrapResult = { wrappedVaultKey?: WrappedVaultKey; schemaVersion: number; sequence: number; needsSetup: boolean }
export type PullResult = { wrappedVaultKey?: WrappedVaultKey; schemaVersion: number; sequence: number; records: SyncRecord[] }
export type RemoteSyncStatus = { syncAllowed: boolean; sequence: number; schemaVersion: number; hasVaultKey: boolean }

const maxIdLength = 160
const maxDeviceIdLength = 120
const maxEnvelopeFieldLength = 2048
const maxCiphertextBytes = 256 * 1024
const maxCiphertextLength = Math.ceil(maxCiphertextBytes / 3) * 4 + 4
const maxHashLength = 128
const maxPullRecords = 500
const gcmIvBytes = 12
const gcmAuthTagBytes = 16
const sha256Bytes = 32
const wrappedVaultKeyBytes = 32
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

const isString = (value: unknown, maxLength: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength && !value.includes('\0')

const isSafeIntegerInRange = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max

const decodedBase64ByteLength = (value: string) => {
  if (!value || value.length % 4 !== 0 || !base64Pattern.test(value)) return undefined
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

const isBase64ByteLengthInRange = (value: unknown, minBytes: number, maxBytes: number) => {
  if (typeof value !== 'string') return false
  const length = decodedBase64ByteLength(value)
  return length !== undefined && length >= minBytes && length <= maxBytes
}

const isWrappedVaultKey = (value: unknown): value is WrappedVaultKey => {
  const wrapped = objectRecord(value)
  return Boolean(
    wrapped &&
    isString(wrapped.iv, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(wrapped.iv, gcmIvBytes, gcmIvBytes) &&
    isString(wrapped.ciphertext, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(wrapped.ciphertext, wrappedVaultKeyBytes, wrappedVaultKeyBytes) &&
    isString(wrapped.authTag, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(wrapped.authTag, gcmAuthTagBytes, gcmAuthTagBytes) &&
    wrapped.algorithm === SYNC_KEY_ALGORITHM &&
    wrapped.derivation === SYNC_KEY_DERIVATION &&
    isSafeIntegerInRange(wrapped.wrappedAt, 0),
  )
}

const isSyncRecord = (value: unknown): value is SyncRecord => {
  const record = objectRecord(value)
  return Boolean(
    record &&
    isString(record.recordId, maxIdLength) &&
    isSafeIntegerInRange(record.revision, 1) &&
    isSafeIntegerInRange(record.serverSequence, 0) &&
    isString(record.deviceId, maxDeviceIdLength) &&
    (record.deletedAt === undefined || isSafeIntegerInRange(record.deletedAt, 1)) &&
    isString(record.ciphertext, maxCiphertextLength) &&
    isBase64ByteLengthInRange(record.ciphertext, 1, maxCiphertextBytes) &&
    isString(record.iv, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(record.iv, gcmIvBytes, gcmIvBytes) &&
    isString(record.authTag, maxEnvelopeFieldLength) &&
    isBase64ByteLengthInRange(record.authTag, gcmAuthTagBytes, gcmAuthTagBytes) &&
    isString(record.contentHash, maxHashLength) &&
    isBase64ByteLengthInRange(record.contentHash, sha256Bytes, sha256Bytes) &&
    record.schemaVersion === SYNC_SCHEMA_VERSION,
  )
}

const isPushAccepted = (value: unknown): value is SyncPushAccepted => {
  const accepted = objectRecord(value)
  return Boolean(
    accepted &&
    isString(accepted.recordId, maxIdLength) &&
    isSafeIntegerInRange(accepted.revision, 1) &&
    isSafeIntegerInRange(accepted.serverSequence, 0) &&
    isString(accepted.contentHash, maxHashLength) &&
    isBase64ByteLengthInRange(accepted.contentHash, sha256Bytes, sha256Bytes),
  )
}

export function normalizeBootstrapResult(value: unknown): BootstrapResult {
  const response = objectRecord(value)
  if (!response || response.schemaVersion !== SYNC_SCHEMA_VERSION || !isSafeIntegerInRange(response.sequence, 0) || typeof response.needsSetup !== 'boolean') {
    throw new Error('Invalid Klarkey sync bootstrap response.')
  }
  if (response.wrappedVaultKey !== undefined && !isWrappedVaultKey(response.wrappedVaultKey)) throw new Error('Invalid Klarkey sync key envelope.')
  return { schemaVersion: response.schemaVersion, sequence: response.sequence, needsSetup: response.needsSetup, wrappedVaultKey: response.wrappedVaultKey }
}

export function normalizePullResult(value: unknown): PullResult {
  const response = objectRecord(value)
  if (!response || response.schemaVersion !== SYNC_SCHEMA_VERSION || !isSafeIntegerInRange(response.sequence, 0) || !Array.isArray(response.records) || response.records.length > maxPullRecords) {
    throw new Error('Invalid Klarkey sync pull response.')
  }
  if (response.wrappedVaultKey !== undefined && !isWrappedVaultKey(response.wrappedVaultKey)) throw new Error('Invalid Klarkey sync key envelope.')
  if (!response.records.every(isSyncRecord)) throw new Error('Invalid Klarkey sync record envelope.')
  return { schemaVersion: response.schemaVersion, sequence: response.sequence, records: response.records, wrappedVaultKey: response.wrappedVaultKey }
}

export function normalizePushResult(value: unknown): SyncPushResult {
  const response = objectRecord(value)
  if (!response || !isSafeIntegerInRange(response.sequence, 0) || !Array.isArray(response.accepted) || !Array.isArray(response.conflicts) || response.accepted.length > maxPushBatchRecords || response.conflicts.length > maxPushBatchRecords) {
    throw new Error('Invalid Klarkey sync push response.')
  }
  if (!response.accepted.every(isPushAccepted) || !response.conflicts.every(isSyncRecord)) throw new Error('Invalid Klarkey sync push records.')
  return { sequence: response.sequence, accepted: response.accepted, conflicts: response.conflicts }
}
