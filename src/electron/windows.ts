import { execFileSync } from 'node:child_process'
import { parse } from 'node:path'
import { nativeImage } from 'electron'
import koffi from 'koffi'
import type { ExternalWindowContext } from '@/shared/types'

const runPowerShell = (script: string) =>
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' },
  ).trim()

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

export const captureForegroundWindow = (): ExternalWindowContext | undefined => {
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

export const pasteIntoWindow = (handle: string) => {
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
