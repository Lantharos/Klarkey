import { spawn } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'

const isDevMode = process.argv.includes('--dev') || Boolean(process.env.VITE_DEV_SERVER_URL)

type WindowsHelloHelperResponse = {
  status?: string
  message?: string
}

type WindowsHelloAvailability = {
  available: boolean
  message?: string
}

type WindowsHelloVerification = {
  verified: boolean
  canceled: boolean
  message?: string
}

const HELPER_PROJECT_NAME = 'Klarkey.WindowsHelloVerifier.exe'
const HELPER_TARGET_FRAMEWORK = 'net9.0-windows10.0.26100.0'
const AVAILABILITY_CACHE_MS = 60_000

let availabilityCache:
  | {
      expiresAt: number
      result: WindowsHelloAvailability
    }
  | undefined

const toPlatform = () => {
  if (process.arch === 'arm64') {
    return { platform: 'ARM64', rid: 'win-arm64' }
  }

  if (process.arch === 'ia32') {
    return { platform: 'x86', rid: 'win-x86' }
  }

  return { platform: 'x64', rid: 'win-x64' }
}

const listHelperCandidates = () => {
  const { platform, rid } = toPlatform()
  const envPath = process.env.KLARKEY_WINDOWS_HELLO_HELPER
  const roots = new Set([
    app.getAppPath(),
    process.cwd(),
    resolve(app.getAppPath(), '..'),
    resolve(process.cwd(), '..'),
  ])

  const candidates: (string | undefined)[] = [join(process.resourcesPath, HELPER_PROJECT_NAME)]

  for (const root of roots) {
    const helperRoot = join(root, 'native', 'windows-passkey-provider', 'Klarkey.WindowsHelloVerifier', 'bin')
    candidates.push(
      join(helperRoot, 'Debug', HELPER_TARGET_FRAMEWORK, HELPER_PROJECT_NAME),
      join(helperRoot, 'Release', HELPER_TARGET_FRAMEWORK, HELPER_PROJECT_NAME),
      join(helperRoot, platform, 'Debug', HELPER_TARGET_FRAMEWORK, rid, HELPER_PROJECT_NAME),
      join(helperRoot, platform, 'Release', HELPER_TARGET_FRAMEWORK, rid, HELPER_PROJECT_NAME),
    )
  }

  if (envPath && isDevMode) {
    candidates.unshift(envPath)
  }

  return candidates
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => resolve(candidate))
}

const resolveHelperPath = () => listHelperCandidates().find((candidate) => existsSync(candidate))

const runHelper = async (mode: 'check-availability' | 'verify-user', message?: string) => {
  if (process.platform !== 'win32') {
    return {
      status: 'unavailable',
      message: 'Windows Hello verification is only available on Windows.',
    } satisfies WindowsHelloHelperResponse
  }

  const helperPath = resolveHelperPath()
  if (!helperPath) {
    return {
      status: 'unavailable',
      message: 'The Klarkey Windows Hello helper is not built yet.',
    } satisfies WindowsHelloHelperResponse
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'klarkey-hello-'))
  const responseFilePath = join(tempDir, 'response.json')

  try {
    await writeFile(responseFilePath, '', { mode: 0o600 })

    await new Promise<void>((resolveProcess, rejectProcess) => {
      const args = ['--mode', mode, '--response-file', responseFilePath]
      if (message?.trim()) {
        args.push('--message', message.trim())
      }

      const child = spawn(helperPath, args, {
        stdio: 'ignore',
        windowsHide: true,
      })

      child.once('error', rejectProcess)
      child.once('exit', (code) => {
        if (code === 0) {
          resolveProcess()
          return
        }

        rejectProcess(new Error(`The Windows Hello helper exited with code ${code ?? 'unknown'}.`))
      })
    })

    const parsed = JSON.parse(await readFile(responseFilePath, 'utf8')) as Record<string, unknown>
    const status =
      (typeof parsed.status === 'string' ? parsed.status : undefined) ??
      (typeof parsed.Status === 'string' ? parsed.Status : undefined)
    const parsedMessage =
      (typeof parsed.message === 'string' ? parsed.message : undefined) ??
      (typeof parsed.Message === 'string' ? parsed.Message : undefined)

    return {
      status,
      message: parsedMessage,
    } satisfies WindowsHelloHelperResponse
  } finally {
    await rm(tempDir, { force: true, recursive: true }).catch(() => undefined)
  }
}

export const getWindowsHelloAvailability = async (): Promise<WindowsHelloAvailability> => {
  if (availabilityCache && availabilityCache.expiresAt > Date.now()) {
    return availabilityCache.result
  }

  const response = await runHelper('check-availability')
  const result =
    response.status === 'available'
      ? { available: true }
      : {
          available: false,
          message: response.message || 'Windows Hello verification is unavailable.',
        }

  availabilityCache = {
    expiresAt: Date.now() + AVAILABILITY_CACHE_MS,
    result,
  }

  return result
}

export const verifyWithWindowsHello = async (message: string): Promise<WindowsHelloVerification> => {
  const response = await runHelper('verify-user', message)
  if (response.status === 'verified') {
    return {
      verified: true,
      canceled: false,
    }
  }

  if (response.status === 'canceled') {
    return {
      verified: false,
      canceled: true,
      message: response.message || 'Windows Hello verification was canceled.',
    }
  }

  return {
    verified: false,
    canceled: false,
    message: response.message || 'Windows Hello verification failed.',
  }
}
