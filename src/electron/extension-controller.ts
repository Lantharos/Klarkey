import { KeyManager } from '@/electron/crypto'
import { readCreateUserVerification, readGetUserVerification } from '@/electron/passkey-user-verification'
import { createDatabase } from '@/electron/database'
import { getWindowsHelloAvailability, verifyWithWindowsHello } from '@/electron/windows-hello-verifier'
import { VaultRepository } from '@/electron/repository'
import { KLARKEY_EXTENSION_PROTOCOL_VERSION, type BrowserExtensionRequest, type BrowserExtensionResponse } from '@/shared/browser-extension'

export class BrowserExtensionController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository = new VaultRepository(this.database.db, this.keyManager.getKey())

  dispose() {
    this.database.close()
  }

  private buildWindowsHelloMessage(operation: 'create' | 'get', url: string) {
    const hostname = (() => {
      try {
        return new URL(url).hostname
      } catch {
        return 'this site'
      }
    })()

    return operation === 'create'
      ? `Verify with Windows Hello to create a passkey for ${hostname} in Klarkey.`
      : `Verify with Windows Hello to sign in to ${hostname} with Klarkey.`
  }

  private async resolveUserVerification(
    operation: 'create' | 'get',
    requestDetailsJson: string,
    url: string,
  ) {
    const requestedVerification =
      operation === 'create' ? readCreateUserVerification(requestDetailsJson) : readGetUserVerification(requestDetailsJson)

    if (requestedVerification === 'discouraged') {
      return {
        ok: true,
        userVerified: false,
      } as const
    }

    const availability = await getWindowsHelloAvailability()
    if (!availability.available) {
      if (requestedVerification === 'required') {
        return {
          ok: false,
          result: {
            status: 'error',
            title: 'Windows Hello required',
            message: availability.message || 'Klarkey could not reach Windows Hello for this passkey request.',
          },
        } as const
      }

      return {
        ok: true,
        userVerified: false,
      } as const
    }

    const verification = await verifyWithWindowsHello(this.buildWindowsHelloMessage(operation, url))
    if (verification.verified) {
      return {
        ok: true,
        userVerified: true,
      } as const
    }

    if (verification.canceled) {
      return {
        ok: false,
        result: {
          status: 'error',
          title: 'Windows Hello canceled',
          message: verification.message || 'Windows Hello verification was canceled.',
        },
      } as const
    }

    if (requestedVerification === 'required') {
      return {
        ok: false,
        result: {
          status: 'error',
          title: 'Windows Hello required',
          message: verification.message || 'Windows Hello verification did not complete.',
        },
      } as const
    }

    return {
      ok: true,
      userVerified: false,
    } as const
  }

  async handle(request: BrowserExtensionRequest): Promise<BrowserExtensionResponse> {
    switch (request.type) {
      case 'ping': {
        const availability = await getWindowsHelloAvailability()
        return {
          id: request.id,
          ok: true,
          result: {
            protocolVersion: KLARKEY_EXTENSION_PROTOCOL_VERSION,
            desktopRequired: true,
            passkeyProviderReady: false,
            nativeUserVerificationReady: availability.available,
          },
        }
      }

      case 'list-logins':
        return {
          id: request.id,
          ok: true,
          result: {
            matches: this.repository.listBrowserSiteMatches(request.url, request.title),
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

      case 'get-identity':
        return {
          id: request.id,
          ok: true,
          result: {
            identity: this.repository.getBrowserFillIdentity(request.itemId),
          },
        }

      case 'get-card':
        return {
          id: request.id,
          ok: true,
          result: {
            card: this.repository.getBrowserFillCard(request.itemId),
          },
        }

      case 'list-field-suggestions':
        return {
          id: request.id,
          ok: true,
          result: {
            suggestions: this.repository.listBrowserFieldSuggestions(request.field, request.flow, request.url, request.title),
          },
        }

      case 'save-login':
        return {
          id: request.id,
          ok: true,
          result: this.repository.saveBrowserLogin(request.payload),
        }

      case 'get-settings':
        return {
          id: request.id,
          ok: true,
          result: {
            settings: this.repository.getSettings(),
          },
        }

      case 'passkeys-status':
        return {
          id: request.id,
          ok: true,
          result: this.repository.getBrowserPasskeyStatus(request.url),
        }

      case 'passkey-create-plan':
        return {
          id: request.id,
          ok: true,
          result: {
            plan: this.repository.planBrowserPasskeyCreate(request.url, request.requestDetailsJson),
          },
        }

      case 'passkey-create-credential': {
        const verification = await this.resolveUserVerification('create', request.requestDetailsJson, request.url)
        if (!verification.ok) {
          return {
            id: request.id,
            ok: true,
            result: verification.result,
          }
        }

        const result = this.repository.prepareBrowserSitePasskey(
          request.url,
          request.origin,
          request.requestDetailsJson,
          verification.userVerified,
        )

        if (!('secret' in result) || !result.secret) {
          return {
            id: request.id,
            ok: true,
            result,
          }
        }

        return {
          id: request.id,
          ok: true,
          result: {
            responseJson: result.secret,
            credentialId: JSON.parse(result.secret).id,
            pendingPasskeyId: result.pendingPasskeyId,
          },
        }
      }

      case 'passkey-save-credential':
        return {
          id: request.id,
          ok: true,
          result: this.repository.savePreparedBrowserSitePasskey(
            request.pendingPasskeyId,
            request.url,
            request.requestDetailsJson,
            request.itemId,
            request.createNew,
          ),
        }

      case 'passkey-discard-credential':
        return {
          id: request.id,
          ok: true,
          result: this.repository.discardPreparedBrowserSitePasskey(request.pendingPasskeyId),
        }

      case 'passkey-get-plan':
        return {
          id: request.id,
          ok: true,
          result: {
            choices: this.repository.listBrowserPasskeyChoices(request.url, request.requestDetailsJson),
          },
        }

      case 'passkey-get-credential': {
        const verification = await this.resolveUserVerification('get', request.requestDetailsJson, request.url)
        if (!verification.ok) {
          return {
            id: request.id,
            ok: true,
            result: verification.result,
          }
        }

        const result = this.repository.getBrowserSitePasskey(
          request.url,
          request.origin,
          request.requestDetailsJson,
          request.credentialId,
          verification.userVerified,
        )

        if (!('secret' in result) || !result.secret) {
          return {
            id: request.id,
            ok: true,
            result,
          }
        }

        return {
          id: request.id,
          ok: true,
          result: {
            responseJson: result.secret,
            credentialId: request.credentialId,
          },
        }
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
