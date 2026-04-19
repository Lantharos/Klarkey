export const CLIPBOARD_CLEAR_OPTIONS = [30, 45, 60, 90, 0] as const
export const AUTO_LOCK_MINUTE_OPTIONS = [1, 5, 10, 15, 30, 60] as const

export function nextClipboardSeconds(current: number): number {
  const opts = CLIPBOARD_CLEAR_OPTIONS
  const idx = opts.findIndex((value) => value === current)
  const nextIdx = idx === -1 ? 0 : (idx + 1) % opts.length
  return opts[nextIdx]
}

export function nextAutoLockMinutes(current: number): number {
  const opts = AUTO_LOCK_MINUTE_OPTIONS
  const idx = opts.findIndex((value) => value === current)
  const nextIdx = idx === -1 ? 0 : (idx + 1) % opts.length
  return opts[nextIdx]
}

export function formatClipboardClearLabel(seconds: number): string {
  return seconds <= 0 ? 'Off' : `${seconds}s`
}
