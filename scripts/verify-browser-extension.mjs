import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distRoot = join(root, 'dist-extension')
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'page-bridge.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/klarkey-128.png',
]

function assertFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Missing extension artifact: ${path}`)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

for (const browser of ['chromium', 'firefox']) {
  const targetRoot = join(distRoot, browser)
  for (const file of requiredFiles) assertFile(join(targetRoot, file))

  const manifest = readJson(join(targetRoot, 'manifest.json'))
  const background = readFileSync(join(targetRoot, 'background.js'), 'utf8')
  if (manifest.name !== 'Klarkey') throw new Error(`${browser} manifest name is invalid.`)
  if (!manifest.permissions?.includes('privacy')) throw new Error(`${browser} manifest is missing the privacy permission.`)
  if (!background.includes('app.klarkey.desktop')) throw new Error(`${browser} background is missing the native host name.`)
  if (!background.includes('passwordSavingEnabled')) throw new Error(`${browser} background is missing browser autofill control.`)
  if (String(JSON.stringify(manifest.content_security_policy ?? '')).includes('unsafe-eval')) {
    throw new Error(`${browser} extension CSP allows unsafe-eval.`)
  }
}
