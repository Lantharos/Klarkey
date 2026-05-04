import { describe, expect, it } from 'vitest'

describe('extension suggested password generator', () => {
  it('generates category-complete passwords with bounded unbiased sampling', async () => {
    const source = await import('../../extension/shared/content/page/forms/forms.js')
    const password = source.randomPassword()
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'

    expect(password).toHaveLength(24)
    expect(password).toMatch(/[ABCDEFGHJKLMNPQRSTUVWXYZ]/)
    expect(password).toMatch(/[abcdefghijkmnopqrstuvwxyz]/)
    expect(password).toMatch(/[23456789]/)
    expect(password).toMatch(/[!@#$%^&*]/)
    expect([...password].every((character) => alphabet.includes(character))).toBe(true)
  })

  it('keeps short requested passwords long enough to include every required category', async () => {
    const source = await import('../../extension/shared/content/page/forms/forms.js')
    const password = source.randomPassword(3)

    expect(password).toHaveLength(4)
    expect(password).toMatch(/[ABCDEFGHJKLMNPQRSTUVWXYZ]/)
    expect(password).toMatch(/[abcdefghijkmnopqrstuvwxyz]/)
    expect(password).toMatch(/[23456789]/)
    expect(password).toMatch(/[!@#$%^&*]/)
  })
})
