import { composeCommandRaw, parseCommand } from '@/shared/command'

describe('parseCommand', () => {
  it('detects create login intent while leaving item text in the input', () => {
    const query = parseCommand('new login netflix')

    expect(query.intent).toBe('create')
    expect(query.entryType).toBe('login')
    expect(query.itemQuery).toBe('netflix')
    expect(query.tokens.map((token) => token.kind)).toEqual(['intent', 'item-type'])
    expect(query.trailingText).toBe('netflix')
  })

  it('detects credential-specific actions', () => {
    const query = parseCommand('show 2fa discord')

    expect(query.intent).toBe('show')
    expect(query.credential).toBe('otp')
    expect(query.itemQuery).toBe('discord')
    expect(query.tokens.map((token) => token.kind)).toEqual(['intent', 'credential'])
    expect(query.trailingText).toBe('discord')
  })

  it('splits item and identity for direct insert commands', () => {
    const query = parseCommand('insert password netflix alice')

    expect(query.intent).toBe('insert')
    expect(query.credential).toBe('password')
    expect(query.itemQuery).toBe('netflix')
    expect(query.identityQuery).toBe('alice')
  })

  it('rebuilds raw text from tokens', () => {
    const query = parseCommand('switch github as personal')

    expect(composeCommandRaw(query)).toBe('switch github as personal')
  })
})
