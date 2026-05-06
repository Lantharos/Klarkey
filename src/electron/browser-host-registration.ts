import { execFileSync } from 'node:child_process'
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  KLARKEY_CHROMIUM_EXTENSION_IDS,
  KLARKEY_CHROMIUM_EXTENSION_ORIGINS,
  KLARKEY_FIREFOX_EXTENSION_ID,
  KLARKEY_NATIVE_HOST_NAME,
} from '@/shared/browser-extension'

const chromeWebStoreUpdateUrl = 'https://clients2.google.com/service/update2/crx'

const chromiumRegistryRoots = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  'HKCU\\Software\\Chromium\\NativeMessagingHosts',
  'HKCU\\Software\\imput\\Helium\\NativeMessagingHosts',
  'HKCU\\Software\\Helium\\NativeMessagingHosts',
]

const chromiumWebStoreExtensionRegistryRoots = [
  'HKCU\\Software\\Google\\Chrome\\Extensions',
  'HKLM\\Software\\Google\\Chrome\\Extensions',
  'HKLM\\Software\\Wow6432Node\\Google\\Chrome\\Extensions',
  'HKCU\\Software\\BraveSoftware\\Brave-Browser\\Extensions',
  'HKCU\\Software\\Chromium\\Extensions',
  'HKCU\\Software\\imput\\Helium\\Extensions',
  'HKCU\\Software\\Helium\\Extensions',
]

const firefoxRegistryRoots = [
  'HKCU\\Software\\Mozilla\\NativeMessagingHosts',
  'HKCU\\Software\\Zen Browser\\NativeMessagingHosts',
  'HKCU\\Software\\Zen\\NativeMessagingHosts',
]

const linuxConfigHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
const linuxFirefoxHome = () => join(homedir(), '.mozilla')

const linuxChromiumManifestDirectories = () => [
  join(linuxConfigHome(), 'google-chrome', 'NativeMessagingHosts'),
  join(linuxConfigHome(), 'chromium', 'NativeMessagingHosts'),
  join(linuxConfigHome(), 'microsoft-edge', 'NativeMessagingHosts'),
  join(linuxConfigHome(), 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
  join(linuxConfigHome(), 'vivaldi', 'NativeMessagingHosts'),
]

const linuxFirefoxManifestDirectories = () => [
  join(linuxFirefoxHome(), 'native-messaging-hosts'),
]

const macApplicationSupport = () => join(homedir(), 'Library', 'Application Support')

const macChromiumManifestDirectories = () => [
  join(macApplicationSupport(), 'Google', 'Chrome', 'NativeMessagingHosts'),
  join(macApplicationSupport(), 'Chromium', 'NativeMessagingHosts'),
  join(macApplicationSupport(), 'Microsoft Edge', 'NativeMessagingHosts'),
  join(macApplicationSupport(), 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
  join(macApplicationSupport(), 'Vivaldi', 'NativeMessagingHosts'),
]

const macFirefoxManifestDirectories = () => [
  join(macApplicationSupport(), 'Mozilla', 'NativeMessagingHosts'),
]

const ignoreUnsupportedModeBits = () => undefined

const resolveNativeHostExecutable = () => {
  if (app.isPackaged && existsSync(app.getPath('exe'))) {
    return app.getPath('exe')
  }

  const appPath = app.getAppPath()
  if (process.platform !== 'win32') {
    const unixHost = join(appPath, 'dist-extension', 'native-host', 'klarkey-native-host.sh')
    return existsSync(unixHost) ? unixHost : undefined
  }

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

const setNamedRegistryValue = (registryPath: string, name: string, value: string) => {
  execFileSync(
    'reg',
    ['ADD', registryPath, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'],
    {
      windowsHide: true,
    },
  )
}

const trySetNamedRegistryValue = (registryPath: string, name: string, value: string) => {
  try {
    setNamedRegistryValue(registryPath, name, value)
  } catch {
    return false
  }

  return true
}

export const chromiumWebStoreExtensionRegistryPaths = () =>
  chromiumWebStoreExtensionRegistryRoots.flatMap((registryRoot) =>
    KLARKEY_CHROMIUM_EXTENSION_IDS.map((extensionId) => `${registryRoot}\\${extensionId}`),
  )

const writeChromiumNativeHostManifest = (directoryPath: string, hostPath: string, fileName = `${KLARKEY_NATIVE_HOST_NAME}.json`) => {
  ensureNativeHostManifestDirectory(directoryPath)
  writeNativeHostManifestFile(join(directoryPath, fileName), {
    name: KLARKEY_NATIVE_HOST_NAME,
    description: 'Klarkey desktop bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: KLARKEY_CHROMIUM_EXTENSION_ORIGINS,
  })
}

const writeFirefoxNativeHostManifest = (directoryPath: string, hostPath: string, fileName = `${KLARKEY_NATIVE_HOST_NAME}.json`) => {
  ensureNativeHostManifestDirectory(directoryPath)
  writeNativeHostManifestFile(join(directoryPath, fileName), {
    name: KLARKEY_NATIVE_HOST_NAME,
    description: 'Klarkey desktop bridge',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: [KLARKEY_FIREFOX_EXTENSION_ID],
  })
}

const ensureUnixNativeMessagingHostRegistration = (hostPath: string) => {
  const chromiumDirectories = process.platform === 'darwin'
    ? macChromiumManifestDirectories()
    : linuxChromiumManifestDirectories()
  const firefoxDirectories = process.platform === 'darwin'
    ? macFirefoxManifestDirectories()
    : linuxFirefoxManifestDirectories()

  for (const directoryPath of chromiumDirectories) {
    writeChromiumNativeHostManifest(directoryPath, hostPath)
  }

  for (const directoryPath of firefoxDirectories) {
    writeFirefoxNativeHostManifest(directoryPath, hostPath)
  }

  return true
}

export const ensureNativeMessagingHostRegistration = () => {
  const hostPath = resolveNativeHostExecutable()
  if (!hostPath) {
    return false
  }

  if (process.platform !== 'win32') {
    return ensureUnixNativeMessagingHostRegistration(hostPath)
  }

  const manifestDirectory = join(app.getPath('userData'), 'native-messaging-hosts')

  const chromiumManifestPath = join(manifestDirectory, 'chromium.app.klarkey.desktop.json')
  writeChromiumNativeHostManifest(manifestDirectory, hostPath, 'chromium.app.klarkey.desktop.json')

  for (const registryRoot of chromiumRegistryRoots) {
    setRegistryValue(`${registryRoot}\\${KLARKEY_NATIVE_HOST_NAME}`, chromiumManifestPath)
  }

  for (const registryPath of chromiumWebStoreExtensionRegistryPaths()) {
    trySetNamedRegistryValue(registryPath, 'update_url', chromeWebStoreUpdateUrl)
  }

  const firefoxManifestPath = join(manifestDirectory, 'firefox.app.klarkey.desktop.json')
  writeFirefoxNativeHostManifest(manifestDirectory, hostPath, 'firefox.app.klarkey.desktop.json')

  for (const registryRoot of firefoxRegistryRoots) {
    setRegistryValue(`${registryRoot}\\${KLARKEY_NATIVE_HOST_NAME}`, firefoxManifestPath)
  }

  return true
}
