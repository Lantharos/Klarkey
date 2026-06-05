type FailureResult = { success: false; message: string }

const maxAttempts = 8
const lockoutMs = 30_000
let failedAttempts = 0
let lockedUntil = 0

export function checkUnlockAttempt(): FailureResult | undefined {
  const remainingMs = lockedUntil - Date.now()
  if (remainingMs <= 0) return undefined
  const seconds = Math.ceil(remainingMs / 1000)
  return { success: false, message: `Try again in ${seconds} second${seconds === 1 ? '' : 's'}.` }
}

export function recordUnlockFailure() {
  failedAttempts += 1
  if (failedAttempts >= maxAttempts) {
    lockedUntil = Date.now() + lockoutMs
  }
}

export function resetUnlockRateLimit() {
  failedAttempts = 0
  lockedUntil = 0
}
