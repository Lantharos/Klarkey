import { clipboard } from 'electron'

export class ClipboardManager {
  private clearTimer?: NodeJS.Timeout

  copy(value: string, timeoutSeconds: number) {
    clipboard.writeText(value)
    this.clearSoon(timeoutSeconds)
  }

  clearNow() {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
      this.clearTimer = undefined
    }
    clipboard.clear()
  }

  private clearSoon(timeoutSeconds: number) {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
      this.clearTimer = undefined
    }

    if (timeoutSeconds <= 0) {
      return
    }

    this.clearTimer = setTimeout(() => {
      clipboard.clear()
    }, timeoutSeconds * 1000)
  }
}
