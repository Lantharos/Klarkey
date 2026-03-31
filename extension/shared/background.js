const runtimeApi = globalThis.browser ?? globalThis.chrome
const nativeHostName = 'app.klarkey.desktop'
const isChromium = Boolean(globalThis.chrome?.webAuthenticationProxy)
let proxyAttached = false
let proxySyncPromise

const createRequestId = () =>
  `req_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`

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

const queryTabs = (queryInfo) =>
  runtimeApi.tabs.query.length === 1 ? runtimeApi.tabs.query(queryInfo) : withCallback(runtimeApi.tabs.query, queryInfo)

const sendTabMessage = (tabId, message) =>
  runtimeApi.tabs.sendMessage.length <= 2
    ? runtimeApi.tabs.sendMessage(tabId, message)
    : withCallback(runtimeApi.tabs.sendMessage, tabId, message)

const sendNativeMessage = (message) =>
  runtimeApi.runtime.sendNativeMessage.length === 2
    ? runtimeApi.runtime.sendNativeMessage(nativeHostName, message)
    : withCallback(runtimeApi.runtime.sendNativeMessage, nativeHostName, message)

async function getActiveTab() {
  const [tab] = await queryTabs({ active: true, currentWindow: true })
  return tab
}

async function getPageContext(tab) {
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

async function requestHost(payload) {
  return sendNativeMessage({
    id: createRequestId(),
    ...payload,
  })
}

async function ensureDesktopConnected() {
  const ping = await requestHost({ type: 'ping' })
  return Boolean(ping?.ok)
}

async function syncProxyAttachment() {
  if (!isChromium) {
    return false
  }

  if (proxySyncPromise) {
    return proxySyncPromise
  }

  proxySyncPromise = (async () => {
    const connected = await ensureDesktopConnected().catch(() => false)

    if (connected && !proxyAttached) {
      await globalThis.chrome.webAuthenticationProxy.attach().catch(() => undefined)
      proxyAttached = true
    }

    if (!connected && proxyAttached) {
      await globalThis.chrome.webAuthenticationProxy.detach().catch(() => undefined)
      proxyAttached = false
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

async function handlePasskeyGetRequest(requestInfo) {
  const tab = await getActiveTab()
  const pageContext = await getPageContext(tab)

  if (!tab?.id || !pageContext.url) {
    await globalThis.chrome.webAuthenticationProxy.completeGetRequest({
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
    await globalThis.chrome.webAuthenticationProxy.completeGetRequest({
      requestId: requestInfo.requestId,
      error: {
        name: 'NotAllowedError',
        message: plan?.error?.message || 'Klarkey desktop is not connected.',
      },
    })
    return
  }

  if (plan.result.status === 'error') {
    await globalThis.chrome.webAuthenticationProxy.completeGetRequest({
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
    await globalThis.chrome.webAuthenticationProxy.completeGetRequest({
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

  await globalThis.chrome.webAuthenticationProxy.completeGetRequest({
    requestId: requestInfo.requestId,
    responseJson: pageResult.responseJson,
  })
}

async function handlePasskeyCreateRequest(requestInfo) {
  const tab = await getActiveTab()
  const pageContext = await getPageContext(tab)

  if (!tab?.id || !pageContext.url) {
    await globalThis.chrome.webAuthenticationProxy.completeCreateRequest({
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
    await globalThis.chrome.webAuthenticationProxy.completeCreateRequest({
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

  await globalThis.chrome.webAuthenticationProxy.completeCreateRequest({
    requestId: requestInfo.requestId,
    responseJson: pageResult.responseJson,
  })
}

async function loadPopupState() {
  const tab = await getActiveTab()
  const pageContext = await getPageContext(tab)
  const chromiumProxyReady = await syncProxyAttachment().catch(() => false)

  try {
    const [ping, matches, passkeys] = await Promise.all([
      requestHost({ type: 'ping' }),
      pageContext.url ? requestHost({ type: 'list-logins', url: pageContext.url, title: pageContext.title }) : undefined,
      pageContext.url && isChromium
        ? requestHost({ type: 'passkeys-status', url: pageContext.url })
        : Promise.resolve({
            ok: true,
            result: {
              supported: false,
              reason: 'This browser does not expose a passkey interception API like Chromium webAuthenticationProxy.',
            },
          }),
    ])

    return {
      connected: Boolean(ping?.ok),
      desktopRequired: true,
      url: pageContext.url,
      title: pageContext.title,
      matches: matches?.ok ? matches.result.matches : [],
      form: pageContext.form,
      passkeys: passkeys?.ok ? passkeys.result : undefined,
      chromiumProxyReady,
      error: matches?.ok ? undefined : matches?.error?.message,
    }
  } catch (error) {
    return {
      connected: false,
      desktopRequired: true,
      url: pageContext.url,
      title: pageContext.title,
      matches: [],
      form: pageContext.form,
      chromiumProxyReady,
      error: error instanceof Error ? error.message : 'Klarkey desktop is not connected.',
    }
  }
}

async function fillLogin(itemId) {
  const response = await requestHost({ type: 'get-login', itemId })
  if (!response?.ok || !response.result.login) {
    return { ok: false, message: response?.error?.message || 'The selected login could not be loaded.' }
  }

  return {
    ok: true,
    login: response.result.login,
    message: 'Login loaded.',
  }
}

async function fillActiveTab(itemId) {
  const tab = await getActiveTab()
  if (!tab?.id) {
    return { ok: false, message: 'No active tab is available.' }
  }

  const fillState = await fillLogin(itemId)
  if (!fillState.ok || !fillState.login) {
    return fillState
  }

  try {
    const fillResult = await sendTabMessage(tab.id, {
      type: 'fill-login',
      login: fillState.login,
    })

    return {
      ok: Boolean(fillResult?.ok),
      message: fillResult?.message || 'Filled the current page.',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Klarkey could not reach the page.',
    }
  }
}

async function saveCurrentLogin() {
  const tab = await getActiveTab()
  const pageContext = await getPageContext(tab)
  const form = pageContext.form

  if (!pageContext.url || !form?.password) {
    return {
      ok: false,
      message: 'No password field was detected on the active page.',
    }
  }

  const response = await requestHost({
    type: 'save-login',
    payload: {
      url: pageContext.url,
      title: pageContext.title,
      username: form.username,
      password: form.password,
    },
  })

  if (!response?.ok) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not save this login.',
    }
  }

  return {
    ok: response.result.status !== 'error',
    message: response.result.message,
    result: response.result,
  }
}

async function listLoginsForUrl(url, title) {
  const response = await requestHost({ type: 'list-logins', url, title })
  if (!response?.ok) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not load matching items.',
      matches: [],
    }
  }

  return {
    ok: true,
    matches: response.result.matches || [],
  }
}

async function saveLoginPayload(payload) {
  const response = await requestHost({
    type: 'save-login',
    payload,
  })

  if (!response?.ok) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not save this login.',
    }
  }

  return {
    ok: response.result.status !== 'error',
    message: response.result.message,
    result: response.result,
  }
}

if (isChromium) {
  globalThis.chrome.webAuthenticationProxy.onCreateRequest.addListener((requestInfo) => {
    void handlePasskeyCreateRequest(requestInfo)
  })

  globalThis.chrome.webAuthenticationProxy.onGetRequest.addListener((requestInfo) => {
    void handlePasskeyGetRequest(requestInfo)
  })

  globalThis.chrome.webAuthenticationProxy.onIsUvpaaRequest.addListener((requestInfo) => {
    void globalThis.chrome.webAuthenticationProxy.completeIsUvpaaRequest({
      requestId: requestInfo.requestId,
      isUvpaa: true,
    })
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

runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    switch (message?.type) {
      case 'popup-state':
        sendResponse(await loadPopupState())
        return
      case 'fill-login':
        sendResponse(await fillActiveTab(message.itemId))
        return
      case 'save-current-login':
        sendResponse(await saveCurrentLogin())
        return
      case 'fetch-login':
        sendResponse(await fillLogin(message.itemId))
        return
      case 'list-logins-for-url':
        sendResponse(await listLoginsForUrl(message.url, message.title))
        return
      case 'save-login-payload':
        sendResponse(await saveLoginPayload(message.payload))
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
