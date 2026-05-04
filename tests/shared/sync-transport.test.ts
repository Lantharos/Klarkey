import { describe, expect, it } from 'vitest'
import { normalizeSecureSyncUrl, secureSyncUrlError } from '@/shared/sync-transport'
import { normalizeSecureSyncUrl as normalizeMobileSecureSyncUrl } from '../../mobile/src/lib/sync-transport'

const normalizers = [
  ['desktop', normalizeSecureSyncUrl],
  ['mobile', normalizeMobileSecureSyncUrl],
] as const

describe('sync transport URL policy', () => {
  it.each(normalizers)('accepts HTTPS origins for %s sync transport', (_, normalize) => {
    expect(normalize(' https://deployment.convex.cloud/ ')).toBe('https://deployment.convex.cloud')
  })

  it.each(normalizers)('rejects non-origin or non-HTTPS %s sync transports', (_, normalize) => {
    expect(normalize('http://deployment.convex.cloud')).toBeUndefined()
    expect(normalize('https://person:secret@deployment.convex.cloud')).toBeUndefined()
    expect(normalize('https://deployment.convex.cloud/path')).toBeUndefined()
    expect(normalize('https://deployment.convex.cloud?token=secret')).toBeUndefined()
    expect(normalize('https://deployment.convex.cloud/#token')).toBeUndefined()
    expect(normalize('javascript:alert(1)')).toBeUndefined()
  })

  it('uses a non-sensitive configuration error message', () => {
    expect(secureSyncUrlError('KLARKEY_CONVEX_URL')).toBe(
      'KLARKEY_CONVEX_URL must be an HTTPS origin without credentials, path, query, or fragment.',
    )
  })
})
