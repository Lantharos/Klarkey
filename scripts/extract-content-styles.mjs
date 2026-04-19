import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentPath = join(root, 'extension/shared/content.js')
const s = fs.readFileSync(contentPath, 'utf8')
const m = s.match(/overlayStyle\.textContent = `([\s\S]*?)`\r?\n\r?\noverlayRoot/)
if (!m) {
  throw new Error('Could not extract inline styles from content.js')
}
const outPath = join(root, 'extension/shared/content/inline-styles.js')
fs.writeFileSync(outPath, `export default ${JSON.stringify(m[1])}\n`)
