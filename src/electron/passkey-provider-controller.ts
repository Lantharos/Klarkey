import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { VaultRepository } from '@/electron/repository'
import type { PasskeyProviderBridgeRequest, PasskeyProviderBridgeResponse } from '@/shared/passkey-provider-bridge'

export class PasskeyProviderBridgeController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository = new VaultRepository(this.database.db, this.keyManager.getKey())

  dispose() {
    this.database.close()
  }

  async handle(request: PasskeyProviderBridgeRequest): Promise<PasskeyProviderBridgeResponse> {
    switch (request.type) {
      case 'ping':
        return {
          id: request.id,
          ok: true,
          result: {
            ready: true,
            bridge: 'klarkey-passkey-provider',
          },
        }

      case 'find-credentials': {
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

      case 'store-credential':
        return {
          id: request.id,
          ok: true,
          result: this.repository.saveSitePasskey(request.url, request.requestDetailsJson, request.responseJson),
        }

      case 'touch-credential':
        return {
          id: request.id,
          ok: true,
          result: this.repository.rememberSitePasskeyAssertion(request.credentialId),
        }

      default: {
        const unsupportedRequest = request as { id: string }
        return {
          id: unsupportedRequest.id,
          ok: false,
          error: {
            code: 'unsupported_request',
            message: 'The requested passkey provider action is not supported.',
          },
        }
      }
    }
  }
}
