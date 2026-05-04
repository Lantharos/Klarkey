import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSyncRecord, encryptPlainRecord, hashPlainRecord, unwrapVaultKey, wrapVaultKey } from '@/electron/sync/crypto'
import type { PlainVaultRecord, SyncRecord } from '@/shared/sync'

const appKey = () => randomBytes(32).toString('base64')

const plainRecord = (): Extract<PlainVaultRecord, { kind: 'item' }> => ({
  kind: 'item',
  recordId: 'item:example',
  itemId: 'example',
  itemType: 'login',
  item: {
    itemId: 'example',
    itemType: 'login',
    itemName: 'Example',
    username: 'krist',
    password: 'secret',
    websites: ['example.com'],
    customFields: [],
  },
  updatedAt: '2026-05-03T00:00:00.000Z',
})

describe('sync crypto', () => {
  it('wraps the vault key and encrypts records', () => {
    const key = appKey()
    const vaultKey = randomBytes(32)
    const wrapped = wrapVaultKey(key, vaultKey)
    const unwrapped = unwrapVaultKey(key, wrapped)
    expect(unwrapped.equals(vaultKey)).toBe(true)

    const encrypted = encryptPlainRecord(vaultKey, 'ave_identity', 'device_1', 1, plainRecord())
    const decrypted = decryptSyncRecord(vaultKey, 'ave_identity', { ...encrypted, serverSequence: 1 } satisfies SyncRecord)
    expect(decrypted).toEqual(plainRecord())
  })

  it('fails with the wrong Ave app key', () => {
    const vaultKey = randomBytes(32)
    const wrapped = wrapVaultKey(appKey(), vaultKey)
    expect(() => unwrapVaultKey(appKey(), wrapped)).toThrow()
  })

  it('rejects malformed wrapped vault key envelopes before decrypting', () => {
    const vaultKey = randomBytes(32)
    const wrapped = wrapVaultKey(appKey(), vaultKey)

    expect(() => unwrapVaultKey(appKey(), { ...wrapped, iv: Buffer.alloc(16).toString('base64') })).toThrow('key envelope IV')
    expect(() => unwrapVaultKey(appKey(), { ...wrapped, iv: '!!!!!!!!!!!!' })).toThrow('key envelope IV')
    expect(() => unwrapVaultKey(appKey(), { ...wrapped, ciphertext: Buffer.alloc(31).toString('base64') })).toThrow('key envelope ciphertext')
  })

  it('fails when authenticated data is tampered', () => {
    const vaultKey = randomBytes(32)
    const encrypted = encryptPlainRecord(vaultKey, 'ave_identity', 'device_1', 1, plainRecord())
    expect(() =>
      decryptSyncRecord(vaultKey, 'other_identity', { ...encrypted, serverSequence: 1 } satisfies SyncRecord),
    ).toThrow()
  })

  it('fails when plaintext and server deletion metadata diverge', () => {
    const vaultKey = randomBytes(32)
    const encrypted = encryptPlainRecord(vaultKey, 'ave_identity', 'device_1', 1, plainRecord())
    expect(() =>
      decryptSyncRecord(vaultKey, 'ave_identity', { ...encrypted, deletedAt: Date.now(), serverSequence: 1 } satisfies SyncRecord),
    ).toThrow('metadata mismatch')
  })

  it('fails when decrypted plaintext is not a valid vault record', () => {
    const vaultKey = randomBytes(32)
    const invalidRecord = {
      ...plainRecord(),
      item: {
        itemId: 'example',
        itemType: 'login',
      },
    } as unknown as PlainVaultRecord
    const encrypted = encryptPlainRecord(vaultKey, 'ave_identity', 'device_1', 1, invalidRecord)

    expect(() =>
      decryptSyncRecord(vaultKey, 'ave_identity', { ...encrypted, serverSequence: 1 } satisfies SyncRecord),
    ).toThrow('payload is invalid')
  })

  it('rejects malformed sync record envelopes before parsing plaintext', () => {
    const vaultKey = randomBytes(32)
    const encrypted = encryptPlainRecord(vaultKey, 'ave_identity', 'device_1', 1, plainRecord())

    expect(() =>
      decryptSyncRecord(vaultKey, 'ave_identity', { ...encrypted, iv: Buffer.alloc(16).toString('base64'), serverSequence: 1 } satisfies SyncRecord),
    ).toThrow('record IV')
    expect(() =>
      decryptSyncRecord(vaultKey, 'ave_identity', { ...encrypted, iv: '!!!!!!!!!!!!', serverSequence: 1 } satisfies SyncRecord),
    ).toThrow('record IV')
    expect(() =>
      decryptSyncRecord(vaultKey, 'ave_identity', { ...encrypted, schemaVersion: 999, serverSequence: 1 } satisfies SyncRecord),
    ).toThrow('schema')
  })

  it('does not dirty a record when only sync metadata changes', () => {
    expect(hashPlainRecord(plainRecord())).toBe(hashPlainRecord({
      ...plainRecord(),
      updatedAt: '2026-05-03T01:00:00.000Z',
    }))
  })
})
