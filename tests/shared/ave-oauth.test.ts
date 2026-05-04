import { describe, expect, it } from 'vitest'
import { isAveOAuthCallbackUrl, parseAveOAuthCallback } from '@/shared/ave-oauth'

describe('Ave OAuth callback parsing', () => {
  it('reads app_key fragments and preserves plus characters', () => {
    const callback = parseAveOAuthCallback('klarkey://oauth/callback?code=abc&state=state#app_key=+vv8/P0=')
    expect(callback).toEqual({
      code: 'abc',
      state: 'state',
      appKey: '+vv8/P0=',
    })
  })

  it('rejects incomplete E2EE callbacks', () => {
    expect(() => parseAveOAuthCallback('klarkey://oauth/callback?code=abc&state=state')).toThrow()
  })

  it('accepts only the exact desktop callback route', () => {
    expect(isAveOAuthCallbackUrl('klarkey://oauth/callback?code=abc&state=state#app_key=+vv8/P0=')).toBe(true)
    expect(isAveOAuthCallbackUrl('klarkey://oauth/callback.evil?code=abc&state=state#app_key=+vv8/P0=')).toBe(false)
    expect(isAveOAuthCallbackUrl('klarkey://evil/callback?code=abc&state=state#app_key=+vv8/P0=')).toBe(false)
    expect(isAveOAuthCallbackUrl('https://klarkey.com/oauth/callback?code=abc&state=state#app_key=+vv8/P0=')).toBe(false)
    expect(() => parseAveOAuthCallback('klarkey://oauth/callback.evil?code=abc&state=state#app_key=+vv8/P0=')).toThrow('invalid')
  })
})
