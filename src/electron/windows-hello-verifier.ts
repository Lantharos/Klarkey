import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from 'electron'

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
  const root = app.getAppPath()
  const { platform, rid } = toPlatform()
  const helperRoot = join(root, 'native', 'windows-passkey-provider', 'Klarkey.WindowsHelloVerifier', 'bin')
  const explicitPath = process.env.KLARKEY_WINDOWS_HELLO_HELPER

  return [
    explicitPath,
    join(helperRoot, 'Debug', HELPER_TARGET_FRAMEWORK, HELPER_PROJECT_NAME),
    join(helperRoot, 'Release', HELPER_TARGET_FRAMEWORK, HELPER_PROJECT_NAME),
    join(helperRoot, platform, 'Debug', HELPER_TARGET_FRAMEWORK, rid, HELPER_PROJECT_NAME),
    join(helperRoot, platform, 'Release', HELPER_TARGET_FRAMEWORK, rid, HELPER_PROJECT_NAME),
    join(process.resourcesPath, HELPER_PROJECT_NAME),
  ]
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

    const response = JSON.parse(await readFile(responseFilePath, 'utf8')) as WindowsHelloHelperResponse
    return response
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
