import {
  browserKind,
  getActiveTab,
  getPageContext,
  isChromium,
  readDesktopConnectionState,
  requestHost,
  sendTabMessage,
  withTimeout,
} from './native-messaging.js'
import { syncProxyAttachment } from './webauthn-proxy.js'

export async function loadPopupState() {
  const tab = await getActiveTab().catch(() => undefined)
  const pageContext = await getPageContext(tab).catch(() => ({
    url: tab?.url,
    title: tab?.title,
  }))
  const connection = await readDesktopConnectionState()

  if (!connection.connected) {
    return {
      connected: false,
      desktopRequired: true,
      browser: browserKind,
      url: pageContext.url,
      title: pageContext.title,
      form: pageContext.form,
      passkeys: {
        supported: false,
        browser: browserKind,
        mode: isChromium ? 'desktop-proxy' : 'browser-limited',
        conditionalUi: false,
        availablePasskeyCount: 0,
        exactMatchCount: 0,
        linkedMatchCount: 0,
        reason: connection.error || 'Klarkey desktop is not connected.',
      },
      chromiumProxyReady: false,
      error: connection.error || 'Klarkey desktop is not connected.',
    }
  }

  const passkeys = pageContext.url
    ? await requestHost({ type: 'passkeys-status', url: pageContext.url }).catch((error) => ({
        ok: false,
        error: {
          message: error instanceof Error ? error.message : 'Passkey state unavailable.',
        },
      }))
    : {
        ok: true,
        result: {
          supported: false,
          browser: browserKind,
          mode: 'browser-limited',
          conditionalUi: false,
          availablePasskeyCount: 0,
          exactMatchCount: 0,
          linkedMatchCount: 0,
          reason: 'Open a site to check whether Klarkey can help with passkeys there.',
        },
      }

  const chromiumProxyReady = await withTimeout(
    syncProxyAttachment().catch(() => false),
    'Timed out while checking the Chromium passkey proxy.',
    1000,
  ).catch(() => false)

  if (
    isChromium &&
    passkeys?.ok &&
    passkeys.result.supported &&
    passkeys.result.mode === 'desktop-proxy' &&
    !chromiumProxyReady
  ) {
    return {
      connected: true,
      desktopRequired: true,
      browser: browserKind,
      url: pageContext.url,
      title: pageContext.title,
      form: pageContext.form,
      passkeys: {
        supported: false,
        browser: browserKind,
        mode: 'desktop-proxy',
        conditionalUi: false,
        availablePasskeyCount: 0,
        exactMatchCount: 0,
        linkedMatchCount: 0,
        reason: 'Klarkey is connected, but Chromium did not grant passkey proxy control for this session.',
      },
      chromiumProxyReady,
      error: undefined,
    }
  }

  return {
    connected: true,
    desktopRequired: true,
    browser: browserKind,
    url: pageContext.url,
    title: pageContext.title,
    form: pageContext.form,
    passkeys: passkeys?.ok
      ? passkeys.result
      : {
          supported: false,
          reason: passkeys?.error?.message || 'Passkey state unavailable.',
        },
    chromiumProxyReady,
    error: undefined,
  }
}

export async function fillLogin(itemId) {
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

export async function fillActiveTab(itemId) {
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

export async function saveCurrentLogin() {
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

export async function listLoginsForUrl(url, title) {
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

export async function fetchIdentity(itemId) {
  const response = await requestHost({ type: 'get-identity', itemId })
  if (!response?.ok || !response.result.identity) {
    return { ok: false, message: response?.error?.message || 'The selected identity could not be loaded.' }
  }

  return {
    ok: true,
    identity: response.result.identity,
    message: 'Identity loaded.',
  }
}

export async function fetchCard(itemId) {
  const response = await requestHost({ type: 'get-card', itemId })
  if (!response?.ok || !response.result.card) {
    return { ok: false, message: response?.error?.message || 'The selected card could not be loaded.' }
  }

  return {
    ok: true,
    card: response.result.card,
    message: 'Card loaded.',
  }
}

export async function getBrowserSettings() {
  const response = await requestHost({ type: 'get-settings' })
  if (!response?.ok || !response.result.settings) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not load browser settings.',
    }
  }

  return {
    ok: true,
    settings: response.result.settings,
  }
}

export async function planPasskeyCreate(payload) {
  const response = await requestHost({
    type: 'passkey-create-plan',
    ...payload,
  })

  if (!response?.ok || !response.result.plan) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not prepare this passkey.',
    }
  }

  return {
    ok: true,
    plan: response.result.plan,
  }
}

export async function createPasskeyCredential(payload) {
  const response = await requestHost({
    type: 'passkey-create-credential',
    ...payload,
  })

  if (!response?.ok || !response.result.responseJson) {
    return {
      ok: false,
      message:
        response?.error?.message ||
        response?.result?.message ||
        'Klarkey could not create this passkey.',
    }
  }

  return {
    ok: true,
    responseJson: response.result.responseJson,
    credentialId: response.result.credentialId,
    pendingPasskeyId: response.result.pendingPasskeyId,
  }
}

export async function savePasskeyCredential(payload) {
  const response = await requestHost({
    type: 'passkey-save-credential',
    ...payload,
  })

  if (!response?.ok) {
    return {
      ok: false,
      message: response?.error?.message || response?.result?.message || 'Klarkey could not save this passkey.',
    }
  }

  return {
    ok: true,
    message: response.result?.message || 'Passkey saved.',
    itemId: response.result?.itemId,
  }
}

export async function discardPasskeyCredential(payload) {
  const response = await requestHost({
    type: 'passkey-discard-credential',
    ...payload,
  })

  if (!response?.ok) {
    return {
      ok: false,
      message: response?.error?.message || response?.result?.message || 'Klarkey could not clear this passkey.',
    }
  }

  return {
    ok: true,
    message: response.result?.message || 'Passkey cleared.',
  }
}

export async function planPasskeyGet(payload) {
  const response = await requestHost({
    type: 'passkey-get-plan',
    ...payload,
  })

  if (!response?.ok || !Array.isArray(response.result.choices)) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not prepare a passkey sign-in.',
    }
  }

  return {
    ok: true,
    choices: response.result.choices,
  }
}

export async function getPasskeyCredential(payload) {
  const response = await requestHost({
    type: 'passkey-get-credential',
    ...payload,
  })

  if (!response?.ok || !response.result.responseJson) {
    return {
      ok: false,
      message:
        response?.error?.message ||
        response?.result?.message ||
        'Klarkey could not use this passkey.',
    }
  }

  return {
    ok: true,
    responseJson: response.result.responseJson,
    credentialId: response.result.credentialId,
  }
}

export async function listFieldSuggestions(field, flow, url, title) {
  const response = await requestHost({ type: 'list-field-suggestions', field, flow, url, title })
  if (!response?.ok) {
    return {
      ok: false,
      message: response?.error?.message || 'Klarkey could not load suggestions.',
      suggestions: [],
    }
  }

  return {
    ok: true,
    suggestions: response.result.suggestions || [],
  }
}

export async function saveLoginPayload(payload) {
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
