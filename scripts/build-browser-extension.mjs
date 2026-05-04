import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const extensionRoot = join(root, 'extension')
const distRoot = join(root, 'dist-extension')
const sharedRoot = join(extensionRoot, 'shared')

function safeRemove(path) {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      console.warn(`[build:extension] Skipping delete for locked path: ${path}`)
      return
    }
    throw error
  }
}

function bundleExtensionSources() {
  execFileSync(
    'bun',
    ['build', join(sharedRoot, 'background', 'index.js'), '--outfile', join(sharedRoot, 'background.js'), '--target', 'browser'],
    { cwd: root, stdio: 'inherit' },
  )
  execFileSync(
    'bun',
    ['build', join(sharedRoot, 'content', 'index.js'), '--outfile', join(sharedRoot, 'content.js'), '--target', 'browser'],
    { cwd: root, stdio: 'inherit' },
  )
}

bundleExtensionSources()
const iconPath = join(root, 'public', 'klarkey.png')
const browsers = ['chromium', 'firefox']
const sharedRuntimeFiles = [
  'background.js',
  'content.js',
  'page-bridge.js',
  'popup.css',
  'popup.html',
  'popup.js',
]

mkdirSync(distRoot, { recursive: true })

for (const browser of browsers) {
  const targetRoot = join(distRoot, browser)
  safeRemove(targetRoot)
  mkdirSync(join(targetRoot, 'icons'), { recursive: true })
  for (const file of sharedRuntimeFiles) {
    cpSync(join(sharedRoot, file), join(targetRoot, file), { force: true })
  }
  cpSync(join(extensionRoot, browser, 'manifest.json'), join(targetRoot, 'manifest.json'), { force: true })
  cpSync(iconPath, join(targetRoot, 'icons', 'klarkey-128.png'), { force: true })
}

const nativeHostRoot = join(distRoot, 'native-host')
const nativeHostStagingRoot = join(distRoot, 'native-host-build')
safeRemove(nativeHostStagingRoot)
mkdirSync(nativeHostStagingRoot, { recursive: true })

execFileSync(
  'dotnet',
  [
    'publish',
    join(root, 'scripts', 'Klarkey.NativeHostLauncher', 'Klarkey.NativeHostLauncher.csproj'),
    '-c',
    'Release',
    '-o',
    nativeHostStagingRoot,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
)

writeFileSync(
  join(nativeHostStagingRoot, 'klarkey-native-host.cmd'),
  `@echo off
setlocal
"%~dp0\\Klarkey.NativeHostLauncher.exe" %*
`,
)

writeFileSync(
  join(nativeHostStagingRoot, 'klarkey-native-host.sh'),
  `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/node_modules/.bin/electron" "$ROOT" --native-messaging-host "$@"
`,
)
chmodSync(join(nativeHostStagingRoot, 'klarkey-native-host.sh'), 0o755)

safeRemove(nativeHostRoot)
try {
  cpSync(nativeHostStagingRoot, nativeHostRoot, { recursive: true, force: true })
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && (error.code === 'EPERM' || error.code === 'EPIPE')) {
    console.warn(`[build:extension] Skipping native-host overwrite for locked path: ${nativeHostRoot}`)
  } else {
    throw error
  }
}

safeRemove(nativeHostStagingRoot)

if (!existsSync(join(root, '.gitignore'))) {
  throw new Error('Expected .gitignore to exist.')
}
