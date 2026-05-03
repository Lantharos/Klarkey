import { describe, expect, it } from 'vitest'
import { parseAveOAuthCallback } from '@/shared/ave-oauth'

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
})
