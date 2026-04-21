import { spawn } from 'node:child_process'
import { KeyManager } from '@/electron/crypto'
import { readCreateUserVerification, readGetUserVerification } from '@/electron/passkey-user-verification'
import { createDatabase } from '@/electron/database'
import { getWindowsHelloAvailability, verifyWithWindowsHello } from '@/electron/windows-hello-verifier'
import { VaultRepository } from '@/electron/repository'
import { app } from 'electron'
import { KLARKEY_EXTENSION_PROTOCOL_VERSION, normalizeBrowserHostname, type BrowserExtensionRequest, type BrowserExtensionResponse } from '@/shared/browser-extension'

const validateOrigin = (origin: string, url: string): string | undefined => {
  try {
    const originHostname = new URL(origin).hostname.toLowerCase()
    const urlHostname = normalizeBrowserHostname(url)
    if (!urlHostname) {
      return originHostname
    }
    if (originHostname === urlHostname || originHostname.endsWith(`.${urlHostname}`) || urlHostname.endsWith(`.${originHostname}`)) {
      return originHostname
    }
    return undefined
  } catch {
    return undefined
  }
}

export class BrowserExtensionController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository: VaultRepository
  private lastUnlockPromptAt = 0

  private readDesktopLockState(): 'locked' | 'passcode' | 'unlocked' {
    const row = this.database.db.prepare('SELECT value FROM settings WHERE key = ?').get('vault_lock_state') as { value?: string } | undefined
    if (row?.value === 'unlocked' || row?.value === 'passcode' || row?.value === 'locked') {
      return row.value
    }
    return 'locked'
  }

  constructor() {
    if (this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }

    const key = this.keyManager.isKeyInMemory() ? this.keyManager.getKey() : Buffer.alloc(0)
    this.repository = new VaultRepository(this.database.db, key)
  }

  dispose() {
    this.database.close()
  }

  private ensureVaultReady() {
    const lockState = this.readDesktopLockState()
    if (lockState !== 'unlocked') {
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
      // ignore spawn failures; extension still gets locked response
    }
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
    const requiresVault = request.type !== 'ping' && request.type !== 'get-settings'
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
      case 'ping': {
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

      case 'get-login': {
        const loginVerification = await this.resolveUserVerification('get', '', '')
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
        const identityVerification = await this.resolveUserVerification('get', '', '')
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
        const cardVerification = await this.resolveUserVerification('get', '', '')
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

        const validOrigin = validateOrigin(request.origin, request.url)
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

        const validOrigin = validateOrigin(request.origin, request.url)
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
