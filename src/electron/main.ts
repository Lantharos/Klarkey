import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
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
  Tray,
} from 'electron'
import { ensureNativeMessagingHostRegistration } from '@/electron/browser-host-registration'
import { KlarkeyController } from '@/electron/controller'
import { IPC_CHANNELS } from '@/electron/constants'
import { readNativeMessageSync, runNativeMessagingHost } from '@/electron/native-host'
import { readPasskeyProviderMessageSync, runPasskeyProviderBridgeHost } from '@/electron/passkey-provider-host'
import { markRuntimeBusy, noteDesktopActivity, notePaletteOpen, resetRuntimeStateForAppStart } from '@/electron/runtime-state'
import { runSshAgentHost } from '@/electron/ssh-agent-host'
import { KlarkeyUpdater } from '@/electron/updater'
import { PASSKEY_HOST, PASSKEY_ORIGIN, PASSKEY_SCHEME } from '@/shared/passkeys'

const ALLOWED_SENDER_PROTOCOLS = [PASSKEY_SCHEME, 'http', 'https']

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

let windowRef: BrowserWindow | null = null
let controllerRef: KlarkeyController | null = null
let sshAgentHostProcess: ChildProcess | null = null
let updaterRef: KlarkeyUpdater | null = null
let isQuitting = false
const __dirname = dirname(fileURLToPath(import.meta.url))
const isDevMode = process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL)
const shouldOpenPaletteOnStart = process.argv.includes('--open-palette')
const shouldAutoUnlockOnStart = process.argv.includes('--external-unlock')
const isNativeMessagingHostMode = process.argv.includes('--native-messaging-host')
const isPasskeyProviderBridgeMode = process.argv.includes('--passkey-provider-bridge')
const isSshAgentHostMode = process.argv.includes('--ssh-agent-host')
const initialNativeHostRequest = isNativeMessagingHostMode ? readNativeMessageSync() : undefined
const initialPasskeyProviderRequest = isPasskeyProviderBridgeMode ? readPasskeyProviderMessageSync() : undefined
const rendererDistPath = () => join(app.getAppPath(), 'dist')
const devServerUrl = () => process.env.VITE_DEV_SERVER_URL ?? (isDevMode ? 'http://127.0.0.1:5173' : undefined)
const appIconPath = () =>
  isDevMode ? join(app.getAppPath(), 'public', 'klarkey.png') : join(app.getAppPath(), 'dist', 'klarkey.png')
const appIcon = () => nativeImage.createFromPath(appIconPath())
const hasSingleInstanceLock = isNativeMessagingHostMode || isPasskeyProviderBridgeMode || isSshAgentHostMode ? true : app.requestSingleInstanceLock()
const findOAuthCallbackUrl = (argv: string[]) => argv.find((arg) => arg.startsWith('klarkey://oauth/callback'))

const spawnBackgroundHost = (modeFlag: '--ssh-agent-host') => {
  const appPath = app.getAppPath()
  const args = appPath && appPath !== process.execPath
    ? [appPath, modeFlag]
    : [modeFlag]

  return spawn(process.execPath, args, {
    detached: false,
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

const resolveAppAssetPath = (pathname: string) => {
  const distPath = rendererDistPath()
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const normalizedPath = /\.[a-z0-9]+$/i.test(requestedPath) ? requestedPath : '/index.html'
  const resolvedPath = resolve(distPath, `.${decodeURIComponent(normalizedPath)}`)

  return resolvedPath.startsWith(distPath) ? resolvedPath : resolve(distPath, 'index.html')
}

const registerAppProtocol = () => {
  protocol.handle(PASSKEY_SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.host !== PASSKEY_HOST) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(resolveAppAssetPath(url.pathname)).toString())
  })
}

const registerOAuthProtocolClient = () => {
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
      console.error('Ave sync sign-in failed', error)
      openPalette()
    })
}

