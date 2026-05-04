import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeBootstrapResult, normalizePullResult, normalizePushResult, normalizeRemoteSyncStatus } from '@/electron/sync/remote-contract'
import { SYNC_KEY_ALGORITHM, SYNC_KEY_DERIVATION, SYNC_SCHEMA_VERSION } from '@/shared/sync'

const encryptedRecord = () => ({
  recordId: 'item:item_1',
  revision: 1,
  serverSequence: 1,
  deviceId: 'device_1',
  ciphertext: Buffer.from('encrypted').toString('base64'),
  iv: Buffer.alloc(12, 1).toString('base64'),
  authTag: Buffer.alloc(16, 2).toString('base64'),
  contentHash: Buffer.alloc(32, 3).toString('base64'),
  schemaVersion: SYNC_SCHEMA_VERSION,
})

const wrappedVaultKey = () => ({
  iv: Buffer.alloc(12, 1).toString('base64'),
  ciphertext: Buffer.alloc(32, 2).toString('base64'),
  authTag: Buffer.alloc(16, 3).toString('base64'),
  algorithm: SYNC_KEY_ALGORITHM,
  derivation: SYNC_KEY_DERIVATION,
  wrappedAt: Date.now(),
})

describe('desktop sync remote contract validation', () => {
  it('accepts bounded bootstrap, pull, and push responses', () => {
    expect(normalizeBootstrapResult({
      schemaVersion: SYNC_SCHEMA_VERSION,
      sequence: 1,
      needsSetup: false,
      wrappedVaultKey: wrappedVaultKey(),
    })).toMatchObject({
      sequence: 1,
      needsSetup: false,
    })

    expect(normalizePullResult({
      schemaVersion: SYNC_SCHEMA_VERSION,
      sequence: 1,
      wrappedVaultKey: wrappedVaultKey(),
      records: [encryptedRecord()],
    }).records).toHaveLength(1)

    expect(normalizePushResult({
      sequence: 1,
      accepted: [{
        recordId: 'item:item_1',
        revision: 1,
        serverSequence: 1,
        contentHash: Buffer.alloc(32, 4).toString('base64'),
      }],
      conflicts: [encryptedRecord()],
    }).accepted).toHaveLength(1)
  })

  it('rejects malformed wrapped keys and encrypted record envelopes', () => {
    expect(() => normalizeBootstrapResult({
      schemaVersion: SYNC_SCHEMA_VERSION,
      sequence: 1,
      needsSetup: false,
      wrappedVaultKey: {
        ...wrappedVaultKey(),
        authTag: 'not base64',
      },
    })).toThrow('key envelope')

    expect(() => normalizePullResult({
      schemaVersion: SYNC_SCHEMA_VERSION,
      sequence: 1,
      records: [{
        ...encryptedRecord(),
        ciphertext: 'x'.repeat(12 * 1024 * 1024),
      }],
    })).toThrow('record envelope')
  })

  it('rejects mismatched top-level sync schema versions', () => {
    expect(() => normalizeBootstrapResult({
      schemaVersion: SYNC_SCHEMA_VERSION + 1,
      sequence: 1,
      needsSetup: false,
      wrappedVaultKey: wrappedVaultKey(),
    })).toThrow('bootstrap')

    expect(() => normalizePullResult({
      schemaVersion: SYNC_SCHEMA_VERSION + 1,
      sequence: 1,
      records: [],
    })).toThrow('pull')

    expect(() => normalizeRemoteSyncStatus({
      syncAllowed: true,
      sequence: 1,
      schemaVersion: SYNC_SCHEMA_VERSION + 1,
      hasVaultKey: true,
    })).toThrow('status')
  })

  it('caps normalized sync response arrays before callers process them', () => {
    expect(() => normalizePullResult({
      schemaVersion: SYNC_SCHEMA_VERSION,
      sequence: 1,
      records: Array.from({ length: 501 }, encryptedRecord),
    })).toThrow('pull')

    expect(() => normalizePushResult({
      sequence: 1,
      accepted: Array.from({ length: 101 }, () => ({
        recordId: 'item:item_1',
        revision: 1,
        serverSequence: 1,
        contentHash: Buffer.alloc(32, 4).toString('base64'),
      })),
      conflicts: [],
    })).toThrow('push')
  })

  it('rejects malformed push metadata before writing sync state', () => {
    expect(() => normalizePushResult({
      sequence: 1,
      accepted: [{
        recordId: 'item:item_1',
        revision: 1,
        serverSequence: 1,
        contentHash: 'not base64',
      }],
      conflicts: [],
    })).toThrow('push records')
  })

  it('routes desktop sync remote responses through normalizers', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/sync/manager.ts'), 'utf8')

    expect(source).toContain('.then(normalizeBootstrapResult)')
    expect(source).toContain('.then(normalizePullResult)')
    expect(source).toContain('.then(normalizePushResult)')
    expect(source).toContain('normalizeRemoteSyncStatus(remote)')
  })
})
