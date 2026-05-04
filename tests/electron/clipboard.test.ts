import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let clipboardText = ''
const writeText = vi.fn((value: string) => {
  clipboardText = value
})
const readText = vi.fn(() => clipboardText)
const clear = vi.fn(() => {
  clipboardText = ''
})

vi.mock('electron', () => ({
  clipboard: {
    writeText,
    readText,
    clear,
  },
}))

describe('ClipboardManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clipboardText = ''
    writeText.mockClear()
    readText.mockClear()
    clear.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears Klarkey-copied text after the timeout', async () => {
    const { ClipboardManager } = await import('@/electron/clipboard')
    const manager = new ClipboardManager()

    manager.copy('secret', 3)
    vi.advanceTimersByTime(3000)

    expect(writeText).toHaveBeenCalledWith('secret')
    expect(clear).toHaveBeenCalledTimes(1)
    expect(clipboardText).toBe('')
  })

  it('does not clear newer clipboard contents copied by the user', async () => {
    const { ClipboardManager } = await import('@/electron/clipboard')
    const manager = new ClipboardManager()

    manager.copy('secret', 3)
    clipboardText = 'user copied this'
    vi.advanceTimersByTime(3000)

    expect(clear).not.toHaveBeenCalled()
    expect(clipboardText).toBe('user copied this')
  })

  it('only tracks the most recent Klarkey clipboard value', async () => {
    const { ClipboardManager } = await import('@/electron/clipboard')
    const manager = new ClipboardManager()

    manager.copy('first', 3)
    manager.copy('second', 3)
    vi.advanceTimersByTime(3000)

    expect(clear).toHaveBeenCalledTimes(1)
    expect(clipboardText).toBe('')
  })

  it('routes desktop recovery code copies through the managed clipboard API', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/recovery-codes-page.tsx'), 'utf8')

    expect(source).toContain('clipboard.copySecret')
    expect(source).not.toContain('navigator.clipboard')
  })

  it('does not grant renderer browser clipboard-write permissions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/electron/main.ts'), 'utf8')

    expect(source).toContain('IPC_CHANNELS.clipboardCopySecret')
    expect(source).toContain('controllerRef?.copySecret(sanitizeClipboardSecret(value))')
    expect(source).not.toContain('clipboard-sanitized-write')
  })
})
