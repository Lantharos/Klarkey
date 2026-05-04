import { basename } from 'node:path'
import koffi from 'koffi'

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const maxProcessPathLength = 4096
const kernel32 = process.platform === 'win32' ? koffi.load('kernel32.dll') : undefined
const OpenProcess = kernel32?.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)')
const QueryFullProcessImageNameW = kernel32?.func(
  'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ char16_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
)
const CloseHandle = kernel32?.func('bool __stdcall CloseHandle(void *hObject)')

const allowedPasskeyProviderParentNames = new Set(['klarkeypasskeyprovider.exe'])
const allowedNativeMessagingBrowserParentNames = new Set([
  'chrome.exe',
  'msedge.exe',
  'brave.exe',
  'firefox.exe',
  'chromium.exe',
])
const allowedNativeMessagingDevParentNames = new Set(['klarkey.nativehostlauncher.exe'])
const allowedNativeMessagingBrowserPathSuffixes = new Map([
  ['chrome.exe', ['Google\\Chrome\\Application\\chrome.exe']],
  ['msedge.exe', ['Microsoft\\Edge\\Application\\msedge.exe']],
  ['brave.exe', ['BraveSoftware\\Brave-Browser\\Application\\brave.exe']],
  ['firefox.exe', ['Mozilla Firefox\\firefox.exe']],
  ['chromium.exe', ['Chromium\\Application\\chromium.exe']],
])

type NativeMessagingParentOptions = {
  isPackaged?: boolean
  env?: NodeJS.ProcessEnv
}

type PasskeyProviderParentOptions = NativeMessagingParentOptions
type SshAgentHostParentOptions = {
  executablePath?: string
}

const readWideString = (buffer: Buffer, charLength: number) =>
  buffer.toString('utf16le', 0, Math.max(0, charLength) * 2).replace(/\0+$/, '').trim()

const normalizeWindowsPath = (value: string) =>
  value.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

const browserInstallRoots = (env: NodeJS.ProcessEnv) => [
  env.ProgramFiles,
  env['ProgramFiles(x86)'],
  env.LOCALAPPDATA,
].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

const windowsAppsInstallRoots = (env: NodeJS.ProcessEnv) => [
  env.ProgramFiles,
  env.ProgramW6432,
].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

const isTrustedBrowserInstallPath = (processPath: string, parentName: string, env: NodeJS.ProcessEnv) => {
  const suffixes = allowedNativeMessagingBrowserPathSuffixes.get(parentName)
  if (!suffixes) {
    return false
  }

  const normalizedPath = normalizeWindowsPath(processPath)
  return browserInstallRoots(env).some((root) => {
    const normalizedRoot = normalizeWindowsPath(root)
    return suffixes.some((suffix) => normalizedPath === `${normalizedRoot}\\${normalizeWindowsPath(suffix)}`)
  })
}

const isTrustedPackagedPasskeyProviderPath = (processPath: string, env: NodeJS.ProcessEnv) => {
  const normalizedPath = normalizeWindowsPath(processPath)
  return windowsAppsInstallRoots(env).some((root) => {
    const normalizedRoot = normalizeWindowsPath(root)
    return normalizedPath.startsWith(`${normalizedRoot}\\windowsapps\\`)
  })
}

const isSameExecutablePath = (processPath: string, executablePath: string | undefined) => {
  if (!executablePath) {
    return false
  }

  return normalizeWindowsPath(processPath) === normalizeWindowsPath(executablePath)
}

export function resolveProcessPath(processId: number) {
  if (process.platform !== 'win32' || !OpenProcess || !QueryFullProcessImageNameW || !CloseHandle || processId <= 0) {
    return undefined
  }

  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId)
  if (!handle) {
    return undefined
  }

  try {
    const pathBuffer = Buffer.alloc(maxProcessPathLength * 2)
    const sizeBuffer = Buffer.alloc(4)
    sizeBuffer.writeUInt32LE(maxProcessPathLength, 0)
    const success = QueryFullProcessImageNameW(handle, 0, pathBuffer, sizeBuffer)
    return success ? readWideString(pathBuffer, sizeBuffer.readUInt32LE(0)) : undefined
  } finally {
    CloseHandle(handle)
  }
}

export function isAllowedPasskeyProviderParentPath(processPath: string | undefined, options: PasskeyProviderParentOptions = {}) {
  if (!processPath) {
    return false
  }

  if (!allowedPasskeyProviderParentNames.has(basename(processPath).toLowerCase())) {
    return false
  }

  return !options.isPackaged || isTrustedPackagedPasskeyProviderPath(processPath, options.env ?? process.env)
}

export function hasAllowedPasskeyProviderBridgeCaller(options: PasskeyProviderParentOptions = {}) {
  return isAllowedPasskeyProviderParentPath(resolveProcessPath(process.ppid), options)
}

export function isAllowedSshAgentHostParentPath(processPath: string | undefined, options: SshAgentHostParentOptions = {}) {
  if (!processPath) {
    return false
  }

  return isSameExecutablePath(processPath, options.executablePath ?? process.execPath)
}

export function hasAllowedSshAgentHostCaller(options: SshAgentHostParentOptions = {}) {
  if (process.platform !== 'win32') {
    return true
  }

  return isAllowedSshAgentHostParentPath(resolveProcessPath(process.ppid), options)
}

export function isAllowedNativeMessagingParentPath(processPath: string | undefined, options: NativeMessagingParentOptions = {}) {
  if (!processPath) {
    return false
  }

  const parentName = basename(processPath).toLowerCase()
  return (allowedNativeMessagingBrowserParentNames.has(parentName) &&
    isTrustedBrowserInstallPath(processPath, parentName, options.env ?? process.env)) ||
    (!options.isPackaged && allowedNativeMessagingDevParentNames.has(parentName))
}

export function hasAllowedNativeMessagingHostCaller(options: NativeMessagingParentOptions = {}) {
  if (process.platform !== 'win32') {
    return true
  }

  return isAllowedNativeMessagingParentPath(resolveProcessPath(process.ppid), options)
}
