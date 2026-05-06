import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  Tray,
} from 'electron'
import { ensureNativeMessagingHostRegistration } from '@/electron/browser-host-registration'
import { KlarkeyController } from '@/electron/controller'
import { IPC_CHANNELS } from '@/electron/constants'
import { ensureLinuxProtocolClientRegistration } from '@/electron/linux-protocol-client'
import { getDesktopIntegrationSupport } from '@/electron/windows'
import { resolveRuntimeMode } from '@/electron/app-mode'
import { ImportExportPathGrants } from '@/electron/import-export-access'
import {
  sanitizeActionExecutionRequest,
  sanitizeClipboardSecret,
  sanitizeCommandRaw,
  sanitizeCreateItemInput,
  sanitizeCreateVaultPasskeyInput,
  sanitizeCredentialId,
  sanitizeExportFormat,
  sanitizeImportFormat,
  sanitizeItemId,
  sanitizePasscode,
  sanitizePassword,
  sanitizeSearchRequest,
  sanitizeSettingsUpdate,
  sanitizeUpdateItemInput,
} from '@/electron/ipc-validation'
import {
  isExternalBrowserUrl,
  resolveRendererAssetPath,
  rendererSecurityHeaderEntries,
  safeErrorMessage,
  safeRendererLoadFailureDetails,
  safeRendererProcessGoneDetails,
  isTrustedPermissionRequest,
  isTrustedRendererUrl,
  shouldAllowDisplayMediaRequest,
  type PermissionDetailsLike,
} from '@/electron/security'
import { runNativeMessagingHost } from '@/electron/native-host'
import { readPasskeyProviderMessageSync, runPasskeyProviderBridgeHost } from '@/electron/passkey-provider-host'
import { markRuntimeBusy, noteDesktopActivity, notePaletteOpen, resetRuntimeStateForAppStart } from '@/electron/runtime-state'
import { runSshAgentHost } from '@/electron/ssh-agent-host'
import { KlarkeyUpdater } from '@/electron/updater'
import { hasAllowedNativeMessagingHostCaller, hasAllowedPasskeyProviderBridgeCaller, hasAllowedSshAgentHostCaller } from '@/electron/process-parent'
import { createExternalUnlockToken, EXTERNAL_UNLOCK_TOKEN_ENV, hasExternalUnlockRequest, hasTrustedExternalUnlockArgs } from '@/electron/external-unlock'
import { ensureLinuxDesktopShortcutFallback } from '@/electron/linux-global-shortcut'
import { PASSKEY_HOST, PASSKEY_ORIGIN, PASSKEY_SCHEME } from '@/shared/passkeys'
import { hasAllowedNativeMessagingCaller } from '@/shared/browser-extension'
import { isAveOAuthCallbackUrl } from '@/shared/ave-oauth'

