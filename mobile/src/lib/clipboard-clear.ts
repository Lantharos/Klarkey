import * as Clipboard from "expo-clipboard";

export const mobileClipboardClearMs = 45000;

export class MobileClipboardClearer {
  private clearTimer?: ReturnType<typeof setTimeout>;
  private copiedValue?: string;

  async copy(value: string) {
    this.cancelTimer();
    await Clipboard.setStringAsync(value);
    this.copiedValue = value;
    this.clearTimer = setTimeout(() => {
      void this.clearCopiedValue();
    }, mobileClipboardClearMs);
  }

  async clearCopiedValue() {
    const value = this.copiedValue;
    this.cancelTimer();
    this.copiedValue = undefined;

    if (!value) {
      return;
    }

    try {
      const current = await Clipboard.getStringAsync();
      if (current !== value) {
        return;
      }

      await Clipboard.setStringAsync("");
    } catch {
      return;
    }
  }

  private cancelTimer() {
    if (!this.clearTimer) {
      return;
    }

    clearTimeout(this.clearTimer);
    this.clearTimer = undefined;
  }
}
