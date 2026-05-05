import { describe, expect, it } from 'vitest'
import {
  isAllowedNativeMessagingParentChain,
  isAllowedNativeMessagingParentPath,
  isAllowedPasskeyProviderParentPath,
  isAllowedSshAgentHostParentPath,
} from '@/electron/process-parent'

const nativeMessagingParentEnv = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\person\\AppData\\Local',
  SystemRoot: 'C:\\Windows',
}

describe('native process caller policy', () => {
  it('accepts only the Klarkey Windows passkey provider as bridge parent', () => {
    expect(isAllowedPasskeyProviderParentPath('C:\\Temp\\KlarkeyPasskeyProvider.exe', { isPackaged: false })).toBe(true)
    expect(isAllowedPasskeyProviderParentPath('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', { isPackaged: false })).toBe(false)
    expect(isAllowedPasskeyProviderParentPath('C:\\Temp\\KlarkeyPasskeyProvider.bat', { isPackaged: false })).toBe(false)
    expect(isAllowedPasskeyProviderParentPath(undefined)).toBe(false)
  })

  it('requires the packaged passkey provider parent to come from WindowsApps', () => {
    const options = { isPackaged: true, env: nativeMessagingParentEnv }

    expect(isAllowedPasskeyProviderParentPath('C:\\Program Files\\WindowsApps\\EFE77E75-69F0-4833-BA61-F4BE21877B67_1.0.0.0_x64__publisher\\KlarkeyPasskeyProvider.exe', options)).toBe(true)
    expect(isAllowedPasskeyProviderParentPath('C:\\Temp\\KlarkeyPasskeyProvider.exe', options)).toBe(false)
    expect(isAllowedPasskeyProviderParentPath('C:\\Users\\person\\WindowsApps\\KlarkeyPasskeyProvider.exe', options)).toBe(false)
  })

  it('accepts browser parents for packaged native messaging hosts', () => {
    const options = { isPackaged: true, env: nativeMessagingParentEnv }

    expect(isAllowedNativeMessagingParentPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', options)).toBe(true)
    expect(isAllowedNativeMessagingParentPath('C:\\Users\\person\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe', options)).toBe(true)
    expect(isAllowedNativeMessagingParentPath('C:\\Program Files\\Mozilla Firefox\\firefox.exe', options)).toBe(true)
    expect(isAllowedNativeMessagingParentPath('C:\\Users\\person\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe', options)).toBe(true)
    expect(isAllowedNativeMessagingParentPath('C:\\Program Files\\Zen Browser\\zen.exe', options)).toBe(true)
    expect(isAllowedNativeMessagingParentPath('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', options)).toBe(false)
    expect(isAllowedNativeMessagingParentPath('C:\\Temp\\chrome.exe', options)).toBe(false)
    expect(isAllowedNativeMessagingParentPath('C:\\Users\\person\\AppData\\Local\\Other\\Helium\\Application\\chrome.exe', options)).toBe(false)
    expect(isAllowedNativeMessagingParentPath('C:\\Temp\\Klarkey.NativeHostLauncher.exe', options)).toBe(false)
  })

  it('accepts Chrome native hosts launched through the Windows command shell only with a trusted browser grandparent', () => {
    const options = { isPackaged: true, env: nativeMessagingParentEnv }

    expect(isAllowedNativeMessagingParentChain(
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      options,
    )).toBe(true)
    expect(isAllowedNativeMessagingParentChain(
      'C:\\Windows\\SysWOW64\\cmd.exe',
      'C:\\Users\\person\\AppData\\Local\\imput\\Helium\\Application\\chrome.exe',
      options,
    )).toBe(true)
    expect(isAllowedNativeMessagingParentChain(
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\Temp\\chrome.exe',
      options,
    )).toBe(false)
    expect(isAllowedNativeMessagingParentChain(
      'C:\\Temp\\cmd.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      options,
    )).toBe(false)
  })

  it('accepts the development native host launcher only outside packaged builds', () => {
    expect(isAllowedNativeMessagingParentPath('C:\\Temp\\Klarkey.NativeHostLauncher.exe', { isPackaged: false, env: nativeMessagingParentEnv })).toBe(true)
    expect(isAllowedNativeMessagingParentPath('C:\\Temp\\Klarkey.NativeHostLauncher.exe', { isPackaged: true, env: nativeMessagingParentEnv })).toBe(false)
  })

  it('accepts SSH agent host mode only from the same executable parent', () => {
    const executablePath = 'C:\\Program Files\\Klarkey\\Klarkey.exe'

    expect(isAllowedSshAgentHostParentPath('C:\\Program Files\\Klarkey\\Klarkey.exe', { executablePath })).toBe(true)
    expect(isAllowedSshAgentHostParentPath('C:\\Temp\\Klarkey.exe', { executablePath })).toBe(false)
    expect(isAllowedSshAgentHostParentPath('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', { executablePath })).toBe(false)
    expect(isAllowedSshAgentHostParentPath(undefined, { executablePath })).toBe(false)
  })
})
