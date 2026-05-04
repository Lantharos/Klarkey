import { resolve, sep } from 'node:path'
import { PASSKEY_HOST, PASSKEY_SCHEME } from '@/shared/passkeys'

export interface RendererTrustOptions {
  isDevMode: boolean
  devServerUrl?: string
}

export interface PermissionDetailsLike {
  requestingUrl?: string
  securityOrigin?: string
  isMainFrame?: boolean
}

export interface DisplayMediaRequestLike {
  securityOrigin?: string
  frameUrl?: string
  videoRequested: boolean
  audioRequested: boolean
  userGesture: boolean
}

interface RendererGoneDetailsLike {
  reason?: unknown
  exitCode?: unknown
}

const externalHttpsHosts = new Set(['aveid.net', 'klarkey.com', 'www.klarkey.com'])
const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

export const rendererContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const rendererSecurityHeaderEntries = [
  ['Content-Security-Policy', rendererContentSecurityPolicy],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
] as const

const parseUrl = (value?: string) => {
  if (!value) {
    return undefined
  }

  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const isKlarkeyAppUrl = (url: URL) => url.protocol === `${PASSKEY_SCHEME}:` && url.host === PASSKEY_HOST

const trustedDevOrigin = (options: RendererTrustOptions) => {
  if (!options.isDevMode) {
    return undefined
  }

  const devUrl = parseUrl(options.devServerUrl)
  return devUrl?.origin
}

export const isTrustedRendererUrl = (value: string | undefined, options: RendererTrustOptions) => {
  const url = parseUrl(value)
  if (!url) {
    return false
  }

  if (isKlarkeyAppUrl(url)) {
    return true
  }

  const devOrigin = trustedDevOrigin(options)
  return Boolean(devOrigin && url.origin === devOrigin)
}

export const isTrustedPermissionRequest = (
  requestingOrigin: string | undefined,
  details: PermissionDetailsLike | undefined,
  options: RendererTrustOptions,
) => {
  if (details?.isMainFrame === false) {
    return false
  }

  return isTrustedRendererUrl(details?.requestingUrl ?? details?.securityOrigin ?? requestingOrigin, options)
}

export const shouldAllowDisplayMediaRequest = (
  request: DisplayMediaRequestLike,
  options: RendererTrustOptions,
) =>
  request.videoRequested &&
  !request.audioRequested &&
  request.userGesture &&
  (isTrustedRendererUrl(request.frameUrl, options) || isTrustedRendererUrl(request.securityOrigin, options))

export const isExternalBrowserUrl = (value: string | undefined, options: RendererTrustOptions = { isDevMode: false }) => {
  const url = parseUrl(value)
  if (!url) {
    return false
  }
  if (url.username || url.password) {
    return false
  }
  if (url.protocol === 'http:') {
    return options.isDevMode && localHttpHosts.has(url.hostname)
  }
  if (url.protocol === 'https:') {
    return (!url.port || url.port === '443') && externalHttpsHosts.has(url.hostname)
  }
  return false
}

export const isPathWithinBase = (basePath: string, targetPath: string) => {
  const normalizedBase = basePath.endsWith(sep) ? basePath.slice(0, -1) : basePath
  return targetPath === normalizedBase || targetPath.startsWith(`${normalizedBase}${sep}`)
}

export const resolveRendererAssetPath = (basePath: string, pathname: string) => {
  const indexPath = resolve(basePath, 'index.html')
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const normalizedPath = /\.[a-z0-9]+$/i.test(requestedPath) ? requestedPath : '/index.html'

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(normalizedPath)
  } catch {
    return indexPath
  }

  if (decodedPath.includes('\0')) {
    return indexPath
  }

  const relativePath = decodedPath.startsWith('/') || decodedPath.startsWith('\\')
    ? `.${decodedPath}`
    : `./${decodedPath}`
  const resolvedPath = resolve(basePath, relativePath)

  return isPathWithinBase(basePath, resolvedPath) ? resolvedPath : indexPath
}

export const safeDiagnosticMessage = (value: unknown, fallback = 'An internal event occurred.') => {
  const message = typeof value === 'string' ? value.trim() : value instanceof Error ? value.message.trim() : ''
  if (!message || message.length > 180 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message)) {
    return fallback
  }

  return message
}

export const safeErrorMessage = (error: unknown, fallback = 'An internal error occurred.') =>
  error instanceof Error ? safeDiagnosticMessage(error, fallback) : fallback

export const safeRendererLoadFailureDetails = (code: unknown, description: unknown) => ({
  code: typeof code === 'number' && Number.isFinite(code) ? code : 0,
  description: safeDiagnosticMessage(description, 'Renderer load failed.'),
})

export const safeRendererProcessGoneDetails = (details: RendererGoneDetailsLike | undefined) => ({
  reason: safeDiagnosticMessage(details?.reason, 'unknown'),
  exitCode: typeof details?.exitCode === 'number' && Number.isFinite(details.exitCode) ? details.exitCode : 0,
})
