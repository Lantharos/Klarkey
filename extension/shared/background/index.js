import './webauthn-proxy.js'
import * as handlers from './popup-handlers.js'
import { runtimeApi } from './native-messaging.js'

const ssoTrackingKey = 'klarkey:sso-tracking'
const ssoTrackingTtlMs = 90_000
const ssoTrackingFutureSkewMs = 60_000
const transientStateTtlMs = 300_000
const transientStateMaxBytes = 8192
const transientStateMaxEntries = 64
const transientState = new Map()
const ssoProviders = new Set([
  'Google',
  'GitHub',
  'Apple',
  'Microsoft',
  'Facebook',
  'Twitter',
  'Discord',
  'Slack',
  'LinkedIn',
  'GitLab',
  'Bitbucket',
  'Amazon',
  'Stripe',
  'Auth0',
  'Okta',
  'SAML',
  'SSO',
])
const ssoProviderHostPatterns = {
  Google: [/^(.+\.)?google\.com$/i, /^(.+\.)?googleusercontent\.com$/i],
  GitHub: [/^(.+\.)?github\.com$/i],
  Apple: [/^(.+\.)?apple\.com$/i],
  Microsoft: [/^(.+\.)?live\.com$/i, /^(.+\.)?microsoftonline\.com$/i, /^(.+\.)?microsoft\.com$/i],
  Facebook: [/^(.+\.)?facebook\.com$/i],
  Twitter: [/^(.+\.)?twitter\.com$/i, /^(.+\.)?x\.com$/i],
  Discord: [/^(.+\.)?discord\.com$/i],
  Slack: [/^(.+\.)?slack\.com$/i],
  LinkedIn: [/^(.+\.)?linkedin\.com$/i],
  GitLab: [/^(.+\.)?gitlab\.com$/i],
  Bitbucket: [/^(.+\.)?bitbucket\.org$/i],
  Amazon: [/^(.+\.)?amazon\.com$/i, /^(.+\.)?amazon\.co\.[a-z]+$/i],
  Stripe: [/^(.+\.)?stripe\.com$/i],
  Auth0: [/^(.+\.)?auth0\.com$/i],
  Okta: [/^(.+\.)?okta\.com$/i, /^(.+\.)?okta-emea\.com$/i, /^(.+\.)?oktapreview\.com$/i],
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const boundedString = (value, maxLength, allowEmpty = false) =>
  typeof value === 'string' &&
  value.length <= maxLength &&
  (allowEmpty || value.trim().length > 0)

const readOptionalString = (value, maxLength) =>
  value === undefined
    ? undefined
    : boundedString(value, maxLength, true)
      ? value
      : undefined

const senderUrl = (sender) => {
  const url = sender?.url || sender?.tab?.url
  return typeof url === 'string' ? url : undefined
}

const hostnameForUrl = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname : undefined
  } catch {
    return undefined
  }
}

const normalizeOriginForUrl = (url) => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

const messageUrl = (message) => {
  const directUrl = typeof message?.url === 'string' ? message.url : undefined
  const payloadUrl = isObject(message?.payload) && typeof message.payload.url === 'string' ? message.payload.url : undefined
  const payloadOriginUrl = isObject(message?.payload) && typeof message.payload.originUrl === 'string' ? message.payload.originUrl : undefined
  return directUrl ?? payloadUrl ?? payloadOriginUrl
}

const assertMessageUrlMatchesSender = (message, sender) => {
  const url = messageUrl(message)
  if (!url) {
    return true
  }

  const senderOrigin = normalizeOriginForUrl(senderUrl(sender))
  const payloadOrigin = normalizeOriginForUrl(url)
  return Boolean(senderOrigin && payloadOrigin && senderOrigin === payloadOrigin)
}

const assertMessageOriginMatchesSender = (message, sender) => {
  const origin = isObject(message?.payload) && typeof message.payload.origin === 'string' ? message.payload.origin : undefined
  if (!origin) {
    return true
  }

  return Boolean(normalizeOriginForUrl(senderUrl(sender)) === origin)
}

const senderBoundMessageTypes = new Set([
  'list-logins-for-url',
  'list-field-suggestions',
  'save-login-payload',
  'fetch-login',
  'fetch-identity',
  'fetch-card',
  'plan-passkey-create',
  'create-passkey-credential',
  'save-passkey-credential',
  'discard-passkey-credential',
  'plan-passkey-get',
  'get-passkey-credential',
  'sso-tracking-set',
])
const popupOnlyMessageTypes = new Set([
  'popup-state',
  'fill-login',
  'save-current-login',
])

const isSenderBoundMessage = (message) => senderBoundMessageTypes.has(message?.type)
const isPopupOnlyMessage = (message) => popupOnlyMessageTypes.has(message?.type)

const isExtensionUiSender = (sender) => {
  if (sender?.tab) {
    return false
  }

  const extensionId = runtimeApi.runtime?.id
  if (extensionId && sender?.id && sender.id !== extensionId) {
    return false
  }

  try {
    const url = new URL(sender?.url || '')
    return url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:'
  } catch {
    return false
  }
}

