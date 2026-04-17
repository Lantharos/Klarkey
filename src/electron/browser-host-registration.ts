import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  KLARKEY_CHROMIUM_EXTENSION_ID,
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

const writeManifestFile = (filePath: string, manifest: Record<string, unknown>) => {
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
  mkdirSync(manifestDirectory, { recursive: true })

  const chromiumManifestPath = join(manifestDirectory, 'chromium.app.klarkey.desktop.json')
  writeManifestFile(chromiumManifestPath, {
    name: KLARKEY_NATIVE_HOST_NAME,
    description: 'Klarkey desktop bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${KLARKEY_CHROMIUM_EXTENSION_ID}/`],
  })

  for (const registryRoot of chromiumRegistryRoots) {
    setRegistryValue(`${registryRoot}\\${KLARKEY_NATIVE_HOST_NAME}`, chromiumManifestPath)
  }

  const firefoxManifestPath = join(manifestDirectory, 'firefox.app.klarkey.desktop.json')
  writeManifestFile(firefoxManifestPath, {
    name: KLARKEY_NATIVE_HOST_NAME,
    description: 'Klarkey desktop bridge',
    path: hostPath,
    type: 'stdio',
    allowed_extensions: [KLARKEY_FIREFOX_EXTENSION_ID],
  })

  setRegistryValue(`${firefoxRegistryRoot}\\${KLARKEY_NATIVE_HOST_NAME}`, firefoxManifestPath)

  return true
}
