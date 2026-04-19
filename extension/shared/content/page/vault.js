import { pageState, browserSettings } from './state.js'
import { sendMessage } from './runtime.js'
import { collectFormSnapshot } from './autofill/write-submit.js'
import {
  savePromptKeyFor,
  setPendingSavePrompt,
  clearPendingSavePrompt,
  getPendingSavePrompt,
} from './pending-save.js'
import { showSaveBanner } from './ui/banners.js'

const refreshMatches = async () => {
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
  }).catch((error) => ({
    ok: false,
    matches: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load matching items.',
  }))

  pageState.matches = response.ok ? response.matches || [] : []
  return pageState.matches
}

const refreshFieldSuggestions = async (field, flow) => {
  const response = await sendMessage({
    type: 'list-field-suggestions',
    field,
    flow,
    url: window.location.href,
    title: document.title,
  }).catch((error) => ({
    ok: false,
    suggestions: [],
    message: error instanceof Error ? error.message : 'Klarkey could not load suggestions.',
  }))

  pageState.fieldSuggestions = response.ok ? response.suggestions || [] : []
  return pageState.fieldSuggestions
}

const maybePromptToSave = async (preferredInput, force = false) => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const snapshot = collectFormSnapshot(preferredInput)
  if (!snapshot.password) {
    return
  }

  const promptKey = savePromptKeyFor(snapshot)
  if (pageState.lastSavePromptKey === promptKey || pageState.activeSaveBannerKey === promptKey) {
    return
  }

  const matches = pageState.matches.length ? pageState.matches : await refreshMatches()
  const exact = matches.find((match) => (match.username || '') === snapshot.username)
  if (!exact && !force) {
    setPendingSavePrompt({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    showSaveBanner({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    pageState.lastSavePromptKey = promptKey
    return
  }

  if (!exact) {
    setPendingSavePrompt({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    showSaveBanner({
      username: snapshot.username,
      password: snapshot.password,
      reason: 'create',
    })
    pageState.lastSavePromptKey = promptKey
    return
  }

  const stored = await sendMessage({ type: 'fetch-login', itemId: exact.itemId }).catch(() => undefined)
  const storedPassword = stored?.ok ? stored.login?.password || '' : ''

  if (storedPassword === snapshot.password) {
    pageState.lastSavePromptKey = promptKey
    clearPendingSavePrompt()
    return
  }

  setPendingSavePrompt({
    username: snapshot.username,
    password: snapshot.password,
    reason: exact ? 'update' : 'create',
  })
  showSaveBanner({
    username: snapshot.username,
    password: snapshot.password,
    reason: exact ? 'update' : 'create',
  })
  pageState.lastSavePromptKey = promptKey
}

const restorePendingSavePrompt = () => {
  if (!browserSettings.browserSavePrompts) {
    return
  }

  const pending = getPendingSavePrompt()
  if (!pending) {
    return
  }

  window.setTimeout(() => {
    if (!getPendingSavePrompt()) {
      return
    }

    showSaveBanner({
      username: pending.username,
      password: pending.password,
      reason: pending.reason,
    })
  }, 240)
}

export { refreshMatches, refreshFieldSuggestions, maybePromptToSave, restorePendingSavePrompt }
