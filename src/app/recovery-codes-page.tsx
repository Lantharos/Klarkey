import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowLeft, Check } from 'lucide-react'
import { KeyHint, ReturnHint, ShortcutHint } from '@/app/palette'

function parsePastedCodes(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^[\s\-*•◦‣⁃–—★☆✦✧]+/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 4 && !/^\d+\./.test(line))
}

function mergeRecoveryCodes(existing: string[], raw: string) {
  const parsed = parsePastedCodes(raw)
  if (!parsed.length) {
    return existing
  }

  const merged = [...existing]
  for (const code of parsed) {
    if (!merged.includes(code)) {
      merged.push(code)
    }
  }
  return merged
}

export function RecoveryCodesPage({
  mode,
  itemName,
  codes: initialCodes,
  surfaceClassName,
  onSave,
  onUpdate,
  onBack,
}: {
  mode: 'add' | 'view'
  itemName: string
  codes: string[]
  surfaceClassName: string
  onSave: (codes: string[]) => void
  onUpdate: (codes: string[]) => void
  onBack: () => void
}) {
  const [codes, setCodes] = useState<string[]>(initialCodes)
  const [lastInitialCodes, setLastInitialCodes] = useState(initialCodes)
  const [used, setUsed] = useState<Set<number>>(new Set())
  const [pasteValue, setPasteValue] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [statusText, setStatusText] = useState<string | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const statusTimeoutRef = useRef<number | undefined>(undefined)

  if (lastInitialCodes !== initialCodes) {
    setLastInitialCodes(initialCodes)
    setCodes(initialCodes)
  }

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (mode === 'add') {
      textareaRef.current?.focus()
    }
  }, [mode])

  const effectiveSelectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, codes.length - 1)))

  useEffect(() => {
    if (mode === 'view' && codes.length > 0) {
      rowRefs.current[effectiveSelectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [codes.length, effectiveSelectedIndex, mode])

  const showStatus = useCallback((message: string) => {
    setStatusText(message)
    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current)
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setStatusText(undefined)
      statusTimeoutRef.current = undefined
    }, 1500)
  }, [])

  const markUsed = useCallback((index: number, nextUsed: boolean) => {
    setUsed((prev) => {
      const next = new Set(prev)
      if (nextUsed) {
        next.add(index)
      } else {
        next.delete(index)
      }
      return next
    })
  }, [])

  const handleCopy = useCallback((index: number) => {
    const code = codes[index]
    if (!code) {
      return
    }

    const copySecret = window.klarkey?.clipboard.copySecret
    if (!copySecret) {
      showStatus('Clipboard unavailable.')
      return
    }

    void copySecret(code)
      .then((result) => {
        if (result?.copied) {
          markUsed(index, true)
        }
        showStatus(result?.message || 'Clipboard unavailable.')
      })
      .catch(() => showStatus('Clipboard unavailable.'))
  }, [codes, markUsed, showStatus])

  const toggleUsed = useCallback((index: number) => {
    const nextUsed = !used.has(index)
    markUsed(index, nextUsed)
    showStatus(nextUsed ? 'Marked as used.' : 'Marked as unused.')
  }, [markUsed, showStatus, used])

  const handleRemove = useCallback((index: number) => {
    const nextCodes = codes.filter((_, codeIndex) => codeIndex !== index)
    setCodes(nextCodes)
    setUsed((prev) => {
      const next = new Set<number>()
      for (const value of prev) {
        if (value < index) {
          next.add(value)
        } else if (value > index) {
          next.add(value - 1)
        }
      }
      return next
    })
    onUpdate(nextCodes)
    showStatus('Removed.')
  }, [codes, onUpdate, showStatus])

  const handleSave = useCallback(() => {
    const merged = mergeRecoveryCodes(codes, pasteValue)
    if (!merged.length) {
      return
    }

    onSave(merged)
  }, [codes, onSave, pasteValue])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        onBack()
        return
      }

      if (mode !== 'view' || !codes.length) {
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((current) => (current + 1) % codes.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((current) => (current - 1 + codes.length) % codes.length)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        handleCopy(effectiveSelectedIndex)
        return
      }

      if (event.key === ' ' || event.key.toLowerCase() === 'u') {
        event.preventDefault()
        toggleUsed(effectiveSelectedIndex)
        return
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        handleRemove(effectiveSelectedIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [codes.length, effectiveSelectedIndex, handleCopy, handleRemove, mode, onBack, toggleUsed])

  const handleEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      handleSave()
    }
  }, [handleSave])

  const remainingCount = useMemo(() => codes.filter((_, index) => !used.has(index)).length, [codes, used])

  return (
    <div className={surfaceClassName}>
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 rounded-[10px] p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <div className="text-[15px] font-medium">{mode === 'add' ? 'Add recovery codes' : 'Recovery codes'}</div>
          {itemName ? <div className="truncate text-[13px] text-white/42">{itemName}</div> : null}
        </div>
      </div>
      <div className="palette-glass-divider" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === 'add' ? (
          <label className="block border-b border-white/6 px-5 py-3">
            <div className="mb-2 text-[13px] text-white/42">Recovery codes</div>
            <textarea
              ref={textareaRef}
              value={pasteValue}
              onChange={(event) => setPasteValue(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              placeholder="Paste recovery codes"
              className="min-h-[140px] w-full resize-none bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
            />
            <div className="mt-2 text-[13px] text-white/42">
              Paste one code per line. Klarkey removes bullets, numbering, and duplicates automatically.
            </div>
          </label>
        ) : codes.length ? (
          <div className="px-5 py-3">
            <div className="space-y-1.5">
              {codes.map((code, index) => {
                const selected = index === effectiveSelectedIndex
                const codeUsed = used.has(index)

                return (
                  <div
                    key={`${code}-${index}`}
                    ref={(element) => {
                      rowRefs.current[index] = element
                    }}
                    className={clsx(
                      'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[10px] border px-3 py-3 text-left transition',
                      codeUsed
                        ? selected
                          ? 'palette-row-selected-success border-emerald-500/30 text-white/60'
                          : 'border-white/5 bg-white/[0.03] text-white/30'
                        : selected
                          ? 'palette-row-selected border-white/14 text-white'
                          : 'border-white/10 bg-white/5 text-white/80',
                    )}
                    >
                      <div
                        className={clsx(
                        'flex h-5 w-5 items-center justify-center rounded-[6px] border',
                        codeUsed ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-white/20 text-white/28',
                      )}
                    >
                      {codeUsed ? <Check size={12} /> : null}
                      </div>
                      <div className="min-w-0">
                        <div className={clsx('truncate font-mono text-[14px]', codeUsed ? 'line-through' : undefined)}>{code}</div>
                      </div>
                    </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 text-[14px] text-white/42">No recovery codes saved.</div>
        )}
      </div>

      <div className="palette-glass-divider" />
      <div className="palette-glass-footer flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
        <span className="text-white/48">
          {statusText ?? (mode === 'add'
            ? 'Press Ctrl + Return to save recovery codes.'
            : codes.length
              ? `${remainingCount} of ${codes.length} remaining`
              : 'No recovery codes saved.')}
        </span>
        <div className="flex items-center gap-2">
          <KeyHint>Esc</KeyHint>
          {mode === 'add' ? (
            <ShortcutHint>
              <span>Ctrl</span>
              <span>+</span>
              <ReturnHint embedded />
            </ShortcutHint>
          ) : (
            <>
              <KeyHint>↑↓</KeyHint>
              <ReturnHint />
              <KeyHint>U</KeyHint>
              <KeyHint>Del</KeyHint>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