protocol.registerSchemesAsPrivileged([
  {
    scheme: PASSKEY_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')
}

let windowRef: BrowserWindow | null = null
let controllerRef: KlarkeyController | null = null
let sshAgentHostProcess: ChildProcess | null = null
let updaterRef: KlarkeyUpdater | null = null
let isQuitting = false
let externalUnlockInFlight: Promise<void> | null = null
let lastExternalUnlockPromptAt = 0
const importExportPathGrants = new ImportExportPathGrants()
const __dirname = dirname(fileURLToPath(import.meta.url))
const runtimeMode = resolveRuntimeMode({
  isPackaged: app.isPackaged,
  argv: process.argv,
  env: process.env,
})
const externalUnlockToken = createExternalUnlockToken()
const isDevMode = runtimeMode.isDevMode
const shouldOpenPaletteOnStart = process.argv.includes('--open-palette')
const shouldExternalUnlockOnStart = hasExternalUnlockRequest(process.argv)
const shouldAutoUnlockOnStart = hasTrustedExternalUnlockArgs(process.argv, externalUnlockToken)
const isNativeMessagingHostMode = hasAllowedNativeMessagingCaller(process.argv) && hasAllowedNativeMessagingHostCaller({ isPackaged: app.isPackaged })
const isPasskeyProviderBridgeMode = process.argv.includes('--passkey-provider-bridge') && hasAllowedPasskeyProviderBridgeCaller({ isPackaged: app.isPackaged })
const isSshAgentHostMode = process.argv.includes('--ssh-agent-host') && hasAllowedSshAgentHostCaller({ executablePath: process.execPath })
const initialPasskeyProviderRequest = isPasskeyProviderBridgeMode ? readPasskeyProviderMessageSync() : undefined
const rendererDistPath = () => join(app.getAppPath(), 'dist')
const devServerUrl = () => runtimeMode.devServerUrl
const rendererTrustOptions = () => ({
  isDevMode,
  devServerUrl: devServerUrl(),
})
const appIconPath = () =>
  isDevMode ? join(app.getAppPath(), 'public', 'klarkey.png') : join(app.getAppPath(), 'dist', 'klarkey.png')
const appIcon = () => nativeImage.createFromPath(appIconPath())
const supportsAcrylicWindowBackground = () => process.platform === 'win32' || process.platform === 'darwin'
const hasSingleInstanceLock = isNativeMessagingHostMode || isPasskeyProviderBridgeMode || isSshAgentHostMode ? true : app.requestSingleInstanceLock()
const findOAuthCallbackUrl = (argv: string[]) => argv.find(isAveOAuthCallbackUrl)

const hasCommand = (command: string) => {
  try {
    execFileSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const toZenityFileFilters = (filters: Electron.FileFilter[]) =>
  filters.map((filter) => `${filter.name} | ${filter.extensions.map((extension) => (extension === '*' ? '*' : `*.${extension}`)).join(' ')}`)

const pickFileWithZenity = (mode: 'open' | 'save', filters: Electron.FileFilter[]) => {
  if (process.platform !== 'linux' || !hasCommand('zenity')) {
    return undefined
  }

  const args = ['--file-selection', mode === 'save' ? '--save' : '', mode === 'save' ? '--confirm-overwrite' : '']
    .filter(Boolean)
    .concat(toZenityFileFilters(filters).flatMap((filter) => ['--file-filter', filter]))

  try {
    return execFileSync('zenity', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch {
    return undefined
  }
}

const withFileDialogWindowState = async <T>(picker: () => Promise<T>) => {
  const wasAlwaysOnTop = windowRef?.isAlwaysOnTop() ?? false
  windowRef?.setAlwaysOnTop(false)
  try {
    return await picker()
  } finally {
    windowRef?.setAlwaysOnTop(wasAlwaysOnTop)
  }
}

const spawnBackgroundHost = (modeFlag: '--ssh-agent-host') => {
  const appPath = app.getAppPath()
  const args = appPath && appPath !== process.execPath
    ? [appPath, modeFlag]
    : [modeFlag]

  return spawn(process.execPath, args, {
    detached: false,
    env: {
      ...process.env,
      [EXTERNAL_UNLOCK_TOKEN_ENV]: externalUnlockToken,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
}

const stopSshAgentHost = () => {
  if (!sshAgentHostProcess || sshAgentHostProcess.killed) {
    sshAgentHostProcess = null
    return
  }

  sshAgentHostProcess.kill()
  sshAgentHostProcess = null
}

const noteDesktopOperation = (busyMs = 30_000) => {
  noteDesktopActivity()
  markRuntimeBusy('desktop', busyMs)
}

const nudgeInstallCheck = () => {
  updaterRef?.nudgeInstallCheck()
}

const syncSshAgentHost = () => {
  if (process.platform !== 'win32') {
    stopSshAgentHost()
    return
  }

  const enabled = controllerRef?.getSettings().sshAgentEnabled ?? false
  if (!enabled) {
    stopSshAgentHost()
    return
  }

  if (sshAgentHostProcess && !sshAgentHostProcess.killed) {
    return
  }

  const child = spawnBackgroundHost('--ssh-agent-host')
  child.unref()
  child.once('exit', () => {
    if (sshAgentHostProcess === child) {
      sshAgentHostProcess = null
    }
  })
  sshAgentHostProcess = child
}

if (!hasSingleInstanceLock) {
  app.quit()
}

const resolveAppAssetPath = (pathname: string) => resolveRendererAssetPath(rendererDistPath(), pathname)

const withRendererSecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers)
  for (const [name, value] of rendererSecurityHeaderEntries) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const registerAppProtocol = () => {
  protocol.handle(PASSKEY_SCHEME, async (request) => {
    if (request.method !== 'GET') {
      return withRendererSecurityHeaders(new Response('Method not allowed', { status: 405 }))
    }

    const url = new URL(request.url)
    if (url.host !== PASSKEY_HOST) {
      return withRendererSecurityHeaders(new Response('Not found', { status: 404 }))
    }

    return withRendererSecurityHeaders(await net.fetch(pathToFileURL(resolveAppAssetPath(url.pathname)).toString()))
  })
}

const registerOAuthProtocolClient = () => {
  if (process.platform === 'linux') {
    const registered = ensureLinuxProtocolClientRegistration()
    if (!registered) {
      console.warn('Could not register the Linux klarkey:// protocol handler.')
    }
  }

  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(PASSKEY_SCHEME, process.execPath, [app.getAppPath()])
    return
  }

  app.setAsDefaultProtocolClient(PASSKEY_SCHEME)
}

const handleOAuthCallbackUrl = (url: string) => {
  const completion = controllerRef?.completeSyncSignIn(url)
  if (!completion) {
    return
  }

  void completion
    .then(() => {
      openPalette()
    })
    .catch((error) => {
      console.error('Ave sync sign-in failed:', safeErrorMessage(error, 'Sync sign-in failed.'))
      openPalette()
    })
}

const validateIpcSender = (event: Electron.IpcMainInvokeEvent) => {
  const frameUrl = event.senderFrame?.url
  if (!isTrustedRendererUrl(frameUrl, rendererTrustOptions())) {
    throw new Error('Unauthorized IPC sender')
  }
}

const openExternalBrowserUrl = (url: string) => {
  if (isExternalBrowserUrl(url, rendererTrustOptions())) {
    void shell.openExternal(url)
  }
}

const bindWindowSecurity = (window: BrowserWindow) => {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalBrowserUrl(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isTrustedRendererUrl(navigationUrl, rendererTrustOptions())) {
      return
    }

    event.preventDefault()
    openExternalBrowserUrl(navigationUrl)
  })
}

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 760,
    height: 520,
    minWidth: 720,
    minHeight: 460,
    frame: false,
    transparent: supportsAcrylicWindowBackground(),
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    backgroundColor: supportsAcrylicWindowBackground() ? '#0f1011cc' : '#1a1a1b',
    backgroundMaterial: supportsAcrylicWindowBackground() ? 'acrylic' : 'none',
    roundedCorners: true,
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  })

  bindWindowSecurity(window)

  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      window.hide()
      nudgeInstallCheck()
    }
  })

  window.on('blur', () => {
    if (!isQuitting && window.isVisible() && !shouldKeepPaletteVisibleOnBlur()) {
      window.hide()
      nudgeInstallCheck()
    }
  })

  window.on('hide', () => {
    nudgeInstallCheck()
  })

  window.webContents.on('did-finish-load', () => {
    console.info('Klarkey renderer loaded')
  })

  window.webContents.on('did-fail-load', (_, code, description) => {
    console.error('Klarkey renderer failed to load', safeRendererLoadFailureDetails(code, description))
  })

  window.webContents.on('render-process-gone', (_, details) => {
    console.error('Klarkey renderer crashed', safeRendererProcessGoneDetails(details))
  })

  if (supportsAcrylicWindowBackground()) {
    window.setBackgroundMaterial?.('acrylic')
  }

  windowRef = window
  controllerRef = new KlarkeyController(window)

  const liveUrl = devServerUrl()
  if (liveUrl) {
    await window.loadURL(liveUrl)
  } else {
    await window.loadURL(PASSKEY_ORIGIN)
  }

  window.once('ready-to-show', () => {
    if (shouldExternalUnlockOnStart && !shouldOpenPaletteOnStart) {
      requestExternalUnlock()
      return
    }

    if (isDevMode || shouldOpenPaletteOnStart) {
      openPalette({ externalUnlock: shouldAutoUnlockOnStart })
    }
  })
}

