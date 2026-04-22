import { pendingSaveStorageKey } from './state.js'

const getPendingSavePrompt = () => {
  try {
    const raw = window.sessionStorage.getItem(pendingSaveStorageKey)
    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw)
    if ((!parsed?.password && !parsed?.ssoProvider) || !parsed?.createdAt || Date.now() - parsed.createdAt > 30_000) {
      window.sessionStorage.removeItem(pendingSaveStorageKey)
      return undefined
    }

    return parsed
  } catch {
    return undefined
  }
}

const setPendingSavePrompt = (payload) => {
  try {
    window.sessionStorage.setItem(
      pendingSaveStorageKey,
      JSON.stringify({
        ...payload,
        createdAt: Date.now(),
      }),
    )
  } catch {
    return
  }
}

const clearPendingSavePrompt = () => {
  try {
    window.sessionStorage.removeItem(pendingSaveStorageKey)
  } catch {
    return
  }
}

const savePromptKeyFor = ({ username, password, ssoProvider }) => `${window.location.hostname}|${username || ''}|${password || ''}|${ssoProvider || ''}`
const passkeyPromptKeyFor = (...parts) => `${window.location.hostname}|${parts.filter(Boolean).join('|')}`

export { getPendingSavePrompt, setPendingSavePrompt, clearPendingSavePrompt, savePromptKeyFor, passkeyPromptKeyFor }
