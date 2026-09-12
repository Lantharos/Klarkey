import { execFileSync } from 'node:child_process'

const target = process.platform === 'win32'
  ? 'exe'
  : process.platform === 'darwin'
    ? 'dmg'
    : 'portable'

execFileSync('sabine', ['bundle', '.', '--target', target, '--out', 'release', '--release'], {
  stdio: 'inherit',
})
