import jsQR from 'jsqr'
import { LoaderCircle, ScanLine, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { parseTotpInput } from '@/shared/totp'
import type { TotpDetails } from '@/shared/types'

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function readTotpFromScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture is not available in this build yet.')
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  })

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true

  try {
    await video.play()

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve()
      })
    }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
      throw new Error('Screen capture is not available right now.')
    }

    const deadline = Date.now() + 15000

    while (Date.now() < deadline) {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
        const result = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        })

        if (result?.data) {
          return result.data
        }
      }

      await wait(250)
    }
  } finally {
    stream.getTracks().forEach((track) => track.stop())
    video.pause()
    video.srcObject = null
  }

  throw new Error('No QR code was found on the selected screen.')
}

const summaryText = (details: TotpDetails) => {
  const parts = [
    details.issuer ?? undefined,
    details.accountName,
    `${details.digits} digits`,
    `${details.period}s`,
    details.algorithm,
  ].filter(Boolean)

  return parts.join(' · ')
}

export function TotpField({
  value,
  onChange,
  onKeyDown,
  existingOtp,
}: {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  existingOtp?: TotpDetails
}) {
  const [scanError, setScanError] = useState<string>()
  const [scanState, setScanState] = useState<'idle' | 'scanning'>('idle')

  const details = useMemo(() => {
    if (!value.trim()) {
      return existingOtp
    }

    try {
      return parseTotpInput(value, existingOtp)
    } catch {
      return undefined
    }
  }, [existingOtp, value])

  const helper =
    scanError ??
    (value.trim()
      ? details
        ? summaryText(details)
        : 'Paste a valid otpauth:// link or base32 secret.'
      : existingOtp
        ? summaryText(existingOtp)
        : 'Paste a base32 secret or an otpauth:// link.')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-[10px] bg-white/4 px-3 py-2.5">
        <input
          data-nav-input="true"
          value={value}
          onChange={(event) => {
            setScanError(undefined)
            onChange(event.target.value)
          }}
          onKeyDown={onKeyDown}
          placeholder="Authenticator secret or otpauth:// link"
          className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              setScanError(undefined)
              onChange('')
            }}
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-white/36 transition hover:bg-white/6 hover:text-white/68"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[13px] text-white/42">{helper}</div>
        <button
          type="button"
          disabled={scanState === 'scanning'}
          onClick={async () => {
            setScanError(undefined)
            setScanState('scanning')

            try {
              const rawValue = await readTotpFromScreen()
              parseTotpInput(rawValue, existingOtp)
              onChange(rawValue)
            } catch (error) {
              const message = error instanceof Error ? error.message : 'The QR code could not be read.'
              setScanError(message)
            } finally {
              setScanState('idle')
            }
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-[8px] bg-white/6 px-2.5 py-1.5 text-[13px] text-white/68 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:bg-white/4 disabled:text-white/30"
        >
          {scanState === 'scanning' ? <LoaderCircle size={14} className="animate-spin" /> : <ScanLine size={14} />}
          <span>Scan on screen</span>
        </button>
      </div>
    </div>
  )
}
