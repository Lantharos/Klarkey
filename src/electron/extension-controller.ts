import { spawn } from 'node:child_process'
import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { markRuntimeBusy, noteExtensionActivity, readRuntimeState } from '@/electron/runtime-state'
import { readTrustedDesktopLockState } from '@/electron/desktop-lock-lease'
import { getWindowsHelloAvailability } from '@/electron/windows-hello-verifier'
import { resolveBrowserUserVerification } from '@/electron/browser-user-verification'
import { BrowserFillGrantStore } from '@/electron/browser-fill-grants'
import { hasBrowserSiteAccess } from '@/electron/repository/browser-site-matches'
import { VaultRepository } from '@/electron/repository'
import { app } from 'electron'
import { KLARKEY_EXTENSION_PROTOCOL_VERSION, validateBrowserPasskeyOrigin, type BrowserExtensionRequest, type BrowserExtensionResponse } from '@/shared/browser-extension'

export class BrowserExtensionController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository: VaultRepository
  private readonly fillGrants = new BrowserFillGrantStore()
  private lastUnlockPromptAt = 0

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
    const lockState = this.readDesktopLockState()
    if (lockState !== 'unlocked') {
      this.repository.clearKey()
      this.keyManager.evictKey()
      this.fillGrants.clear()
      return false
    }

    if (!this.keyManager.isKeyInMemory() && this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }

    if (this.keyManager.isKeyInMemory()) {
      this.repository.setKey(this.keyManager.getKey())
      return true
    }

    return false
  }

  private lockedExtensionResult() {
    return {
      status: 'locked',
      title: 'Vault locked',
      message: 'Unlock Klarkey to use browser autofill.',
    } as const
  }

  private isLoginAllowedForUrl(itemId: string, url?: string) {
    if (!url) {
      return false
    }

    return hasBrowserSiteAccess(this.repository.getSnapshot(false), itemId, url)
  }

  private isPassiveRequest(type: BrowserExtensionRequest['type']) {
    return type === 'ping' || type === 'get-settings'
  }

  private buildUpdatingMessage(targetVersion?: string) {
    return targetVersion
      ? `Klarkey is updating to ${targetVersion}. Try again in about a minute.`
      : 'Klarkey is updating. Try again in about a minute.'
  }

  private promptDesktopUnlock() {
    const now = Date.now()
    if (now - this.lastUnlockPromptAt < 10000) {
      return
    }
    this.lastUnlockPromptAt = now

    const appPath = app.getAppPath()
    const args = appPath && appPath !== process.execPath
      ? [appPath, '--open-palette']
      : ['--open-palette']

    try {
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
    } catch {
      return
    }
  }

  async handle(request: BrowserExtensionRequest): Promise<BrowserExtensionResponse> {
    const runtimeState = readRuntimeState()
    const updateState = runtimeState.update
    const passiveRequest = this.isPassiveRequest(request.type)

    if (!passiveRequest) {
      noteExtensionActivity()
      markRuntimeBusy('extension', 30_000)
    }

    if (request.type === 'ping') {
      if (updateState.availability === 'updating') {
        return {
          id: request.id,
          ok: true,
          result: {
            protocolVersion: KLARKEY_EXTENSION_PROTOCOL_VERSION,
            desktopRequired: true,
            passkeyProviderReady: false,
            nativeUserVerificationReady: false,
            vaultUnlocked: false,
            availability: 'updating',
            retryAfterSeconds: updateState.retryAfterSeconds,
            targetVersion: updateState.targetVersion,
          },
        }
      }

      const availability = await getWindowsHelloAvailability()
      const vaultUnlocked = this.readDesktopLockState() === 'unlocked' && this.ensureVaultReady()
      return {
        id: request.id,
        ok: true,
        result: {
          protocolVersion: KLARKEY_EXTENSION_PROTOCOL_VERSION,
          desktopRequired: true,
          passkeyProviderReady: false,
          nativeUserVerificationReady: availability.available,
          vaultUnlocked,
          availability: 'online',
          retryAfterSeconds: undefined,
          targetVersion: updateState.targetVersion,
        },
      }
    }

    if (updateState.availability === 'updating') {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'desktop_updating',
          message: this.buildUpdatingMessage(updateState.targetVersion),
        },
      }
    }

    const requiresVault = request.type !== 'get-settings'
    if (requiresVault && !this.ensureVaultReady()) {
      const isPassiveRequest = ['list-logins', 'list-field-suggestions', 'passkeys-status', 'passkey-create-plan', 'passkey-get-plan'].includes(request.type)
      if (!isPassiveRequest) {
        this.promptDesktopUnlock()
      }
      return {
        id: request.id,
        ok: true,
        result: this.lockedExtensionResult(),
      }
    }

    switch (request.type) {
      case 'list-logins':
        return {
          id: request.id,
          ok: true,
          result: {
            matches: this.repository.listBrowserSiteMatches(request.url, request.title),
          },
        }

      case 'get-login': {
        if (!this.isLoginAllowedForUrl(request.itemId, request.url)) {
          return {
            id: request.id,
            ok: true,
            result: {
              login: undefined,
            },
          }
        }

        const loginVerification = await resolveBrowserUserVerification('get', '{}', request.url)
        if (!loginVerification.ok) {
          return {
            id: request.id,
            ok: true,
            result: loginVerification.result,
          }
        }
        return {
          id: request.id,
          ok: true,
          result: {
            login: this.repository.getBrowserFillLogin(request.itemId),
          },
        }
      }

      case 'get-identity': {
        if (!this.fillGrants.allows('identity', request.itemId, request.url)) {
          return {
            id: request.id,
            ok: true,
            result: {
              identity: undefined,
            },
          }
        }

        const identityVerification = await resolveBrowserUserVerification('get', '{}', request.url)
        if (!identityVerification.ok) {
          return {
            id: request.id,
            ok: true,
            result: identityVerification.result,
          }
        }
        return {
          id: request.id,
          ok: true,
          result: {
            identity: this.repository.getBrowserFillIdentity(request.itemId),
          },
        }
      }

      case 'get-card': {
        if (!this.fillGrants.allows('card', request.itemId, request.url)) {
          return {
            id: request.id,
            ok: true,
            result: {
              card: undefined,
            },
          }
        }

        const cardVerification = await resolveBrowserUserVerification('get', '{}', request.url)
        if (!cardVerification.ok) {
          return {
            id: request.id,
            ok: true,
            result: cardVerification.result,
          }
        }
        return {
          id: request.id,
          ok: true,
          result: {
            card: this.repository.getBrowserFillCard(request.itemId),
          },
        }
      }

      case 'list-field-suggestions':
        {
          const suggestions = this.repository.listBrowserFieldSuggestions(request.field, request.flow, request.url, request.title)
          this.fillGrants.remember(request.url, suggestions)
          return {
            id: request.id,
            ok: true,
            result: {
              suggestions,
            },
          }
        }

      case 'get-settings':
        return {
          id: request.id,
          ok: true,
          result: {
            settings: this.repository.getSettings(),
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
        if (!request.origin) {
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'missing_origin',
              message: 'The passkey creation request is missing the origin.',
            },
          }
        }

        const validOrigin = validateBrowserPasskeyOrigin(request.origin, request.url)
        if (!validOrigin) {
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'invalid_origin',
              message: 'The passkey origin does not match the requesting site.',
            },
          }
        }

        const verification = await resolveBrowserUserVerification('create', request.requestDetailsJson, request.url)
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
        if (!request.origin) {
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'missing_origin',
              message: 'The passkey authentication request is missing the origin.',
            },
          }
        }

        const validOrigin = validateBrowserPasskeyOrigin(request.origin, request.url)
        if (!validOrigin) {
          return {
            id: request.id,
            ok: false,
            error: {
              code: 'invalid_origin',
              message: 'The passkey origin does not match the requesting site.',
            },
          }
        }

        const verification = await resolveBrowserUserVerification('get', request.requestDetailsJson, request.url)
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
