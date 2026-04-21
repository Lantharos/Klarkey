import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unlinkSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  app,
  BrowserWindow,
  desktopCapturer,
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
import { runSshAgentHost } from '@/electron/ssh-agent-host'
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
let isQuitting = false
const __dirname = dirname(fileURLToPath(import.meta.url))
const isDevMode = process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL)
const shouldOpenPaletteOnStart = process.argv.includes('--open-palette')
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
    }
  })

  window.on('blur', () => {
    if (!isQuitting && window.isVisible() && !shouldKeepPaletteVisibleOnBlur()) {
      window.hide()
    }
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
      openPalette()
    }
  })
}

const openPalette = () => {
  if (!windowRef || !controllerRef) {
    return
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const bounds = windowRef.getBounds()
  const x = Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height * 0.12)

  windowRef.setPosition(x, y, false)
  windowRef.moveTop()
  controllerRef?.rememberExternalWindow()
  windowRef.webContents.send(IPC_CHANNELS.palettePrepare)

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

const shouldKeepPaletteVisibleOnBlur = () => {
  const state = controllerRef?.getLockInfo().state
  return state === 'locked' || state === 'passcode'
}

const registerHotkey = () => {
  const hotkey = controllerRef?.getSettings().hotkey ?? 'Alt+S'
  globalShortcut.unregisterAll()
  globalShortcut.register(hotkey, openPalette)
}

const createTray = () => {
  const icon = appIcon().resize({ width: 18, height: 18 })
  const tray = new Tray(icon)
  tray.setToolTip('Klarkey')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Klarkey', click: openPalette },
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
  tray.on('click', openPalette)
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
  ipcMain.handle(IPC_CHANNELS.actionExecute, withVaultUnlocked(vaultLockedResult, (event, actionId, modifier) => controllerRef?.execute(event, actionId, modifier) ?? vaultLockedResult))
  ipcMain.handle(IPC_CHANNELS.itemGet, withVaultUnlocked(undefined, (_event, itemId) => controllerRef?.getItem(itemId)))
  ipcMain.handle(IPC_CHANNELS.itemCreate, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.createItem(input) ?? vaultLockedResult))
  ipcMain.handle(IPC_CHANNELS.itemUpdate, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.updateItem(input) ?? vaultLockedResult))
  ipcMain.handle(IPC_CHANNELS.itemDelete, withVaultUnlocked(vaultLockedResult, (_event, itemId) => controllerRef?.deleteItem(itemId) ?? vaultLockedResult))
  ipcMain.handle(IPC_CHANNELS.vaultUnlock, (event) => {
    validateIpcSender(event)
    return controllerRef?.unlock()
  })
  ipcMain.handle(IPC_CHANNELS.vaultLockState, (event) => {
    validateIpcSender(event)
    return controllerRef?.getLockInfo()
  })
  ipcMain.handle(IPC_CHANNELS.vaultUnlockWithHello, async (event) => {
    validateIpcSender(event)
    const result = await controllerRef?.unlockWithWindowsHello()
    return result ?? { success: false, message: 'Controller not available.' }
  })
  ipcMain.handle(IPC_CHANNELS.vaultUnlockWithPassword, (event, password: string) => {
    validateIpcSender(event)
    return controllerRef?.unlockWithPassword(password)
  })
  ipcMain.handle(IPC_CHANNELS.vaultLock, (event) => {
    validateIpcSender(event)
    controllerRef?.lock()
  })
  ipcMain.handle(IPC_CHANNELS.vaultSetupMasterPassword, (event, password: string) => {
    validateIpcSender(event)
    return controllerRef?.setupMasterPassword(password)
  })
  ipcMain.handle(IPC_CHANNELS.vaultChangeMasterPassword, (event, currentPassword: string, newPassword: string) => {
    validateIpcSender(event)
    return controllerRef?.changeMasterPassword(currentPassword, newPassword)
  })
  ipcMain.handle(IPC_CHANNELS.vaultRemoveMasterPassword, (event, currentPassword: string) => {
    validateIpcSender(event)
    return controllerRef?.removeMasterPassword(currentPassword)
  })
  ipcMain.handle(IPC_CHANNELS.vaultSetPasscode, (event, passcode: string) => {
    validateIpcSender(event)
    return controllerRef?.setPasscode(passcode)
  })
  ipcMain.handle(IPC_CHANNELS.vaultRemovePasscode, (event) => {
    validateIpcSender(event)
    return controllerRef?.removePasscode()
  })
  ipcMain.handle(IPC_CHANNELS.vaultConfirmPasscode, (event, passcode: string) => {
    validateIpcSender(event)
    return controllerRef?.confirmPasscode(passcode)
  })
  ipcMain.handle(IPC_CHANNELS.vaultVerifyPasscode, (event, passcode: string) => {
    validateIpcSender(event)
    return controllerRef?.verifyPasscode(passcode)
  })
  ipcMain.handle(IPC_CHANNELS.settingsGet, (event) => {
    validateIpcSender(event)
    return controllerRef?.getSettings()
  })
  ipcMain.handle(IPC_CHANNELS.paletteTargetGet, (event) => {
    validateIpcSender(event)
    return controllerRef?.getExternalWindowContext()
  })
  ipcMain.handle(IPC_CHANNELS.settingsSet, (event, update) => {
    validateIpcSender(event)
    const previous = controllerRef?.getSettings()
    if (!previous) {
      return undefined
    }

    if (update?.hotkey !== undefined) {
      globalShortcut.unregisterAll()
      const ok = globalShortcut.register(update.hotkey, openPalette)
      if (!ok) {
        globalShortcut.register(previous.hotkey, openPalette)
        throw new Error('Could not register shortcut')
      }
    } else {
      registerHotkey()
    }

    const nextSettings = controllerRef?.updateSettings(update)
    syncSshAgentHost()
    return nextSettings
  })
  ipcMain.handle(IPC_CHANNELS.passkeySupport, (event) => {
    validateIpcSender(event)
    return controllerRef?.getPasskeySupport()
  })
  ipcMain.handle(IPC_CHANNELS.passkeyList, withVaultUnlocked([], () => controllerRef?.listVaultPasskeys() ?? []))
  ipcMain.handle(IPC_CHANNELS.passkeyCreate, withVaultUnlocked(vaultLockedResult, (_event, input) => controllerRef?.createVaultPasskey(input) ?? vaultLockedResult))
  ipcMain.handle(IPC_CHANNELS.passkeyAuthenticate, withVaultUnlocked(vaultLockedResult, (_event, credentialId) => controllerRef?.authenticateVaultPasskey(credentialId) ?? vaultLockedResult))
  ipcMain.handle(IPC_CHANNELS.passkeyDelete, withVaultUnlocked(vaultLockedResult, (_event, passkeyId) => controllerRef?.deleteVaultPasskey(passkeyId) ?? vaultLockedResult))

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

      controllerRef?.dispose()
      controllerRef = null

      const dbPath = join(app.getPath('userData'), 'klarkey.sqlite')
      const dbWalPath = `${dbPath}-wal`
      const dbShmPath = `${dbPath}-shm`
      const keyPath = join(app.getPath('userData'), 'vault.key')
      try { unlinkSync(dbPath) } catch { /* ok */ }
      try { unlinkSync(dbWalPath) } catch { /* ok */ }
      try { unlinkSync(dbShmPath) } catch { /* ok */ }
      try { unlinkSync(keyPath) } catch { /* ok */ }

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

    bindIpc()
    registerAppProtocol()
    try {
      ensureNativeMessagingHostRegistration()
    } catch (error) {
      console.error('Failed to register the browser native host', error)
    }
    await createWindow()
    createTray()
    registerHotkey()
    app.setLoginItemSettings({ openAtLogin: controllerRef?.getSettings().launchOnStartup ?? false })
    syncSshAgentHost()
  })
  .catch((error) => {
    console.error('Failed to initialize Klarkey', error)
  })

app.on('second-instance', () => {
  openPalette()
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
  controllerRef?.dispose()
  controllerRef = null
})

app.on('window-all-closed', () => undefined)
