import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const extensionRoot = join(root, 'extension')
const distRoot = join(root, 'dist-extension')
const sharedRoot = join(extensionRoot, 'shared')
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

writeFileSync(
  join(nativeHostRoot, 'klarkey-native-host.cmd'),
  `@echo off
setlocal
set "ROOT=%~dp0..\\.."
call "%ROOT%\\node_modules\\.bin\\electron.cmd" "%ROOT%" --native-messaging-host
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
