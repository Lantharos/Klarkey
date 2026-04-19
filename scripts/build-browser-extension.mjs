import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const extensionRoot = join(root, 'extension')
const distRoot = join(root, 'dist-extension')
const sharedRoot = join(extensionRoot, 'shared')

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

rmSync(distRoot, { recursive: true, force: true })

for (const browser of browsers) {
  const targetRoot = join(distRoot, browser)
  mkdirSync(join(targetRoot, 'icons'), { recursive: true })
  cpSync(sharedRoot, targetRoot, { recursive: true })
  cpSync(join(extensionRoot, browser, 'manifest.json'), join(targetRoot, 'manifest.json'))
  cpSync(iconPath, join(targetRoot, 'icons', 'klarkey-128.png'))
}

const nativeHostRoot = join(distRoot, 'native-host')
mkdirSync(nativeHostRoot, { recursive: true })

execFileSync(
  'dotnet',
  [
    'publish',
    join(root, 'scripts', 'Klarkey.NativeHostLauncher', 'Klarkey.NativeHostLauncher.csproj'),
    '-c',
    'Release',
    '-o',
    nativeHostRoot,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
)

writeFileSync(
  join(nativeHostRoot, 'klarkey-native-host.cmd'),
  `@echo off
setlocal
"%~dp0\\Klarkey.NativeHostLauncher.exe"
`,
)

writeFileSync(
  join(nativeHostRoot, 'klarkey-native-host.sh'),
  `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/node_modules/.bin/electron" "$ROOT" --native-messaging-host
`,
)
chmodSync(join(nativeHostRoot, 'klarkey-native-host.sh'), 0o755)

if (!existsSync(join(root, '.gitignore'))) {
  throw new Error('Expected .gitignore to exist.')
}