const shouldAutoUnlockFromArgs = (argv: string[]) => hasTrustedExternalUnlockArgs(argv, externalUnlockToken)
const shouldOpenPaletteFromArgs = (argv: string[]) => argv.includes('--open-palette')

const requestExternalUnlock = () => {
  if (!controllerRef) {
    return
  }

  const lockInfo = controllerRef.getLockInfo()
  if (lockInfo.state === 'unlocked') {
    return
  }

  if (!lockInfo.primaryMethods.includes('windowsHello')) {
    openPalette()
    return
  }

  const now = Date.now()
  if (externalUnlockInFlight || now - lastExternalUnlockPromptAt < 10000) {
    return
  }
  lastExternalUnlockPromptAt = now

  noteDesktopOperation(60_000)
  controllerRef.recordActivity()

  const wasAlwaysOnTop = windowRef?.isAlwaysOnTop() ?? false
  windowRef?.setAlwaysOnTop(false)
  externalUnlockInFlight = controllerRef.unlockWithWindowsHello()
    .then(() => undefined)
    .catch((error) => {
      console.error('External Windows Hello unlock failed:', safeErrorMessage(error))
    })
    .finally(() => {
      windowRef?.setAlwaysOnTop(wasAlwaysOnTop)
      externalUnlockInFlight = null
      nudgeInstallCheck()
    })
}

