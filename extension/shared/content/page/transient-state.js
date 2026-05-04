import { sendMessage } from './runtime.js'

const values = new Map()
const defaultTtlMs = 120_000

const keyFor = (name) => `klarkey:${name}:${window.location.origin}`

const readEntry = (name) => {
  const key = keyFor(name)
  const entry = values.get(key)
  if (!entry) {
    return undefined
  }

  if (!entry.expiresAt || Date.now() > entry.expiresAt) {
    values.delete(key)
    void sendMessage({ type: 'transient-state-clear', payload: { key } }).catch(() => undefined)
    return undefined
  }

  return entry.value
}

const getTransientState = (name, fallback = undefined) => readEntry(name) ?? fallback

const setTransientState = (name, value, ttlMs = defaultTtlMs) => {
  const key = keyFor(name)
  const expiresAt = Date.now() + ttlMs
  values.set(key, { value, expiresAt })
  void sendMessage({ type: 'transient-state-set', payload: { key, value, expiresAt } }).catch(() => undefined)
}

const clearTransientState = (name) => {
  const key = keyFor(name)
  values.delete(key)
  void sendMessage({ type: 'transient-state-clear', payload: { key } }).catch(() => undefined)
}

const hydrateTransientState = async (name) => {
  const key = keyFor(name)
  const response = await sendMessage({ type: 'transient-state-get', payload: { key } }).catch(() => undefined)
  const entry = response?.ok ? response.entry : undefined
  if (!entry || !entry.expiresAt || Date.now() > entry.expiresAt) {
    values.delete(key)
    return undefined
  }

  values.set(key, entry)
  return entry.value
}

export { getTransientState, setTransientState, clearTransientState, hydrateTransientState }
