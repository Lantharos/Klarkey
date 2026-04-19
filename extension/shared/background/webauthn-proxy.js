import {
  getActiveTab,
  getPageContext,
  isChromium,
  readDesktopCapabilities,
  requestHost,
  sendTabMessage,
  withTimeout,
} from './native-messaging.js'

let proxyAttached = false
let proxySyncPromise
const canceledPasskeyRequestIds = new Set()

export async function syncProxyAttachment() {
  if (!isChromium) {
    return false
  }

  if (proxySyncPromise) {
    return proxySyncPromise
  }

  proxySyncPromise = (async () => {
    const capabilities = await readDesktopCapabilities().catch(() => undefined)
    const connected = Boolean(capabilities)
    const passkeyProviderReady = Boolean(capabilities?.passkeyProviderReady)

    if (connected && passkeyProviderReady && !proxyAttached) {
      try {
        await withTimeout(globalThis.chrome.webAuthenticationProxy.attach(), 'Timed out while attaching the Chromium passkey proxy.')
        proxyAttached = true
      } catch {
        proxyAttached = false
      }
    }

    if ((!connected || !passkeyProviderReady) && proxyAttached) {
      try {
        await withTimeout(globalThis.chrome.webAuthenticationProxy.detach(), 'Timed out while detaching the Chromium passkey proxy.')
      } finally {
        proxyAttached = false
      }
    }

    return proxyAttached
  })()

  try {
    return await proxySyncPromise
  } finally {
    proxySyncPromise = undefined
  }
}

async function runSiteWebAuthn(tabId, operation, requestDetailsJson) {
  const response = await sendTabMessage(tabId, {
    type: 'run-passkey-operation',
    operation,
    requestDetailsJson,
  })

  if (!response?.ok) {
    return {
      error: response?.error || {
        name: 'NotAllowedError',
        message: 'The page did not complete the passkey request.',
      },
    }
  }

  return response
}

async function withDetachedProxy(task) {
  if (!isChromium) {
    return task()
  }

  const wasAttached = proxyAttached
  if (wasAttached) {
    await globalThis.chrome.webAuthenticationProxy.detach().catch(() => undefined)
    proxyAttached = false
  }

  try {
    return await task()
  } finally {
    if (wasAttached) {
      await globalThis.chrome.webAuthenticationProxy.attach().catch(() => undefined)
      proxyAttached = true
    }
  }
}

function toExtensionError(error) {
  if (error?.name && error?.message) {
    return {
      name: error.name,
      message: error.message,
    }
  }

  if (error instanceof Error) {
    return {
      name: 'NotAllowedError',
      message: error.message,
    }
  }

  return {
    name: 'NotAllowedError',
    message: 'The passkey request could not be completed.',
  }
}

async function completePasskeyRequest(kind, details) {
  const requestId = details?.requestId
  if (typeof requestId === 'number' && canceledPasskeyRequestIds.has(requestId)) {
    canceledPasskeyRequestIds.delete(requestId)
    return false
  }

  try {
    if (kind === 'create') {
      await globalThis.chrome.webAuthenticationProxy.completeCreateRequest(details)
    } else {
      await globalThis.chrome.webAuthenticationProxy.completeGetRequest(details)
    }
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Invalid requestId') || message.includes('canceled')) {
      if (typeof requestId === 'number') {
        canceledPasskeyRequestIds.delete(requestId)
      }
      return false
    }

    throw error
  }
}

