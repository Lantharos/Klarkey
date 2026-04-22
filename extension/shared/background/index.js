import './webauthn-proxy.js'
import * as handlers from './popup-handlers.js'
import { runtimeApi } from './native-messaging.js'

const ssoTrackingKey = 'klarkey:sso-tracking'

async function getSsoTracking() {
  if (!runtimeApi.storage?.local) {
    return undefined
  }

  const stored = await new Promise((resolve, reject) => {
    runtimeApi.storage.local.get([ssoTrackingKey], (result) => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(result?.[ssoTrackingKey])
    })
  }).catch(() => undefined)

  return stored
}

async function setSsoTracking(value) {
  if (!runtimeApi.storage?.local) {
    return
  }

  await new Promise((resolve, reject) => {
    runtimeApi.storage.local.set({ [ssoTrackingKey]: value }, () => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(undefined)
    })
  }).catch(() => undefined)
}

async function clearSsoTracking() {
  if (!runtimeApi.storage?.local) {
    return
  }

  await new Promise((resolve, reject) => {
    runtimeApi.storage.local.remove([ssoTrackingKey], () => {
      const error = globalThis.chrome?.runtime?.lastError
      if (error) {
        reject(new Error(error.message))
        return
      }
      resolve(undefined)
    })
  }).catch(() => undefined)
}

runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    switch (message?.type) {
      case 'sso-tracking-get':
        sendResponse({ ok: true, tracking: await getSsoTracking() })
        return
      case 'sso-tracking-set':
        await setSsoTracking(message.payload)
        sendResponse({ ok: true })
        return
      case 'sso-tracking-update':
        {
          const current = await getSsoTracking()
          if (!current) {
            sendResponse({ ok: false, tracking: undefined })
            return
          }
          const next = { ...current, ...message.payload }
          await setSsoTracking(next)
          sendResponse({ ok: true, tracking: next })
          return
        }
      case 'sso-tracking-clear':
        await clearSsoTracking()
        sendResponse({ ok: true })
        return
      case 'popup-state':
        sendResponse(await handlers.loadPopupState())
        return
      case 'fill-login':
        sendResponse(await handlers.fillActiveTab(message.itemId))
        return
      case 'save-current-login':
        sendResponse(await handlers.saveCurrentLogin())
        return
      case 'fetch-login':
        sendResponse(await handlers.fillLogin(message.itemId))
        return
      case 'fetch-identity':
        sendResponse(await handlers.fetchIdentity(message.itemId))
        return
      case 'fetch-card':
        sendResponse(await handlers.fetchCard(message.itemId))
        return
      case 'get-browser-settings':
        sendResponse(await handlers.getBrowserSettings())
        return
      case 'plan-passkey-create':
        sendResponse(await handlers.planPasskeyCreate(message.payload))
        return
      case 'create-passkey-credential':
        sendResponse(await handlers.createPasskeyCredential(message.payload))
        return
      case 'save-passkey-credential':
        sendResponse(await handlers.savePasskeyCredential(message.payload))
        return
      case 'discard-passkey-credential':
        sendResponse(await handlers.discardPasskeyCredential(message.payload))
        return
      case 'plan-passkey-get':
        sendResponse(await handlers.planPasskeyGet(message.payload))
        return
      case 'get-passkey-credential':
        sendResponse(await handlers.getPasskeyCredential(message.payload))
        return
      case 'list-logins-for-url':
        sendResponse(await handlers.listLoginsForUrl(message.url, message.title))
        return
      case 'list-field-suggestions':
        sendResponse(await handlers.listFieldSuggestions(message.field, message.flow, message.url, message.title))
        return
      case 'save-login-payload':
        sendResponse(await handlers.saveLoginPayload(message.payload))
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
