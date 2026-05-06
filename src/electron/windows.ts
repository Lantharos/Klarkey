import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readlinkSync, unlinkSync } from 'node:fs'
import { parse } from 'node:path'
import { nativeImage } from 'electron'
import koffi from 'koffi'
import type { DesktopIntegrationSupport, ExternalWindowContext } from '@/shared/types'

const runPowerShell = (script: string) =>
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' },
  ).trim()

const runDesktopCommand = (command: string, args: string[], timeout = 1200) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout,
  }).trim()

const hasDesktopCommand = (command: string) => {
  try {
    runDesktopCommand('sh', ['-lc', `command -v ${command}`])
    return true
  } catch {
    return false
  }
}

const user32 = process.platform === 'win32' ? koffi.load('user32.dll') : undefined
const kernel32 = process.platform === 'win32' ? koffi.load('kernel32.dll') : undefined
const GetForegroundWindow = user32?.func('void * __stdcall GetForegroundWindow()')
const GetWindowTextW = user32?.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ char16_t *lpString, int nMaxCount)')
const GetWindowThreadProcessId = user32?.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)')
const OpenProcess = kernel32?.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)')
const QueryFullProcessImageNameW = kernel32?.func(
  'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ char16_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
)
const CloseHandle = kernel32?.func('bool __stdcall CloseHandle(void *hObject)')
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const maxTextLength = 1024
const maxProcessPathLength = 4096
let ydotoolDaemonStarted = false

const wait = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const readWideString = (buffer: Buffer, charLength: number) =>
  buffer.toString('utf16le', 0, Math.max(0, charLength) * 2).replace(/\0+$/, '').trim()

const readProcessPath = (processHandle: unknown) => {
  if (!QueryFullProcessImageNameW || !processHandle) {
    return undefined
  }

  const pathBuffer = Buffer.alloc(maxProcessPathLength * 2)
  const sizeBuffer = Buffer.alloc(4)
  sizeBuffer.writeUInt32LE(maxProcessPathLength, 0)

  const success = QueryFullProcessImageNameW(processHandle, 0, pathBuffer, sizeBuffer)
  if (!success) {
    return undefined
  }

  return readWideString(pathBuffer, sizeBuffer.readUInt32LE(0))
}

const getWindowTitle = (handle: unknown) => {
  if (!GetWindowTextW || !handle) {
    return undefined
  }

  const titleBuffer = Buffer.alloc(maxTextLength * 2)
  const length = GetWindowTextW(handle, titleBuffer, maxTextLength)

  return length > 0 ? readWideString(titleBuffer, length) : undefined
}

const getAppIconDataUrl = (processPath?: string) => {
  if (!processPath) {
    return undefined
  }

  const image = nativeImage.createFromPath(processPath)
  return image.isEmpty() ? undefined : image.resize({ width: 16, height: 16 }).toDataURL()
}

const captureLinuxForegroundWindow = (): ExternalWindowContext | undefined => {
  if (!hasDesktopCommand('xdotool')) {
    return undefined
  }

  try {
    const handle = runDesktopCommand('xdotool', ['getactivewindow'])
    if (!/^\d+$/.test(handle)) {
      return undefined
    }

    let processPath: string | undefined
    const processId = runDesktopCommand('xdotool', ['getwindowpid', handle])
    if (/^\d+$/.test(processId)) {
      try {
        processPath = readlinkSync(`/proc/${processId}/exe`)
      } catch {
        processPath = undefined
      }
    }

    return {
      handle,
      appName: processPath ? parse(processPath).name : undefined,
      windowTitle: runDesktopCommand('xdotool', ['getwindowname', handle]),
      iconDataUrl: getAppIconDataUrl(processPath),
      processPath,
    }
  } catch {
    return undefined
  }
}

export const captureForegroundWindow = (): ExternalWindowContext | undefined => {
  if (process.platform === 'linux') {
    return captureLinuxForegroundWindow()
  }

  if (
    process.platform !== 'win32' ||
    !GetForegroundWindow ||
    !GetWindowThreadProcessId ||
    !OpenProcess ||
    !CloseHandle
  ) {
    return undefined
  }

  try {
    const handle = GetForegroundWindow()
    if (!handle) {
      return undefined
    }

    const processIdBuffer = Buffer.alloc(4)
    GetWindowThreadProcessId(handle, processIdBuffer)
    const processId = processIdBuffer.readUInt32LE(0)

    if (!processId) {
      return undefined
    }

    const processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId)
    const processPath = processHandle ? readProcessPath(processHandle) : undefined
    if (processHandle) {
      CloseHandle(processHandle)
    }

    return {
      handle: koffi.address(handle).toString(),
      appName: processPath ? parse(processPath).name : undefined,
      windowTitle: getWindowTitle(handle),
      iconDataUrl: getAppIconDataUrl(processPath),
      processPath,
    }
  } catch {
    return undefined
  }
}

export const captureForegroundWindowAsync = async (): Promise<ExternalWindowContext | undefined> => {
  return captureForegroundWindow()
}

