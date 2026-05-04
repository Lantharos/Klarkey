import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/shared/types'
import { validatePlainVaultRecord, type PlainVaultRecord } from '@/shared/sync'

const itemRecord = (): Extract<PlainVaultRecord, { kind: 'item' }> => ({
  kind: 'item',
  recordId: 'item:item-1',
  itemId: 'item-1',
  itemType: 'login',
  item: {
    itemId: 'item-1',
    itemType: 'login',
    itemName: 'Example',
    username: 'person@example.com',
    password: 'secret',
    websites: ['https://example.com'],
    customFields: [],
    recoveryCodes: [],
  },
  updatedAt: '2026-05-04T00:00:00.000Z',
})

const p256Coordinate = (fill: number) => Buffer.alloc(32, fill).toString('base64url')

const passkeyJwk = () => ({
  kty: 'EC',
  crv: 'P-256',
  x: p256Coordinate(1),
  y: p256Coordinate(2),
  d: p256Coordinate(3),
})

const passkeyRecord = (): Extract<PlainVaultRecord, { kind: 'site-passkey' }> => ({
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

describe('sync plain record validation', () => {
  it('accepts well-formed item, settings, and site-passkey records', () => {
    expect(validatePlainVaultRecord(itemRecord())).toBe(true)
    expect(validatePlainVaultRecord({
      kind: 'settings',
      recordId: 'settings:user',
      settings: DEFAULT_SETTINGS,
      updatedAt: '2026-05-04T00:00:00.000Z',
    })).toBe(true)
    expect(validatePlainVaultRecord(passkeyRecord())).toBe(true)
  })

  it('rejects item records whose IDs or payloads do not match', () => {
    expect(validatePlainVaultRecord({
      ...itemRecord(),
      recordId: 'item:item-2',
    })).toBe(false)

    expect(validatePlainVaultRecord({
      ...itemRecord(),
      item: {
        ...itemRecord().item,
        itemId: 'item-2',
      },
    })).toBe(false)
  })

  it('rejects tombstones without a positive integer deletion timestamp', () => {
    expect(validatePlainVaultRecord({
      ...itemRecord(),
      deletedAt: 0,
    })).toBe(false)

    expect(validatePlainVaultRecord({
      ...itemRecord(),
      deletedAt: 1,
    })).toBe(true)
  })

  it('accepts site passkey tombstones without private key material', () => {
    expect(validatePlainVaultRecord({
      ...passkeyRecord(),
      passkeyId: 'credential-1',
      privateKeyJwk: undefined,
      transports: [],
      deletedAt: 1,
    })).toBe(true)
  })

  it('rejects oversized or malformed decrypted records', () => {
    expect(validatePlainVaultRecord({
      ...itemRecord(),
      item: {
        ...itemRecord().item,
        itemName: '',
      },
    })).toBe(false)

    expect(validatePlainVaultRecord({
      ...itemRecord(),
      item: {
        ...itemRecord().item,
        websites: Array.from({ length: 33 }, (_, index) => `https://example${index}.com`),
      },
    })).toBe(false)
  })

  it('rejects unsafe synced settings', () => {
    const record = {
      kind: 'settings',
      recordId: 'settings:user',
      settings: DEFAULT_SETTINGS,
      updatedAt: '2026-05-04T00:00:00.000Z',
    } satisfies Extract<PlainVaultRecord, { kind: 'settings' }>

    expect(validatePlainVaultRecord({ ...record, settings: { ...DEFAULT_SETTINGS, hotkey: 'S' } })).toBe(false)
    expect(validatePlainVaultRecord({ ...record, settings: { ...DEFAULT_SETTINGS, hotkey: 'ctrl+alt+s' } })).toBe(false)
    expect(validatePlainVaultRecord({ ...record, settings: { ...DEFAULT_SETTINGS, clearClipboardSeconds: 3600 } })).toBe(false)
    expect(validatePlainVaultRecord({ ...record, settings: { ...DEFAULT_SETTINGS, autoLockMinutes: 1440 } })).toBe(false)
  })

  it('requires synced passkey private keys to be P-256 private JWKs', () => {
    expect(validatePlainVaultRecord({
      ...passkeyRecord(),
      privateKeyJwk: {
        ...passkeyJwk(),
        crv: 'P-384',
      },
    })).toBe(false)

    expect(validatePlainVaultRecord({
      ...passkeyRecord(),
      privateKeyJwk: {
        ...passkeyJwk(),
        d: Buffer.alloc(31, 3).toString('base64url'),
      },
    })).toBe(false)

    expect(validatePlainVaultRecord({
      ...passkeyRecord(),
      privateKeyJwk: {
        ...passkeyJwk(),
        x: 'not base64url!',
      },
    })).toBe(false)
  })
})
