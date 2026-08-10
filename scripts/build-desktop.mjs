import { execFileSync } from 'node:child_process'

const target = process.platform === 'win32'
  ? 'windows'
  : process.platform === 'darwin'
    ? 'macos'
    : 'portable'

execFileSync('sabine', ['bundle', '.', '--target', target, '--out', 'release', '--release'], {
  stdio: 'inherit',
})