const validateIpcSender = (event: Electron.IpcMainInvokeEvent) => {
  const frameUrl = event.senderFrame?.url
  if (!frameUrl) {
    throw new Error('Unauthorized IPC sender')
  }

  if (isDevMode && frameUrl.startsWith('http://')) {
    return
  }

  const senderProtocol = new URL(frameUrl).protocol.replace(':', '')
  if (!ALLOWED_SENDER_PROTOCOLS.includes(senderProtocol as typeof ALLOWED_SENDER_PROTOCOLS[number])) {
    throw new Error('Unauthorized IPC sender')
  }
}

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 760,
    height: 520,
    minWidth: 720,
    minHeight: 460,
    frame: false,
    transparent: false,
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f1011',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

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
    console.error('Klarkey renderer failed to load', code, description)
  })

  window.webContents.on('render-process-gone', (_, details) => {
    console.error('Klarkey renderer crashed', details)
  })

  window.setBackgroundMaterial?.('acrylic')

  windowRef = window
  controllerRef = new KlarkeyController(window)

  const liveUrl = devServerUrl()
  if (liveUrl) {
    await window.loadURL(liveUrl)
  } else {
    await window.loadURL(PASSKEY_ORIGIN)
  }

  window.once('ready-to-show', () => {
    if (isDevMode || shouldOpenPaletteOnStart) {
      openPalette({ externalUnlock: shouldAutoUnlockOnStart })
    }
  })
}

const shouldAutoUnlockFromArgs = (argv: string[]) => argv.includes('--external-unlock')