const openPalette = (options?: { externalUnlock?: boolean }) => {
  if (!windowRef || !controllerRef) {
    return
  }

  notePaletteOpen()

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = windowRef.getBounds()
  const x = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height * 0.12)

  windowRef.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  windowRef.setAlwaysOnTop(false)
  windowRef.setAlwaysOnTop(true, 'screen-saver')
  windowRef.setFocusable(true)
  windowRef.setPosition(x, y, false)
  if (windowRef.isMinimized()) {
    windowRef.restore()
  }
  windowRef.moveTop()
  controllerRef?.rememberExternalWindow()
  windowRef.webContents.send(IPC_CHANNELS.palettePrepare, options?.externalUnlock ? { externalUnlock: true } : undefined)

  setTimeout(() => {
    windowRef?.show()
    windowRef?.setAlwaysOnTop(true, 'screen-saver')
    windowRef?.moveTop()
    windowRef?.focus()
    windowRef?.webContents.focus()
    controllerRef?.focus()
  }, 16)
}

const closePalette = () => {
  windowRef?.hide()
}

const openPaletteFromUser = () => {
  openPalette()
}

const shouldKeepPaletteVisibleOnBlur = () => {
  const state = controllerRef?.getLockInfo().state
  return state === 'locked' || state === 'passcode'
}

const registerHotkey = () => {
  const hotkey = controllerRef?.getSettings().hotkey ?? 'Alt+S'
  globalShortcut.unregisterAll()
  const registered = globalShortcut.register(hotkey, openPaletteFromUser)
  if (!registered) {
    const installedDesktopFallback = ensureLinuxDesktopShortcutFallback(hotkey)
    console.warn(
      installedDesktopFallback
        ? `Electron could not register ${hotkey}; installed a desktop shortcut fallback.`
        : `Could not register global shortcut ${hotkey}.`,
    )
  }
}

