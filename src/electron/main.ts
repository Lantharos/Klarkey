import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
import { KlarkeyController } from '@/electron/controller'
import { IPC_CHANNELS } from '@/electron/constants'
import { runNativeMessagingHost } from '@/electron/native-host'
import { runPasskeyProviderBridgeHost } from '@/electron/passkey-provider-host'
import { PASSKEY_HOST, PASSKEY_ORIGIN, PASSKEY_SCHEME } from '@/shared/passkeys'

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
let isQuitting = false
const __dirname = dirname(fileURLToPath(import.meta.url))
const isDevMode = process.argv.includes('--dev')
const isNativeMessagingHostMode = process.argv.includes('--native-messaging-host')
const isPasskeyProviderBridgeMode = process.argv.includes('--passkey-provider-bridge')
const rendererDistPath = () => join(app.getAppPath(), 'dist')
const devServerUrl = () => process.env.VITE_DEV_SERVER_URL ?? (isDevMode ? 'http://127.0.0.1:5173' : undefined)
const appIconPath = () =>
  isDevMode ? join(app.getAppPath(), 'public', 'klarkey.png') : join(app.getAppPath(), 'dist', 'klarkey.png')
const appIcon = () => nativeImage.createFromPath(appIconPath())
const hasSingleInstanceLock = isNativeMessagingHostMode || isPasskeyProviderBridgeMode ? true : app.requestSingleInstanceLock()

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
    if (!isQuitting && window.isVisible()) {
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
    if (isDevMode) {
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
  windowRef.webContents.send(IPC_CHANNELS.palettePrepare)

  setTimeout(() => {
    windowRef?.showInactive()

    void controllerRef?.rememberExternalWindowAsync().finally(() => {
      windowRef?.focus()
      windowRef?.webContents.focus()
      controllerRef?.focus()
    })
  }, 16)
}

const closePalette = () => {
  windowRef?.hide()
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
  ipcMain.handle(IPC_CHANNELS.paletteOpen, async () => openPalette())
  ipcMain.handle(IPC_CHANNELS.paletteClose, async () => closePalette())
  ipcMain.handle(IPC_CHANNELS.commandParse, (event, raw) => controllerRef?.parseCommand(event, raw))
  ipcMain.handle(IPC_CHANNELS.searchResolve, (event, query) => controllerRef?.resolve(event, query))
  ipcMain.handle(IPC_CHANNELS.actionExecute, (event, actionId, modifier) =>
    controllerRef?.execute(event, actionId, modifier),
  )
  ipcMain.handle(IPC_CHANNELS.itemGet, (_, itemId) => controllerRef?.getItem(itemId))
  ipcMain.handle(IPC_CHANNELS.itemCreate, (_, input) => controllerRef?.createItem(input))
  ipcMain.handle(IPC_CHANNELS.itemUpdate, (_, input) => controllerRef?.updateItem(input))
  ipcMain.handle(IPC_CHANNELS.itemDelete, (_, itemId) => controllerRef?.deleteItem(itemId))
  ipcMain.handle(IPC_CHANNELS.vaultUnlock, () => controllerRef?.unlock())
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => controllerRef?.getSettings())
  ipcMain.handle(IPC_CHANNELS.settingsSet, (_, update) => {
    const next = controllerRef?.updateSettings(update)
    registerHotkey()
    return next
  })
  ipcMain.handle(IPC_CHANNELS.passkeySupport, () => controllerRef?.getPasskeySupport())
  ipcMain.handle(IPC_CHANNELS.passkeyList, () => controllerRef?.listVaultPasskeys())
  ipcMain.handle(IPC_CHANNELS.passkeyCreate, (_, input) => controllerRef?.createVaultPasskey(input))
  ipcMain.handle(IPC_CHANNELS.passkeyAuthenticate, (_, credentialId) =>
    controllerRef?.authenticateVaultPasskey(credentialId),
  )
  ipcMain.handle(IPC_CHANNELS.passkeyDelete, (_, passkeyId) => controllerRef?.deleteVaultPasskey(passkeyId))
}

app.whenReady()
  .then(async () => {
    if (isNativeMessagingHostMode) {
      await runNativeMessagingHost()
      app.quit()
      return
    }

    if (isPasskeyProviderBridgeMode) {
      await runPasskeyProviderBridgeHost()
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
    await createWindow()
    createTray()
    registerHotkey()
    app.setLoginItemSettings({ openAtLogin: controllerRef?.getSettings().launchOnStartup ?? false })
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
  controllerRef?.dispose()
})

app.on('window-all-closed', () => undefined)
