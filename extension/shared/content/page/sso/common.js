import { sendMessage } from '../runtime.js'
import { queryAllDeep, readFieldValue, visible } from '../dom.js'
import { clearTransientState, getTransientState, setTransientState } from '../transient-state.js'

const SSO_KEYWORDS = [
  'sign in with',
  'signin with',
  'login with',
  'log in with',
  'continue with',
  'continue to',
  'sign up with',
  'signup with',
  'register with',
  'single sign-on',
  'single sign on',
]

const SSO_PROVIDERS = [
  { name: 'Google', patterns: [/google/i, /gmail/i] },
  { name: 'GitHub', patterns: [/github/i] },
  { name: 'Apple', patterns: [/apple/i, /sign in with apple/i] },
  { name: 'Microsoft', patterns: [/microsoft/i, /live\.com/i, /outlook/i] },
  { name: 'Facebook', patterns: [/facebook/i, /fb/i] },
  { name: 'Twitter', patterns: [/twitter/i, /x\.com/i] },
  { name: 'Discord', patterns: [/discord/i] },
  { name: 'Slack', patterns: [/slack/i] },
  { name: 'LinkedIn', patterns: [/linkedin/i] },
  { name: 'GitLab', patterns: [/gitlab/i] },
  { name: 'Bitbucket', patterns: [/bitbucket/i] },
  { name: 'Amazon', patterns: [/amazon/i, /aws/i] },
  { name: 'Stripe', patterns: [/stripe/i] },
  { name: 'Auth0', patterns: [/auth0/i] },
  { name: 'Okta', patterns: [/okta/i] },
  { name: 'SAML', patterns: [/\bsaml\b/i] },
  { name: 'SSO', patterns: [/\bsso\b/i, /single sign[ -]?on/i] },
]

const SSO_PROVIDER_HOST_PATTERNS = {
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
  Amazon: [/^(.+\.)?amazon\.com$/i, /^(.+\.)?amazonaws\.com$/i],
  Stripe: [/^(.+\.)?stripe\.com$/i],
  Auth0: [/^(.+\.)?auth0\.com$/i],
  Okta: [/^(.+\.)?okta\.com$/i],
}

const ssoTrackingTtlMs = 90_000
const ENTERPRISE_SSO_PROVIDERS = new Set(['Okta', 'Auth0', 'SSO', 'SAML'])
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

let trackedMatchCacheKey = ''
let trackedMatchCache = []
let globalSsoCaptureAttached = false
let ssoTrackingHydrated = false

function isSameSiteHost(currentHost, originHost) {
  return currentHost === originHost || currentHost.endsWith(`.${originHost}`) || originHost.endsWith(`.${currentHost}`)
}

function detectSsoProvider(text) {
  const lower = text.toLowerCase()
  for (const provider of SSO_PROVIDERS) {
    if (provider.patterns.some((pattern) => pattern.test(lower))) {
      return provider.name
    }
  }
  return undefined
}

function getSsoSignals(element) {
  return [
    element.textContent || '',
    element instanceof HTMLElement ? element.innerText || '' : '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || '',
    element.getAttribute('name') || '',
    element.getAttribute('value') || '',
    element.getAttribute('id') || '',
    element.getAttribute('class') || '',
    element.getAttribute('data-provider') || '',
    element.getAttribute('data-testid') || '',
    element.getAttribute('href') || '',
    element.getAttribute('action') || '',
  ].join(' ')
}

function providersCompatible(savedProvider, detectedProvider) {
  if (!savedProvider || !detectedProvider) {
    return false
  }

  if (savedProvider.toLowerCase() === detectedProvider.toLowerCase()) {
    return true
  }

  return ENTERPRISE_SSO_PROVIDERS.has(savedProvider) && ENTERPRISE_SSO_PROVIDERS.has(detectedProvider)
}

function isProviderHost(hostname, provider) {
  const patterns = SSO_PROVIDER_HOST_PATTERNS[provider]
  if (!hostname || !patterns?.length) {
    return false
  }

  const normalizedHost = hostname.replace(/^www\./i, '').toLowerCase()
  return patterns.some((pattern) => pattern.test(normalizedHost))
}

function extractAccountIdentifierFromText(value) {
  return value.match(EMAIL_PATTERN)?.[0]
}

