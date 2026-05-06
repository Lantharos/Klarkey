import { clipboard } from 'electron'

export class ClipboardManager {
  private clearTimer?: NodeJS.Timeout
  private pendingClearValue?: string

  copy(value: string, timeoutSeconds: number) {
    clipboard.writeText(value)
    this.clearSoon(timeoutSeconds)
  }

  clearNow() {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
      this.clearTimer = undefined
    }
    this.pendingClearValue = undefined
    clipboard.clear()
  }

  private clearSoon(timeoutSeconds: number) {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer)
      this.clearTimer = undefined
    }
    this.pendingClearValue = clipboard.readText()

    if (timeoutSeconds <= 0) {
      this.pendingClearValue = undefined
      return
    }

    this.clearTimer = setTimeout(() => {
      if (this.pendingClearValue !== undefined && clipboard.readText() === this.pendingClearValue) {
        clipboard.clear()
      }
      this.pendingClearValue = undefined
      this.clearTimer = undefined
    }, timeoutSeconds * 1000)
  }
}
