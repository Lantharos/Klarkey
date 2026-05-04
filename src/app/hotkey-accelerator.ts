import { keyboardEventPartsToAccelerator } from '@/shared/hotkey-accelerator'

export function keyboardEventToAccelerator(event: KeyboardEvent): string | undefined {
  if (event.repeat) {
    return undefined
  }

  return keyboardEventPartsToAccelerator({
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    platform: navigator.platform,
    shiftKey: event.shiftKey,
  })
}
