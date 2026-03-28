import { execFile, execFileSync } from 'node:child_process'

const runPowerShell = (script: string) =>
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8' },
  ).trim()

const runPowerShellAsync = (script: string) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolve(stdout.trim())
      },
    )
  })

export const captureForegroundWindow = () => {
  try {
    const output = runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$handle = [Win32]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { "" } else { $handle.ToInt64() }
`)
    return output || undefined
  } catch {
    return undefined
  }
}

export const captureForegroundWindowAsync = async () => {
  try {
    const output = await runPowerShellAsync(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$handle = [Win32]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { "" } else { $handle.ToInt64() }
`)
    return output || undefined
  } catch {
    return undefined
  }
}

export const pasteIntoWindow = (handle: string) => {
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
