import './webauthn-proxy.js'
import * as handlers from './popup-handlers.js'
import { runtimeApi } from './native-messaging.js'

runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    switch (message?.type) {
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
