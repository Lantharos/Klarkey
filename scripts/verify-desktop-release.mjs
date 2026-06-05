const requiredWindowsSigningEnv = [
  'WINDOWS_CODESIGN_CERTIFICATE',
  'WINDOWS_CODESIGN_PASSWORD',
]

if (process.platform !== 'win32') {
  process.exit(0)
}

const missing = requiredWindowsSigningEnv.filter((name) => !process.env[name])
if (missing.length > 0) {
  console.warn(`Windows signing is not configured: ${missing.join(', ')}`)
}
