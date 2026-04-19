export const runtimeApi = globalThis.browser ?? globalThis.chrome
export const nativeHostName = 'app.klarkey.desktop'
export const isChromium = Boolean(globalThis.chrome?.webAuthenticationProxy)
export const browserKind = globalThis.browser ? 'firefox' : isChromium ? 'chromium' : 'other'

let nativePort
let nativePortPromise
let nativePortGeneration = 0
const nativePortRequests = new Map()

let desktopState = {
  connected: false,
  lastError: 'Klarkey desktop is not connected.',
  updatedAt: 0,
}

export const OPERATION_TIMEOUT_MS = 4000
export const HOST_TIMEOUT_MS = 15000

export const createRequestId = () =>
  `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`

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
        reject(new Error(error.message))
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

const updateDesktopState = (connected, lastError) => {
  desktopState = {
    connected,
    lastError,
    updatedAt: Date.now(),
  }
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
    updateDesktopState(true, undefined)
    pending.resolve(response)
  })

  port.onDisconnect.addListener(() => {
    if (generation !== nativePortGeneration) {
      return
    }

    const message = runtimeApi.runtime.lastError?.message || 'Klarkey desktop is not connected.'
    nativePort = undefined
    updateDesktopState(false, message)
    rejectPendingNativeRequests(message)
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
      updateDesktopState(true, undefined)
      return port
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Klarkey desktop is not connected.'
      updateDesktopState(false, message)
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

export async function requestHost(payload) {
  const port = await ensureNativePort()
  const id = createRequestId()

  return withTimeout(
    new Promise((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        nativePortRequests.delete(id)
        reject(new Error('Timed out while contacting the Klarkey desktop bridge.'))
      }, HOST_TIMEOUT_MS)

      nativePortRequests.set(id, {
        resolve,
        reject,
        timeoutId,
      })

      try {
        port.postMessage({
          id,
          ...payload,
        })
      } catch (error) {
        nativePortRequests.delete(id)
        globalThis.clearTimeout(timeoutId)
        reject(error instanceof Error ? error : new Error('Klarkey desktop is not connected.'))
      }
    }),
    'Timed out while contacting the Klarkey desktop bridge.',
    HOST_TIMEOUT_MS,
  )
}

export async function ensureDesktopConnected() {
  const ping = await requestHost({ type: 'ping' })
  return Boolean(ping?.ok)
}

export async function readDesktopCapabilities() {
  const ping = await requestHost({ type: 'ping' })
  if (!ping?.ok) {
    return undefined
  }

  return ping.result
}

export async function readDesktopConnectionState() {
  if (desktopState.connected) {
    return { connected: true }
  }

  const connected = await ensureDesktopConnected().catch((error) => {
    updateDesktopState(false, error instanceof Error ? error.message : 'Klarkey desktop is not connected.')
    return false
  })

  return connected
    ? { connected: true }
    : {
        connected: false,
        error: desktopState.lastError || 'Klarkey desktop is not connected.',
      }
}
