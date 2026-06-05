import { clearTransientState, getTransientState, hydrateTransientState, setTransientState } from './transient-state.js'

const pendingSaveTtlMs = 120_000

const getPendingSavePrompt = () => {
  const pending = getTransientState('pending-save')
  if ((!pending?.password && !pending?.ssoProvider) || !pending?.createdAt || Date.now() - pending.createdAt > pendingSaveTtlMs) {
    clearTransientState('pending-save')
    return undefined
  }

  return pending
}

const setPendingSavePrompt = (payload) => {
  setTransientState('pending-save', { ...payload, createdAt: Date.now() }, pendingSaveTtlMs)
}

const clearPendingSavePrompt = () => {
  clearTransientState('pending-save')
}

const hydratePendingSavePrompt = () => hydrateTransientState('pending-save')

const promptKeySeed = (() => {
  const values = new Uint32Array(2)
  globalThis.crypto?.getRandomValues?.(values)
  return `${values[0].toString(36)}${values[1].toString(36)}`
})()

const mixPromptKey = (hash, value) => {
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619) >>> 0
  }

  return hash
}

const promptFingerprintFor = (value) => {
  const seedHash = mixPromptKey(2_166_136_261, promptKeySeed)
  return mixPromptKey(mixPromptKey(seedHash, '|'), value || '').toString(36)
}

const savePromptKeyFor = ({ username, password, ssoProvider }) =>
  `${window.location.origin}|${username || ''}|${promptFingerprintFor(password)}|${ssoProvider || ''}`
const passkeyPromptKeyFor = (...parts) => `${window.location.origin}|${parts.filter(Boolean).join('|')}`

export { getPendingSavePrompt, setPendingSavePrompt, clearPendingSavePrompt, hydratePendingSavePrompt, savePromptKeyFor, passkeyPromptKeyFor }
