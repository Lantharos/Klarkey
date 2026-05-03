import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { app, safeStorage } from 'electron'
import { ClipboardManager } from '@/electron/clipboard'
import { IPC_CHANNELS } from '@/electron/constants'
import { KeyManager } from '@/electron/crypto'
import { createDatabase } from '@/electron/database'
import { VaultRepository } from '@/electron/repository'
import { SyncManager } from '@/electron/sync/manager'
import { VaultLockManager } from '@/electron/vault-lock'
import { exportVault } from '@/electron/export'
import { importVault } from '@/electron/import'
import { executePaletteAction } from '@/electron/palette-action-execution'
import { captureForegroundWindow, captureForegroundWindowAsync } from '@/electron/windows'
import { PASSKEY_ORIGIN, PASSKEY_RP_ID } from '@/shared/passkeys'
import { parseCommand } from '@/shared/command'
import { resolveSearchResponse } from '@/shared/resolver'
import type { ExportOptions, ExportResult, ImportOptions, ImportResult } from '@/shared/import-export'
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
  VaultLockInfo,
  VaultOperationResult,
  VaultPasskeyRecord,
} from '@/shared/types'

const encodeWindowHandle = (buffer: Buffer) =>
  Array.from(buffer)
    .reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n)
    .toString()

export class KlarkeyController {
  private readonly keyManager = new KeyManager()
  private readonly database = createDatabase()
  private readonly clipboard = new ClipboardManager()
  private readonly window: BrowserWindow
  private readonly lockManager: VaultLockManager
  private readonly repository: VaultRepository
  private readonly syncManager: SyncManager
  private readonly paletteWindowHandle: string
  private lastExternalWindow?: string
  private externalWindow?: ExternalWindowContext
  private actionCache = new Map<string, ResolvedAction>()
  private readonly isDevMode = process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL)
  private syncTimer?: ReturnType<typeof setTimeout>

  constructor(window: BrowserWindow) {
    this.window = window
    this.paletteWindowHandle = encodeWindowHandle(window.getNativeWindowHandle())

    let key: Buffer
    if (this.keyManager.hasKeyFile()) {
      if (this.keyManager.isSafeStorageAvailable()) {
        this.keyManager.unlockFromSystem()
      }
      if (this.keyManager.isKeyInMemory() || this.keyManager.hasMasterPassword()) {
        key = this.keyManager.isKeyInMemory() ? this.keyManager.getKey() : Buffer.alloc(0)
      } else {
        key = Buffer.alloc(0)
      }
    } else if (this.keyManager.isSafeStorageAvailable()) {
      key = this.keyManager.setupNewVault()
    } else {
      key = Buffer.alloc(0)
    }

    this.repository = new VaultRepository(this.database.db, key)
    this.syncManager = new SyncManager(this.database)
    this.lockManager = new VaultLockManager(this.keyManager, this.database.db, this.repository.getSettings())

    if (this.keyManager.isKeyInMemory()) {
      this.lockManager.transitionAfterUnlock()
    }

    this.lockManager.onStateChange((info) => {
      this.window.webContents.send(IPC_CHANNELS.vaultLockState, info)
      if (info.state === 'locked') {
        this.repository.clearKey()
        this.clipboard.clearNow()
        this.stopSyncRealtime()
      } else if (info.state === 'unlocked' || info.state === 'passcode') {
        if (this.keyManager.isKeyInMemory()) {
          this.repository.setKey(this.keyManager.getKey())
        }
        this.startSyncRealtime()
        this.scheduleSync(300)
      }
    })

    if (!this.lockManager.isLocked()) {
      this.startSyncRealtime()
      this.scheduleSync(600)
    }
  }

  dispose() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
    }
    this.stopSyncRealtime()
    this.lockManager.lock()
    this.database.close()
  }

  getLockInfo() {
    return this.lockManager.getLockInfo()
  }

  async unlockWithWindowsHello(): Promise<VaultOperationResult> {
    return this.lockManager.unlockWithWindowsHello()
  }

  unlockWithPassword(password: string): VaultOperationResult {
    return this.lockManager.unlockWithPassword(password)
  }

  lock() {
    this.lockManager.lock()
  }

  setupMasterPassword(password: string) {
    return this.lockManager.setupMasterPassword(password)
  }

  changeMasterPassword(currentPassword: string, newPassword: string) {
    return this.lockManager.changeMasterPassword(currentPassword, newPassword)
  }

  removeMasterPassword(currentPassword: string) {
    return this.lockManager.removeMasterPassword(currentPassword)
  }

  setPasscode(passcode: string) {
    return this.lockManager.setPasscode(passcode)
  }

  removePasscode() {
    return this.lockManager.removePasscode()
  }

  verifyPasscode(passcode: string) {
    return this.lockManager.verifyPasscode(passcode)
  }

  confirmPasscode(passcode: string) {
    return this.lockManager.confirmPasscode(passcode)
  }

  getSettings(): UserSettings {
    return this.repository.getSettings()
  }

  updateSettings(update: SettingsUpdate) {
    const settings = this.repository.updateSettings(update)
    this.lockManager.updateSettings(settings)
    app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup })
    this.scheduleSync()
    return settings
  }

  getSyncStatus() {
    return this.syncManager.getStatus()
  }

  startSyncSignIn() {
    return this.syncManager.startSignIn()
  }

  async completeSyncSignIn(callbackUrl: string) {
    const status = await this.syncManager.completeCallback(callbackUrl)
    this.startSyncRealtime()
    this.scheduleSync(150)
    this.emitSyncUpdate(false, true)
    return status
  }

  signOutSync() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = undefined
    }
    const status = this.syncManager.signOut()
    this.emitSyncUpdate(false)
    return status
  }

  async syncNow() {
    if (this.lockManager.isLocked()) {
      return Promise.reject(new Error('Unlock the vault before syncing.'))
    }
    const pending = this.syncManager.syncNow(this.repository, { fullPull: true })
    this.emitSyncUpdate(false)
    const status = await pending
    this.startSyncRealtime()
    this.emitSyncUpdate(this.syncManager.didLastRunChangeVault())
    return status
  }

  createItem(input: CreateItemInput) {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }
    const result = this.repository.createItem(input)
    if (result.status !== 'error') {
      this.scheduleSync()
    }
    return result
  }

  getItem(itemId: string) {
    if (this.lockManager.isLocked()) {
      return undefined
    }
    return this.repository.getItemDetails(itemId)
  }

  updateItem(input: UpdateItemInput) {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }
    const result = this.repository.updateItem(input)
    if (result.status !== 'error') {
      this.scheduleSync()
    }
    return result
  }

  deleteItem(itemId: string) {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }
    const result = this.repository.deleteItem(itemId)
    if (result.status !== 'error') {
      this.scheduleSync()
    }
    return result
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
    if (this.lockManager.isLocked()) {
      return []
    }
    return this.repository.listVaultPasskeys()
  }

  createVaultPasskey(input: CreateVaultPasskeyInput): ActionExecutionResult {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }
    const result = this.repository.createVaultPasskey(input)
    if (result.status !== 'error') {
      this.scheduleSync()
    }
    return result
  }

  authenticateVaultPasskey(credentialId: string): ActionExecutionResult {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }

    const result = this.repository.touchVaultPasskey(credentialId)
    if (result.status === 'success') {
      this.lockManager.transitionAfterUnlock()
    }
    return result
  }

  deleteVaultPasskey(passkeyId: string): ActionExecutionResult {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }
    const result = this.repository.deleteVaultPasskey(passkeyId)
    if (result.status !== 'error') {
      this.scheduleSync()
    }
    return result
  }

  async exportVault(options: ExportOptions): Promise<ExportResult> {
    if (this.lockManager.isLocked()) {
      return {
        success: false,
        exportedCount: 0,
        message: 'Vault is locked. Unlock to export.',
      }
    }
    return exportVault(this.repository, options)
  }

  async importVault(options: ImportOptions): Promise<ImportResult> {
    if (this.lockManager.isLocked()) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        message: 'Vault is locked. Unlock to import.',
      }
    }
    const result = await importVault(this.repository, options)
    if (result.success && result.importedCount > 0) {
      this.scheduleSync()
    }
    return result
  }

  parseCommand(_: IpcMainInvokeEvent, raw: string) {
    return parseCommand(raw)
  }

  resolve(_: IpcMainInvokeEvent, request: { query: CommandQuery; offset?: number; limit?: number }): SearchResponse {
    const snapshot = this.repository.getSnapshot()
    const response = resolveSearchResponse(snapshot, request.query, {
      offset: request.offset,
      limit: request.limit,
      locked: this.lockManager.isLocked() || this.lockManager.requiresPasscode(),
      targetContext: this.externalWindow,
      showDevOptions: this.isDevMode,
    })

    if ((request.offset ?? 0) === 0) {
      this.actionCache.clear()
    }

    for (const action of response.actions) {
      this.actionCache.set(action.id, action)
    }

    return {
      ...response,
      locked: this.lockManager.isLocked() || this.lockManager.requiresPasscode(),
    }
  }

  unlock(): ActionExecutionResult {
    if (this.lockManager.isUnlocked()) {
      return {
        status: 'success',
        title: 'Vault ready',
        message: 'Sensitive actions are already available.',
      }
    }

    return {
      status: 'locked',
      title: 'Vault locked',
      message: 'Use Windows Hello or your master password to unlock.',
    }
  }

  execute(_: IpcMainInvokeEvent, actionId: string, modifier: ModifierKey): ActionExecutionResult {
    if (this.lockManager.isLocked()) {
      return lockedResult()
    }

    if (this.lockManager.requiresPasscode()) {
      return {
        status: 'locked',
        title: 'Passcode required',
        message: 'Enter your passcode to continue.',
      }
    }

    return executePaletteAction(
      {
        repository: this.repository,
        clipboard: this.clipboard,
        window: this.window,
        getLastExternalWindow: () => this.lastExternalWindow,
        getActionCache: () => this.actionCache,
        isLocked: () => this.lockManager.isLocked(),
        extendUnlockWindow: () => {
          if (this.lockManager.isUnlocked()) {
            this.lockManager.updateSettings(this.repository.getSettings())
          }
        },
      },
      actionId,
      modifier,
    )
  }

  private emitSyncUpdate(vaultChanged: boolean, returnHome = false) {
    this.window.webContents.send(IPC_CHANNELS.syncChanged, {
      status: this.syncManager.getStatus(),
      vaultChanged,
      returnHome,
    })
  }

  private startSyncRealtime() {
    if (this.lockManager.isLocked()) {
      return
    }

    this.syncManager.startRealtime(
      () => this.scheduleSync(150),
      () => this.emitSyncUpdate(false),
    )
  }

  private stopSyncRealtime() {
    this.syncManager.stopRealtime()
  }

  private scheduleSync(delay = 900) {
    const status = this.syncManager.getStatus()
    if (this.lockManager.isLocked() || !status.configured || !status.signedIn) {
      return
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
    }

    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      void this.syncInBackground()
    }, delay)
  }

  private async syncInBackground() {
    if (this.lockManager.isLocked()) {
      return
    }

    try {
      const pending = this.syncManager.syncNow(this.repository)
      this.emitSyncUpdate(false)
      await pending
      this.startSyncRealtime()
      this.emitSyncUpdate(this.syncManager.didLastRunChangeVault())
    } catch {
      this.emitSyncUpdate(false)
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

  isVaultUnlockedForExtension() {
    return !this.lockManager.isLocked()
  }

  devForceLock() {
    this.lockManager.lock()
  }

  devForceUnlock() {
    if (this.keyManager.isSafeStorageAvailable()) {
      this.keyManager.unlockFromSystem()
    }
    if (this.keyManager.isKeyInMemory()) {
      this.lockManager.transitionAfterUnlock()
      this.repository.setKey(this.keyManager.getKey())
    }
  }

  devForcePasscode() {
    this.lockManager.forcePasscodeState()
  }

  devDumpLockInfo(): VaultLockInfo & { keyInMemory: boolean; keyFileExists: boolean } {
    return {
      ...this.lockManager.getLockInfo(),
      keyInMemory: this.keyManager.isKeyInMemory(),
      keyFileExists: this.keyManager.hasKeyFile(),
    }
  }
}

function lockedResult(): ActionExecutionResult {
  return {
    status: 'locked',
    title: 'Vault locked',
    message: 'Unlock the vault to continue.',
  }
}
