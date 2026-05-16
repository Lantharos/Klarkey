export const runtimeApi = globalThis.browser ?? globalThis.chrome
export const nativeHostName = 'app.klarkey.desktop'
export const isChromium = Boolean(globalThis.chrome && !globalThis.browser)
export const browserKind = globalThis.browser ? 'firefox' : isChromium ? 'chromium' : 'other'

let nativePort
let nativePortPromise
let nativePortGeneration = 0
const nativePortRequests = new Map()
let lastKnownUnlockedAt = 0
let heartbeatTimer
let reconnectTimer
let heartbeatInFlight = false
let requestCounter = 0

let desktopState = {
  connected: false,
  availability: 'offline',
  lastError: 'Klarkey desktop is not connected.',
  targetVersion: undefined,
  retryAfterSeconds: undefined,
  updatedAt: 0,
}

export const OPERATION_TIMEOUT_MS = 4000
export const HOST_TIMEOUT_MS = 15000
export const UNLOCK_RETRY_WAIT_MS = 120000
export const UNLOCK_REQUEST_TIMEOUT_MS = 120000
export const UNLOCK_POLL_INTERVAL_MS = 350
export const UNLOCK_GRACE_MS = 20000
export const MAX_NATIVE_REQUEST_BYTES = 10 * 1024 * 1024
const DESKTOP_HEARTBEAT_MS = 5000
const DESKTOP_RECONNECT_MS = 10000
const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i
const RETRYABLE_AFTER_UNLOCK_TYPES = new Set([
  'get-login',
  'get-identity',
  'get-card',
  'passkey-create-credential',
  'passkey-save-credential',
  'passkey-get-credential',
])

const randomRequestSuffix = () => {
  const bytes = new Uint8Array(6)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  requestCounter = (requestCounter + 1) % 1_000_000
  return `${Date.now().toString(36)}${requestCounter.toString(36)}`
}

export const createRequestId = () =>
  `req_${Date.now().toString(36)}_${randomRequestSuffix()}`

export const nativeRequestByteLength = (payload) => {
  try {
    const serialized = JSON.stringify(payload)
    return typeof serialized === 'string'
      ? new TextEncoder().encode(serialized).byteLength
      : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export const isNativeRequestSizeAllowed = (payload) =>
  nativeRequestByteLength(payload) <= MAX_NATIVE_REQUEST_BYTES

export const safeExtensionErrorMessage = (error, fallback = 'Klarkey desktop is not connected.') => {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim()
  if (!message || message.length > 180 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message)) {
    return fallback
  }

  return message
}

export const withTimeout = (promise, message, timeoutMs = OPERATION_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      globalThis.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])

const withCallback = (fn, ...args) =>
  new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(safeExtensionErrorMessage(error.message, 'Browser request failed.')))
        return
      }

      resolve(result)
    })
  })

export const queryTabs = (queryInfo) =>
  withTimeout(
    runtimeApi.tabs.query.length === 1 ? runtimeApi.tabs.query(queryInfo) : withCallback(runtimeApi.tabs.query, queryInfo),
    'Timed out while reading the active tab.',
  )

export const sendTabMessage = (tabId, message) =>
  withTimeout(
    runtimeApi.tabs.sendMessage.length <= 2
      ? runtimeApi.tabs.sendMessage(tabId, message)
      : withCallback(runtimeApi.tabs.sendMessage, tabId, message),
    'Timed out while contacting the page.',
  )

export const rejectPendingNativeRequests = (message) => {
  for (const { reject, timeoutId } of nativePortRequests.values()) {
    globalThis.clearTimeout(timeoutId)
    reject(new Error(message))
  }
  nativePortRequests.clear()
}

const buildUpdatingMessage = (targetVersion) =>
  targetVersion
    ? `Klarkey is updating to ${targetVersion}. Try again in about a minute.`
    : 'Klarkey is updating. Try again in about a minute.'

const updateDesktopState = (nextState) => {
  desktopState = {
    ...desktopState,
    ...nextState,
    updatedAt: Date.now(),
  }
}

const applyPingState = (result) => {
  const availability = result?.availability === 'updating' ? 'updating' : 'online'
  const targetVersion = typeof result?.targetVersion === 'string' && result.targetVersion ? result.targetVersion : undefined
  const retryAfterSeconds =
    typeof result?.retryAfterSeconds === 'number' && Number.isFinite(result.retryAfterSeconds) && result.retryAfterSeconds > 0
      ? Math.round(result.retryAfterSeconds)
      : undefined

  updateDesktopState({
    connected: availability === 'online',
    availability,
    targetVersion,
    retryAfterSeconds,
    lastError: availability === 'updating' ? buildUpdatingMessage(targetVersion) : undefined,
  })

  return availability
}

