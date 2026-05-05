import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { readTrustedDesktopLockState } from '@/electron/desktop-lock-lease'
import { VaultRepository } from '@/electron/repository'
import type { PasskeyProviderBridgeRequest, PasskeyProviderBridgeResponse } from '@/shared/passkey-provider-bridge'

export class PasskeyProviderBridgeController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository: VaultRepository

  private readDesktopLockState() {
    return readTrustedDesktopLockState(this.database.db)
  }

  constructor() {
    const lockState = this.readDesktopLockState()
    if (lockState === 'unlocked' && this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }

    const key = lockState === 'unlocked' && this.keyManager.isKeyInMemory() ? this.keyManager.getKey() : Buffer.alloc(0)
    this.repository = new VaultRepository(this.database.db, key)
  }

  dispose() {
    this.database.close()
  }

  private ensureVaultReady() {
    if (this.readDesktopLockState() !== 'unlocked') {
      this.repository.clearKey()
      this.keyManager.evictKey()
      return false
    }

    if (!this.keyManager.isKeyInMemory() && this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }

    if (!this.keyManager.isKeyInMemory()) {
      return false
    }

    this.repository.setKey(this.keyManager.getKey())
    return true
  }

  private lockedProviderResult() {
    return {
      status: 'locked',
      title: 'Vault locked',
      message: 'Unlock Klarkey before using the passkey provider.',
    } as const
  }

  async handle(request: PasskeyProviderBridgeRequest): Promise<PasskeyProviderBridgeResponse> {
    switch (request.type) {
      case 'ping': {
        const vaultUnlocked = this.ensureVaultReady()
        return {
          id: request.id,
          ok: true,
          result: {
            ready: vaultUnlocked,
            bridge: 'klarkey-passkey-provider',
            vaultUnlocked,
            reason: vaultUnlocked ? undefined : 'Unlock Klarkey before using the passkey provider.',
          },
        }
      }

      case 'find-credentials': {
        this.ensureVaultReady()

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
        if (!this.ensureVaultReady()) {
          return {
            id: request.id,
            ok: true,
            result: this.lockedProviderResult(),
          }
        }

        return {
          id: request.id,
          ok: true,
          result: this.repository.saveSitePasskey(request.url, request.requestDetailsJson, request.responseJson),
        }

      case 'touch-credential':
        if (!this.ensureVaultReady()) {
          return {
            id: request.id,
            ok: true,
            result: this.lockedProviderResult(),
          }
        }

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
