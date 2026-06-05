const runtimeApi = globalThis.browser ?? globalThis.chrome
const runtime = runtimeApi?.runtime
const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

const safePopupErrorMessage = (error, fallback = 'Could not reach Klarkey desktop.') => {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim()
  if (!message || message.length > 180 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message)) {
    return fallback
  }

  return message
}

const sendMessage = (message) =>
  !runtime
    ? Promise.reject(new Error('Klarkey extension runtime is unavailable in this context.'))
    : runtime.sendMessage.length === 1
      ? runtime.sendMessage(message)
      : new Promise((resolve, reject) => {
          runtime.sendMessage(message, (result) => {
            const error = globalThis.chrome?.runtime?.lastError
            if (error) {
              reject(new Error(safePopupErrorMessage(error.message, 'Browser request failed.')))
              return
            }

            resolve(result)
          })
        })

const elements = {
  title: document.getElementById('title'),
  siteHost: document.getElementById('siteHost'),
  statusMessage: document.getElementById('statusMessage'),
  passkeyTitle: document.getElementById('passkeyTitle'),
  passkeyMessage: document.getElementById('passkeyMessage'),
}

const getHostLabel = (value) => {
  if (!value) {
    return ''
  }

  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

async function loadPopup() {
  try {
    const state = await sendMessage({ type: 'popup-state' })
    elements.siteHost.textContent = getHostLabel(state.url)
    elements.title.textContent = state.updating
      ? 'Klarkey is updating.'
      : state.connected
        ? 'Ready for this browser.'
        : 'Desktop app required.'
    elements.statusMessage.textContent = state.updating
      ? state.error || 'Klarkey is updating and will reconnect automatically.'
      : state.connected
      ? 'Autofill, save flows, and browser bridge features are available through Klarkey desktop.'
      : state.error || 'Open Klarkey desktop to connect the browser bridge.'

    if (!state.passkeys?.supported) {
      elements.passkeyTitle.textContent = state.updating
        ? 'Passkey features are paused.'
        : state.connected
          ? state.browser === 'chromium'
            ? 'Save to Klarkey is not available yet.'
            : 'Passkey interception is browser-limited.'
        : 'Passkey status unavailable.'
      elements.passkeyMessage.textContent =
        state.passkeys?.reason ||
        (state.updating
          ? 'Klarkey is updating and will reconnect automatically when it finishes.'
          : !state.connected
          ? 'Open Klarkey desktop to load passkey state for this browser.'
          : state.browser === 'chromium'
          ? 'This browser can still use its built-in passkey flow. Klarkey passkey capture is limited here.'
          : 'This browser can still use its built-in passkey flow, but Klarkey cannot intercept it directly.')
      return
    }

    const passkeysLocked = state.passkeys.locked === true || state.passkeys.status === 'locked'

    if (state.passkeys.exactMatchCount > 0) {
      elements.passkeyTitle.textContent = passkeysLocked ? 'Passkeys are available for this site.' : 'Passkeys are ready for this site.'
      elements.passkeyMessage.textContent =
        passkeysLocked
          ? 'Unlock Klarkey when you choose one.'
          : state.passkeys.exactMatchCount === 1
          ? 'Klarkey has a saved passkey directly linked to this site.'
          : `Klarkey has ${state.passkeys.exactMatchCount} saved passkeys directly linked to this site.`
      return
    }

    if (state.passkeys.linkedMatchCount > 0) {
      elements.passkeyTitle.textContent = 'Site-linked passkeys are available.'
      elements.passkeyMessage.textContent =
        passkeysLocked
          ? 'Unlock Klarkey when you choose one.'
          : state.passkeys.linkedMatchCount === 1
          ? 'Klarkey found one passkey linked through the saved site match.'
          : `Klarkey found ${state.passkeys.linkedMatchCount} passkeys linked through saved site matches.`
      return
    }

    elements.passkeyTitle.textContent = 'No passkey linked yet.'
    elements.passkeyMessage.textContent =
      state.passkeys.reason ||
      (state.passkeys.availablePasskeyCount > 0
        ? 'Klarkey has saved passkeys, but none are linked to this site yet.'
        : 'Klarkey does not have a saved passkey for this site yet.')
  } catch (error) {
    elements.siteHost.textContent = ''
    elements.title.textContent = 'Desktop app required.'
    elements.statusMessage.textContent = safePopupErrorMessage(error)
    elements.passkeyTitle.textContent = 'Passkey status unavailable.'
    elements.passkeyMessage.textContent = 'Klarkey could not load passkey state for this browser.'
  }
}

void loadPopup()

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void loadPopup()
  }
})
