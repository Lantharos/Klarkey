import { describe, expect, it } from 'vitest'
import {
  MAX_PASSKEY_PROVIDER_RESPONSE_BYTES,
  sanitizePasskeyProviderErrorMessage,
  serializePasskeyProviderResponse,
} from '@/electron/passkey-provider-host'

const readSerializedBody = (message: Buffer) => JSON.parse(message.subarray(4).toString('utf8'))

describe('passkey provider host protocol', () => {
  it('serializes provider responses with a 32-bit little-endian length prefix', () => {
    const serialized = serializePasskeyProviderResponse({
      id: 'req_1',
      ok: true,
      result: {
        ready: true,
        bridge: 'klarkey-passkey-provider',
        vaultUnlocked: true,
      },
    })

    expect(serialized.readUInt32LE(0)).toBe(serialized.byteLength - 4)
    expect(readSerializedBody(serialized)).toMatchObject({
      id: 'req_1',
      ok: true,
    })
  })

  it('fails closed before writing oversized provider responses', () => {
    const serialized = serializePasskeyProviderResponse({
      id: 'req_2',
      ok: true,
      result: {
        requestDetailsJson: 'x'.repeat(MAX_PASSKEY_PROVIDER_RESPONSE_BYTES),
        selectedCredentialIds: [],
      },
    })
    const body = readSerializedBody(serialized)

    expect(serialized.readUInt32LE(0)).toBeLessThan(MAX_PASSKEY_PROVIDER_RESPONSE_BYTES)
    expect(body).toMatchObject({
      id: 'req_2',
      ok: false,
      error: {
        code: 'provider_bridge_response_too_large',
      },
    })
    expect(JSON.stringify(body)).not.toContain('x'.repeat(128))
  })

  it('redacts sensitive provider bridge failures', () => {
    expect(sanitizePasskeyProviderErrorMessage(new Error('User cancelled'))).toBe('User cancelled')
    expect(sanitizePasskeyProviderErrorMessage(new Error('password=secret'))).toBe('An internal error occurred.')
    expect(sanitizePasskeyProviderErrorMessage(new Error('failed at C:\\Users\\person\\vault.db'))).toBe('An internal error occurred.')
    expect(sanitizePasskeyProviderErrorMessage(new Error('SQLITE_BUSY'))).toBe('A database error occurred.')
  })
})
