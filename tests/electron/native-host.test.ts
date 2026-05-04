import { describe, expect, it } from 'vitest'
import { MAX_NATIVE_HOST_RESPONSE_BYTES, sanitizeNativeHostErrorMessage, serializeNativeMessageResponse } from '@/electron/native-host'

const readSerializedBody = (message: Buffer) => JSON.parse(message.subarray(4).toString('utf8'))

describe('native messaging host protocol', () => {
  it('serializes native messages with a 32-bit little-endian length prefix', () => {
    const serialized = serializeNativeMessageResponse({
      id: 'req_1',
      ok: true,
      result: { settings: { browserAutoSubmitLogin: true } },
    } as never)

    expect(serialized.readUInt32LE(0)).toBe(serialized.byteLength - 4)
    expect(readSerializedBody(serialized)).toMatchObject({
      id: 'req_1',
      ok: true,
    })
  })

  it('fails closed before writing oversized browser responses', () => {
    const serialized = serializeNativeMessageResponse({
      id: 'req_2',
      ok: true,
      result: { login: { itemId: 'item_1', itemName: 'Example', password: 'x'.repeat(MAX_NATIVE_HOST_RESPONSE_BYTES) } },
    } as never)
    const body = readSerializedBody(serialized)

    expect(serialized.readUInt32LE(0)).toBeLessThan(MAX_NATIVE_HOST_RESPONSE_BYTES)
    expect(body).toMatchObject({
      id: 'req_2',
      ok: false,
      error: {
        code: 'native_host_response_too_large',
      },
    })
    expect(JSON.stringify(body)).not.toContain('x'.repeat(128))
  })

  it('redacts sensitive native host failures', () => {
    expect(sanitizeNativeHostErrorMessage(new Error('Timed out'))).toBe('Timed out')
    expect(sanitizeNativeHostErrorMessage(new Error('refresh_token=abc'))).toBe('An internal error occurred.')
    expect(sanitizeNativeHostErrorMessage(new Error('failed for https://id.example.test/callback?code=abc'))).toBe('An internal error occurred.')
    expect(sanitizeNativeHostErrorMessage(new Error('ENOENT: no such file or directory'))).toBe('A file system error occurred.')
  })
})
