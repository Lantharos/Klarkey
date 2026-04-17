import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { app, safeStorage } from 'electron'
import { ClipboardManager } from '@/electron/clipboard'
import { IPC_CHANNELS } from '@/electron/constants'
import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { VaultRepository } from '@/electron/repository'
import { captureForegroundWindow, captureForegroundWindowAsync, pasteIntoWindow } from '@/electron/windows'
import { PASSKEY_ORIGIN, PASSKEY_RP_ID } from '@/shared/passkeys'
import { parseCommand } from '@/shared/command'
import { resolveActions, resolveSearchResponse } from '@/shared/resolver'
import type {
  ActionExecutionResult,
  CommandQuery,
  CreateVaultPasskeyInput,
  ExternalWindowContext,
  CreateItemInput,
  ItemDetails,
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
const INSERT_CLIPBOARD_CLEAR_SECONDS = 5
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
    const settings = this.repository.getSettings()
    const parseAction = () => {
      const [kind, itemId, field] = actionId.split(':')
      return { kind, itemId, field }
    }
    const getItemField = (item: ItemDetails | undefined, field: string) => {
      if (!item) {
        return undefined
      }

      if (field === 'username') {
        return item.username || undefined
      }

      if (field === 'password') {
        return item.password
      }

      if (field === 'fullName') {
        return item.fullName
      }

      if (field === 'email') {
        return item.email
      }

      if (field === 'phone') {
        return item.phone
      }

      if (field === 'address') {
        return item.address
      }

      if (field === 'content') {
        return item.content || item.notes
      }

      return undefined
    }

    if (actionId.startsWith('paste:')) {
      const { itemId, field } = parseAction()
      const item = itemId ? this.repository.getItemDetails(itemId) : undefined
      const value =
        !itemId || !field
          ? undefined
          : field === 'password'
            ? this.repository.getPassword(itemId)
            : field === 'otp'
              ? this.repository.getOtp(itemId)
            : field === 'username'
              ? this.repository.getUsername(itemId)
              : getItemField(item, field)

      if (!value) {
        return {
          status: 'error',
          title: 'Value missing',
          message: 'This item does not have a value to insert.',
        }
      }

      if (!this.lastExternalWindow) {
        return {
          status: 'error',
          title: 'No previous field',
          message: 'Open Klarkey from the field you want to fill.',
        }
      }

      this.clipboard.copy(value, INSERT_CLIPBOARD_CLEAR_SECONDS)
      this.window.hide()
      const pasted = pasteIntoWindow(this.lastExternalWindow)
      return pasted
        ? {
            status: 'success',
            title: 'Value inserted',
            message: 'Pasted into the last selected field.',
          }
        : {
            status: 'error',
            title: 'Insert failed',
            message: 'Could not focus the previous window.',
          }
    }

    if (actionId.startsWith('copy:')) {
      const { itemId, field } = parseAction()
      const item = itemId ? this.repository.getItemDetails(itemId) : undefined
      const value =
        !itemId || !field
          ? undefined
          : field === 'password'
            ? this.repository.getPassword(itemId)
            : field === 'otp'
              ? this.repository.getOtp(itemId)
              : getItemField(item, field)

      if (!itemId || !field || !value) {
        return {
          status: 'error',
          title: 'Value missing',
          message: 'The requested value could not be copied.',
        }
      }

      this.clipboard.copy(value, settings.clearClipboardSeconds)
      this.repository.remember(actionId, item?.itemName ?? 'Item', itemId)
      return {
        status: 'success',
        title: 'Value copied',
        message: 'Clipboard will clear automatically.',
      }
    }

    if (actionId.startsWith('show:')) {
      const { itemId, field } = parseAction()
      const item = itemId ? this.repository.getItemDetails(itemId) : undefined
      const value =
        !itemId || !field
          ? undefined
          : field === 'password'
            ? this.repository.getPassword(itemId)
            : field === 'otp'
              ? this.repository.getOtp(itemId)
              : getItemField(item, field)

      if (!itemId || !field || !value) {
        return {
          status: 'error',
          title: 'Value missing',
          message: 'The requested value could not be revealed.',
        }
      }

      if (modifier === 'control') {
        this.clipboard.copy(value, settings.clearClipboardSeconds)
        this.repository.remember(actionId, item?.itemName ?? 'Item', itemId)
        return {
          status: 'success',
          title: 'Value copied',
          message: 'Clipboard will clear automatically.',
        }
      }

      this.repository.remember(actionId, item?.itemName ?? 'Item', itemId)
      return {
        status: 'info',
        title: field === 'otp' ? 'Current OTP' : 'Value revealed',
        message: field === 'otp' ? 'Code refreshes every 30 seconds.' : 'Use this only when needed.',
        secret: value,
      }
    }

    const snapshot = this.repository.getSnapshot()
    const action =
      this.actionCache.get(actionId) ??
      resolveActions(snapshot, parseCommand('settings')).find((candidate) => candidate.id === actionId)

    if (!action) {
      return {
        status: 'error',
        title: 'Action missing',
        message: 'The selected action could not be resolved.',
      }
    }

    if (action.requiresUnlock && this.isLocked()) {
      return {
        status: 'locked',
        title: 'Unlock required',
        message: 'Use the unlock button to continue with sensitive data.',
      }
    }

    switch (action.kind) {
      case 'open-item': {
        if (!action.itemId) {
          break
        }

        if (modifier === 'control') {
          const password = this.repository.getPassword(action.itemId)
          if (password) {
            this.clipboard.copy(password, settings.clearClipboardSeconds)
            this.repository.remember(action.id, action.title, action.itemId)
            return {
              status: 'success',
              title: 'Password copied',
              message: 'Clipboard will clear automatically.',
            }
          }
        }

        if (modifier === 'alt') {
          const password = this.repository.getPassword(action.itemId)
          if (password) {
            this.repository.remember(action.id, action.title, action.itemId)
            return {
              status: 'info',
              title: 'Password revealed',
              message: 'Use this only when autofill is not available.',
              secret: password,
            }
          }
        }

        const item = this.repository.getItemDetails(action.itemId)
        const identityName = [item?.firstName, item?.middleName, item?.lastName]
          .map((value) => value?.trim())
          .filter(Boolean)
          .join(' ')
        const defaultValue =
          item?.itemType === 'login'
            ? item.username
            : item?.itemType === 'identity'
              ? item.fullName || identityName || item.email || item.username
              : item?.content || item?.notes

        if (defaultValue) {
          this.clipboard.copy(defaultValue, settings.clearClipboardSeconds)
          this.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'success',
            title: 'Value copied',
            message: defaultValue,
          }
        }
        break
      }

      case 'copy-password': {
        if (!action.itemId) {
          break
        }

        const password = this.repository.getPassword(action.itemId)
        if (password) {
          this.clipboard.copy(password, settings.clearClipboardSeconds)
          this.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'success',
            title: 'Password copied',
            message: 'Clipboard will clear automatically.',
          }
        }
        break
      }

      case 'copy-value': {
        return this.execute(_, `copy:${action.itemId}:${action.id.endsWith(':username') ? 'username' : 'content'}`, modifier)
      }

      case 'show-password': {
        if (!action.itemId) {
          break
        }

        const password = this.repository.getPassword(action.itemId)
        if (password) {
          if (modifier === 'control') {
            this.clipboard.copy(password, settings.clearClipboardSeconds)
            this.repository.remember(action.id, action.title, action.itemId)
            return {
              status: 'success',
              title: 'Password copied',
              message: 'Clipboard will clear automatically.',
            }
          }

          this.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'info',
            title: 'Password revealed',
            message: 'Use this only when you need to inspect the secret.',
            secret: password,
          }
        }
        break
      }

      case 'show-otp':
      case 'copy-otp': {
        if (!action.itemId) {
          break
        }

        const otp = this.repository.getOtp(action.itemId)
        if (otp) {
          if (action.kind === 'copy-otp' || modifier === 'control') {
            this.clipboard.copy(otp, settings.clearClipboardSeconds)
            this.repository.remember(action.id, action.title, action.itemId)
            return {
              status: 'success',
              title: 'Code copied',
              message: 'The current OTP is now on your clipboard.',
            }
          }

          this.repository.remember(action.id, action.title, action.itemId)
          return {
            status: 'info',
            title: 'Current OTP',
            message: 'Code refreshes every 30 seconds.',
            secret: otp,
          }
        }
        break
      }

      case 'create-item': {
        const itemType = action.itemType

        if (!itemType || itemType === 'ssh-key') {
          return {
            status: 'info',
            title: 'Coming soon',
            message: 'That item type is not available yet.',
          }
        }

        const itemName = action.subtitle.trim() || action.title.replace(/^Create\s+/i, '').trim()
        const result = this.repository.createItem({ itemType, itemName })
        this.unlockedUntil = Date.now() + LOCK_WINDOW_MS
        return result
      }

      case 'generate-passkey': {
        return {
          status: 'info',
          title: 'Manage passkeys in Settings',
          message: 'Klarkey passkeys are configured in Settings because website passkeys need the site origin itself.',
        }
      }

      case 'switch-item': {
        this.repository.remember(action.id, action.title, action.itemId)
        return {
          status: 'success',
          title: 'Item switched',
          message: 'This item is now the most recent one used.',
        }
      }

      case 'coming-soon': {
        return {
          status: 'info',
          title: 'Coming soon',
          message: 'That item type is reserved for a future adapter.',
        }
      }

      case 'open-settings': {
        return {
          status: 'info',
          title: 'Settings',
          message: 'The preferences panel is open.',
        }
      }
    }

    return {
      status: 'error',
      title: 'Action incomplete',
      message: 'The requested action could not be completed.',
    }
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
