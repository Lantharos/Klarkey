import { pageState, browserSettings } from '../state.js'
import { sendMessage } from '../runtime.js'
import { showSaveBanner } from '../ui/banners.js'
import { setPendingSavePrompt } from '../pending-save.js'
import {
  clearSsoTracking,
  findBestAccountCandidate,
  getStoredSsoTracking,
  getSsoPromptKey,
  isProviderHost,
  isSameSiteHost,
  providersCompatible,
} from './common.js'

async function refreshMatches() {
  const href = window.location.href
  if (pageState.lastListUrl !== href) {
    pageState.lastListUrl = href
    pageState.matches = []
    pageState.fieldSuggestions = []
  }

  const response = await sendMessage({
    type: 'list-logins-for-url',
    url: href,
    title: document.title,
  }).catch(() => ({ ok: false, matches: [] }))

  pageState.matches = response.ok ? response.matches || [] : []
  return pageState.matches
}

async function maybePromptSsoSave() {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const tracking = await getStoredSsoTracking()
  if (!tracking) {
    return
  }

  const currentHost = window.location.hostname
  const originHost = tracking.originHostname
  if (!currentHost || !originHost) {
    clearSsoTracking()
    return
  }

  if (!isSameSiteHost(currentHost, originHost)) {
    return
  }

  clearSsoTracking()

  const provider = tracking.provider
  if (isProviderHost(currentHost, provider) && isProviderHost(originHost, provider)) {
    clearSsoTracking()
    return
  }

  const accountIdentifier = tracking.selectedAccount || findBestAccountCandidate(provider)
  const promptKey = getSsoPromptKey(provider, `${window.location.href}|${accountIdentifier || ''}`)
  if (pageState.lastSavePromptKey === promptKey || pageState.activeSaveBannerKey === promptKey) {
    return
  }

  const matches = pageState.matches.length ? pageState.matches : await refreshMatches()
  const exact = accountIdentifier
    ? matches.find((match) => providersCompatible(match.ssoProvider, provider) && (match.username || '').toLowerCase() === accountIdentifier.toLowerCase())
    : matches.find((match) => providersCompatible(match.ssoProvider, provider))

  if (exact) {
    pageState.lastSavePromptKey = promptKey
    return
  }

  const genericExisting = accountIdentifier
    ? matches.find((match) => providersCompatible(match.ssoProvider, provider) && !match.username)
    : undefined

  setPendingSavePrompt({
    username: accountIdentifier || '',
    password: '',
    ssoProvider: provider,
    reason: genericExisting ? 'update' : 'create',
  })

  showSaveBanner({
    username: accountIdentifier || '',
    password: '',
    ssoProvider: provider,
    reason: genericExisting ? 'update' : 'create',
  })

  pageState.lastSavePromptKey = promptKey
}

export { maybePromptSsoSave }
