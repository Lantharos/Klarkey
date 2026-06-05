import { exchangeCode, fetchUserInfo, refreshToken } from '@ave-id/sdk'
import type { TokenResponse } from '@ave-id/sdk/types'
import { mergeAveAppKey } from '@/shared/ave-oauth'
import type { SyncAccount } from '@/shared/sync'

export interface SyncSession {
  accessToken: string
  accessTokenJwt?: string
  idToken: string
  refreshToken?: string
  appKey: string
  expiresAt: number
  account: SyncAccount
}

export interface PendingOAuthRequest {
  state: string
  verifier: string
  nonce: string
  createdAt: number
}

export interface AveSyncConfig {
  clientId: string
  redirectUri: string
  issuer: string
  convexUrl: string
}

type IdTokenClaims = {
  sub?: string
  name?: string
  email?: string
  exp?: number
  iss?: string
  aud?: string | string[]
  nonce?: string
}

type VerifiedIdTokenClaims = IdTokenClaims & {
  sub: string
  exp: number
  iss: string
  aud: string | string[]
}

const TOKEN_MAX = 32_768
const APP_KEY_MAX = 4096
const CLOCK_SKEW_MS = 60 * 1000
const OAUTH_REQUEST_MAX_AGE_MS = 10 * 60 * 1000

const isString = (value: unknown, maxLength: number, allowEmpty = false) =>
  typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim()) && !value.includes('\0')

export function isFreshPendingOAuthRequest(value: PendingOAuthRequest | undefined) {
  if (!value || !isString(value.state, APP_KEY_MAX) || !isString(value.verifier, APP_KEY_MAX) || !isString(value.nonce, APP_KEY_MAX)) return false
  return value.createdAt <= Date.now() + CLOCK_SKEW_MS && Date.now() - value.createdAt <= OAUTH_REQUEST_MAX_AGE_MS
}

function requiredTokenString(value: unknown, label: string, maxLength = TOKEN_MAX) {
  if (!isString(value, maxLength)) throw new Error(`Ave ${label} is invalid.`)
  return value as string
}

function optionalTokenString(value: unknown, label: string, maxLength = TOKEN_MAX) {
  if (value === undefined) return undefined
  if (!isString(value, maxLength, true)) throw new Error(`Ave ${label} is invalid.`)
  return value as string
}

function decodeIdTokenSubject(idToken?: string): IdTokenClaims | undefined {
  if (typeof idToken !== 'string' || !isString(idToken, TOKEN_MAX)) return undefined
  try {
    const parts = idToken.split('.')
    if (parts.length !== 3 || !parts[1]) return undefined
    const payload = parts[1].padEnd(Math.ceil(parts[1].length / 4) * 4, '=').replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)) as IdTokenClaims
  } catch {
    return undefined
  }
}

function normalizedIssuer(value: string) {
  return value.replace(/\/+$/, '')
}

function audienceMatches(audience: string | string[] | undefined, clientId: string) {
  return Array.isArray(audience) ? audience.includes(clientId) : audience === clientId
}

function verifiedIdTokenClaims(config: AveSyncConfig, idToken: string | undefined, expectedNonce?: string): VerifiedIdTokenClaims {
  const claims = decodeIdTokenSubject(idToken)
  if (!claims?.sub || !claims.iss || !claims.aud || !claims.exp) throw new Error('Ave did not return a valid identity token.')
  if (normalizedIssuer(claims.iss) !== normalizedIssuer(config.issuer)) throw new Error('Ave identity token issuer did not match this Klarkey session.')
  if (!audienceMatches(claims.aud, config.clientId)) throw new Error('Ave identity token audience did not match this Klarkey app.')
  if (claims.exp * 1000 <= Date.now()) throw new Error('Ave identity token is expired.')
  if (expectedNonce !== undefined && claims.nonce !== expectedNonce) throw new Error('Ave sign-in nonce did not match this Klarkey session.')
  return claims as VerifiedIdTokenClaims
}

export async function exchangeOAuthCode(config: AveSyncConfig, callbackUrl: string, code: string, verifier: string, expectedNonce: string) {
  return sessionFromTokenResponse(config, callbackUrl, await exchangeCode(config, { code, codeVerifier: verifier }), expectedNonce)
}

async function sessionFromTokenResponse(config: AveSyncConfig, callbackUrl: string, tokens: TokenResponse, expectedNonce?: string): Promise<SyncSession> {
  const merged = mergeAveAppKey(callbackUrl, tokens)
  const accessToken = requiredTokenString(merged.access_token, 'access token')
  const accessTokenJwt = optionalTokenString(merged.access_token_jwt, 'access token JWT')
  const idToken = requiredTokenString(merged.id_token, 'identity token')
  const sessionRefreshToken = optionalTokenString(merged.refresh_token, 'refresh token')
  const appKey = requiredTokenString(merged.app_key, 'app key', APP_KEY_MAX)
  const claims = verifiedIdTokenClaims(config, idToken, expectedNonce)
  const userInfo = await fetchUserInfo(config, accessToken).catch(() => undefined)
  if (userInfo?.sub && userInfo.sub !== claims.sub) throw new Error('Ave user info did not match the identity token.')
  return {
    accessToken,
    accessTokenJwt,
    idToken,
    refreshToken: sessionRefreshToken,
    appKey,
    expiresAt: claims.exp * 1000,
    account: {
      aveIdentityId: userInfo?.sub ?? claims.sub,
      displayName: userInfo?.name ?? claims.name,
      email: userInfo?.email ?? claims.email,
    },
  }
}

export async function refreshSyncSession(config: AveSyncConfig, session: SyncSession): Promise<SyncSession> {
  if (session.expiresAt > Date.now() + 60_000) return session
  if (!session.refreshToken) throw new Error('Ave sync session expired. Sign in again.')
  const refreshed = await refreshToken(config, { refreshToken: session.refreshToken })
  const idToken = requiredTokenString(refreshed.id_token, 'identity token')
  const claims = verifiedIdTokenClaims(config, idToken)
  if (claims.sub !== session.account.aveIdentityId) throw new Error('Ave refreshed identity token did not match the signed-in account.')
  return {
    ...session,
    accessToken: requiredTokenString(refreshed.access_token, 'access token'),
    accessTokenJwt: optionalTokenString(refreshed.access_token_jwt, 'access token JWT'),
    idToken,
    refreshToken: optionalTokenString(refreshed.refresh_token, 'refresh token') ?? session.refreshToken,
    expiresAt: claims.exp * 1000,
  }
}
