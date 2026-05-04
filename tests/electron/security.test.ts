import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isExternalBrowserUrl,
  isPathWithinBase,
  rendererContentSecurityPolicy,
  rendererSecurityHeaderEntries,
  resolveRendererAssetPath,
  safeDiagnosticMessage,
  safeErrorMessage,
  safeRendererLoadFailureDetails,
  safeRendererProcessGoneDetails,
  isTrustedPermissionRequest,
  isTrustedRendererUrl,
  shouldAllowDisplayMediaRequest,
} from '@/electron/security'

const prod = { isDevMode: false }
const dev = { isDevMode: true, devServerUrl: 'http://127.0.0.1:5173' }

describe('Electron renderer security policy', () => {
  it('trusts only the app protocol in production', () => {
    expect(isTrustedRendererUrl('klarkey://app', prod)).toBe(true)
    expect(isTrustedRendererUrl('klarkey://app/settings', prod)).toBe(true)
    expect(isTrustedRendererUrl('klarkey://oauth/callback?code=abc', prod)).toBe(false)
    expect(isTrustedRendererUrl('https://klarkey.app', prod)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173', prod)).toBe(false)
  })

  it('trusts only the configured dev origin in dev mode', () => {
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/src/main.tsx', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/src/main.tsx', dev)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/src/main.tsx', dev)).toBe(false)
    expect(isTrustedRendererUrl('https://example.test', dev)).toBe(false)
  })

  it('rejects subframe permission requests and untrusted origins', () => {
    expect(isTrustedPermissionRequest('klarkey://app', { isMainFrame: true }, prod)).toBe(true)
    expect(isTrustedPermissionRequest('klarkey://app', { isMainFrame: false }, prod)).toBe(false)
    expect(isTrustedPermissionRequest('https://example.test', { isMainFrame: true }, prod)).toBe(false)
  })

  it('requires a trusted user-initiated video-only screen capture request', () => {
    expect(shouldAllowDisplayMediaRequest({
      securityOrigin: 'klarkey://app',
      videoRequested: true,
      audioRequested: false,
      userGesture: true,
    }, prod)).toBe(true)
    expect(shouldAllowDisplayMediaRequest({
      securityOrigin: 'klarkey://app',
      videoRequested: true,
      audioRequested: true,
      userGesture: true,
    }, prod)).toBe(false)
    expect(shouldAllowDisplayMediaRequest({
      securityOrigin: 'klarkey://app',
      videoRequested: true,
      audioRequested: false,
      userGesture: false,
    }, prod)).toBe(false)
    expect(shouldAllowDisplayMediaRequest({
      securityOrigin: 'https://example.test',
      videoRequested: true,
      audioRequested: false,
      userGesture: true,
    }, prod)).toBe(false)
  })

  it('allows only browser-safe external URLs', () => {
    expect(isExternalBrowserUrl('https://klarkey.com/docs')).toBe(true)
    expect(isExternalBrowserUrl('https://www.klarkey.com/docs')).toBe(true)
    expect(isExternalBrowserUrl('https://aveid.net/oauth/authorize')).toBe(true)
    expect(isExternalBrowserUrl('http://127.0.0.1:5173', dev)).toBe(true)
    expect(isExternalBrowserUrl('http://localhost:5173', dev)).toBe(true)
    expect(isExternalBrowserUrl('http://127.0.0.1:5173', prod)).toBe(false)
    expect(isExternalBrowserUrl('http://localhost:5173', prod)).toBe(false)
    expect(isExternalBrowserUrl('https://klarkey.app/docs')).toBe(false)
    expect(isExternalBrowserUrl('https://example.com')).toBe(false)
    expect(isExternalBrowserUrl('https://klarkey.com:444/docs')).toBe(false)
    expect(isExternalBrowserUrl('https://person@klarkey.com/docs')).toBe(false)
    expect(isExternalBrowserUrl('mailto:security@klarkey.com')).toBe(false)
    expect(isExternalBrowserUrl('http://example.com')).toBe(false)
    expect(isExternalBrowserUrl('file:///C:/Users/krist/secret.txt')).toBe(false)
    expect(isExternalBrowserUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalBrowserUrl('klarkey://app')).toBe(false)
  })

  it('validates OAuth URLs before opening the external browser', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/sync/manager.ts'), 'utf8')

    expect(source).toContain('if (!isExternalBrowserUrl(url))')
    expect(source).toContain("throw new Error('Sync sign-in provider URL is not trusted.')")
    expect(source).toContain('await shell.openExternal(url)')
  })

  it('does not accept sibling paths with the same prefix as app assets', () => {
    const basePath = resolve('C:/app/dist')
    expect(isPathWithinBase(basePath, resolve('C:/app/dist/index.html'))).toBe(true)
    expect(isPathWithinBase(basePath, resolve('C:/app/dist'))).toBe(true)
    expect(isPathWithinBase(basePath, resolve('C:/app/dist-evil/index.html'))).toBe(false)
  })

  it('resolves app protocol assets without path traversal or malformed decoding', () => {
    const basePath = resolve('C:/app/dist')
    const indexPath = resolve(basePath, 'index.html')

    expect(resolveRendererAssetPath(basePath, '/')).toBe(indexPath)
    expect(resolveRendererAssetPath(basePath, '/assets/index.js')).toBe(resolve(basePath, 'assets/index.js'))
    expect(resolveRendererAssetPath(basePath, '/settings')).toBe(indexPath)
    expect(resolveRendererAssetPath(basePath, '/%2e%2e/secret.js')).toBe(indexPath)
    expect(resolveRendererAssetPath(basePath, '/%E0%A4%A')).toBe(indexPath)
    expect(resolveRendererAssetPath(basePath, '/assets/%00.js')).toBe(indexPath)
  })

  it('rejects non-GET app protocol requests before serving renderer assets', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/main.ts'), 'utf8')

    expect(source).toContain("if (request.method !== 'GET')")
    expect(source).toContain("new Response('Method not allowed', { status: 405 })")
  })

  it('pins renderer security headers for the app protocol', () => {
    expect(rendererSecurityHeaderEntries).toContainEqual(['Content-Security-Policy', rendererContentSecurityPolicy])
    expect(rendererSecurityHeaderEntries).toContainEqual(['X-Content-Type-Options', 'nosniff'])
    expect(rendererSecurityHeaderEntries).toContainEqual(['Referrer-Policy', 'no-referrer'])
    expect(rendererContentSecurityPolicy).toContain("default-src 'self'")
    expect(rendererContentSecurityPolicy).toContain("script-src 'self'")
    expect(rendererContentSecurityPolicy).toContain("object-src 'none'")
    expect(rendererContentSecurityPolicy).toContain("frame-ancestors 'none'")
    expect(rendererContentSecurityPolicy).not.toContain("'unsafe-eval'")
  })

  it('keeps renderer styling self-contained without remote font imports', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

    expect(css).not.toContain('fonts.googleapis.com')
    expect(css).not.toContain('fonts.gstatic.com')
    expect(css).not.toMatch(/@import\s+url\(['"]?https?:\/\//)
    expect(rendererContentSecurityPolicy).toContain("font-src 'self' data:")
    expect(rendererContentSecurityPolicy).not.toContain('fonts.googleapis.com')
    expect(rendererContentSecurityPolicy).not.toContain('fonts.gstatic.com')
  })

  it('redacts sensitive error messages before logging', () => {
    expect(safeDiagnosticMessage('Network unavailable', 'Fallback')).toBe('Network unavailable')
    expect(safeDiagnosticMessage('token=abc123', 'Fallback')).toBe('Fallback')
    expect(safeDiagnosticMessage('failed at https://id.example.test/callback?code=abc', 'Fallback')).toBe('Fallback')
    expect(safeErrorMessage(new Error('Network unavailable'), 'Fallback')).toBe('Network unavailable')
    expect(safeErrorMessage(new Error('access_token=abc123'), 'Fallback')).toBe('Fallback')
    expect(safeErrorMessage(new Error('credentialId=abc123'), 'Fallback')).toBe('Fallback')
    expect(safeErrorMessage(new Error('privateKey=abc123'), 'Fallback')).toBe('Fallback')
    expect(safeErrorMessage(new Error('failed for https://id.example.test/callback?code=abc'), 'Fallback')).toBe('Fallback')
    expect(safeErrorMessage(new Error('failed at C:\\Users\\person\\vault.db'), 'Fallback')).toBe('Fallback')
  })

  it('redacts renderer load and crash diagnostics before logging', () => {
    expect(safeRendererLoadFailureDetails(-3, 'ERR_ABORTED')).toEqual({
      code: -3,
      description: 'ERR_ABORTED',
    })
    expect(safeRendererLoadFailureDetails(-7, 'failed for https://example.test/reset?token=abc')).toEqual({
      code: -7,
      description: 'Renderer load failed.',
    })
    expect(safeRendererProcessGoneDetails({ reason: 'crashed', exitCode: 9 })).toEqual({
      reason: 'crashed',
      exitCode: 9,
    })
    expect(safeRendererProcessGoneDetails({ reason: 'password=secret', exitCode: Number.NaN })).toEqual({
      reason: 'unknown',
      exitCode: 0,
    })
  })

  it('does not log raw renderer failure details from Electron main', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/main.ts'), 'utf8')

    expect(source).toContain('safeRendererLoadFailureDetails(code, description)')
    expect(source).toContain('safeRendererProcessGoneDetails(details)')
    expect(source).not.toContain("console.error('Klarkey renderer failed to load', code, description)")
    expect(source).not.toContain("console.error('Klarkey renderer crashed', details)")
  })

  it('writes desktop key and sync session files with private file modes', () => {
    const keySource = readFileSync(resolve(process.cwd(), 'src/electron/crypto.ts'), 'utf8')
    const sessionSource = readFileSync(resolve(process.cwd(), 'src/electron/sync/session.ts'), 'utf8')
    const exportSource = readFileSync(resolve(process.cwd(), 'src/electron/export/write-export-file.ts'), 'utf8')
    const databaseSource = readFileSync(resolve(process.cwd(), 'src/electron/database.ts'), 'utf8')

    expect(keySource).toContain('constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600')
    expect(keySource).toContain('fchmodSync(fd, 0o600)')
    expect(keySource).toContain('lstatSync(filePath).isSymbolicLink()')
    expect(keySource).toContain('constants.O_RDONLY | noFollow')
    expect(keySource).toContain('fstatSync(fd)')
    expect(keySource).toContain('readFileSync(fd, \'utf8\')')
    expect(keySource).toContain('renameSync(tempPath, filePath)')
    expect(keySource).toContain('chmodSync(filePath, 0o600)')
    expect(sessionSource).toContain('const PRIVATE_FILE_MODE = 0o600')
    expect(sessionSource).toContain('constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | noFollow, PRIVATE_FILE_MODE')
    expect(sessionSource).toContain('fchmodSync(fd, PRIVATE_FILE_MODE)')
    expect(sessionSource).toContain('chmodSync(path, PRIVATE_FILE_MODE)')
    expect(sessionSource).toContain('lstatSync(path).isSymbolicLink()')
    expect(sessionSource).toContain('readFileSync(fd, \'utf8\')')
    expect(exportSource).toContain('const privateFileMode = 0o600')
    expect(exportSource).toContain('constants.O_NOFOLLOW')
    expect(exportSource).toContain('fchmodSync(fd, privateFileMode)')
    expect(exportSource).toContain('chmodSync(filePath, privateFileMode)')
    expect(databaseSource).toContain('mkdirSync(directoryPath, { recursive: true, mode: 0o700 })')
    expect(databaseSource).toContain('ensureDatabaseDirectory(dirname(dbPath))')
    expect(databaseSource).toContain('lstatSync(directoryPath)')
    expect(databaseSource).toContain('stats.isSymbolicLink() || !stats.isDirectory()')
    expect(databaseSource).toContain('validateDatabasePath(dbPath)')
    expect(databaseSource).toContain('stats.isSymbolicLink() || !stats.isFile()')
    expect(databaseSource).toContain('chmodSync(path, 0o600)')
    expect(databaseSource).toContain("`${dbPath}-wal`")
    expect(databaseSource).toContain("`${dbPath}-shm`")
  })

  it('configures SQLite to reduce local secret persistence', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/database.ts'), 'utf8')

    expect(source).toContain("db.pragma('secure_delete = ON')")
    expect(source).toContain("db.pragma('temp_store = MEMORY')")
    expect(source).toContain("db.pragma('trusted_schema = OFF')")
  })

  it('uses packaged-aware runtime mode before accepting a Windows Hello helper override', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/windows-hello-verifier.ts'), 'utf8')

    expect(source).toContain('resolveRuntimeMode')
    expect(source).toContain('isPackaged: app?.isPackaged ?? true')
    expect(source).not.toContain("process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL)")
  })

  it('redacts Windows Hello helper failures before returning them to the app', () => {
    const electronSource = readFileSync(resolve(process.cwd(), 'src/electron/windows-hello-verifier.ts'), 'utf8')
    const winFormsHelper = readFileSync(resolve(process.cwd(), 'native/windows-passkey-provider/Klarkey.WindowsHelloVerifier/Program.cs'), 'utf8')
    const winUiHelper = readFileSync(resolve(process.cwd(), 'native/windows-passkey-provider/KlarkeyPasskeyProvider/App.xaml.cs'), 'utf8')

    expect(electronSource).toContain('helperSensitiveMessagePattern')
    expect(electronSource).toContain('safeHelperMessage(response.message')
    expect(winFormsHelper).toContain('GenericFailureMessage')
    expect(winUiHelper).toContain('GenericVerificationFailureMessage')
    expect(winFormsHelper).not.toContain('exception.Message')
    expect(winUiHelper).not.toContain('exception.Message')
  })

  it('redacts Windows passkey provider bridge diagnostics before showing them', () => {
    const bridgeProbe = readFileSync(
      resolve(process.cwd(), 'native/windows-passkey-provider/KlarkeyPasskeyProvider/Services/KlarkeyBridgeProbeService.cs'),
      'utf8',
    )

    expect(bridgeProbe).toContain('SensitiveBridgeDiagnosticPattern')
    expect(bridgeProbe).toContain('PathBridgeDiagnosticPattern')
    expect(bridgeProbe).toContain('SafeBridgeDiagnosticMessage(response.Error?.Message)')
    expect(bridgeProbe).toContain('SafeBridgeDiagnosticMessage(error)')
    expect(bridgeProbe).not.toContain('CreateError("BridgePingException", exception.Message)')
    expect(bridgeProbe).not.toContain('response.Error?.Message ?? AppResources.GetString("BridgeUnknownError")')
  })

  it('allows Windows Hello helpers to write only to the pre-created Klarkey temp response file', () => {
    const winFormsHelper = readFileSync(resolve(process.cwd(), 'native/windows-passkey-provider/Klarkey.WindowsHelloVerifier/Program.cs'), 'utf8')
    const winUiOptions = readFileSync(resolve(process.cwd(), 'native/windows-passkey-provider/KlarkeyPasskeyProvider/Services/VerificationLaunchOptions.cs'), 'utf8')
    const winUiApp = readFileSync(resolve(process.cwd(), 'native/windows-passkey-provider/KlarkeyPasskeyProvider/App.xaml.cs'), 'utf8')

    for (const source of [winFormsHelper, winUiOptions]) {
      expect(source).toContain('ValidateResponseFilePath')
      expect(source).toContain('Path.GetTempPath()')
      expect(source).toContain('"klarkey-hello-"')
      expect(source).toContain('"response.json"')
      expect(source).toContain('File.Exists(fullPath)')
      expect(source).toContain('FileAttributes.ReparsePoint')
    }
    expect(winFormsHelper).toContain('TryReadValidatedResponseFilePath')
    expect(winFormsHelper).not.toContain('TryReadResponseFilePath')
    expect(winUiApp).toContain('launchOptions.Mode == VerificationLaunchMode.Invalid')
  })
})
