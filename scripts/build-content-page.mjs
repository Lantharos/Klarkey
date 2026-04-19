import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentPath = join(root, 'extension/shared/content.js')
const s = fs.readFileSync(contentPath, 'utf8')
const parts = s.split(/overlayStyle\.textContent = `[\s\S]*?`\r?\n\r?\n/)
if (parts.length !== 2) {
  throw new Error('Could not split content.js for page.js')
}
const page =
  "import inlineStyles from './inline-styles.js'\n" +
  parts[0] +
  'overlayStyle.textContent = inlineStyles\n\n' +
  parts[1]

fs.writeFileSync(join(root, 'extension/shared/content/page.js'), page)
