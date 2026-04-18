const SPECIAL_CODES: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Backquote',
}

function codeToKeySymbol(code: string): string | undefined {
  if (code.startsWith('Key') && code.length === 4) {
    return code.slice(3)
  }
  if (code.startsWith('Digit')) {
    return code.slice(5)
  }
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) {
    return code
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `num${code.slice(6)}`
  }
  return SPECIAL_CODES[code]
}

export function keyboardEventToAccelerator(event: KeyboardEvent): string | undefined {
  if (event.repeat) {
    return undefined
  }

  const keyPart = codeToKeySymbol(event.code)
  if (!keyPart) {
    return undefined
  }

  const modifiers: string[] = []
  if (event.ctrlKey) {
    modifiers.push('Ctrl')
  }
  if (event.altKey) {
    modifiers.push('Alt')
  }
  if (event.shiftKey) {
    modifiers.push('Shift')
  }
  if (event.metaKey) {
    modifiers.push(navigator.platform.toLowerCase().includes('mac') ? 'Command' : 'Super')
  }

  return [...modifiers, keyPart].join('+')
}
