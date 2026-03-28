import { useEffect, useMemo, useState } from 'react'
import { getTotpCode } from '@/shared/totp'
import type { TotpDetails } from '@/shared/types'

const formatCode = (value: string) => {
  if (value.length !== 6) {
    return value
  }

  return `${value.slice(0, 3)} ${value.slice(3)}`
}

export function TotpCodePanel({ otp }: { otp: TotpDetails }) {
  const [now, setNow] = useState(() => Date.now())
  const code = useMemo(() => getTotpCode(otp, now), [now, otp])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="px-3 pb-2 pt-3">
      <div className="rounded-[12px] bg-white/4 px-4 py-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[28px] leading-none tracking-[0.16em] text-white">{formatCode(code.value)}</div>
            <div className="mt-2 text-[13px] text-white/42">
              {[otp.issuer, otp.accountName].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[24px] font-medium leading-none text-white/84">{code.remainingSeconds}s</div>
            <div className="mt-2 text-[13px] text-white/34">refresh</div>
          </div>
        </div>
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-white/48 transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, (1 - code.progress) * 100))}%` }}
          />
        </div>
      </div>
    </div>
  )
}
