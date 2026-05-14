import { execFileSync } from 'node:child_process'

execFileSync('bun', ['run', 'verify:desktop-release'], { stdio: 'inherit' })

const buildArgs = ['run', 'tauri', 'build']

if (process.platform === 'linux') {
  buildArgs.push('--bundles', 'deb,rpm')
}

execFileSync('bun', buildArgs, { stdio: 'inherit' })
