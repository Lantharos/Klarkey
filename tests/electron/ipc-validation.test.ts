import { parseCommand } from '@/shared/command'
import {
  sanitizeActionExecutionRequest,
  sanitizeClipboardSecret,
  sanitizeCommandRaw,
  sanitizeCreateItemInput,
  sanitizeCreateVaultPasskeyInput,
  sanitizePasscode,
  sanitizeSearchRequest,
  sanitizeSettingsUpdate,
  sanitizeUpdateItemInput,
} from '@/electron/ipc-validation'

describe('Electron IPC validation', () => {
  it('accepts bounded renderer search payloads', () => {
    const query = parseCommand('copy github password')
    const request = sanitizeSearchRequest({ query, offset: 0, limit: 20 })

    expect(request.query.raw).toBe('copy github password')
    expect(request.offset).toBe(0)
    expect(request.limit).toBe(20)
  })

  it('rejects oversized command input before command parsing', () => {
    expect(() => sanitizeCommandRaw('x'.repeat(2049))).toThrow('Invalid IPC payload')
    expect(() => sanitizeSearchRequest({ query: parseCommand('x'), limit: 1000 })).toThrow('Invalid IPC payload')
  })

  it('bounds renderer clipboard secret payloads', () => {
    expect(sanitizeClipboardSecret('recovery-code')).toBe('recovery-code')
    expect(() => sanitizeClipboardSecret('')).toThrow('Invalid IPC payload')
    expect(() => sanitizeClipboardSecret('x'.repeat(100_001))).toThrow('Invalid IPC payload')
  })

  it('allows only known action shapes and modifiers', () => {
    expect(sanitizeActionExecutionRequest('copy:item_123:password', 'control')).toEqual({
      actionId: 'copy:item_123:password',
      modifier: 'control',
    })
    expect(sanitizeActionExecutionRequest('paste:item-123:password', 'none')).toEqual({
      actionId: 'paste:item-123:password',
      modifier: 'none',
    })
    expect(sanitizeActionExecutionRequest('paste:sync:item-123:password', 'none')).toEqual({
      actionId: 'paste:sync:item-123:password',
      modifier: 'none',
    })
    expect(() => sanitizeActionExecutionRequest('copy:item_123:script', 'control')).toThrow('Invalid IPC payload')
    expect(() => sanitizeActionExecutionRequest('copy:item_123:password:extra', 'control')).toThrow('Invalid IPC payload')
    expect(() => sanitizeActionExecutionRequest('copy:item_123:password', 'meta')).toThrow('Invalid IPC payload')
  })

  it('keeps settings updates on supported keys and values', () => {
    expect(sanitizeSettingsUpdate({ clearClipboardSeconds: 45, autoLockMinutes: 15, sshAgentEnabled: true, hotkey: ' ctrl + alt + s ' })).toEqual({
      clearClipboardSeconds: 45,
      autoLockMinutes: 15,
      sshAgentEnabled: true,
      hotkey: 'Ctrl+Alt+S',
    })
    expect(() => sanitizeSettingsUpdate({ clearClipboardSeconds: 3600 })).toThrow('Invalid IPC payload')
    expect(() => sanitizeSettingsUpdate({ unknown: true })).toThrow('Invalid IPC payload')
  })

  it('rejects unsafe global shortcut settings', () => {
    expect(() => sanitizeSettingsUpdate({ hotkey: 'S' })).toThrow('Invalid IPC payload')
    expect(() => sanitizeSettingsUpdate({ hotkey: 'Shift+S' })).toThrow('Invalid IPC payload')
    expect(() => sanitizeSettingsUpdate({ hotkey: 'Ctrl+MissingKey' })).toThrow('Invalid IPC payload')
    expect(() => sanitizeSettingsUpdate({ hotkey: 'Ctrl+S+T' })).toThrow('Invalid IPC payload')
    expect(() => sanitizeSettingsUpdate({ hotkey: 'Ctrl+Ctrl+S' })).toThrow('Invalid IPC payload')
  })

  it('bounds passcode and item mutation payloads', () => {
    expect(sanitizePasscode('123456')).toBe('123456')
    expect(() => sanitizePasscode('1234567')).toThrow('Invalid IPC payload')

    const create = sanitizeCreateItemInput({
      itemType: 'login',
      itemName: 'Example',
      username: 'krist',
      websites: ['https://example.test'],
      customFields: [{ id: 'field_1', label: 'PIN', value: '1234' }],
    })
    expect(create.itemName).toBe('Example')
    expect(create.websites).toEqual(['https://example.test'])

    expect(() => sanitizeUpdateItemInput({ itemId: 'item_1', itemName: 'x'.repeat(257) })).toThrow('Invalid IPC payload')
    expect(() => sanitizeCreateItemInput({ itemType: 'login', itemName: 'Example', customFields: [{ id: 'field_1' }] })).toThrow(
      'Invalid IPC payload',
    )
  })

  it('validates vault passkey enrollment payloads', () => {
    expect(sanitizeCreateVaultPasskeyInput({
      label: 'Laptop',
      credentialId: 'credential',
      transports: ['internal'],
    })).toEqual({
      label: 'Laptop',
      credentialId: 'credential',
      transports: ['internal'],
    })
    expect(() => sanitizeCreateVaultPasskeyInput({ label: 'Laptop', credentialId: '', transports: [] })).toThrow('Invalid IPC payload')
  })
})
