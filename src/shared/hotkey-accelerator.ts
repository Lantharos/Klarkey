const HOTKEY_MAX = 64

const modifierAliases = new Map([
  ['alt', 'Alt'],
  ['cmd', 'Command'],
  ['command', 'Command'],
  ['cmdorctrl', 'CommandOrControl'],
  ['commandorcontrol', 'CommandOrControl'],
  ['control', 'Ctrl'],
  ['ctrl', 'Ctrl'],
  ['meta', 'Super'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
  ['super', 'Super'],
])

const modifierOrder = ['CommandOrControl', 'Command', 'Ctrl', 'Alt', 'Shift', 'Super'] as const
const strongModifiers = new Set(['CommandOrControl', 'Command', 'Ctrl', 'Alt', 'Super'])

const keyAliases = new Map([
  ['backspace', 'Backspace'],
  ['capslock', 'Capslock'],
  ['delete', 'Delete'],
  ['down', 'Down'],
  ['end', 'End'],
  ['enter', 'Enter'],
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['home', 'Home'],
  ['insert', 'Insert'],
  ['left', 'Left'],
  ['numadd', 'numadd'],
  ['numdec', 'numdec'],
  ['numdiv', 'numdiv'],
  ['nummult', 'nummult'],
  ['numlock', 'Numlock'],
  ['numsub', 'numsub'],
  ['pagedown', 'PageDown'],
  ['pageup', 'PageUp'],
  ['plus', 'Plus'],
  ['printscreen', 'PrintScreen'],
  ['return', 'Enter'],
  ['right', 'Right'],
  ['scrolllock', 'Scrolllock'],
  ['space', 'Space'],
  ['tab', 'Tab'],
  ['up', 'Up'],
])

const codeKeySymbols: Record<string, string> = {
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  Backquote: '`',
  Backslash: '\\',
  Backspace: 'Backspace',
  BracketLeft: '[',
  BracketRight: ']',
  CapsLock: 'Capslock',
  Comma: ',',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Equal: '=',
  Escape: 'Escape',
  Home: 'Home',
  Insert: 'Insert',
  IntlBackslash: '\\',
  Minus: '-',
  NumpadAdd: 'numadd',
  NumpadDecimal: 'numdec',
  NumpadDivide: 'numdiv',
  NumpadEnter: 'Enter',
  NumpadMultiply: 'nummult',
  NumpadSubtract: 'numsub',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Period: '.',
  PrintScreen: 'PrintScreen',
  Quote: '"',
  ScrollLock: 'Scrolllock',
  Semicolon: ';',
  Slash: '/',
  Space: 'Space',
  Tab: 'Tab',
}

const punctuationKeys = new Set([')', '!', '@', '#', '$', '%', '^', '&', '*', '(', ':', ';', '+', '=', '<', ',', '_', '-', '>', '.', '?', '/', '~', '`', '{', ']', '[', '|', '\\', '}', '"'])

function normalizeModifier(part: string) {
  return modifierAliases.get(part.toLowerCase())
}

function normalizeKey(part: string) {
  const trimmed = part.trim()
  if (/^[a-z]$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  if (/^[0-9]$/.test(trimmed)) {
    return trimmed
  }
  if (/^f([1-9]|1\d|2[0-4])$/i.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  if (/^num[0-9]$/i.test(trimmed)) {
    return `num${trimmed.slice(3)}`
  }
  const aliased = keyAliases.get(trimmed.toLowerCase())
  if (aliased) {
    return aliased
  }
  if (punctuationKeys.has(trimmed)) {
    return trimmed
  }
  return undefined
}

export function normalizeHotkeyAccelerator(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > HOTKEY_MAX || trimmed.includes('\0')) {
    return undefined
  }

  const parts = trimmed.split('+').map((part) => part.trim())
  if (parts.some((part) => part.length === 0)) {
    return undefined
  }

  const modifiers = new Set<string>()
  let key: string | undefined

  for (const part of parts) {
    const modifier = normalizeModifier(part)
    if (modifier) {
      if (modifiers.has(modifier)) {
        return undefined
      }
      modifiers.add(modifier)
      continue
    }

    const keyPart = normalizeKey(part)
    if (!keyPart || key) {
      return undefined
    }
    key = keyPart
  }

  if (!key || !Array.from(modifiers).some((modifier) => strongModifiers.has(modifier))) {
    return undefined
  }

  const orderedModifiers = modifierOrder.filter((modifier) => modifiers.has(modifier))
  return [...orderedModifiers, key].join('+')
}

export function keyboardCodeToAcceleratorKey(code: string) {
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3).toUpperCase()
  }
  if (code.startsWith('Digit') && code.length === 6) {
    return code.slice(5)
  }
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) {
    return code
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `num${code.slice(6)}`
  }
  return codeKeySymbols[code]
}

export function keyboardEventPartsToAccelerator(input: {
  altKey: boolean
  code: string
  ctrlKey: boolean
  metaKey: boolean
  platform: string
  shiftKey: boolean
}) {
  const keyPart = keyboardCodeToAcceleratorKey(input.code)
  if (!keyPart) {
    return undefined
  }

  const modifiers: string[] = []
  if (input.ctrlKey) {
    modifiers.push('Ctrl')
  }
  if (input.altKey) {
    modifiers.push('Alt')
  }
  if (input.shiftKey) {
    modifiers.push('Shift')
  }
  if (input.metaKey) {
    modifiers.push(input.platform.toLowerCase().includes('mac') ? 'Command' : 'Super')
  }

  return normalizeHotkeyAccelerator([...modifiers, keyPart].join('+'))
}
