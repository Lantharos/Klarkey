import { extractAppKeyFromUrl, mergeAppKeyFromUrl, normalizeAppKeyBase64 } from '@ave-id/sdk/app-key'
import type { TokenResponse } from '@ave-id/sdk/types'

export interface AveOAuthCallback {
  code: string
  state: string
  appKey: string
}

export function isAveOAuthCallbackUrl(callbackUrl: string) {
  try {
    const url = new URL(callbackUrl)
    return url.protocol === 'klarkey:' && url.host === 'oauth' && url.pathname === '/callback'
  } catch {
    return false
  }
}

export function parseAveOAuthCallback(callbackUrl: string): AveOAuthCallback {
  if (!isAveOAuthCallbackUrl(callbackUrl)) {
    throw new Error('Ave callback URL is invalid.')
  }

  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')?.trim()
  const state = url.searchParams.get('state')?.trim()
  const appKey = normalizeAppKeyBase64(extractAppKeyFromUrl(url))

  if (!code || !state || !appKey) {
    throw new Error('Ave callback is missing code, state, or app_key.')
  }

  return { code, state, appKey }
}

export function mergeAveAppKey(callbackUrl: string, tokens: TokenResponse): TokenResponse {
  const merged = mergeAppKeyFromUrl(callbackUrl, tokens)
  if (!merged.app_key) {
    throw new Error('Ave did not return an app_key for this E2EE app authorization.')
  }
  return merged
}
