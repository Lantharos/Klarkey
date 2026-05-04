import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { TokenResponse } from '@ave-id/sdk/types'
import { fetchUserInfo, refreshToken } from '@ave-id/sdk'
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

const sessionFile = () => join(app.getPath('userData'), 'sync-session.v1')
const pendingFile = () => join(app.getPath('userData'), 'sync-oauth-pending.v1')
const TOKEN_MAX = 32_768
const APP_KEY_MAX = 4096
const ID_MAX = 4096
const DISPLAY_MAX = 4096
const OAUTH_SECRET_MAX = 4096
const OAUTH_REQUEST_MAX_AGE_MS = 10 * 60 * 1000
const CLOCK_SKEW_MS = 60 * 1000
const SECURE_FILE_MAX_BYTES = 256 * 1024
const PRIVATE_FILE_MODE = 0o600

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0) && !value.includes('\0')
}

function isOptionalString(value: unknown, maxLength: number) {
  return value === undefined || isString(value, maxLength, true)
}

function requiredTokenString(value: unknown, label: string, maxLength = TOKEN_MAX) {
  if (!isString(value, maxLength)) {
    throw new Error(`Ave ${label} is invalid.`)
  }
  return value
}

function optionalTokenString(value: unknown, label: string, maxLength = TOKEN_MAX) {
  if (value === undefined) {
    return undefined
  }
  if (!isString(value, maxLength, true)) {
    throw new Error(`Ave ${label} is invalid.`)
  }
  return value
}

function isFutureSafeInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isFreshOAuthRequestTimestamp(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return false
  }
  const now = Date.now()
  const timestamp = value as number
  return timestamp <= now + CLOCK_SKEW_MS && now - timestamp <= OAUTH_REQUEST_MAX_AGE_MS
}

function isSyncAccount(value: unknown): value is SyncAccount {
  return isRecord(value) &&
    isString(value.aveIdentityId, ID_MAX) &&
    isOptionalString(value.displayName, DISPLAY_MAX) &&
    isOptionalString(value.email, DISPLAY_MAX)
}

function isSyncSession(value: unknown): value is SyncSession {
  return isRecord(value) &&
    isString(value.accessToken, TOKEN_MAX) &&
    isOptionalString(value.accessTokenJwt, TOKEN_MAX) &&
    isString(value.idToken, TOKEN_MAX) &&
    isOptionalString(value.refreshToken, TOKEN_MAX) &&
    isString(value.appKey, APP_KEY_MAX) &&
    isFutureSafeInteger(value.expiresAt) &&
    isSyncAccount(value.account)
}

function isPendingOAuthRequest(value: unknown): value is PendingOAuthRequest {
  return isRecord(value) &&
    isString(value.state, OAUTH_SECRET_MAX) &&
    isString(value.verifier, OAUTH_SECRET_MAX) &&
    isString(value.nonce, OAUTH_SECRET_MAX) &&
    isFreshOAuthRequestTimestamp(value.createdAt)
}

function encodeSecure(value: unknown) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available for Ave sync tokens.')
  }
  return safeStorage.encryptString(JSON.stringify(value)).toString('base64')
}

function decodeSecure<Value>(payload: string): Value {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available for Ave sync tokens.')
  }
  return JSON.parse(safeStorage.decryptString(Buffer.from(payload, 'base64'))) as Value
}

function writeSecureFile(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error('Stored Ave sync secret is invalid.')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const fd = openSync(path, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | noFollow, PRIVATE_FILE_MODE)
  try {
    if (!fstatSync(fd).isFile()) {
      throw new Error('Stored Ave sync secret is invalid.')
    }
    writeFileSync(fd, encodeSecure(value), { encoding: 'utf8' })
    try {
      fchmodSync(fd, PRIVATE_FILE_MODE)
    } catch {
      void 0
    }
  } finally {
    closeSync(fd)
  }
  try {
    chmodSync(path, PRIVATE_FILE_MODE)
  } catch {
    void 0
  }
}

function readSecureFile<Value>(path: string): Value | undefined {
  if (!existsSync(path)) {
    return undefined
  }
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > SECURE_FILE_MAX_BYTES) {
    throw new Error('Stored Ave sync secret is invalid.')
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const fd = openSync(path, constants.O_RDONLY | noFollow)
  try {
    const openedStats = fstatSync(fd)
    if (!openedStats.isFile() || openedStats.size <= 0 || openedStats.size > SECURE_FILE_MAX_BYTES) {
      throw new Error('Stored Ave sync secret is invalid.')
    }
    return decodeSecure<Value>(readFileSync(fd, 'utf8'))
  } finally {
    closeSync(fd)
  }
}

