import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
    getPath: vi.fn(),
  },
}))

vi.mock('electron', () => electronMock)

import {
  ensureNativeHostManifestDirectory,
  writeNativeHostManifestFile,
} from '@/electron/browser-host-registration'

const tempRoots: string[] = []

const createTempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'klarkey-native-host-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true })
  }
})

describe('native host registration hardening', () => {
  it('creates private manifest directories and writes private manifest files', () => {
    const root = createTempRoot()
    const directoryPath = join(root, 'native-messaging-hosts')
    const manifestPath = join(directoryPath, 'chromium.app.klarkey.desktop.json')

    ensureNativeHostManifestDirectory(directoryPath)
    writeNativeHostManifestFile(manifestPath, {
      name: 'app.klarkey.desktop',
      type: 'stdio',
    })

    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual({
      name: 'app.klarkey.desktop',
      type: 'stdio',
    })

    if (process.platform !== 'win32') {
      expect(statSync(directoryPath).mode & 0o077).toBe(0)
      expect(statSync(manifestPath).mode & 0o077).toBe(0)
    }
  })

  it('refuses abnormal manifest directory and file targets', () => {
    const root = createTempRoot()
    const blockedDirectoryPath = join(root, 'native-messaging-hosts')
    const directoryPath = join(root, 'safe-native-hosts')
    const blockedManifestPath = join(directoryPath, 'chromium.app.klarkey.desktop.json')

    writeFileSync(blockedDirectoryPath, 'not a directory', 'utf8')
    expect(() => ensureNativeHostManifestDirectory(blockedDirectoryPath)).toThrow('normal directory')

    ensureNativeHostManifestDirectory(directoryPath)
    mkdirSync(blockedManifestPath)
    expect(() => writeNativeHostManifestFile(blockedManifestPath, {})).toThrow('normal file')
  })

  it('checks linked manifest paths before writing host registration files', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/browser-host-registration.ts'), 'utf8')

    expect(source).toContain('lstatSync(directoryPath)')
    expect(source).toContain('stats.isSymbolicLink() || !stats.isDirectory()')
    expect(source).toContain('lstatSync(filePath)')
    expect(source).toContain('stats.isSymbolicLink() || !stats.isFile()')
    expect(source).toContain('constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY, 0o600')
    expect(source).toContain('chmodSync(filePath, 0o600)')
  })
})
