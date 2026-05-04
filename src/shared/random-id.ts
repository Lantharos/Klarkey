let fallbackCounter = 0

export function randomId(prefix: string) {
  const bytes = new Uint8Array(6)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }

  fallbackCounter += 1
  return `${prefix}_${Date.now().toString(16)}_${fallbackCounter.toString(16)}`
}
