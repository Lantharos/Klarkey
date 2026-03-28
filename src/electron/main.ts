import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  Tray,
} from 'electron'
import { KlarkeyController } from '@/electron/controller'
import { IPC_CHANNELS } from '@/electron/constants'

let windowRef: BrowserWindow | null = null
let controllerRef: KlarkeyController | null = null
let isQuitting = false
const __dirname = dirname(fileURLToPath(import.meta.url))
const isDevMode = process.argv.includes('--dev')
const rendererEntry = () => join(app.getAppPath(), 'dist', 'index.html')
const devServerUrl = () => process.env.VITE_DEV_SERVER_URL ?? (isDevMode ? 'http://127.0.0.1:5173' : undefined)
const appIconPath = () =>
  isDevMode ? join(app.getAppPath(), 'public', 'klarkey.png') : join(app.getAppPath(), 'dist', 'klarkey.png')
const appIcon = () => nativeImage.createFromPath(appIconPath())
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
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
    await window.loadFile(rendererEntry())
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
}

app.whenReady()
  .then(async () => {
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