const assertTransientKeyMatchesSender = (payload, sender) => {
  if (!isObject(payload) || !boundedString(payload.key, 512)) {
    return false
  }

  const senderOrigin = normalizeOriginForUrl(senderUrl(sender))
  return Boolean(senderOrigin && payload.key.startsWith('klarkey:') && payload.key.endsWith(`:${senderOrigin}`))
}

const isSameSiteHost = (currentHost, originHost) =>
  Boolean(currentHost && originHost && (currentHost === originHost || currentHost.endsWith(`.${originHost}`)))

const isProviderHost = (hostname, provider) => {
  const patterns = ssoProviderHostPatterns[provider]
  if (!hostname || !patterns?.length) {
    return false
  }

  const normalizedHost = hostname.replace(/^www\./i, '').toLowerCase()
  return patterns.some((pattern) => pattern.test(normalizedHost))
}

const assertSsoTrackingSenderAllowed = (tracking, sender) => {
  const currentHost = hostnameForUrl(senderUrl(sender))
  return Boolean(
    currentHost &&
    (isSameSiteHost(currentHost, tracking?.originHostname) || isProviderHost(currentHost, tracking?.provider)),
  )
}

const isTrackedOriginLookup = async (message, sender) => {
  if (message?.type !== 'list-logins-for-url') {
    return false
  }

  const tracking = await getSsoTracking()
  return Boolean(
    tracking?.originUrl &&
    tracking.originUrl === messageUrl(message) &&
    assertSsoTrackingSenderAllowed(tracking, sender),
  )
}

const sanitizeSsoTracking = (value) => {
  if (!isObject(value) || !ssoProviders.has(value.provider)) {
    return undefined
  }

  if (!boundedString(value.originUrl, 4096) || !boundedString(value.originHostname, 255)) {
    return undefined
  }

  let origin
  try {
    origin = new URL(value.originUrl)
  } catch {
    return undefined
  }

  if ((origin.protocol !== 'https:' && origin.protocol !== 'http:') || origin.hostname !== value.originHostname) {
    return undefined
  }

  const now = Date.now()
  if (!Number.isFinite(value.startedAt) || value.startedAt <= 0 || value.startedAt > now + ssoTrackingFutureSkewMs || now - value.startedAt > ssoTrackingTtlMs) {
    return undefined
  }

  return {
    provider: value.provider,
    originUrl: value.originUrl,
    originTitle: readOptionalString(value.originTitle, 512) ?? '',
    originHostname: value.originHostname,
    startedAt: value.startedAt,
    selectedAccount: readOptionalString(value.selectedAccount, 320),
  }
}

const sanitizeSsoTrackingPatch = (value) => {
  if (!isObject(value)) {
    return undefined
  }

  const selectedAccount = readOptionalString(value.selectedAccount, 320)
  return selectedAccount === undefined
    ? {}
    : { selectedAccount }
}

const pruneTransientState = () => {
  const now = Date.now()
  for (const [key, entry] of transientState.entries()) {
    if (!entry?.expiresAt || now > entry.expiresAt) {
      transientState.delete(key)
    }
  }

  while (transientState.size > transientStateMaxEntries) {
    const oldestKey = transientState.keys().next().value
    if (!oldestKey) {
      return
    }
    transientState.delete(oldestKey)
  }
}

const sanitizeTransientStateEntry = (value) => {
  if (!isObject(value) || !boundedString(value.key, 512)) {
    return undefined
  }

  if (!Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + transientStateTtlMs) {
    return undefined
  }

  const serialized = JSON.stringify(value.value)
  if (serialized === undefined || serialized.length > transientStateMaxBytes) {
    return undefined
  }

  return {
    key: value.key,
    entry: {
      value: value.value,
      expiresAt: value.expiresAt,
    },
  }
}

const getTransientState = (key) => {
  pruneTransientState()
  return transientState.get(key)
}

const setTransientState = (payload) => {
  const next = sanitizeTransientStateEntry(payload)
  if (!next) {
    return false
  }

  pruneTransientState()
  if (!transientState.has(next.key) && transientState.size >= transientStateMaxEntries) {
    const oldestKey = transientState.keys().next().value
    if (oldestKey) {
      transientState.delete(oldestKey)
    }
  }

  transientState.set(next.key, next.entry)
  return true
}

const clearTransientState = (payload) => {
  if (!isObject(payload) || !boundedString(payload.key, 512)) {
    return false
  }

  transientState.delete(payload.key)
  return true
}

async function getSsoTracking() {
  if (!runtimeApi.storage?.local) {
    return undefined
  }

  const stored = await new Promise((resolve, reject) => {
    runtimeApi.storage.local.get([ssoTrackingKey], (result) => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(result?.[ssoTrackingKey])
    })
  }).catch(() => undefined)

  const tracking = sanitizeSsoTracking(stored)
  if (!tracking && stored) {
    await clearSsoTracking()
  }
  return tracking
}

