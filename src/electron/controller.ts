import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { app, safeStorage } from 'electron'
import { ClipboardManager } from '@/electron/clipboard'
import { IPC_CHANNELS } from '@/electron/constants'
import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { VaultRepository } from '@/electron/repository'
import { executePaletteAction } from '@/electron/palette-action-execution'
import { captureForegroundWindow, captureForegroundWindowAsync } from '@/electron/windows'
import { PASSKEY_ORIGIN, PASSKEY_RP_ID } from '@/shared/passkeys'
import { parseCommand } from '@/shared/command'
import { resolveSearchResponse } from '@/shared/resolver'
import type {
  ActionExecutionResult,
  CommandQuery,
  CreateVaultPasskeyInput,
  ExternalWindowContext,
  CreateItemInput,
  ModifierKey,
  PasskeySupport,
  ResolvedAction,
  SearchResponse,
  SettingsUpdate,
  UpdateItemInput,
  UserSettings,
  VaultPasskeyRecord,
} from '@/shared/types'

const LOCK_WINDOW_MS = Number.POSITIVE_INFINITY
const encodeWindowHandle = (buffer: Buffer) =>
  Array.from(buffer)
    .reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n)
    .toString()

export class KlarkeyController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository = new VaultRepository(this.database.db, this.keyManager.getKey())
  private readonly clipboard = new ClipboardManager()
  private readonly window: BrowserWindow
  private readonly paletteWindowHandle: string
  private unlockedUntil = 0
  private lastExternalWindow?: string
  private externalWindow?: ExternalWindowContext
  private actionCache = new Map<string, ResolvedAction>()

  constructor(window: BrowserWindow) {
    this.window = window
    this.paletteWindowHandle = encodeWindowHandle(window.getNativeWindowHandle())
    this.unlockedUntil = Date.now() + LOCK_WINDOW_MS
  }

  dispose() {
    this.database.close()
  }

  getSettings(): UserSettings {
    return this.repository.getSettings()
  }

  updateSettings(update: SettingsUpdate) {
    const settings = this.repository.updateSettings(update)
    app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup })
    return settings
  }

  createItem(input: CreateItemInput) {
    return this.repository.createItem(input)
  }

  getItem(itemId: string) {
    return this.repository.getItemDetails(itemId)
  }

  updateItem(input: UpdateItemInput) {
    return this.repository.updateItem(input)
  }

  deleteItem(itemId: string) {
    return this.repository.deleteItem(itemId)
  }

  getPasskeySupport(): PasskeySupport {
    return {
      available: true,
      secureContext: true,
      platformAuthenticatorAvailable: false,
      conditionalMediationAvailable: false,
      platform: process.platform,
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      relyingPartyId: PASSKEY_RP_ID,
      origin: PASSKEY_ORIGIN,
    }
  }

  getExternalWindowContext() {
    return this.externalWindow
  }

  listVaultPasskeys(): VaultPasskeyRecord[] {
    return this.repository.listVaultPasskeys()
  }

  createVaultPasskey(input: CreateVaultPasskeyInput): ActionExecutionResult {
    return this.repository.createVaultPasskey(input)
  }

  authenticateVaultPasskey(credentialId: string): ActionExecutionResult {
    this.unlockedUntil = Date.now() + LOCK_WINDOW_MS
    return this.repository.touchVaultPasskey(credentialId)
  }

  deleteVaultPasskey(passkeyId: string): ActionExecutionResult {
    return this.repository.deleteVaultPasskey(passkeyId)
  }

  parseCommand(_: IpcMainInvokeEvent, raw: string) {
    return parseCommand(raw)
  }

  resolve(_: IpcMainInvokeEvent, request: { query: CommandQuery; offset?: number; limit?: number }): SearchResponse {
    const snapshot = this.repository.getSnapshot()
    const response = resolveSearchResponse(snapshot, request.query, {
      offset: request.offset,
      limit: request.limit,
      locked: this.isLocked(),
      targetContext: this.externalWindow,
    })

    if ((request.offset ?? 0) === 0) {
      this.actionCache.clear()
    }

    for (const action of response.actions) {
      this.actionCache.set(action.id, action)
    }

    return {
      ...response,
      locked: this.isLocked(),
    }
  }

  unlock(): ActionExecutionResult {
    this.unlockedUntil = Date.now() + LOCK_WINDOW_MS
    return {
      status: 'success',
      title: 'Vault ready',
      message: 'Sensitive actions are already available.',
    }
  }

  execute(_: IpcMainInvokeEvent, actionId: string, modifier: ModifierKey): ActionExecutionResult {
    return executePaletteAction(
      {
        repository: this.repository,
        clipboard: this.clipboard,
        window: this.window,
        getLastExternalWindow: () => this.lastExternalWindow,
        getActionCache: () => this.actionCache,
        isLocked: () => this.isLocked(),
        extendUnlockWindow: () => {
          this.unlockedUntil = Date.now() + LOCK_WINDOW_MS
        },
      },
      actionId,
      modifier,
    )
  }

  focus() {
    this.window.webContents.send(IPC_CHANNELS.paletteFocus)
  }

  private setExternalWindowContext(context?: ExternalWindowContext) {
    if (!context || context.handle === this.paletteWindowHandle) {
      return
    }

    this.externalWindow = context
    this.lastExternalWindow = context.handle
    this.window.webContents.send(IPC_CHANNELS.paletteTargetChanged, context)

    if (context.iconDataUrl || !context.processPath) {
      return
    }

    void app.getFileIcon(context.processPath, { size: 'small' }).then((icon) => {
      if (icon.isEmpty()) {
        return
      }

      if (this.externalWindow?.handle !== context.handle) {
        return
      }

      const iconDataUrl = icon.resize({ width: 16, height: 16 }).toDataURL()
      this.externalWindow = {
        ...this.externalWindow,
        iconDataUrl,
      }
      this.window.webContents.send(IPC_CHANNELS.paletteTargetChanged, this.externalWindow)
    }).catch(() => undefined)
  }

  rememberExternalWindow() {
    this.setExternalWindowContext(captureForegroundWindow())
  }

  async rememberExternalWindowAsync() {
    this.setExternalWindowContext(await captureForegroundWindowAsync())
  }

  private isLocked() {
    return Date.now() > this.unlockedUntil
  }
}
