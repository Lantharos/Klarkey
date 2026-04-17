import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { VaultRepository } from '@/electron/repository'
import { KLARKEY_EXTENSION_PROTOCOL_VERSION, type BrowserExtensionRequest, type BrowserExtensionResponse } from '@/shared/browser-extension'

export class BrowserExtensionController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository = new VaultRepository(this.database.db, this.keyManager.getKey())

  dispose() {
    this.database.close()
  }

  async handle(request: BrowserExtensionRequest): Promise<BrowserExtensionResponse> {
    switch (request.type) {
      case 'ping':
        return {
          id: request.id,
          ok: true,
          result: {
            protocolVersion: KLARKEY_EXTENSION_PROTOCOL_VERSION,
            desktopRequired: true,
          },
        }

      case 'list-logins':
        return {
          id: request.id,
          ok: true,
          result: {
            matches: this.repository.listBrowserSiteMatches(request.url),
          },
        }

      case 'get-login':
        return {
          id: request.id,
          ok: true,
          result: {
            login: this.repository.getBrowserFillLogin(request.itemId),
          },
        }

      case 'list-field-suggestions':
        return {
          id: request.id,
          ok: true,
          result: {
            suggestions: this.repository.listBrowserFieldSuggestions(request.field, request.url),
          },
        }

      case 'save-login':
        return {
          id: request.id,
          ok: true,
          result: this.repository.saveBrowserLogin(request.payload),
        }

      case 'passkeys-status':
        return {
          id: request.id,
          ok: true,
          result: {
            supported: true,
            browser: 'chromium',
            mode: 'desktop-proxy',
          },
        }

      case 'passkey-get-request': {
        const result = this.repository.getPasskeysForBrowserRequest(request.url, request.requestDetailsJson)
        if ('status' in result) {
          return {
            id: request.id,
            ok: true,
            result,
          }
        }

        return {
          id: request.id,
          ok: true,
          result,
        }
      }

      case 'passkey-create-finish':
        return {
          id: request.id,
          ok: true,
          result: this.repository.saveSitePasskey(request.url, request.requestDetailsJson, request.responseJson),
        }

      case 'passkey-get-finish':
        return {
          id: request.id,
          ok: true,
          result: this.repository.rememberSitePasskeyAssertion(request.credentialId),
        }

      default:
        {
          const unsupportedRequest = request as { id: string }
        return {
          id: unsupportedRequest.id,
          ok: false,
          error: {
            code: 'unsupported_request',
            message: 'The requested browser extension action is not supported.',
          },
        }
        }
    }
  }
}
