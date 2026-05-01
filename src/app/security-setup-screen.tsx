import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function PasscodeSetupScreen({
  onSubmit,
  onCancel,
}: {
  onSubmit: (passcode: string, confirmPasscode: string) => Promise<{ success: boolean; message: string }>
  onCancel: () => void
}) {
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter')
  const [passcode, setPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const enterRefs = useRef<Array<HTMLInputElement | null>>([])
  const confirmRefs = useRef<Array<HTMLInputElement | null>>([])
  const codeLength = 4

  const activeCode = stage === 'enter' ? passcode : confirmPasscode

  const focusIndex = (index: number) => {
    const refs = stage === 'enter' ? enterRefs.current : confirmRefs.current
    refs[index]?.focus()
  }

  useEffect(() => {
    const refs = stage === 'enter' ? enterRefs.current : confirmRefs.current
    refs[0]?.focus()
  }, [stage])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      if (stage === 'confirm') {
        if (confirmPasscode.length > 0) {
          setConfirmPasscode('')
          return
        }
        setStage('enter')
        setConfirmPasscode('')
        setError('')
        return
      }

      if (passcode.length > 0) {
        setPasscode('')
        setError('')
        return
      }

      onCancel()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [confirmPasscode.length, onCancel, passcode.length, stage])

  const submit = async (nextConfirmPasscode = confirmPasscode) => {
    if (isSubmitting) {
      return
    }
    setIsSubmitting(true)
    const result = await onSubmit(passcode, nextConfirmPasscode)
    if (!result.success) {
      setError(result.message)
      setStage('enter')
      setPasscode('')
      setConfirmPasscode('')
    }
    setIsSubmitting(false)
  }

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)
    const chars = activeCode.padEnd(codeLength, ' ').split('')
    chars[index] = digit || ' '
    const next = chars.join('').replace(/\s+/g, '')
    setError('')

    if (stage === 'enter') {
      setPasscode(next)
      if (next.length === codeLength) {
        setStage('confirm')
        setConfirmPasscode('')
      }
    } else {
      setConfirmPasscode(next)
      if (next.length === codeLength) {
        void submit(next)
      }
    }

    if (digit && index < codeLength - 1) {
      focusIndex(index + 1)
    }
  }

  const handleKeyDown = (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      if (!activeCode[index] && index > 0) {
        focusIndex(index - 1)
      }
      return
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      focusIndex(index - 1)
      return
    }

    if (event.key === 'ArrowRight' && index < codeLength - 1) {
      event.preventDefault()
      focusIndex(index + 1)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-5">
      <div className="mx-auto w-full max-w-[360px] space-y-5">
        <p className="text-center text-[14px] text-white/55">
          {stage === 'enter' ? 'Enter your passcode.' : 'Confirm your passcode.'}
        </p>
        <div className="flex items-center justify-center gap-3">
          {Array.from({ length: codeLength }).map((_, index) => (
            <input
              key={`${stage}-${index}`}
              ref={(element) => {
                if (stage === 'enter') {
                  enterRefs.current[index] = element
                } else {
                  confirmRefs.current[index] = element
                }
              }}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={activeCode[index] ?? ''}
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
        {error ? <p className="text-[13px] text-red-300/80">{error}</p> : null}
      </div>
    </div>
  )
}

export function MasterPasswordSetupScreen({
  onSubmit,
  onCancel,
}: {
  onSubmit: (password: string, confirmPassword: string) => Promise<{ success: boolean; message: string }>
  onCancel: () => void
}) {
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    passwordRef.current?.focus()
  }, [stage])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      if (stage === 'confirm') {
        if (confirmPassword.length > 0) {
          setConfirmPassword('')
          return
        }
        setStage('enter')
        setConfirmPassword('')
        setError('')
        return
      }

      if (password.length > 0) {
        setPassword('')
        setError('')
        return
      }

      onCancel()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [confirmPassword.length, onCancel, password.length, stage])

  const submit = async () => {
    if (isSubmitting) {
      return
    }
    setIsSubmitting(true)
    const result = await onSubmit(password, confirmPassword)
    if (!result.success) {
      setError(result.message)
      setStage('enter')
      setPassword('')
      setConfirmPassword('')
    }
    setIsSubmitting(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-5">
      <div className="mx-auto w-full max-w-[360px] space-y-4">
        <p className="text-[14px] text-white/55">
          {stage === 'enter'
            ? 'Enter your master password (minimum 8 characters).'
            : 'Confirm your master password.'}
        </p>
        <input
          ref={passwordRef}
          type="password"
          value={stage === 'enter' ? password : confirmPassword}
          onChange={(event) => {
            if (stage === 'enter') {
              setPassword(event.target.value)
            } else {
              setConfirmPassword(event.target.value)
            }
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (stage === 'enter') {
                if (password.trim().length > 0) {
                  setStage('confirm')
                }
                return
              }
              void submit()
            }
          }}
          placeholder={stage === 'enter' ? 'Enter master password' : 'Confirm master password'}
          className="h-11 w-full rounded-[10px] bg-white/8 px-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:ring-2 focus:ring-white/20"
          disabled={isSubmitting}
        />
        {error ? <p className="text-[13px] text-red-300/80">{error}</p> : null}
      </div>
    </div>
  )
}

export function PasscodeConfirmScreen({
  title,
  passcodeLength = 4,
  onSubmit,
  onCancel,
}: {
  title: string
  passcodeLength?: number
  onSubmit: (passcode: string) => Promise<{ success: boolean; message: string }>
  onCancel: () => void
}) {
  const length = Math.min(6, Math.max(4, passcodeLength))
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      if (passcode.length > 0) {
        setPasscode('')
        setError('')
        inputRefs.current[0]?.focus()
        return
      }

      onCancel()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel, passcode.length])

  const submitPasscode = async (nextPasscode: string) => {
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    const result = await onSubmit(nextPasscode)
    if (!result.success) {
      setError(result.message || 'Incorrect passcode.')
      setPasscode('')
      inputRefs.current[0]?.focus()
    }
    setIsSubmitting(false)
  }

  const handleChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1)
    const chars = passcode.padEnd(length, ' ').split('')
    chars[index] = digit || ' '
    const next = chars.join('').replace(/\s+/g, '')
    setPasscode(next)
    setError('')

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
      return
    }

    if (next.length === length) {
      void submitPasscode(next)
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

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-6 py-5">
      <div className="mx-auto w-full max-w-[360px] space-y-5">
        <p className="text-center text-[14px] text-white/55">{title}</p>
        <div className="flex items-center justify-center gap-3">
          {Array.from({ length }).map((_, index) => (
            <input
              key={`confirm-passcode-${index}`}
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
        {error ? <p className="text-[13px] text-red-300/80">{error}</p> : null}
      </div>
    </div>
  )
}