const createTray = () => {
  const icon = appIcon().resize({ width: 18, height: 18 })
  const tray = new Tray(icon)
  tray.setToolTip('Klarkey')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Klarkey', click: openPaletteFromUser },
      { label: 'Lock Vault', click: () => controllerRef?.lock() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', openPaletteFromUser)
}

const bindIpc = () => {
  const vaultLockedResult = {
    status: 'locked',
    title: 'Vault locked',
    message: 'Unlock the vault to continue.',
  } as const
  const vaultOperationLockedResult = { success: false, message: 'Vault locked' } as const

  const withVaultUnlocked = <TArgs extends unknown[], TResult>(
    lockedFallback: TResult,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult,
  ) => {
    return (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => {
      validateIpcSender(event)
      const state = controllerRef?.getLockInfo().state
      if (state !== 'unlocked') {
        return lockedFallback
      }
      controllerRef?.recordActivity()
      return handler(event, ...args)
    }
  }

  const withDesktopInteraction = <TArgs extends unknown[], TResult>(
    busyMs: number,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
  ) => {
    return async (event: Electron.IpcMainInvokeEvent, ...args: TArgs) => {
      validateIpcSender(event)
      noteDesktopOperation(busyMs)
      controllerRef?.recordActivity()
      try {
        return await handler(event, ...args)
      } finally {
        nudgeInstallCheck()
      }
    }
  }

  ipcMain.handle(IPC_CHANNELS.paletteOpen, async (event) => {
    validateIpcSender(event)
    openPalette()
  })
  ipcMain.handle(IPC_CHANNELS.paletteClose, async (event) => {
    validateIpcSender(event)
    closePalette()
  })
  ipcMain.handle(IPC_CHANNELS.commandParse, (event, raw) => {
    validateIpcSender(event)
    return controllerRef?.parseCommand(event, sanitizeCommandRaw(raw))
  })
  ipcMain.handle(IPC_CHANNELS.searchResolve, (event, query) => {
    validateIpcSender(event)
    return controllerRef?.resolve(event, sanitizeSearchRequest(query))
  })
  ipcMain.handle(
    IPC_CHANNELS.actionExecute,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultLockedResult, (event, actionId, modifier) => {
      const request = sanitizeActionExecutionRequest(actionId, modifier)
      return controllerRef?.execute(event, request.actionId, request.modifier) ?? vaultLockedResult
    })),
  )
  ipcMain.handle(IPC_CHANNELS.desktopSupport, (event) => {
    validateIpcSender(event)
    return getDesktopIntegrationSupport()
  })
  ipcMain.handle(
    IPC_CHANNELS.clipboardCopySecret,
    withDesktopInteraction(15_000, withVaultUnlocked(vaultLockedResult, (_event, value) =>
      controllerRef?.copySecret(sanitizeClipboardSecret(value)) ?? vaultLockedResult)),
  )
  ipcMain.handle(IPC_CHANNELS.itemGet, withVaultUnlocked(undefined, (_event, itemId) => controllerRef?.getItem(sanitizeItemId(itemId))))
  ipcMain.handle(
    IPC_CHANNELS.itemCreate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.createItem(sanitizeCreateItemInput(input)) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.itemUpdate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.updateItem(sanitizeUpdateItemInput(input)) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.itemDelete,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, itemId) => controllerRef?.deleteItem(sanitizeItemId(itemId)) ?? vaultLockedResult)),
  )
  ipcMain.handle(IPC_CHANNELS.vaultUnlock, withDesktopInteraction(30_000, () => controllerRef?.unlock()))
  ipcMain.handle(IPC_CHANNELS.vaultLockState, (event) => {
    validateIpcSender(event)
    return controllerRef?.getLockInfo()
  })
  ipcMain.handle(IPC_CHANNELS.vaultUnlockWithHello, withDesktopInteraction(60_000, async () => {
    const wasAlwaysOnTop = windowRef?.isAlwaysOnTop() ?? true
    windowRef?.setAlwaysOnTop(false)
    try {
      const result = await controllerRef?.unlockWithWindowsHello()
      return result ?? { success: false, message: 'Controller not available.' }
    } finally {
      windowRef?.setAlwaysOnTop(wasAlwaysOnTop)
    }
  }))
  ipcMain.handle(IPC_CHANNELS.vaultUnlockWithPassword, withDesktopInteraction(30_000, (_event, password: string) => controllerRef?.unlockWithPassword(sanitizePassword(password))))
  ipcMain.handle(IPC_CHANNELS.vaultLock, withDesktopInteraction(15_000, () => {
    controllerRef?.lock()
  }))
  ipcMain.handle(
    IPC_CHANNELS.vaultSetupMasterPassword,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultOperationLockedResult, (_event, password: string) => controllerRef?.setupMasterPassword(sanitizePassword(password)) ?? vaultOperationLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.vaultChangeMasterPassword,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultOperationLockedResult, (_event, currentPassword: string, newPassword: string) =>
      controllerRef?.changeMasterPassword(sanitizePassword(currentPassword), sanitizePassword(newPassword)) ?? vaultOperationLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.vaultRemoveMasterPassword,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultOperationLockedResult, (_event, currentPassword: string) => controllerRef?.removeMasterPassword(sanitizePassword(currentPassword)) ?? vaultOperationLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.vaultSetPasscode,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultOperationLockedResult, (_event, passcode: string) => controllerRef?.setPasscode(sanitizePasscode(passcode)) ?? vaultOperationLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.vaultRemovePasscode,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultOperationLockedResult, () => controllerRef?.removePasscode() ?? vaultOperationLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.vaultConfirmPasscode,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultOperationLockedResult, (_event, passcode: string) => controllerRef?.confirmPasscode(sanitizePasscode(passcode)) ?? vaultOperationLockedResult)),
  )
  ipcMain.handle(IPC_CHANNELS.vaultVerifyPasscode, withDesktopInteraction(45_000, (_event, passcode: string) => controllerRef?.verifyPasscode(sanitizePasscode(passcode))))
  ipcMain.handle(IPC_CHANNELS.settingsGet, (event) => {
    validateIpcSender(event)
    return controllerRef?.getSettings()
  })
  ipcMain.handle(IPC_CHANNELS.paletteTargetGet, (event) => {
    validateIpcSender(event)
    return controllerRef?.getExternalWindowContext()
  })
  ipcMain.handle(IPC_CHANNELS.settingsSet, withDesktopInteraction(15_000, withVaultUnlocked(undefined, (_event, unsafeUpdate) => {
    const update = sanitizeSettingsUpdate(unsafeUpdate)
    const previous = controllerRef?.getSettings()
    if (!previous) {
      return undefined
    }

    if (update?.hotkey !== undefined) {
      globalShortcut.unregisterAll()
      const ok = globalShortcut.register(update.hotkey, openPaletteFromUser)
      if (!ok) {
        const restored = globalShortcut.register(previous.hotkey, openPaletteFromUser)
        if (!restored) {
          console.warn(`Could not restore global shortcut ${previous.hotkey}.`)
        }
        throw new Error('Could not register shortcut')
      }
    } else {
      registerHotkey()
    }

    const nextSettings = controllerRef?.updateSettings(update)
    syncSshAgentHost()
    return nextSettings
  })))
  ipcMain.handle(IPC_CHANNELS.syncStatus, (event) => {
    validateIpcSender(event)
    return controllerRef?.getSyncStatus()
  })
  ipcMain.handle(IPC_CHANNELS.syncSignIn, withDesktopInteraction(30_000, () => controllerRef?.startSyncSignIn()))
  ipcMain.handle(IPC_CHANNELS.syncSignOut, withDesktopInteraction(15_000, () => controllerRef?.signOutSync()))
  ipcMain.handle(IPC_CHANNELS.syncNow, withDesktopInteraction(120_000, () => controllerRef?.syncNow()))
  ipcMain.handle(IPC_CHANNELS.passkeySupport, (event) => {
    validateIpcSender(event)
    return controllerRef?.getPasskeySupport()
  })
  ipcMain.handle(IPC_CHANNELS.passkeyList, withVaultUnlocked([], () => controllerRef?.listVaultPasskeys() ?? []))
  ipcMain.handle(
    IPC_CHANNELS.passkeyCreate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.createVaultPasskey(sanitizeCreateVaultPasskeyInput(input)) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.passkeyAuthenticate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, credentialId) => controllerRef?.authenticateVaultPasskey(sanitizeCredentialId(credentialId)) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.passkeyDelete,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultLockedResult, (_event, passkeyId) => controllerRef?.deleteVaultPasskey(sanitizeItemId(passkeyId)) ?? vaultLockedResult)),
  )
  const exportLockedResult = { success: false, exportedCount: 0, message: 'Vault locked' } as const
  const importLockedResult = { success: false, importedCount: 0, skippedCount: 0, errorCount: 0, message: 'Vault locked' } as const
  ipcMain.handle(IPC_CHANNELS.exportVault, withDesktopInteraction(300_000, async (_event, options) => {
    if (controllerRef?.getLockInfo().state !== 'unlocked') {
      return exportLockedResult
    }
    if (!importExportPathGrants.consumeExportPath(options)) {
      return {
        success: false,
        exportedCount: 0,
        message: 'Choose an export location from Klarkey before exporting.',
      }
    }
    return controllerRef?.exportVault(options) ?? exportLockedResult
  }))
  ipcMain.handle(IPC_CHANNELS.importVault, withDesktopInteraction(300_000, async (_event, options) => {
    if (controllerRef?.getLockInfo().state !== 'unlocked') {
      return importLockedResult
    }
    if (!importExportPathGrants.consumeImportPath(options)) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        message: 'Choose an import file from Klarkey before importing.',
      }
    }
    return controllerRef?.importVault(options) ?? importLockedResult
  }))
  ipcMain.handle(IPC_CHANNELS.pickImportFile, async (event, format: string) => {
    validateIpcSender(event)
    const safeFormat = sanitizeImportFormat(format)
    const filters: Electron.FileFilter[] = []
    if (safeFormat === '1pux') {
      filters.push({ name: '1Password Export', extensions: ['1pux'] })
    } else if (safeFormat === 'bitwarden-json') {
      filters.push({ name: 'Bitwarden JSON', extensions: ['json'] })
    } else if (safeFormat === 'dashlane-json') {
      filters.push({ name: 'Dashlane JSON', extensions: ['json'] })
    } else if (safeFormat === 'klarkey-json') {
      filters.push({ name: 'Klarkey JSON', extensions: ['json'] })
    } else {
      filters.push({ name: 'Supported files', extensions: ['csv', 'json', '1pux'] })
    }
    filters.push({ name: 'All files', extensions: ['*'] })

    const filePath = await withFileDialogWindowState(async () => {
      const zenityPath = pickFileWithZenity('open', filters)
      if (zenityPath) {
        return zenityPath
      }

      const result = process.platform === 'linux'
        ? await dialog.showOpenDialog({ filters, properties: ['openFile'] })
        : await dialog.showOpenDialog(windowRef!, { filters, properties: ['openFile'] })
      return result.canceled ? undefined : result.filePaths[0]
    })
    return filePath ? importExportPathGrants.grantImportPath(filePath, safeFormat) : undefined
  })
  ipcMain.handle(IPC_CHANNELS.pickExportFile, async (event, format: string) => {
    validateIpcSender(event)
    const safeFormat = sanitizeExportFormat(format)
    const filters: Electron.FileFilter[] = []
    if (safeFormat === 'klarkey-json') {
      filters.push({ name: 'Klarkey JSON', extensions: ['json'] })
    } else {
      filters.push({ name: 'CSV', extensions: ['csv'] })
    }

    const filePath = await withFileDialogWindowState(async () => {
      const zenityPath = pickFileWithZenity('save', filters)
      if (zenityPath) {
        return zenityPath
      }

      const result = process.platform === 'linux'
        ? await dialog.showSaveDialog({ filters, properties: ['createDirectory', 'showOverwriteConfirmation'] })
        : await dialog.showSaveDialog(windowRef!, { filters, properties: ['createDirectory', 'showOverwriteConfirmation'] })
      return result.canceled ? undefined : result.filePath
    })
    return filePath ? importExportPathGrants.grantExportPath(filePath, safeFormat) : undefined
  })

  if (isDevMode) {
    ipcMain.handle(IPC_CHANNELS.devForceLock, (event) => {
      validateIpcSender(event)
      controllerRef?.devForceLock()
      return controllerRef?.getLockInfo()
    })
    ipcMain.handle(IPC_CHANNELS.devForceUnlock, (event) => {
      validateIpcSender(event)
      controllerRef?.devForceUnlock()
      return controllerRef?.getLockInfo()
    })
    ipcMain.handle(IPC_CHANNELS.devForcePasscode, (event) => {
      validateIpcSender(event)
      controllerRef?.devForcePasscode()
      return controllerRef?.getLockInfo()
    })
    ipcMain.handle(IPC_CHANNELS.devDumpLockInfo, (event) => {
      validateIpcSender(event)
      return controllerRef?.devDumpLockInfo()
    })
    ipcMain.handle(IPC_CHANNELS.devResetVault, async (event) => {
      validateIpcSender(event)

      // Close the database and clear the controller BEFORE destroying the
      // window, because dispose() triggers lock() which fires a state-change
      // callback that sends IPC to windowRef.
      controllerRef?.dispose()
      controllerRef = null

      // Now it's safe to tear down the window/renderer.
      windowRef?.destroy()
      windowRef = null

      const dbPath = join(app.getPath('userData'), 'klarkey.sqlite')
      const keyPath = join(app.getPath('userData'), 'vault.key')

      // On Windows, better-sqlite3 with WAL mode keeps the DB file locked
      // even after close(). Instead of fighting the OS to delete files,
      // just reopen the DB and wipe every table. The file stays but is empty.
      // Then delete the key file so a new vault key is generated on restart.
      const { default: Database } = await import('better-sqlite3')
      const tmpDb = new Database(dbPath)
      try {
        tmpDb.exec(`
          DELETE FROM identities;
          DELETE FROM passkeys;
          DELETE FROM pending_passkeys;
          DELETE FROM vault_passkeys;
          DELETE FROM recent_actions;
          DELETE FROM settings;
          VACUUM;
        `)
      } finally {
        tmpDb.close()
      }

      try { rmSync(keyPath, { force: true }) } catch { /* ok */ }

      try {
        await session.defaultSession.clearCache()
      } catch {
        // ignore cache clear failures in dev reset
      }

      if (process.env.VITE_DEV_SERVER_URL) {
        app.quit()
        return { status: 'quit' }
      }

      app.relaunch()
      app.exit(0)
      return { status: 'restarting' }
    })
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})