function decodeIdTokenSubject(idToken?: string) {
  if (!isString(idToken, TOKEN_MAX)) {
    return undefined
  }

  try {
    const parts = idToken.split('.')
    if (parts.length !== 3 || !isString(parts[1], TOKEN_MAX)) {
      return undefined
    }
    const payload = parts[1]
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as IdTokenClaims
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
  if (!claims?.sub || !claims.iss || !claims.aud || !claims.exp) {
    throw new Error('Ave did not return a valid identity token.')
  }
  if (normalizedIssuer(claims.iss) !== normalizedIssuer(config.issuer)) {
    throw new Error('Ave identity token issuer did not match this Klarkey session.')
  }
  if (!audienceMatches(claims.aud, config.clientId)) {
    throw new Error('Ave identity token audience did not match this Klarkey app.')
  }
  if (claims.exp * 1000 <= Date.now()) {
    throw new Error('Ave identity token is expired.')
  }
  if (expectedNonce !== undefined && claims.nonce !== expectedNonce) {
    throw new Error('Ave sign-in nonce did not match this Klarkey session.')
  }
  return claims as VerifiedIdTokenClaims
}

export function readSyncSession() {
  const session = readSecureFile<unknown>(sessionFile())
  if (session === undefined) {
    return undefined
  }
  if (!isSyncSession(session)) {
    throw new Error('Stored Ave sync session is invalid.')
  }
  return session
}

export function tryReadSyncSession() {
  try {
    return readSyncSession()
  } catch {
    return undefined
  }
}

export function writeSyncSession(session: SyncSession) {
  writeSecureFile(sessionFile(), session)
}

export function clearSyncSession() {
  try {
    unlinkSync(sessionFile())
  } catch {
    return
  }
}

export function readPendingOAuthRequest() {
  const request = readSecureFile<unknown>(pendingFile())
  if (request === undefined) {
    return undefined
  }
  if (!isPendingOAuthRequest(request)) {
    throw new Error('Stored Ave sign-in request is invalid.')
  }
  return request
}

export function writePendingOAuthRequest(request: PendingOAuthRequest) {
  writeSecureFile(pendingFile(), request)
}

export function clearPendingOAuthRequest() {
  try {
    unlinkSync(pendingFile())
  } catch {
    return
  }
}

export async function sessionFromTokenResponse(config: AveSyncConfig, callbackUrl: string, tokens: TokenResponse, expectedNonce?: string): Promise<SyncSession> {
  const merged = mergeAveAppKey(callbackUrl, tokens)
  const accessToken = requiredTokenString(merged.access_token, 'access token')
  const accessTokenJwt = optionalTokenString(merged.access_token_jwt, 'access token JWT')
  const idToken = requiredTokenString(merged.id_token, 'identity token')
  const sessionRefreshToken = optionalTokenString(merged.refresh_token, 'refresh token')
  const appKey = requiredTokenString(merged.app_key, 'app key', APP_KEY_MAX)
  const claims = verifiedIdTokenClaims(config, idToken, expectedNonce)
  const userInfo = await fetchUserInfo(config, accessToken).catch(() => undefined)
  if (userInfo?.sub && userInfo.sub !== claims.sub) {
    throw new Error('Ave user info did not match the identity token.')
  }
  const aveIdentityId = userInfo?.sub ?? claims?.sub ?? merged.user_id ?? merged.user?.id

  if (!aveIdentityId) {
    throw new Error('Ave did not return the identity token required by Convex sync.')
  }

  return {
    accessToken,
    accessTokenJwt,
    idToken,
    refreshToken: sessionRefreshToken,
    appKey,
    expiresAt: claims.exp * 1000,
    account: {
      aveIdentityId,
      displayName: userInfo?.name ?? merged.user?.displayName ?? claims?.name,
      email: userInfo?.email ?? merged.user?.email ?? claims?.email,
    },
  }
}

export async function refreshSyncSession(config: AveSyncConfig, session: SyncSession): Promise<SyncSession> {
  if (session.expiresAt > Date.now() + 60_000) {
    return session
  }
  if (!session.refreshToken) {
    throw new Error('Ave sync session expired. Sign in again.')
  }

  const refreshed = await refreshToken(config, { refreshToken: session.refreshToken })
  const accessToken = requiredTokenString(refreshed.access_token, 'access token')
  const accessTokenJwt = optionalTokenString(refreshed.access_token_jwt, 'access token JWT')
  const idToken = requiredTokenString(refreshed.id_token, 'identity token')
  const sessionRefreshToken = optionalTokenString(refreshed.refresh_token, 'refresh token')

  const claims = verifiedIdTokenClaims(config, idToken)
  if (claims.sub !== session.account.aveIdentityId) {
    throw new Error('Ave refreshed identity token did not match the signed-in account.')
  }
  const next: SyncSession = {
    ...session,
    accessToken,
    accessTokenJwt,
    idToken,
    refreshToken: sessionRefreshToken ?? session.refreshToken,
    expiresAt: claims.exp * 1000,
  }
  writeSyncSession(next)
  return next
}
