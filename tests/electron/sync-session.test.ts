import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AveSyncConfig } from '@/electron/sync/session'

const config: AveSyncConfig = {
  clientId: 'klarkey-client',
  redirectUri: 'klarkey://oauth/callback',
  issuer: 'https://aveid.net',
}

const appKey = Buffer.alloc(32, 1).toString('base64')
let userDataPath = ''

function encodeBase64Url(value: unknown) {
  return Buffer
    .from(JSON.stringify(value), 'utf8')
    .toString('base64url')
}

function idToken(overrides: Record<string, unknown> = {}) {
  return [
    encodeBase64Url({ alg: 'RS256', typ: 'JWT' }),
    encodeBase64Url({
      sub: 'identity-1',
      iss: config.issuer,
      aud: config.clientId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'nonce-1',
      ...overrides,
    }),
    'signature',
  ].join('.')
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'access-token',
    id_token: idToken(),
    refresh_token: 'refresh-token',
    expires_in: 3600,
    app_key: appKey,
    ...overrides,
  } as never
}

function callbackUrl() {
  return `klarkey://oauth/callback?code=code&state=state#app_key=${encodeURIComponent(appKey)}`
}

function securePayload(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

describe('sync session token validation', () => {
  beforeEach(() => {
    vi.resetModules()
    userDataPath = mkdtempSync(join(tmpdir(), 'klarkey-sync-session-'))
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => userDataPath),
      },
      safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: vi.fn((value: string) => Buffer.from(value, 'utf8')),
        decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
      },
    }))
    vi.doMock('@ave-id/sdk', () => ({
      fetchUserInfo: vi.fn(async () => undefined),
      refreshToken: vi.fn(async () => tokenResponse()),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    if (userDataPath) {
      rmSync(userDataPath, { recursive: true, force: true })
      userDataPath = ''
    }
  })

  it('stores a sync session only when the ID token nonce matches the pending request', async () => {
    const { sessionFromTokenResponse } = await import('@/electron/sync/session')

    const session = await sessionFromTokenResponse(config, callbackUrl(), tokenResponse(), 'nonce-1')

    expect(session.account.aveIdentityId).toBe('identity-1')
    expect(session.expiresAt).toBeGreaterThan(Date.now())
  })

  it('rejects callback tokens with a mismatched OIDC nonce', async () => {
    const { sessionFromTokenResponse } = await import('@/electron/sync/session')

    await expect(sessionFromTokenResponse(
      config,
      callbackUrl(),
      tokenResponse({ id_token: idToken({ nonce: 'other-nonce' }) }),
      'nonce-1',
    )).rejects.toThrow('nonce')
  })

  it('rejects ID tokens for another client or issuer', async () => {
    const { sessionFromTokenResponse } = await import('@/electron/sync/session')

    await expect(sessionFromTokenResponse(
      config,
      callbackUrl(),
      tokenResponse({ id_token: idToken({ aud: 'other-client' }) }),
      'nonce-1',
    )).rejects.toThrow('audience')

    await expect(sessionFromTokenResponse(
      config,
      callbackUrl(),
      tokenResponse({ id_token: idToken({ iss: 'https://evil.example' }) }),
      'nonce-1',
    )).rejects.toThrow('issuer')
  })

  it('rejects malformed or oversized callback token fields before storing a sync session', async () => {
    const { sessionFromTokenResponse } = await import('@/electron/sync/session')

    await expect(sessionFromTokenResponse(
      config,
      callbackUrl(),
      tokenResponse({ id_token: `${idToken()}.extra` }),
      'nonce-1',
    )).rejects.toThrow('identity token')

    await expect(sessionFromTokenResponse(
      config,
      callbackUrl(),
      tokenResponse({ access_token: 'x'.repeat(32_769) }),
      'nonce-1',
    )).rejects.toThrow('access token')

    await expect(sessionFromTokenResponse(
      config,
      `klarkey://oauth/callback?code=code&state=state#app_key=${'x'.repeat(4097)}`,
      tokenResponse({ app_key: 'x'.repeat(4097) }),
      'nonce-1',
    )).rejects.toThrow('app key')
  })

  it('rejects malformed stored sync sessions', async () => {
    writeFileSync(join(userDataPath, 'sync-session.v1'), securePayload({ accessToken: 'token' }), 'utf8')
    const { readSyncSession } = await import('@/electron/sync/session')

    expect(() => readSyncSession()).toThrow('invalid')
  })

  it('rejects oversized stored sync session files before decrypting', async () => {
    writeFileSync(join(userDataPath, 'sync-session.v1'), 'x'.repeat(256 * 1024 + 1), 'utf8')
    const electron = await import('electron')
    const { readSyncSession } = await import('@/electron/sync/session')

    expect(() => readSyncSession()).toThrow('invalid')
    expect(electron.safeStorage.decryptString).not.toHaveBeenCalled()
  })

  it('opens stored sync secrets without following replacement symlinks', () => {
    const source = readFileSync(join(process.cwd(), 'src/electron/sync/session.ts'), 'utf8')

    expect(source).toContain('lstatSync(path).isSymbolicLink()')
    expect(source).toContain('stats.isSymbolicLink()')
    expect(source).toContain('constants.O_NOFOLLOW')
    expect(source).toContain('fstatSync(fd)')
    expect(source).toContain('readFileSync(fd, \'utf8\')')
  })

  it('rejects stale pending OAuth requests', async () => {
    writeFileSync(
      join(userDataPath, 'sync-oauth-pending.v1'),
      securePayload({
        state: 'state',
        verifier: 'verifier',
        nonce: 'nonce-1',
        createdAt: Date.now() - 11 * 60 * 1000,
      }),
      'utf8',
    )
    const { readPendingOAuthRequest } = await import('@/electron/sync/session')

    expect(() => readPendingOAuthRequest()).toThrow('invalid')
  })

  it('accepts fresh pending OAuth requests', async () => {
    const { readPendingOAuthRequest, writePendingOAuthRequest } = await import('@/electron/sync/session')

    writePendingOAuthRequest({
      state: 'state',
      verifier: 'verifier',
      nonce: 'nonce-1',
      createdAt: Date.now(),
    })

    expect(readPendingOAuthRequest()).toMatchObject({
      state: 'state',
      verifier: 'verifier',
      nonce: 'nonce-1',
    })
  })

  it('requires a fresh token or refresh token before using an expired sync session', async () => {
    const { refreshSyncSession } = await import('@/electron/sync/session')

    await expect(refreshSyncSession(config, {
      accessToken: 'access-token',
      idToken: idToken(),
      appKey,
      expiresAt: Date.now() - 1000,
      account: {
        aveIdentityId: 'identity-1',
      },
    })).rejects.toThrow('expired')
  })

  it('rejects malformed refreshed token fields before replacing the stored session', async () => {
    const sdk = await import('@ave-id/sdk')
    vi.mocked(sdk.refreshToken).mockResolvedValueOnce(tokenResponse({
      access_token: 'x'.repeat(32_769),
      id_token: idToken(),
    }))
    const { refreshSyncSession } = await import('@/electron/sync/session')

    await expect(refreshSyncSession(config, {
      accessToken: 'access-token',
      idToken: idToken({ exp: Math.floor(Date.now() / 1000) - 60 }),
      refreshToken: 'refresh-token',
      appKey,
      expiresAt: Date.now() - 1000,
      account: {
        aveIdentityId: 'identity-1',
      },
    })).rejects.toThrow('access token')
  })

  it('validates Convex sync transport URLs before clients send tokens', () => {
    const source = readFileSync(join(process.cwd(), 'src/electron/sync/manager.ts'), 'utf8')

    expect(source).toContain('normalizeSecureSyncUrl(this.rawConvexUrl())')
    expect(source).toContain('throw new Error(secureSyncUrlError(\'KLARKEY_CONVEX_URL\'))')
    expect(source).toContain('return new ConvexHttpClient(this.requireConvexUrl(), { auth: session.idToken })')
    expect(source).toContain('const convexUrl = this.convexUrl()')
    expect(source).toContain('configured: Boolean(config && convexUrl)')
  })
})
