import { execFileSync } from 'node:child_process'
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  KLARKEY_CHROMIUM_EXTENSION_ORIGIN,
  KLARKEY_FIREFOX_EXTENSION_ID,
  KLARKEY_NATIVE_HOST_NAME,
} from '@/shared/browser-extension'

const chromiumRegistryRoots = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  'HKCU\\Software\\Chromium\\NativeMessagingHosts',
]

const firefoxRegistryRoot = 'HKCU\\Software\\Mozilla\\NativeMessagingHosts'

const ignoreUnsupportedModeBits = () => undefined

const resolveNativeHostExecutable = () => {
  if (app.isPackaged && existsSync(app.getPath('exe'))) {
    return app.getPath('exe')
  }

  const appPath = app.getAppPath()
  const candidates = [
    join(appPath, 'dist-extension', 'native-host', 'Klarkey.NativeHostLauncher.exe'),
    join(appPath, 'scripts', 'Klarkey.NativeHostLauncher', 'bin', 'Release', 'net9.0', 'Klarkey.NativeHostLauncher.exe'),
  ]

  return candidates.find((candidate) => existsSync(candidate))
}

export const ensureNativeHostManifestDirectory = (directoryPath: string) => {
  try {
    mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
  } catch (error) {
    if (!existsSync(directoryPath)) {
      throw error
    }

    const stats = lstatSync(directoryPath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Native host manifest directory must be a normal directory.', { cause: error })
    }
  }

  const stats = lstatSync(directoryPath)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Native host manifest directory must be a normal directory.')
  }

  try {
    chmodSync(directoryPath, 0o700)
  } catch {
    ignoreUnsupportedModeBits()
  }
}

export const writeNativeHostManifestFile = (filePath: string, manifest: Record<string, unknown>) => {
  if (existsSync(filePath)) {
    const stats = lstatSync(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error('Native host manifest path must be a normal file.')
    }
  }

  const payload = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const descriptor = openSync(filePath, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY, 0o600)

  try {
    writeSync(descriptor, payload, 0, payload.byteLength)
  } finally {
    closeSync(descriptor)
  }

  try {
    chmodSync(filePath, 0o600)
  } catch {
    ignoreUnsupportedModeBits()
  }
}

const setRegistryValue = (registryPath: string, manifestPath: string) => {
  execFileSync(
    'reg',
    ['ADD', registryPath, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
    {
      windowsHide: true,
    },
  )
}

export const ensureNativeMessagingHostRegistration = () => {
  if (process.platform !== 'win32') {
    return false
  }

  const hostPath = resolveNativeHostExecutable()
  if (!hostPath) {
    return false
  }

  const manifestDirectory = join(app.getPath('userData'), 'native-messaging-hosts')
  ensureNativeHostManifestDirectory(manifestDirectory)

  const chromiumManifestPath = join(manifestDirectory, 'chromium.app.klarkey.desktop.json')
  writeNativeHostManifestFile(chromiumManifestPath, {
    name: KLARKEY_NATIVE_HOST_NAME,
    description: 'Klarkey desktop bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [KLARKEY_CHROMIUM_EXTENSION_ORIGIN],
  })

  for (const registryRoot of chromiumRegistryRoots) {
    setRegistryValue(`${registryRoot}\\${KLARKEY_NATIVE_HOST_NAME}`, chromiumManifestPath)
  }

  const firefoxManifestPath = join(manifestDirectory, 'firefox.app.klarkey.desktop.json')
  writeNativeHostManifestFile(firefoxManifestPath, {
    name: KLARKEY_NATIVE_HOST_NAME,
    description: 'Klarkey desktop bridge',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: [KLARKEY_FIREFOX_EXTENSION_ID],
  })

  setRegistryValue(`${firefoxRegistryRoot}\\${KLARKEY_NATIVE_HOST_NAME}`, firefoxManifestPath)

  return true
}
