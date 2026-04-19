import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { VaultLockInfo } from '@/shared/types'

let lastAutoSystemUnlockAttemptAt = 0

export function VaultLockScreen({
  lockInfo,
  onUnlockWithHello,
  onUnlockWithPassword,
}: {
  lockInfo: VaultLockInfo
  onUnlockWithHello: () => Promise<{ success: boolean; message: string }>
  onUnlockWithPassword: (password: string) => Promise<{ success: boolean; message: string }>
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [helloLoading, setHelloLoading] = useState(false)
  const [helloAttempted, setHelloAttempted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (password.length > 0) {
      setError('')
    }
  }, [password])

  const canUseHello = lockInfo.primaryMethods.includes('windowsHello')
  const needsPassword = lockInfo.primaryMethods.includes('masterPassword')

  const handleHello = async () => {
    setHelloLoading(true)
    if (!needsPassword) {
      setError('')
    }
    const result = await onUnlockWithHello()
    if (!result.success) {
      setError(result.message || 'Windows Hello verification failed.')
    }
    setHelloLoading(false)
  }

  useEffect(() => {
    if (!canUseHello || helloAttempted) {
      return
    }

    const now = Date.now()
    if (now - lastAutoSystemUnlockAttemptAt < 2000) {
      setHelloAttempted(true)
      return
    }

    setHelloAttempted(true)
    lastAutoSystemUnlockAttemptAt = now
    void handleHello()
  }, [canUseHello, helloAttempted])

  const handlePassword = async () => {
    if (!password.trim()) {
      setError('Enter your master password.')
      return
    }
    const result = await onUnlockWithPassword(password)
    if (!result.success) {
      setError(result.message || 'Unlock failed.')
      return
    }
    setPassword('')
    setError('')
  }

  return (
    <div className="flex h-full min-h-full flex-col items-center justify-center gap-6 px-8 py-6 text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/8">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <div className="flex flex-col items-center gap-1 text-center">
        <div className="text-[18px] font-medium text-white">Vault locked</div>
        <div className="max-w-[280px] text-[14px] text-white/50">
          {helloLoading
            ? 'Verifying with Windows Hello...'
            : needsPassword
              ? 'Enter your master password to unlock.'
              : canUseHello
                ? 'Unlock with Windows Hello by reopening the palette if needed.'
                : 'Set up a master password to protect your vault.'}
        </div>
      </div>

      {(canUseHello || needsPassword) && (
        <div className="flex w-full max-w-[280px] flex-col gap-3">
          {needsPassword && (
            <>
              <div className="flex flex-col gap-2">
                <input
                  ref={inputRef}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handlePassword()
                    }
                  }}
                  placeholder="Master password"
                  className="h-10 w-full rounded-[10px] bg-white/8 px-3 text-[14px] text-white outline-none placeholder:text-white/30 focus:ring-2 focus:ring-white/20"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void handlePassword()}
                  className="flex h-10 w-full items-center justify-center rounded-[10px] bg-white/10 text-[14px] font-medium text-white transition hover:bg-white/14"
                >
                  Unlock
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <div className="text-[13px] text-red-300/80">{error}</div>}
    </div>
  )
}

export function PasscodeScreen({
  onVerifyPasscode,
  passcodeLength = 4,
}: {
  onVerifyPasscode: (passcode: string) => Promise<{ success: boolean; message: string }>
  passcodeLength?: number
}) {
  const length = Math.min(6, Math.max(4, passcodeLength))
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)
    const chars = passcode.padEnd(length, ' ').split('')
    chars[index] = digit || ' '
    const next = chars.join('').replace(/\s+/g, '')
    setPasscode(next)
    setError('')

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      if (!passcode[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
      }
      return
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      inputRefs.current[index - 1]?.focus()
      return
    }

    if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  useEffect(() => {
    if (isSubmitting || passcode.length !== length) {
      return
    }

    setIsSubmitting(true)
    void (async () => {
      const result = await onVerifyPasscode(passcode)
      if (!result.success) {
        setError(result.message || 'Incorrect passcode.')
        setPasscode('')
        inputRefs.current[0]?.focus()
      }
      setIsSubmitting(false)
    })()
  }, [isSubmitting, length, onVerifyPasscode, passcode])

  return (
    <div className="flex h-full min-h-full flex-col items-center justify-center px-8 py-6 text-white">
      <div className="flex items-center gap-3">
        {Array.from({ length }).map((_, index) => (
          <input
            key={`passcode-${index}`}
            ref={(element) => {
              inputRefs.current[index] = element
            }}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={passcode[index] ?? ''}
            onChange={(event) => handleChange(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            className={clsx(
              'h-12 w-12 rounded-[10px] border bg-white/6 text-center text-[20px] font-semibold text-white outline-none transition',
              'border-white/12 focus:border-white/28 focus:ring-2 focus:ring-white/20',
              isSubmitting ? 'opacity-70' : '',
            )}
            disabled={isSubmitting}
          />
        ))}
      </div>
      {error ? <div className="mt-4 text-[13px] text-red-300/80">{error}</div> : null}
    </div>
  )
}