function extractAccountIdentifierFromElement(element) {
  const signal = [
    getSsoSignals(element),
    readFieldValue(element),
    element.getAttribute('data-email') || '',
    element.getAttribute('data-identifier') || '',
    element.getAttribute('data-user') || '',
    element.getAttribute('data-username') || '',
  ].join(' ')

  return extractAccountIdentifierFromText(signal)
}

function extractAccountIdentifierFromTarget(target) {
  let current = target
  for (let depth = 0; current instanceof Element && depth < 12; depth += 1) {
    const identifier = extractAccountIdentifierFromElement(current)
    if (identifier) {
      return identifier
    }
    current = current.parentElement
  }

  return undefined
}

function extractAccountIdentifierFromPath(path) {
  for (const entry of path) {
    if (!(entry instanceof Element)) {
      continue
    }

    const identifier = extractAccountIdentifierFromElement(entry)
    if (identifier) {
      return identifier
    }
  }

  for (const entry of path) {
    if (!(entry instanceof Element)) {
      continue
    }

    const descendants = entry.querySelectorAll?.('*')
    if (!descendants) {
      continue
    }

    for (const descendant of descendants) {
      const identifier = extractAccountIdentifierFromElement(descendant)
      if (identifier) {
        return identifier
      }
    }
  }

  return undefined
}

function getDirectChildByClass(element, className) {
  for (const child of element.children) {
    if (child.classList.contains(className)) {
      return child
    }
  }

  return undefined
}

function getGoogleAccountRows() {
  return queryAllDeep(document, '.ZfdVuf').filter((element) => element instanceof HTMLElement)
}

function getGoogleAccountClickTarget(row) {
  if (!(row instanceof Element)) {
    return undefined
  }

  return getDirectChildByClass(row, 'Y9aYob') || row
}

function extractProviderSpecificAccount(target, tracking) {
  if (window.location.hostname.includes('google.com')) {
    const googleRow = target.closest('.ZfdVuf')
    if (googleRow) {
      return extractAccountIdentifierFromElement(googleRow)
    }
  }

  if (!tracking || isSameSiteHost(window.location.hostname, tracking.originHostname)) {
    return undefined
  }

  return undefined
}

function setSsoTracking(payload) {
  setTransientState('sso-flow', payload, ssoTrackingTtlMs)

  void sendMessage({ type: 'sso-tracking-set', payload }).catch(() => undefined)
}

function updateSsoTracking(patch) {
  const current = getSsoTracking()
  if (current) {
    setSsoTracking({
      ...current,
      ...patch,
    })
  }

  void sendMessage({ type: 'sso-tracking-update', payload: patch }).catch(() => undefined)
}

function clearSsoTracking() {
  clearTransientState('sso-flow')

  void sendMessage({ type: 'sso-tracking-clear' }).catch(() => undefined)
}

function getSsoTracking() {
  const data = getTransientState('sso-flow')
  if (!data) {
    return undefined
  }

  if (!data.startedAt || Date.now() - data.startedAt > ssoTrackingTtlMs) {
    clearSsoTracking()
    return undefined
  }

  return data
}

async function getStoredSsoTracking() {
  const local = getSsoTracking()
  if (local) {
    return local
  }

  const response = await sendMessage({ type: 'sso-tracking-get' }).catch(() => undefined)
  const tracking = response?.ok ? response.tracking : undefined
  if (!tracking?.startedAt || Date.now() - tracking.startedAt > 90_000) {
    if (tracking) {
      clearSsoTracking()
    }
    return undefined
  }

  return tracking
}

async function hydrateStoredSsoTracking() {
  if (ssoTrackingHydrated) {
    return getSsoTracking()
  }

  const tracking = await getStoredSsoTracking()
  if (tracking) {
    setTransientState('sso-flow', tracking, ssoTrackingTtlMs)
  }

  ssoTrackingHydrated = true
  return tracking
}

function isSsoButton(element) {
  if (element.closest('.klarkey-inline-root')) {
    return undefined
  }

  const text = getSsoSignals(element)
  const lower = text.toLowerCase()
  if (!SSO_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return undefined
  }

  return detectSsoProvider(text)
}