const openPalette = (options?: { externalUnlock?: boolean }) => {
  if (!windowRef || !controllerRef) {
    return
  }

  notePaletteOpen()

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = windowRef.getBounds()
  const x = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height * 0.12)

  windowRef.setPosition(x, y, false)
  windowRef.moveTop()
  controllerRef?.rememberExternalWindow()
  windowRef.webContents.send(IPC_CHANNELS.palettePrepare, options?.externalUnlock ? { externalUnlock: true } : undefined)

  setTimeout(() => {
    windowRef?.showInactive()
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
  globalShortcut.register(hotkey, openPaletteFromUser)
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
    return controllerRef?.parseCommand(event, raw)
  })
  ipcMain.handle(IPC_CHANNELS.searchResolve, (event, query) => {
    validateIpcSender(event)
    return controllerRef?.resolve(event, query)
  })
  ipcMain.handle(
    IPC_CHANNELS.actionExecute,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultLockedResult, (event, actionId, modifier) => controllerRef?.execute(event, actionId, modifier) ?? vaultLockedResult)),
  )
  ipcMain.handle(IPC_CHANNELS.itemGet, withVaultUnlocked(undefined, (_event, itemId) => controllerRef?.getItem(itemId)))
  ipcMain.handle(
    IPC_CHANNELS.itemCreate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.createItem(input) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.itemUpdate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.updateItem(input) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.itemDelete,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, itemId) => controllerRef?.deleteItem(itemId) ?? vaultLockedResult)),
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
  ipcMain.handle(IPC_CHANNELS.vaultUnlockWithPassword, withDesktopInteraction(30_000, (_event, password: string) => controllerRef?.unlockWithPassword(password)))
  ipcMain.handle(IPC_CHANNELS.vaultLock, withDesktopInteraction(15_000, () => {
    controllerRef?.lock()
  }))
  ipcMain.handle(IPC_CHANNELS.vaultSetupMasterPassword, withDesktopInteraction(60_000, (_event, password: string) => controllerRef?.setupMasterPassword(password)))
  ipcMain.handle(
    IPC_CHANNELS.vaultChangeMasterPassword,
    withDesktopInteraction(60_000, (_event, currentPassword: string, newPassword: string) => controllerRef?.changeMasterPassword(currentPassword, newPassword)),
  )
  ipcMain.handle(IPC_CHANNELS.vaultRemoveMasterPassword, withDesktopInteraction(60_000, (_event, currentPassword: string) => controllerRef?.removeMasterPassword(currentPassword)))
  ipcMain.handle(IPC_CHANNELS.vaultSetPasscode, withDesktopInteraction(45_000, (_event, passcode: string) => controllerRef?.setPasscode(passcode)))
  ipcMain.handle(IPC_CHANNELS.vaultRemovePasscode, withDesktopInteraction(45_000, () => controllerRef?.removePasscode()))
  ipcMain.handle(IPC_CHANNELS.vaultConfirmPasscode, withDesktopInteraction(45_000, (_event, passcode: string) => controllerRef?.confirmPasscode(passcode)))
  ipcMain.handle(IPC_CHANNELS.vaultVerifyPasscode, withDesktopInteraction(45_000, (_event, passcode: string) => controllerRef?.verifyPasscode(passcode)))
  ipcMain.handle(IPC_CHANNELS.settingsGet, (event) => {
    validateIpcSender(event)
    return controllerRef?.getSettings()
  })
  ipcMain.handle(IPC_CHANNELS.paletteTargetGet, (event) => {
    validateIpcSender(event)
    return controllerRef?.getExternalWindowContext()
  })
  ipcMain.handle(IPC_CHANNELS.settingsSet, withDesktopInteraction(15_000, (_event, update) => {
    const previous = controllerRef?.getSettings()
    if (!previous) {
      return undefined
    }

    if (update?.hotkey !== undefined) {
      globalShortcut.unregisterAll()
      const ok = globalShortcut.register(update.hotkey, openPaletteFromUser)
      if (!ok) {
        globalShortcut.register(previous.hotkey, openPaletteFromUser)
        throw new Error('Could not register shortcut')
      }
    } else {
      registerHotkey()
    }

    const nextSettings = controllerRef?.updateSettings(update)
    syncSshAgentHost()
    return nextSettings
  }))
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
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.createVaultPasskey(input) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.passkeyAuthenticate,
    withDesktopInteraction(60_000, withVaultUnlocked(vaultLockedResult, (_event, credentialId) => controllerRef?.authenticateVaultPasskey(credentialId) ?? vaultLockedResult)),
  )
  ipcMain.handle(
    IPC_CHANNELS.passkeyDelete,
    withDesktopInteraction(45_000, withVaultUnlocked(vaultLockedResult, (_event, passkeyId) => controllerRef?.deleteVaultPasskey(passkeyId) ?? vaultLockedResult)),
  )
  const exportLockedResult = { success: false, exportedCount: 0, message: 'Vault locked' } as const
  const importLockedResult = { success: false, importedCount: 0, skippedCount: 0, errorCount: 0, message: 'Vault locked' } as const
  ipcMain.handle(IPC_CHANNELS.exportVault, withDesktopInteraction(300_000, async (_event, options) => {
    if (controllerRef?.getLockInfo().state !== 'unlocked') {
      return exportLockedResult
    }
    return controllerRef?.exportVault(options) ?? exportLockedResult
  }))
  ipcMain.handle(IPC_CHANNELS.importVault, withDesktopInteraction(300_000, async (_event, options) => {
    if (controllerRef?.getLockInfo().state !== 'unlocked') {
      return importLockedResult
    }
    return controllerRef?.importVault(options) ?? importLockedResult
  }))
  ipcMain.handle(IPC_CHANNELS.pickImportFile, async (event, format: string) => {
    validateIpcSender(event)
    const filters: Electron.FileFilter[] = []
    if (format === '1pux') {
      filters.push({ name: '1Password Export', extensions: ['1pux'] })
    } else if (format === 'bitwarden-json') {
      filters.push({ name: 'Bitwarden JSON', extensions: ['json'] })
    } else if (format === 'dashlane-json') {
      filters.push({ name: 'Dashlane JSON', extensions: ['json'] })
    } else if (format === 'klarkey-json') {
      filters.push({ name: 'Klarkey JSON', extensions: ['json'] })
    } else {
      filters.push({ name: 'Supported files', extensions: ['csv', 'json', '1pux'] })
    }
    filters.push({ name: 'All files', extensions: ['*'] })

    const result = await dialog.showOpenDialog(windowRef!, { filters, properties: ['openFile'] })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle(IPC_CHANNELS.pickExportFile, async (event, format: string) => {
    validateIpcSender(event)
    const filters: Electron.FileFilter[] = []
    if (format === 'klarkey-json') {
      filters.push({ name: 'Klarkey JSON', extensions: ['json'] })
    } else {
      filters.push({ name: 'CSV', extensions: ['csv'] })
    }

    const result = await dialog.showSaveDialog(windowRef!, { filters, properties: ['createDirectory', 'showOverwriteConfirmation'] })
    return result.canceled ? undefined : result.filePath
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

app.whenReady()
  .then(async () => {
    if (isNativeMessagingHostMode) {
      await runNativeMessagingHost(initialNativeHostRequest)
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

    session.defaultSession.setDisplayMediaRequestHandler(
      async (_, callback) => {
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
      console.error('Failed to register the browser native host', error)
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
    console.error('Failed to initialize Klarkey', error)
  })

app.on('second-instance', (_event, argv) => {
  const callbackUrl = findOAuthCallbackUrl(argv)
  if (callbackUrl) {
    handleOAuthCallbackUrl(callbackUrl)
    return
  }

  openPalette({ externalUnlock: shouldAutoUnlockFromArgs(argv) })
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (url.startsWith('klarkey://oauth/callback')) {
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