app.whenReady()
  .then(async () => {
    if (isNativeMessagingHostMode) {
      await runNativeMessagingHost()
      app.quit()
      return
    }

    if (isPasskeyProviderBridgeMode) {
      await runPasskeyProviderBridgeHost(initialPasskeyProviderRequest)
      app.quit()
      return
    }

    if (isSshAgentHostMode) {
      await runSshAgentHost()
      app.quit()
      return
    }

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      const permissionName = String(permission)
      const isTrustedRequest = isTrustedPermissionRequest(undefined, details as PermissionDetailsLike | undefined, rendererTrustOptions())
      callback(permissionName === 'display-capture' && isTrustedRequest)
    })
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
      const permissionName = String(permission)
      const isTrustedRequest = isTrustedPermissionRequest(requestingOrigin, details as PermissionDetailsLike | undefined, rendererTrustOptions())
      return permissionName === 'display-capture' && isTrustedRequest
    })
    session.defaultSession.setDevicePermissionHandler(() => false)
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_, callback) => {
        if (!shouldAllowDisplayMediaRequest({
          securityOrigin: _.securityOrigin,
          frameUrl: _.frame?.url,
          videoRequested: _.videoRequested,
          audioRequested: _.audioRequested,
          userGesture: _.userGesture,
        }, rendererTrustOptions())) {
          callback({})
          return
        }

        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })

        callback({
          video: sources[0],
        })
      },
      { useSystemPicker: true },
    )

    resetRuntimeStateForAppStart()
    bindIpc()
    registerAppProtocol()
    registerOAuthProtocolClient()
    try {
      ensureNativeMessagingHostRegistration()
    } catch (error) {
      console.error('Failed to register the browser native host:', safeErrorMessage(error))
    }
    await createWindow()
    const callbackUrl = findOAuthCallbackUrl(process.argv)
    if (callbackUrl) {
      handleOAuthCallbackUrl(callbackUrl)
    }
    createTray()
    registerHotkey()
    app.setLoginItemSettings({ openAtLogin: controllerRef?.getSettings().launchOnStartup ?? false })
    syncSshAgentHost()
    updaterRef = new KlarkeyUpdater({
      isPaletteVisible: () => windowRef?.isVisible() ?? false,
    })
    updaterRef.start()
  })
  .catch((error) => {
    console.error('Failed to initialize Klarkey:', safeErrorMessage(error))
  })

app.on('second-instance', (_event, argv) => {
  const callbackUrl = findOAuthCallbackUrl(argv)
  if (callbackUrl) {
    handleOAuthCallbackUrl(callbackUrl)
    return
  }

  if (hasExternalUnlockRequest(argv) && !shouldOpenPaletteFromArgs(argv)) {
    requestExternalUnlock()
    return
  }

  openPalette({ externalUnlock: shouldAutoUnlockFromArgs(argv) })
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (isAveOAuthCallbackUrl(url)) {
    handleOAuthCallbackUrl(url)
  }
})

app.on('activate', () => {
  openPalette()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopSshAgentHost()
  updaterRef?.dispose()
  updaterRef = null
  controllerRef?.dispose()
  controllerRef = null
})

app.on('window-all-closed', () => undefined)