function findSsoButtons() {
  const candidates = document.querySelectorAll('a, button, [role="button"], input[type="submit"]')
  const results = []
  for (const element of candidates) {
    const provider = isSsoButton(element)
    if (provider) {
      results.push({ element, provider })
    }
  }
  return results
}

function getSsoPromptKey(provider, url) {
  return `sso|${provider}|${url}`
}

function findBestAccountCandidate(provider) {
  if (provider === 'Google' && window.location.hostname.includes('google.com')) {
    const ranked = rankGoogleEmailsForPage()
    if (ranked[0]) {
      return ranked[0]
    }
  }

  const providerText = provider.toLowerCase()
  const urlParams = new URLSearchParams(window.location.search)
  for (const key of ['email', 'login_hint', 'username', 'user', 'account']) {
    const value = urlParams.get(key)?.trim()
    if (value && EMAIL_PATTERN.test(value)) {
      return value.match(EMAIL_PATTERN)?.[0]
    }
  }

  const directInputs = queryAllDeep(document, 'input[type="email"], input[autocomplete="email"], input[autocomplete="username"]')
  for (const input of directInputs) {
    const value = readFieldValue(input).trim()
    if (EMAIL_PATTERN.test(value)) {
      return value.match(EMAIL_PATTERN)?.[0]
    }
  }

  let bestCandidate
  let bestScore = -1
  const elements = queryAllDeep(document, 'input, button, a, span, div, p, li, small, strong, td, [aria-label], [title], [data-email], [data-user], [data-username]')
  for (const element of elements) {
    if (!(element instanceof Element) || !visible(element)) {
      continue
    }

    const signal = [
      element.textContent || '',
      element instanceof HTMLElement ? element.innerText || '' : '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('data-email') || '',
      element.getAttribute('data-user') || '',
      element.getAttribute('data-username') || '',
      readFieldValue(element),
    ].join(' ').trim()

    const match = signal.match(EMAIL_PATTERN)
    if (!match) {
      continue
    }

    let score = 40
    const lower = signal.toLowerCase()
    if (lower.includes(providerText)) {
      score += 12
    }
    if (/signed in|continue as|logged in|account|profile|email|user|welcome|last time/.test(lower)) {
      score += 10
    }
    if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement || element instanceof HTMLInputElement) {
      score += 6
    }
    if (signal.length < 120) {
      score += 4
    }

    if (score > bestScore) {
      bestScore = score
      bestCandidate = match[0]
    }
  }

  return bestCandidate
}

function scoreEmailCandidate(map, email, points) {
  map.set(email, (map.get(email) || 0) + points)
}

