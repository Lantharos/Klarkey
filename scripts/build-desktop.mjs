import { execFileSync } from 'node:child_process'

execFileSync('bun', ['run', 'verify:desktop-release'], { stdio: 'inherit' })
execFileSync('bun', ['run', 'build'], { stdio: 'inherit' })
execFileSync('cargo', ['build', '--manifest-path', 'desktop/Cargo.toml', '--release'], { stdio: 'inherit' })
