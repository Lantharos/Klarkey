import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'extension/shared/content/inline-styles.js')
const raw = fs.readFileSync(path, 'utf8')
const m = raw.match(/^export default\s+([\s\S]+)\s*$/)
if (!m) {
  throw new Error('Could not parse inline-styles.js')
}
const css = JSON.parse(m[1].trim())
const escaped = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
fs.writeFileSync(path, `export default \`\n${escaped}\`\n`)