function emailBelongsToOrigin(email) {
  const host = window.location.hostname.replace(/^www\./i, '').toLowerCase()
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) {
    return false
  }

  return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`)
}

function rankGoogleEmailsForPage() {
  const scores = new Map()

  for (const row of getGoogleAccountRows()) {
    const email = extractAccountIdentifierFromElement(row)
    if (email && !emailBelongsToOrigin(email)) {
      scoreEmailCandidate(scores, email, 30)
    }
  }

  const bodyText = [document.body?.innerText || '', document.body?.textContent || ''].join(' ').slice(0, 200_000)
  for (const match of bodyText.matchAll(new RegExp(EMAIL_PATTERN.source, 'gi'))) {
    const email = match[0]
    if (!emailBelongsToOrigin(email)) {
      scoreEmailCandidate(scores, email, 1)
    }
  }

  const urlParams = new URLSearchParams(window.location.search)
  for (const key of ['email', 'login_hint']) {
    const value = urlParams.get(key)?.trim()
    if (value && EMAIL_PATTERN.test(value) && !emailBelongsToOrigin(value)) {
      scoreEmailCandidate(scores, value.match(EMAIL_PATTERN)?.[0] || value, 40)
    }
  }

  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([email]) => email)
}

function startTrackingSso(provider) {
  trackedMatchCacheKey = ''
  trackedMatchCache = []
  setSsoTracking({
    provider,
    originUrl: window.location.href,
    originTitle: document.title,
    originHostname: window.location.hostname,
    startedAt: Date.now(),
  })
}

async function maybeCaptureVisibleProviderAccount() {
  const tracking = await getStoredSsoTracking()
  if (!tracking || isSameSiteHost(window.location.hostname, tracking.originHostname) || tracking.selectedAccount) {
    return
  }

  if (tracking.provider === 'Google' && window.location.hostname.includes('google.com')) {
    const ranked = rankGoogleEmailsForPage()
    if (ranked[0]) {
      updateSsoTracking({ selectedAccount: ranked[0] })
      return
    }
  }

  const candidates = []
  if (tracking.provider === 'Google' && window.location.hostname.includes('google.com')) {
    for (const row of getGoogleAccountRows()) {
      const identifier = extractAccountIdentifierFromElement(row)
      if (identifier) {
        candidates.push({ identifier, score: 100 })
      }
    }
  }

  const elements = queryAllDeep(document, 'input[type="email"], [data-email], [data-identifier], button, a, [role="button"], [role="option"], div, span, p, li, strong, small')
  for (const element of elements) {
    if (!(element instanceof Element) || !visible(element)) {
      continue
    }

    const identifier = extractAccountIdentifierFromElement(element)
    if (!identifier) {
      continue
    }

    const rect = element.getBoundingClientRect()
    const signal = getSsoSignals(element).toLowerCase()
    let score = 30
    if (signal.includes(tracking.provider.toLowerCase())) {
      score += 10
    }
    if (/choose an account|account|continue as|signed in|use another account|select/i.test(signal)) {
      score += 12
    }
    if (rect.width > 120 && rect.height > 24) {
      score += 8
    }
    candidates.push({ identifier, score })
  }

  if (!candidates.length) {
    return
  }

  candidates.sort((left, right) => right.score - left.score)
  updateSsoTracking({ selectedAccount: candidates[0].identifier })
}

function captureProviderAccountFromEvent(event) {
  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  const candidate = target.closest('a, button, [role="button"], [role="link"], [role="option"], input[type="submit"], [data-email], [data-identifier]') || target
  const provider = isSsoButton(candidate)
  if (provider) {
    startTrackingSso(provider)
    return
  }

  const tracking = getSsoTracking()
  const accountIdentifier =
    extractProviderSpecificAccount(target, tracking) ||
    extractAccountIdentifierFromPath(event.composedPath?.() || [target]) ||
    extractAccountIdentifierFromTarget(target)

  if (accountIdentifier) {
    updateSsoTracking({ selectedAccount: accountIdentifier })
  }
}

function attachSsoListeners() {
  const buttons = findSsoButtons()
  for (const { element, provider } of buttons) {
    if (element.dataset.klarkeySsoAttached) {
      continue
    }

    element.dataset.klarkeySsoAttached = 'true'
    element.addEventListener('click', () => {
      startTrackingSso(provider)
    })
  }
}

function attachGlobalSsoCapture() {
  if (globalSsoCaptureAttached) {
    return
  }

  globalSsoCaptureAttached = true
  document.addEventListener('pointerdown', captureProviderAccountFromEvent, true)
  document.addEventListener('mousedown', captureProviderAccountFromEvent, true)
  document.addEventListener('click', captureProviderAccountFromEvent, true)
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        captureProviderAccountFromEvent(event)
      }
    },
    true,
  )
}

function scanForSsoButtons() {
  void hydrateStoredSsoTracking()
  attachGlobalSsoCapture()
  attachSsoListeners()
  void maybeCaptureVisibleProviderAccount()
}

async function getTrackedOriginMatches(tracking) {
  const cacheKey = `${tracking.originUrl}|${tracking.provider}`
  if (trackedMatchCacheKey === cacheKey) {
    return trackedMatchCache
  }

  const response = await sendMessage({
    type: 'list-logins-for-url',
    url: tracking.originUrl,
    title: tracking.originTitle,
  }).catch(() => ({ ok: false, matches: [] }))

  trackedMatchCacheKey = cacheKey
  trackedMatchCache = response.ok ? response.matches || [] : []
  return trackedMatchCache
}

export {
  clearSsoTracking,
  extractAccountIdentifierFromElement,
  findBestAccountCandidate,
  findSsoButtons,
  getGoogleAccountClickTarget,
  getGoogleAccountRows,
  getStoredSsoTracking,
  getTrackedOriginMatches,
  getSsoPromptKey,
  hydrateStoredSsoTracking,
  isProviderHost,
  isSameSiteHost,
  maybeCaptureVisibleProviderAccount,
  providersCompatible,
  scanForSsoButtons,
}
