import { describe, expect, it } from 'vitest'
import { EXTERNAL_UNLOCK_FLAG, EXTERNAL_UNLOCK_TOKEN_FLAG, externalUnlockArgs, hasTrustedExternalUnlockArgs } from '@/electron/external-unlock'

describe('external unlock launch policy', () => {
  it('requires the current session token before auto-unlocking', () => {
    const token = 'session-token'

    expect(hasTrustedExternalUnlockArgs([EXTERNAL_UNLOCK_FLAG, EXTERNAL_UNLOCK_TOKEN_FLAG, token], token)).toBe(true)
    expect(hasTrustedExternalUnlockArgs([EXTERNAL_UNLOCK_FLAG], token)).toBe(false)
    expect(hasTrustedExternalUnlockArgs([EXTERNAL_UNLOCK_FLAG, EXTERNAL_UNLOCK_TOKEN_FLAG, 'stale-token'], token)).toBe(false)
    expect(hasTrustedExternalUnlockArgs([EXTERNAL_UNLOCK_TOKEN_FLAG, token], token)).toBe(false)
  })

  it('builds the unlock argv passed from helper processes', () => {
    expect(externalUnlockArgs('session-token')).toEqual([EXTERNAL_UNLOCK_FLAG, EXTERNAL_UNLOCK_TOKEN_FLAG, 'session-token'])
    expect(externalUnlockArgs(undefined)).toEqual([EXTERNAL_UNLOCK_FLAG])
  })
})