const pasteWithLinuxTool = (handle: string) => {
  const isX11 = process.env.XDG_SESSION_TYPE?.toLowerCase() === 'x11'

  if (isX11 && hasDesktopCommand('xdotool')) {
    const args = /^\d+$/.test(handle)
      ? ['windowactivate', '--sync', handle, 'key', '--clearmodifiers', 'ctrl+v']
      : ['sleep', '0.12', 'key', '--clearmodifiers', 'ctrl+v']
    try {
      runDesktopCommand('xdotool', args)
      return true
    } catch {
      return false
    }
  }

  if (canUseYdotool()) {
    try {
      wait(180)
      runDesktopCommand('ydotool', ['key', '29:1', '47:1', '47:0', '29:0'])
      return true
    } catch {
      ydotoolDaemonStarted = false
    }
  }

  if (hasDesktopCommand('wtype')) {
    try {
      wait(180)
      runDesktopCommand('wtype', ['-M', 'ctrl', 'v', '-m', 'ctrl'])
      return true
    } catch {
      return false
    }
  }

  if (hasDesktopCommand('xdotool')) {
    const args = /^\d+$/.test(handle)
      ? ['windowactivate', '--sync', handle, 'key', '--clearmodifiers', 'ctrl+v']
      : ['sleep', '0.12', 'key', '--clearmodifiers', 'ctrl+v']
    try {
      runDesktopCommand('xdotool', args)
      return true
    } catch {
      return false
    }
  }

  return false
}

const pasteWithMacOsAccessibility = () => {
  runDesktopCommand('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'])
  return true
}

const ydotoolSocketPath = () => process.env.YDOTOOL_SOCKET || `/run/user/${process.getuid?.() ?? 0}/.ydotool_socket`

const canAccessUinput = () => {
  try {
    accessSync('/dev/uinput', constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

const hasYdotoolDaemon = () => existsSync(ydotoolSocketPath())

const hasRunningYdotoolDaemon = () => {
  if (!hasDesktopCommand('pgrep')) {
    return hasYdotoolDaemon()
  }

  try {
    runDesktopCommand('pgrep', ['-x', 'ydotoold'])
    return true
  } catch {
    return false
  }
}

const removeStaleYdotoolSocket = () => {
  if (!existsSync(ydotoolSocketPath()) || hasRunningYdotoolDaemon()) {
    return
  }

  try {
    unlinkSync(ydotoolSocketPath())
  } catch {
    return
  }
}

const waitForYdotoolDaemon = () => {
  const deadline = Date.now() + 800
  while (Date.now() < deadline) {
    if (hasYdotoolDaemon() && hasRunningYdotoolDaemon()) {
      return true
    }
    wait(40)
  }
  return hasYdotoolDaemon() && hasRunningYdotoolDaemon()
}

const ensureYdotoolDaemon = () => {
  removeStaleYdotoolSocket()

  if (hasYdotoolDaemon() && hasRunningYdotoolDaemon()) {
    return true
  }

  if (ydotoolDaemonStarted) {
    return waitForYdotoolDaemon()
  }

  if (!hasDesktopCommand('ydotool') || !hasDesktopCommand('ydotoold') || !canAccessUinput()) {
    return false
  }

  try {
    const child = spawn('ydotoold', [`--socket-path=${ydotoolSocketPath()}`], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    ydotoolDaemonStarted = true
    return waitForYdotoolDaemon()
  } catch {
    return false
  }
}

const canUseYdotool = () => hasDesktopCommand('ydotool') && ensureYdotoolDaemon()

const canUseWtype = () => {
  if (!hasDesktopCommand('wtype')) {
    return false
  }

  if (process.env.XDG_CURRENT_DESKTOP?.toLowerCase().includes('gnome')) {
    return false
  }

  return true
}

export const canPasteIntoExternalWindow = (handle?: string) => {
  if (process.platform === 'win32') {
    return Boolean(handle && /^\d+$/.test(handle))
  }

  if (process.platform === 'darwin') {
    return hasDesktopCommand('osascript')
  }

  if (process.platform === 'linux') {
    const isX11 = process.env.XDG_SESSION_TYPE?.toLowerCase() === 'x11'
    return (isX11 && hasDesktopCommand('xdotool')) || canUseYdotool() || canUseWtype()
  }

  return false
}

export const getDesktopIntegrationSupport = (): DesktopIntegrationSupport => {
  const tools = {
    xdotool: hasDesktopCommand('xdotool'),
    ydotool: canUseYdotool(),
    wtype: canUseWtype(),
    osascript: hasDesktopCommand('osascript'),
  }
  const isX11 = process.env.XDG_SESSION_TYPE?.toLowerCase() === 'x11'
  const available =
    process.platform === 'win32' ||
    (process.platform === 'darwin' && tools.osascript) ||
    (process.platform === 'linux' && ((isX11 && tools.xdotool) || tools.ydotool || tools.wtype))
  const linuxMessage =
    process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland'
      ? 'Install ydotool and allow /dev/uinput access to enable automatic insert on Wayland.'
      : 'Install xdotool to enable automatic insert.'

  return {
    platform: process.platform,
    sessionType: process.env.XDG_SESSION_TYPE,
    autoPaste: {
      available,
      tools,
      message: available ? undefined : process.platform === 'linux' ? linuxMessage : undefined,
    },
  }
}

export const pasteIntoWindow = (handle: string) => {
  if (process.platform === 'linux') {
    try {
      return pasteWithLinuxTool(handle)
    } catch {
      return false
    }
  }

  if (process.platform === 'darwin') {
    try {
      return pasteWithMacOsAccessibility()
    } catch {
      return false
    }
  }

  if (!handle || !/^\d+$/.test(handle)) {
    return false
  }

  try {
    runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$shell = New-Object -ComObject WScript.Shell
$target = [IntPtr]::new(${handle})
[Win32]::SetForegroundWindow($target) | Out-Null
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait("^v")
`)
    return true
  } catch {
    return false
  }
}
