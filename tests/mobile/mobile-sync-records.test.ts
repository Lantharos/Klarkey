import { describe, expect, it } from 'vitest'
import {
  isPlainMobileRecord,
  normalizeBootstrapResponse,
  normalizePullResponse,
  normalizePushBatchResponse,
  normalizeRemoteSyncStatus,
  normalizeWrappedVaultKey,
  type PlainMobileRecord,
} from '../../mobile/src/lib/sync-records'

const p256Coordinate = (fill: number) => Buffer.alloc(32, fill).toString('base64url')

const passkeyJwk = () => ({
  kty: 'EC',
  crv: 'P-256',
  x: p256Coordinate(1),
  y: p256Coordinate(2),
  d: p256Coordinate(3),
})

const passkeyRecord = (): Extract<PlainMobileRecord, { kind: 'site-passkey' }> => ({
  kind: 'site-passkey',
  recordId: 'site-passkey:credential-1',
  passkeyId: 'passkey-1',
  itemId: 'item-1',
  credentialId: 'credential-1',
  label: 'Example',
  rpId: 'example.com',
  transports: ['internal'],
  privateKeyJwk: passkeyJwk(),
  signCount: 0,
  createdAt: '2026-05-04T00:00:00.000Z',
  syncedCounter: true,
})

const encryptedRecord = () => ({
  recordId: 'item:item-1',
  revision: 1,
  serverSequence: 1,
  deviceId: 'device-1',
  ciphertext: Buffer.from('encrypted').toString('base64'),
  iv: Buffer.alloc(12, 1).toString('base64'),
  authTag: Buffer.alloc(16, 2).toString('base64'),
  contentHash: Buffer.alloc(32, 3).toString('base64'),
  schemaVersion: 1,
})

const wrappedVaultKey = () => ({
  iv: Buffer.alloc(12, 1).toString('base64'),
  ciphertext: Buffer.alloc(32, 2).toString('base64'),
  authTag: Buffer.alloc(16, 3).toString('base64'),
  algorithm: 'AES-256-GCM',
  derivation: 'HKDF-SHA256-klarkey-sync-v1',
  wrappedAt: Date.now(),
})

describe('mobile sync record validation', () => {
  it('accepts P-256 synced passkey private JWKs', () => {
    expect(isPlainMobileRecord(passkeyRecord())).toBe(true)
  })

  it('rejects malformed synced passkey private JWKs', () => {
    expect(isPlainMobileRecord({
      ...passkeyRecord(),
      privateKeyJwk: {
        ...passkeyJwk(),
        crv: 'P-384',
      },
    })).toBe(false)

    expect(isPlainMobileRecord({
      ...passkeyRecord(),
      privateKeyJwk: {
        ...passkeyJwk(),
        d: Buffer.alloc(31, 3).toString('base64url'),
      },
    })).toBe(false)

    expect(isPlainMobileRecord({
      ...passkeyRecord(),
      privateKeyJwk: {
        ...passkeyJwk(),
        y: 'not base64url!',
      },
    })).toBe(false)
  })

  it('accepts site passkey tombstones without private key material', () => {
    expect(isPlainMobileRecord({
      kind: 'site-passkey',
      recordId: 'site-passkey:credential-1',
      passkeyId: 'credential-1',
      itemId: 'item-1',
      credentialId: 'credential-1',
      label: 'Deleted passkey',
      transports: [],
      signCount: 0,
      createdAt: '2026-05-04T00:00:00.000Z',
      syncedCounter: true,
      deletedAt: 1,
    })).toBe(true)
  })

  it('rejects malformed encrypted sync envelopes before mobile decrypts them', () => {
    expect(() => normalizePullResponse({
      schemaVersion: 1,
      sequence: 1,
      records: [{ ...encryptedRecord(), iv: '!!!!!!!!!!!!' }],
    })).toThrow('record envelope')

    expect(() => normalizePullResponse({
      schemaVersion: 1,
      sequence: 1,
      wrappedVaultKey: {
        iv: Buffer.alloc(12, 1).toString('base64'),
        ciphertext: Buffer.alloc(31, 2).toString('base64'),
        authTag: Buffer.alloc(16, 3).toString('base64'),
        algorithm: 'AES-256-GCM',
        derivation: 'HKDF-SHA256-klarkey-sync-v1',
        wrappedAt: Date.now(),
      },
      records: [],
    })).toThrow('key envelope')

    expect(() => normalizePushBatchResponse({
      sequence: 1,
      accepted: [{
        recordId: 'item:item-1',
        revision: 1,
        serverSequence: 1,
        contentHash: 'not base64',
      }],
      conflicts: [],
    })).toThrow('push records')
  })

  it('rejects malformed wrapped sync keys from any mobile bootstrap path', () => {
    expect(() => normalizeWrappedVaultKey({
      ...wrappedVaultKey(),
      algorithm: 'AES-256-CBC',
    })).toThrow('key envelope')

    expect(() => normalizeWrappedVaultKey({
      ...wrappedVaultKey(),
      authTag: 'not base64',
    })).toThrow('key envelope')
  })

  it('normalizes mobile bootstrap and realtime status responses by schema version', () => {
    expect(normalizeBootstrapResponse({
      schemaVersion: 1,
      sequence: 1,
      needsSetup: false,
      wrappedVaultKey: wrappedVaultKey(),
    }).wrappedVaultKey).toBeDefined()

    expect(normalizeRemoteSyncStatus({
      syncAllowed: true,
      sequence: 1,
      schemaVersion: 1,
      hasVaultKey: true,
    })).toMatchObject({ sequence: 1 })

    expect(() => normalizeBootstrapResponse({
      schemaVersion: 2,
      sequence: 1,
      needsSetup: false,
    })).toThrow('bootstrap')

    expect(() => normalizePullResponse({
      schemaVersion: 2,
      sequence: 1,
      records: [],
    })).toThrow('pull')

    expect(() => normalizeRemoteSyncStatus({
      syncAllowed: true,
      sequence: 1,
      schemaVersion: 2,
      hasVaultKey: true,
    })).toThrow('status')
  })

  it('caps mobile sync response arrays before processing', () => {
    expect(() => normalizePullResponse({
      schemaVersion: 1,
      sequence: 1,
      records: Array.from({ length: 501 }, encryptedRecord),
    })).toThrow('pull')

    expect(() => normalizePushBatchResponse({
      sequence: 1,
      accepted: Array.from({ length: 101 }, () => ({
        recordId: 'item:item-1',
        revision: 1,
        serverSequence: 1,
        contentHash: Buffer.alloc(32, 3).toString('base64'),
      })),
      conflicts: [],
    })).toThrow('push')
  })

})
