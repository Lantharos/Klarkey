import { decryptValue, encryptValue } from '@/electron/crypto'

describe('crypto helpers', () => {
  it('round-trips encrypted content', () => {
    const key = Buffer.alloc(32, 7)
    const payload = encryptValue(key, 'super-secret')

    expect(decryptValue(key, payload)).toBe('super-secret')
  })
})
