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
  siteUrl: document.getElementById('siteUrl'),
  statusMessage: document.getElementById('statusMessage'),
  matches: document.getElementById('matches'),
  passkeys: document.getElementById('passkeys'),
  passkeyHint: document.getElementById('passkeyHint'),
  saveButton: document.getElementById('saveButton'),
}

const setStatus = (message, connected) => {
  elements.statusBadge.textContent = connected ? 'Connected' : 'Offline'
  elements.statusBadge.classList.toggle('connected', connected)
  elements.statusMessage.textContent = message
}

const renderMatches = (matches) => {
  elements.matches.innerHTML = ''

  if (!matches.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'No saved logins match this site yet.'
    elements.matches.appendChild(empty)
    return
  }

  for (const match of matches) {
    const node = document.createElement('article')
    node.className = 'match'
    node.innerHTML = `
      <div class="match-header">
        <div>
          <div class="match-title"></div>
          <div class="match-subtitle"></div>
        </div>
      </div>
      <div class="match-meta"></div>
      <div class="match-actions">
        <button class="button">Fill</button>
      </div>
    `

    node.querySelector('.match-title').textContent = match.itemName
    node.querySelector('.match-subtitle').textContent = match.username || 'No username'

    const meta = node.querySelector('.match-meta')
    if (match.hasOtp) {
      const token = document.createElement('span')
      token.className = 'token'
      token.textContent = 'OTP available'
      meta.appendChild(token)
    }
    if (match.hasPasskey) {
      const token = document.createElement('span')
      token.className = 'token'
      token.textContent = 'Passkey linked'
      meta.appendChild(token)
    }

    node.querySelector('button').addEventListener('click', async () => {
      setStatus('Filling the current page…', true)
      const response = await sendMessage({ type: 'fill-login', itemId: match.itemId })
      setStatus(response.message || 'Done.', Boolean(response.ok))
    })

    elements.matches.appendChild(node)
  }
}

async function loadPopup() {
  try {
    const state = await sendMessage({ type: 'popup-state' })
    elements.title.textContent = state.connected ? 'Site items' : 'Desktop app required'
    elements.siteUrl.textContent = state.url || 'No active page'
    if (state.passkeys?.supported) {
      elements.passkeys.textContent = 'Chromium passkey proxy is available through Klarkey desktop.'
      elements.passkeyHint.textContent = state.chromiumProxyReady
        ? 'Passkey requests on this browser can be intercepted and mapped back to Klarkey.'
        : 'Start Klarkey desktop to activate passkey interception in Chromium browsers.'
    } else {
      elements.passkeys.textContent = state.passkeys?.reason || 'Passkey state unavailable.'
      elements.passkeyHint.textContent = state.chromiumProxyReady
        ? 'This browser build is attached, but the current passkey bridge is limited.'
        : 'Firefox stays on password/autofill mode until a browser-side passkey interception API exists.'
    }
    elements.saveButton.disabled = !state.connected
    setStatus(
      state.connected
        ? state.error || 'Ready to autofill from the desktop vault.'
        : state.error || 'Start Klarkey desktop to use the extension.',
      state.connected,
    )
    renderMatches(state.matches || [])
  } catch (error) {
    elements.title.textContent = 'Desktop app required'
    elements.saveButton.disabled = true
    setStatus(error instanceof Error ? error.message : 'Could not reach Klarkey desktop.', false)
    renderMatches([])
    elements.passkeys.textContent = 'Passkey bridge unavailable until the desktop host is connected.'
    elements.passkeyHint.textContent = 'The extension stays desktop-only and does not fall back to standalone mode.'
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