const clearHeartbeat = () => {
  if (heartbeatTimer) {
    globalThis.clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
}

const clearReconnectProbe = () => {
  if (reconnectTimer) {
    globalThis.clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
}

const resetNativePort = (port) => {
  if (port && nativePort && nativePort !== port) {
    return
  }

  const currentPort = nativePort
  nativePort = undefined
  clearHeartbeat()
  if (currentPort) {
    try {
      currentPort.disconnect()
    } catch {
    }
  }
}

const disconnectNativePortForUpdate = () => {
  if (!nativePort) {
    return
  }

  const port = nativePort
  nativePort = undefined
  try {
    port.disconnect()
  } catch {
    // ignore disconnect failures while stepping aside for desktop updates
  }
}

const probeDesktopAvailability = async () => {
  try {
    const ping = await sendHostRequest({ type: 'ping' })
    if (!ping?.ok) {
      return undefined
    }

    applyPingState(ping.result)
    return ping.result
  } catch {
    return undefined
  }
}

const scheduleReconnectProbe = () => {
  if (reconnectTimer || desktopState.availability !== 'updating') {
    return
  }

  reconnectTimer = globalThis.setTimeout(() => {
    reconnectTimer = undefined
    void probeDesktopAvailability().then((result) => {
      if (result?.availability === 'updating' || desktopState.availability === 'updating') {
        scheduleReconnectProbe()
      }
    })
  }, DESKTOP_RECONNECT_MS)
}

const startHeartbeat = () => {
  if (heartbeatTimer) {
    return
  }

  heartbeatTimer = globalThis.setInterval(() => {
    if (!nativePort || heartbeatInFlight) {
      return
    }

    heartbeatInFlight = true
    void probeDesktopAvailability()
      .then((result) => {
        if (result?.availability === 'updating') {
          disconnectNativePortForUpdate()
          scheduleReconnectProbe()
        }
      })
      .finally(() => {
        heartbeatInFlight = false
      })
  }, DESKTOP_HEARTBEAT_MS)
}

const attachNativePortListeners = (port, generation) => {
  port.onMessage.addListener((response) => {
    if (!response?.id) {
      return
    }

    const pending = nativePortRequests.get(response.id)
    if (!pending) {
      return
    }

    nativePortRequests.delete(response.id)
    globalThis.clearTimeout(pending.timeoutId)
    if (pending.payloadType === 'ping' && response?.ok) {
      applyPingState(response.result)
    } else if (desktopState.availability !== 'updating') {
      updateDesktopState({ connected: true, availability: 'online', lastError: undefined })
    }
    pending.resolve(response)
  })

  port.onDisconnect.addListener(() => {
    if (generation !== nativePortGeneration) {
      return
    }

    const message = safeExtensionErrorMessage(runtimeApi.runtime.lastError?.message)
    const pendingMessage = desktopState.availability === 'updating'
      ? desktopState.lastError || buildUpdatingMessage(desktopState.targetVersion)
      : message
    nativePort = undefined
    clearHeartbeat()
    if (desktopState.availability === 'updating') {
      updateDesktopState({ connected: false, lastError: desktopState.lastError || buildUpdatingMessage(desktopState.targetVersion) })
      scheduleReconnectProbe()
    } else {
      updateDesktopState({ connected: false, availability: 'offline', lastError: message, retryAfterSeconds: undefined })
    }
    rejectPendingNativeRequests(pendingMessage)
  })
}

export const ensureNativePort = async () => {
  if (nativePort) {
    return nativePort
  }

  if (nativePortPromise) {
    return nativePortPromise
  }

  nativePortPromise = Promise.resolve()
    .then(() => runtimeApi.runtime.connectNative(nativeHostName))
    .then((port) => {
      nativePortGeneration += 1
      nativePort = port
      attachNativePortListeners(port, nativePortGeneration)
      clearReconnectProbe()
      updateDesktopState({ connected: true, availability: 'online', lastError: undefined })
      startHeartbeat()
      return port
    })
    .catch((error) => {
      const message = safeExtensionErrorMessage(error)
      updateDesktopState({ connected: false, availability: 'offline', lastError: message, retryAfterSeconds: undefined })
      throw new Error(message)
    })
    .finally(() => {
      nativePortPromise = undefined
    })

  return nativePortPromise
}

export async function getActiveTab() {
  const [tab] = await queryTabs({ active: true, currentWindow: true })
  return tab
}

export async function getPageContext(tab) {
  if (!tab?.id) {
    return {
      url: tab?.url,
      title: tab?.title,
    }
  }

  try {
    const context = await sendTabMessage(tab.id, { type: 'collect-page-context' })
    return {
      url: context?.url || tab.url,
      title: context?.title || tab.title,
      form: context?.form,
    }
  } catch {
    return {
      url: tab.url,
      title: tab.title,
    }
  }
}

async function sendHostRequest(payload) {
  const id = createRequestId()
  const nativeRequest = {
    id,
    ...payload,
  }

  if (!isNativeRequestSizeAllowed(nativeRequest)) {
    throw new Error('The browser request was too large to send safely.')
  }

  const port = await ensureNativePort()

  const timeoutMs = RETRYABLE_AFTER_UNLOCK_TYPES.has(payload?.type)
    ? UNLOCK_REQUEST_TIMEOUT_MS
    : HOST_TIMEOUT_MS

  return withTimeout(
    new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        nativePortRequests.delete(id)
        resetNativePort(port)
        updateDesktopState({
          connected: false,
          availability: 'offline',
          lastError: 'Timed out while contacting the Klarkey desktop bridge.',
          retryAfterSeconds: undefined,
        })
        reject(new Error('Timed out while contacting the Klarkey desktop bridge.'))
      }, timeoutMs)

      nativePortRequests.set(id, {
        resolve,
        reject,
        payloadType: payload?.type,
        timeoutId,
      })

      try {
        port.postMessage(nativeRequest)
      } catch (error) {
        nativePortRequests.delete(id)
        globalThis.clearTimeout(timeoutId)
        resetNativePort(port)
        updateDesktopState({
          connected: false,
          availability: 'offline',
          lastError: safeExtensionErrorMessage(error),
          retryAfterSeconds: undefined,
        })
        reject(error instanceof Error ? error : new Error('Klarkey desktop is not connected.'))
      }
    }),
    'Timed out while contacting the Klarkey desktop bridge.',
    timeoutMs,
  )
}

