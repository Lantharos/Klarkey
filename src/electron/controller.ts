import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { ClipboardManager } from '@/electron/clipboard'
import { IPC_CHANNELS } from '@/electron/constants'
import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { IdentityRepository } from '@/electron/repository'
import { captureForegroundWindow, captureForegroundWindowAsync, pasteIntoWindow } from '@/electron/windows'
import { parseCommand } from '@/shared/command'
import { resolveActions } from '@/shared/resolver'
import type {
  ActionExecutionResult,
  CommandQuery,
  CreateIdentityInput,
  ModifierKey,
  SearchResponse,
  SettingsUpdate,
  UpdateIdentityInput,
  UserSettings,
} from '@/shared/types'

const LOCK_WINDOW_MS = Number.POSITIVE_INFINITY
const INSERT_CLIPBOARD_CLEAR_SECONDS = 5

export class KlarkeyController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly repository = new IdentityRepository(this.database.db, this.keyManager.getKey())
  private readonly clipboard = new ClipboardManager()
  private readonly window: BrowserWindow
  private unlockedUntil = 0
  private lastExternalWindow?: string
  private actionCache = new Map<string, ReturnType<typeof resolveActions>[number]>()

  constructor(window: BrowserWindow) {
    this.window = window
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

  createItem(input: CreateIdentityInput) {
    return this.repository.createIdentity(input)
  }

  getItem(identityId: string) {
    return this.repository.getIdentityDetails(identityId)
  }

  updateItem(input: UpdateIdentityInput) {
    return this.repository.updateIdentity(input)
  }

  deleteItem(identityId: string) {
    return this.repository.deleteIdentity(identityId)
  }

  parseCommand(_: IpcMainInvokeEvent, raw: string) {
    return parseCommand(raw)
  }

  resolve(_: IpcMainInvokeEvent, query: CommandQuery): SearchResponse {
    const snapshot = this.repository.getSnapshot()
    const actions = resolveActions(snapshot, query)
    this.actionCache = new Map(actions.map((action) => [action.id, action]))

    return {
      actions,
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

    if (actionId.startsWith('paste-username:')) {
      const identityId = actionId.replace('paste-username:', '')
      const username = this.repository.getUsername(identityId)
      if (!username) {
        return {
          status: 'error',
          title: 'Username missing',
          message: 'This item does not have a username to insert.',
        }
      }

      if (!this.lastExternalWindow) {
        return {
          status: 'error',
          title: 'No previous field',
          message: 'Open Klarkey from the field you want to fill.',
        }
      }

      this.clipboard.copy(username, INSERT_CLIPBOARD_CLEAR_SECONDS)
      this.window.hide()
      const pasted = pasteIntoWindow(this.lastExternalWindow)
      return pasted
        ? {
            status: 'success',
            title: 'Username inserted',
            message: 'Pasted into the last selected field.',
          }
        : {
            status: 'error',
            title: 'Insert failed',
            message: 'Could not focus the previous window.',
          }
    }

    if (actionId.startsWith('paste-password:')) {
      const identityId = actionId.replace('paste-password:', '')
      const password = this.repository.getPassword(identityId)
      if (!password) {
        return {
          status: 'error',
          title: 'Password missing',
          message: 'This item does not have a password to insert.',
        }
      }

      if (!this.lastExternalWindow) {
        return {
          status: 'error',
          title: 'No previous field',
          message: 'Open Klarkey from the field you want to fill.',
        }
      }

      this.clipboard.copy(password, INSERT_CLIPBOARD_CLEAR_SECONDS)
      this.window.hide()
      const pasted = pasteIntoWindow(this.lastExternalWindow)
      return pasted
        ? {
            status: 'success',
            title: 'Password inserted',
            message: 'Pasted into the last selected field.',
          }
        : {
            status: 'error',
            title: 'Insert failed',
            message: 'Could not focus the previous window.',
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
      case 'login': {
        if (!action.identityId) {
          break
        }

        if (modifier === 'control') {
          const password = this.repository.getPassword(action.identityId)
          if (password) {
            this.clipboard.copy(password, settings.clearClipboardSeconds)
            this.repository.remember(action.id, action.title, action.identityId)
            return {
              status: 'success',
              title: 'Password copied',
              message: 'Clipboard will clear automatically.',
            }
          }
        }

        if (modifier === 'alt') {
          const password = this.repository.getPassword(action.identityId)
          if (password) {
            this.repository.remember(action.id, action.title, action.identityId)
            return {
              status: 'info',
              title: 'Password revealed',
              message: 'Use this only when autofill is not available.',
              secret: password,
            }
          }
        }

        const username = this.repository.getUsername(action.identityId)
        if (username) {
          this.clipboard.copy(username, settings.clearClipboardSeconds)
          this.repository.remember(action.id, action.title, action.identityId)
          return {
            status: 'success',
            title: 'Username copied',
            message: username,
          }
        }
        break
      }

      case 'copy-password': {
        if (!action.identityId) {
          break
        }

        const password = this.repository.getPassword(action.identityId)
        if (password) {
          this.clipboard.copy(password, settings.clearClipboardSeconds)
          this.repository.remember(action.id, action.title, action.identityId)
          return {
            status: 'success',
            title: 'Password copied',
            message: 'Clipboard will clear automatically.',
          }
        }
        break
      }

      case 'show-password': {
        if (!action.identityId) {
          break
        }

        const password = this.repository.getPassword(action.identityId)
        if (password) {
          if (modifier === 'control') {
            this.clipboard.copy(password, settings.clearClipboardSeconds)
            this.repository.remember(action.id, action.title, action.identityId)
            return {
              status: 'success',
              title: 'Password copied',
              message: 'Clipboard will clear automatically.',
            }
          }

          this.repository.remember(action.id, action.title, action.identityId)
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
        if (!action.identityId) {
          break
        }

        const otp = this.repository.getOtp(action.identityId)
        if (otp) {
          if (action.kind === 'copy-otp' || modifier === 'control') {
            this.clipboard.copy(otp, settings.clearClipboardSeconds)
            this.repository.remember(action.id, action.title, action.identityId)
            return {
              status: 'success',
              title: 'Code copied',
              message: 'The current OTP is now on your clipboard.',
            }
          }

          this.repository.remember(action.id, action.title, action.identityId)
          return {
            status: 'info',
            title: 'Current OTP',
            message: 'Code refreshes every 30 seconds.',
            secret: otp,
          }
        }
        break
      }

      case 'create-login': {
        const itemName = action.title.replace(/^Create\s+/i, '').trim()
        const result = this.repository.createIdentity({ itemName })
        this.unlockedUntil = Date.now() + LOCK_WINDOW_MS
        return result
      }

      case 'generate-passkey': {
        if (action.identityId) {
          this.repository.markPasskey(action.identityId, action.title)
          this.repository.remember(action.id, action.title, action.identityId)
          return {
            status: 'success',
            title: 'Passkey placeholder added',
            message: 'The local passkey bridge is marked and ready for a later provider adapter.',
          }
        }
        break
      }

      case 'switch-identity': {
        this.repository.remember(action.id, action.title, action.identityId)
        return {
          status: 'success',
          title: 'Identity switched',
          message: 'This item is now the most recent one used.',
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

  rememberExternalWindow() {
    const handle = captureForegroundWindow()
    if (handle) {
      this.lastExternalWindow = handle
    }
  }

  async rememberExternalWindowAsync() {
    const handle = await captureForegroundWindowAsync()
    if (handle) {
      this.lastExternalWindow = handle
    }
  }

  private isLocked() {
    return Date.now() > this.unlockedUntil
  }
}