async function setSsoTracking(value) {
  if (!runtimeApi.storage?.local) {
    return
  }

  await new Promise((resolve, reject) => {
    runtimeApi.storage.local.set({ [ssoTrackingKey]: value }, () => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(undefined)
    })
  }).catch(() => undefined)
}

async function clearSsoTracking() {
  if (!runtimeApi.storage?.local) {
    return
  }

  await new Promise((resolve, reject) => {
    runtimeApi.storage.local.remove([ssoTrackingKey], () => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(undefined)
    })
  }).catch(() => undefined)
}

runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    if (isPopupOnlyMessage(message) && !isExtensionUiSender(sender)) {
      sendResponse({
        ok: false,
        message: 'This extension action is only available from Klarkey.',
      })
      return
    }

    if (
      isSenderBoundMessage(message) &&
      (!assertMessageOriginMatchesSender(message, sender) ||
        (!assertMessageUrlMatchesSender(message, sender) && !(await isTrackedOriginLookup(message, sender))))
    ) {
      sendResponse({
        ok: false,
        message: 'The extension request did not match the current tab.',
      })
      return
    }

    switch (message?.type) {
      case 'transient-state-get':
        {
          const key = assertTransientKeyMatchesSender(message.payload, sender) ? message.payload.key : undefined
          sendResponse({ ok: Boolean(key), entry: key ? getTransientState(key) : undefined })
          return
        }
      case 'transient-state-set':
        sendResponse({ ok: assertTransientKeyMatchesSender(message.payload, sender) && setTransientState(message.payload) })
        return
      case 'transient-state-clear':
        sendResponse({ ok: assertTransientKeyMatchesSender(message.payload, sender) && clearTransientState(message.payload) })
        return
      case 'sso-tracking-get':
        {
          const tracking = await getSsoTracking()
          if (tracking && !assertSsoTrackingSenderAllowed(tracking, sender)) {
            sendResponse({ ok: false, tracking: undefined })
            return
          }
          sendResponse({ ok: true, tracking })
        }
        return
      case 'sso-tracking-set':
        {
          const tracking = sanitizeSsoTracking(message.payload)
          if (!tracking) {
            await clearSsoTracking()
            sendResponse({ ok: false })
            return
          }
          await setSsoTracking(tracking)
          sendResponse({ ok: true })
          return
        }
      case 'sso-tracking-update':
        {
          const current = await getSsoTracking()
          const patch = sanitizeSsoTrackingPatch(message.payload)
          if (!current || !patch || !assertSsoTrackingSenderAllowed(current, sender)) {
            sendResponse({ ok: false, tracking: undefined })
            return
          }
          const next = sanitizeSsoTracking({ ...current, ...patch })
          if (!next) {
            await clearSsoTracking()
            sendResponse({ ok: false, tracking: undefined })
            return
          }
          await setSsoTracking(next)
          sendResponse({ ok: true, tracking: next })
          return
        }
      case 'sso-tracking-clear':
        {
          const current = await getSsoTracking()
          if (current && !assertSsoTrackingSenderAllowed(current, sender)) {
            sendResponse({ ok: false })
            return
          }
        }
        await clearSsoTracking()
        sendResponse({ ok: true })
        return
      case 'popup-state':
        sendResponse(await handlers.loadPopupState())
        return
      case 'fill-login':
        sendResponse(await handlers.fillActiveTab(message.itemId))
        return
      case 'save-current-login':
        sendResponse(await handlers.saveCurrentLogin())
        return
      case 'fetch-login':
        sendResponse(await handlers.fillLogin(message.itemId, message.url, message.title))
        return
      case 'fetch-identity':
        sendResponse(await handlers.fetchIdentity(message.itemId, message.url, message.title))
        return
      case 'fetch-card':
        sendResponse(await handlers.fetchCard(message.itemId, message.url, message.title))
        return
      case 'get-browser-settings':
        sendResponse(await handlers.getBrowserSettings())
        return
      case 'plan-passkey-create':
        sendResponse(await handlers.planPasskeyCreate(message.payload))
        return
      case 'create-passkey-credential':
        sendResponse(await handlers.createPasskeyCredential(message.payload))
        return
      case 'save-passkey-credential':
        sendResponse(await handlers.savePasskeyCredential(message.payload))
        return
      case 'discard-passkey-credential':
        sendResponse(await handlers.discardPasskeyCredential(message.payload))
        return
      case 'plan-passkey-get':
        sendResponse(await handlers.planPasskeyGet(message.payload))
        return
      case 'get-passkey-credential':
        sendResponse(await handlers.getPasskeyCredential(message.payload))
        return
      case 'list-logins-for-url':
        sendResponse(await handlers.listLoginsForUrl(message.url, message.title))
        return
      case 'list-field-suggestions':
        sendResponse(await handlers.listFieldSuggestions(message.field, message.flow, message.url, message.title))
        return
      case 'save-login-payload':
        sendResponse(await handlers.saveLoginPayload(message.payload))
        return
      default:
        sendResponse({
          ok: false,
          message: 'Unsupported extension action.',
        })
    }
  })()

  return true
})