async function handlePasskeyGetRequest(requestInfo) {
  const tab = await getActiveTab()
  const pageContext = await getPageContext(tab)

  if (!tab?.id || !pageContext.url) {
    await completePasskeyRequest('get', {
      requestId: requestInfo.requestId,
      error: {
        name: 'NotAllowedError',
        message: 'No active site is available for this passkey request.',
      },
    })
    return
  }

  const plan = await requestHost({
    type: 'passkey-get-request',
    url: pageContext.url,
    title: pageContext.title,
    requestDetailsJson: requestInfo.requestDetailsJson,
  }).catch((error) => ({
    ok: false,
    error: {
      code: 'desktop_unavailable',
      message: error instanceof Error ? error.message : 'Klarkey desktop is not connected.',
    },
  }))

  if (!plan?.ok) {
    await completePasskeyRequest('get', {
      requestId: requestInfo.requestId,
      error: {
        name: 'NotAllowedError',
        message: plan?.error?.message || 'Klarkey desktop is not connected.',
      },
    })
    return
  }

  if (plan.result.status === 'error') {
    await completePasskeyRequest('get', {
      requestId: requestInfo.requestId,
      error: {
        name: 'NotAllowedError',
        message: plan.result.message,
      },
    })
    return
  }

  const pageResult = await withDetachedProxy(() =>
    runSiteWebAuthn(tab.id, 'get', plan.result.requestDetailsJson),
  )

  if (pageResult.error) {
    await completePasskeyRequest('get', {
      requestId: requestInfo.requestId,
      error: toExtensionError(pageResult.error),
    })
    return
  }

  if (pageResult.responseJson) {
    await requestHost({
      type: 'passkey-get-finish',
      credentialId: pageResult.credentialId,
    }).catch(() => undefined)
  }

  await completePasskeyRequest('get', {
    requestId: requestInfo.requestId,
    responseJson: pageResult.responseJson,
  })
}

async function handlePasskeyCreateRequest(requestInfo) {
  const tab = await getActiveTab()
  const pageContext = await getPageContext(tab)

  if (!tab?.id || !pageContext.url) {
    await completePasskeyRequest('create', {
      requestId: requestInfo.requestId,
      error: {
        name: 'NotAllowedError',
        message: 'No active site is available for this passkey registration.',
      },
    })
    return
  }

  const pageResult = await withDetachedProxy(() =>
    runSiteWebAuthn(tab.id, 'create', requestInfo.requestDetailsJson),
  )

  if (pageResult.error) {
    await completePasskeyRequest('create', {
      requestId: requestInfo.requestId,
      error: toExtensionError(pageResult.error),
    })
    return
  }

  if (pageResult.responseJson) {
    await requestHost({
      type: 'passkey-create-finish',
      url: pageContext.url,
      title: pageContext.title,
      requestDetailsJson: requestInfo.requestDetailsJson,
      responseJson: pageResult.responseJson,
    }).catch(() => undefined)
  }

  await completePasskeyRequest('create', {
    requestId: requestInfo.requestId,
    responseJson: pageResult.responseJson,
  })
}

if (isChromium) {
  globalThis.chrome.webAuthenticationProxy.onCreateRequest.addListener((requestInfo) => {
    void handlePasskeyCreateRequest(requestInfo)
  })

  globalThis.chrome.webAuthenticationProxy.onGetRequest.addListener((requestInfo) => {
    void handlePasskeyGetRequest(requestInfo)
  })

  globalThis.chrome.webAuthenticationProxy.onIsUvpaaRequest.addListener((requestInfo) => {
    void (async () => {
      const capabilities = await readDesktopCapabilities().catch(() => undefined)
      await globalThis.chrome.webAuthenticationProxy.completeIsUvpaaRequest({
        requestId: requestInfo.requestId,
        isUvpaa: Boolean(capabilities?.nativeUserVerificationReady),
      })
    })()
  })

  globalThis.chrome.webAuthenticationProxy.onRequestCanceled.addListener((requestId) => {
    canceledPasskeyRequestIds.add(requestId)
    globalThis.setTimeout(() => canceledPasskeyRequestIds.delete(requestId), 30000)
  })

  globalThis.chrome.webAuthenticationProxy.onRemoteSessionStateChange.addListener(() => {
    void syncProxyAttachment()
  })

  globalThis.chrome.runtime.onStartup?.addListener(() => {
    void syncProxyAttachment()
  })

  globalThis.chrome.runtime.onInstalled?.addListener(() => {
    void syncProxyAttachment()
  })

  void syncProxyAttachment()
}
