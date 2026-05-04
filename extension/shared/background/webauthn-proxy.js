import { isChromium, withTimeout } from './native-messaging.js'

let proxySyncPromise

const detachChromiumProxy = async () => {
  const proxy = globalThis.chrome?.webAuthenticationProxy
  if (!proxy?.detach) {
    return
  }

  await withTimeout(proxy.detach(), 'Timed out while detaching the Chromium passkey proxy.').catch(() => undefined)
}

export async function syncProxyAttachment() {
  if (!isChromium) {
    return false
  }

  if (proxySyncPromise) {
    return proxySyncPromise
  }

  proxySyncPromise = detachChromiumProxy().then(() => false)

  try {
    return await proxySyncPromise
  } finally {
    proxySyncPromise = undefined
  }
}

if (isChromium) {
  const proxy = globalThis.chrome?.webAuthenticationProxy

  proxy?.onRemoteSessionStateChange?.addListener(() => {
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
