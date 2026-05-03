import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
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

const sessionFile = () => join(app.getPath('userData'), 'sync-session.v1')
const pendingFile = () => join(app.getPath('userData'), 'sync-oauth-pending.v1')

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
  writeFileSync(path, encodeSecure(value), 'utf8')
}

function readSecureFile<Value>(path: string): Value | undefined {
  if (!existsSync(path)) {
    return undefined
  }
  return decodeSecure<Value>(readFileSync(path, 'utf8'))
}

function decodeIdTokenSubject(idToken?: string) {
  if (!idToken) {
    return undefined
  }

  try {
    const [, payload] = idToken.split('.')
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as {
      sub?: string
      name?: string
      email?: string
      exp?: number
    }
  } catch {
    return undefined
  }
}

export function readSyncSession() {
  return readSecureFile<SyncSession>(sessionFile())
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
  return readSecureFile<PendingOAuthRequest>(pendingFile())
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

export async function sessionFromTokenResponse(config: AveSyncConfig, callbackUrl: string, tokens: TokenResponse): Promise<SyncSession> {
  const merged = mergeAveAppKey(callbackUrl, tokens)
  const claims = decodeIdTokenSubject(merged.id_token)
  const userInfo = await fetchUserInfo(config, merged.access_token).catch(() => undefined)
  const aveIdentityId = userInfo?.sub ?? claims?.sub ?? merged.user_id ?? merged.user?.id
  const appKey = merged.app_key

  if (!merged.id_token || !aveIdentityId || !appKey) {
    throw new Error('Ave did not return the identity token required by Convex sync.')
  }

  return {
    accessToken: merged.access_token,
    accessTokenJwt: merged.access_token_jwt,
    idToken: merged.id_token,
    refreshToken: merged.refresh_token,
    appKey,
    expiresAt: claims?.exp ? claims.exp * 1000 : Date.now() + Math.max(merged.expires_in - 30, 30) * 1000,
    account: {
      aveIdentityId,
      displayName: userInfo?.name ?? merged.user?.displayName ?? claims?.name,
      email: userInfo?.email ?? merged.user?.email ?? claims?.email,
    },
  }
}

export async function refreshSyncSession(config: AveSyncConfig, session: SyncSession): Promise<SyncSession> {
  if (!session.refreshToken || session.expiresAt > Date.now() + 60_000) {
    return session
  }

  const refreshed = await refreshToken(config, { refreshToken: session.refreshToken })
  if (!refreshed.id_token) {
    throw new Error('Ave refresh did not return the id_token required by Convex sync.')
  }

  const claims = decodeIdTokenSubject(refreshed.id_token)
  const next: SyncSession = {
    ...session,
    accessToken: refreshed.access_token,
    accessTokenJwt: refreshed.access_token_jwt,
    idToken: refreshed.id_token,
    refreshToken: refreshed.refresh_token ?? session.refreshToken,
    expiresAt: claims?.exp ? claims.exp * 1000 : Date.now() + Math.max(refreshed.expires_in - 30, 30) * 1000,
  }
  writeSyncSession(next)
  return next
}
