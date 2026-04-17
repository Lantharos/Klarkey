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
  siteHost: document.getElementById('siteHost'),
  statusMessage: document.getElementById('statusMessage'),
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
    elements.title.textContent = state.connected ? 'Browser bridge' : 'Desktop app required'
    elements.statusMessage.textContent = state.connected
      ? 'Autofill and save flows are ready through Klarkey desktop.'
      : state.error || 'Open Klarkey desktop to connect the browser bridge.'
  } catch (error) {
    elements.siteHost.textContent = ''
    elements.title.textContent = 'Desktop app required'
    elements.statusMessage.textContent =
      error instanceof Error ? error.message : 'Could not reach Klarkey desktop.'
  }
}

void loadPopup()

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void loadPopup()
  }
})