async function waitForDesktopUnlock(timeoutMs = UNLOCK_RETRY_WAIT_MS) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const ping = await sendHostRequest({ type: 'ping' }).catch(() => undefined)
    if (ping?.ok && ping?.result?.availability === 'updating') {
      return false
    }
    if (ping?.ok && ping?.result?.vaultUnlocked) {
      lastKnownUnlockedAt = Date.now()
      return true
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, UNLOCK_POLL_INTERVAL_MS))
  }

  return false
}

const buildUpdatingResponse = () => ({
  ok: false,
  error: {
    code: 'desktop_updating',
    message: desktopState.lastError || buildUpdatingMessage(desktopState.targetVersion),
  },
})

export async function requestHost(payload) {
  if (payload?.type !== 'ping' && desktopState.availability === 'updating') {
    return buildUpdatingResponse()
  }

  const inUnlockGraceWindow = Date.now() - lastKnownUnlockedAt <= UNLOCK_GRACE_MS
  if (inUnlockGraceWindow && RETRYABLE_AFTER_UNLOCK_TYPES.has(payload?.type)) {
    const optimistic = await sendHostRequest(payload)
    if (!(optimistic?.ok && optimistic?.result?.status === 'locked')) {
      return optimistic
    }
  }

  const response = await sendHostRequest(payload)
  const shouldRetryAfterUnlock =
    RETRYABLE_AFTER_UNLOCK_TYPES.has(payload?.type) &&
    response?.ok &&
    response?.result?.status === 'locked'

  if (!shouldRetryAfterUnlock) {
    return response
  }

  const unlocked = await waitForDesktopUnlock()
  if (!unlocked) {
    return response
  }

  lastKnownUnlockedAt = Date.now()
  return sendHostRequest(payload)
}

export async function ensureDesktopConnected() {
  const ping = await requestHost({ type: 'ping' })
  return Boolean(ping?.ok && ping?.result?.availability !== 'updating')
}

export async function readDesktopCapabilities() {
  const ping = await requestHost({ type: 'ping' })
  if (!ping?.ok) {
    return undefined
  }

  return ping.result
}

export async function readDesktopConnectionState() {
  if (desktopState.availability === 'updating') {
    return {
      connected: false,
      updating: true,
      error: desktopState.lastError || buildUpdatingMessage(desktopState.targetVersion),
      targetVersion: desktopState.targetVersion,
    }
  }

  if (desktopState.connected) {
    return { connected: true, updating: false, targetVersion: desktopState.targetVersion }
  }

  const connected = await ensureDesktopConnected().catch((error) => {
    const message = safeExtensionErrorMessage(error)
    updateDesktopState({
      connected: false,
      availability: 'offline',
      lastError: message,
    })
    return false
  })

  return connected
    ? { connected: true, updating: false, targetVersion: desktopState.targetVersion }
    : {
        connected: false,
        updating: false,
        error: desktopState.lastError || 'Klarkey desktop is not connected.',
        targetVersion: desktopState.targetVersion,
      }
}
