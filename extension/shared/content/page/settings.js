import { browserSettings } from './state.js'
import { sendMessage } from './runtime.js'

const loadBrowserSettings = async () => {
  const response = await sendMessage({ type: 'get-browser-settings' }).catch(() => undefined)
  if (response?.ok && response.settings) {
    Object.assign(browserSettings, response.settings)
  }

  return browserSettings
}

export { loadBrowserSettings }
