const runtimeApi = globalThis.browser ?? globalThis.chrome
const runtime = runtimeApi?.runtime

const sendMessage = (message) =>
  !runtime
    ? Promise.reject(new Error('Klarkey extension runtime is unavailable in this context.'))
    : runtime.sendMessage.length === 1
      ? runtime.sendMessage(message)
      : new Promise((resolve, reject) => {
          runtime.sendMessage(message, (result) => {
            const error = globalThis.chrome?.runtime?.lastError
            if (error) {
              reject(new Error(error.message))
              return
            }

            resolve(result)
          })
        })

const elements = {
  title: document.getElementById('title'),
  statusBadge: document.getElementById('statusBadge'),
  siteHost: document.getElementById('siteHost'),
  siteUrl: document.getElementById('siteUrl'),
  statusMessage: document.getElementById('statusMessage'),
  passkeys: document.getElementById('passkeys'),
  passkeyHint: document.getElementById('passkeyHint'),
  saveButton: document.getElementById('saveButton'),
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

const setStatus = (message, connected) => {
  elements.statusBadge.textContent = connected ? 'Online' : 'Offline'
  elements.statusBadge.classList.toggle('connected', connected)
  elements.statusMessage.textContent = message
}

async function loadPopup() {
  try {
    const state = await sendMessage({ type: 'popup-state' })
    const hostLabel = getHostLabel(state.url)

    elements.siteHost.textContent = hostLabel
    elements.siteUrl.textContent = state.url || 'No active page'
    elements.title.textContent = state.connected ? 'Ready for this page' : 'Desktop app required'
    elements.passkeys.textContent = state.passkeys?.supported
      ? 'Chromium passkey proxy is ready through Klarkey desktop.'
      : state.passkeys?.reason || 'Passkey state unavailable.'
    elements.passkeyHint.textContent = state.passkeys?.supported
      ? state.chromiumProxyReady
        ? 'Passkey requests on supported Chromium browsers can be routed through Klarkey.'
        : 'Open Klarkey desktop to attach the browser passkey proxy.'
      : state.chromiumProxyReady
        ? 'This browser is attached, but passkey interception is limited here.'
        : 'Firefox stays on autofill-only mode until a browser-side passkey interception API exists.'
    elements.saveButton.disabled = !state.connected

    setStatus(
      state.connected
        ? state.error || 'Autofill, passkeys, and save flows are available from the desktop vault.'
        : state.error || 'Open Klarkey desktop to connect the browser bridge.',
      state.connected,
    )
  } catch (error) {
    elements.siteHost.textContent = ''
    elements.title.textContent = 'Desktop app required'
    elements.siteUrl.textContent = 'No active page'
    elements.saveButton.disabled = true
    elements.passkeys.textContent = 'Passkey bridge unavailable until the desktop host is connected.'
    elements.passkeyHint.textContent = 'The extension stays desktop-only and does not fall back to standalone mode.'
    setStatus(error instanceof Error ? error.message : 'Could not reach Klarkey desktop.', false)
  }
}

elements.saveButton.addEventListener('click', async () => {
  setStatus('Saving the current page credentials…', true)
  const response = await sendMessage({ type: 'save-current-login' })
  setStatus(response.message || 'Saved.', Boolean(response.ok))
  await loadPopup()
})

void loadPopup()

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void loadPopup()
  }
})
