import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import type { VaultLockInfo } from '@/shared/types'

type LockInfo = VaultLockInfo & { keyInMemory?: boolean; keyFileExists?: boolean }

export function DevPanel() {
  const [lockInfo, setLockInfo] = useState<LockInfo | null>(null)

  const api = window.klarkey

  const refresh = async () => {
    if (!api?.dev) return
    const info = await api.dev.dumpLockInfo()
    setLockInfo(info)
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (!api?.dev) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-5 text-white">
        <div className="text-[15px] text-white/72">Developer options are only available in dev mode.</div>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {lockInfo && (
          <div className="mb-4 space-y-1 rounded-[10px] bg-white/4 px-3 py-2">
            <div className="pb-1 text-[12px] font-semibold uppercase tracking-wider text-yellow-300/60">
              Vault Lock State
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[13px]">
              <span className="text-white/50">State</span>
              <span className={clsx(
                'font-mono font-bold',
                lockInfo.state === 'locked' && 'text-red-400',
                lockInfo.state === 'passcode' && 'text-yellow-400',
                lockInfo.state === 'unlocked' && 'text-green-400',
              )}>
                {lockInfo.state}
              </span>
              <span className="text-white/50">Key in memory</span>
              <span className={lockInfo.keyInMemory ? 'text-green-400' : 'text-red-400'}>
                {String(lockInfo.keyInMemory)}
              </span>
              <span className="text-white/50">Key file</span>
              <span>{lockInfo.keyFileExists ? 'exists' : 'missing'}</span>
              <span className="text-white/50">Primary methods</span>
              <span>{lockInfo.primaryMethods.join(', ') || 'none'}</span>
              <span className="text-white/50">Master password</span>
              <span>{lockInfo.masterPasswordSet ? 'set' : 'not set'}</span>
              <span className="text-white/50">Passcode</span>
              <span>{lockInfo.passcodeSet ? `set (${lockInfo.passcodeEnabled ? 'on' : 'off'})` : 'not set'}</span>
              <span className="text-white/50">Safe storage</span>
              <span>{lockInfo.safeStorageAvailable ? 'available' : 'unavailable'}</span>
              <span className="text-white/50">Auto-lock</span>
              <span>{lockInfo.autoLockMinutes} min</span>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="pb-1 text-[12px] font-semibold uppercase tracking-wider text-white/38">
            Actions
          </div>

          <button
            type="button"
            onClick={async () => { await api.dev!.forceLock(); void refresh() }}
            className="flex w-full items-center gap-3 rounded-[10px] bg-red-500/12 px-3 py-2.5 text-left text-[14px] font-medium text-red-200 transition hover:bg-red-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Force Lock
          </button>

          <button
            type="button"
            onClick={async () => { await api.dev!.forceUnlock(); void refresh() }}
            className="flex w-full items-center gap-3 rounded-[10px] bg-green-500/12 px-3 py-2.5 text-left text-[14px] font-medium text-green-200 transition hover:bg-green-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Force Unlock (safeStorage)
          </button>

          <button
            type="button"
            onClick={async () => { await api.dev!.forcePasscode(); void refresh() }}
            className="flex w-full items-center gap-3 rounded-[10px] bg-yellow-500/12 px-3 py-2.5 text-left text-[14px] font-medium text-yellow-200 transition hover:bg-yellow-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
            Force Passcode Screen
          </button>

          <button
            type="button"
            onClick={() => void refresh()}
            className="flex w-full items-center gap-3 rounded-[10px] bg-white/6 px-3 py-2.5 text-left text-[14px] text-white/74 transition hover:bg-white/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.89 2.82" /><path d="M21 3v9h-9" /></svg>
            Refresh Info
          </button>

          <div className="h-px bg-white/8" />

          <button
            type="button"
            onClick={async () => {
              const confirmed = window.confirm('This will DELETE all vault data (database + key) and restart the app. Are you sure?')
              if (!confirmed) return
              await api.dev!.resetVault()
            }}
            className="flex w-full items-center gap-3 rounded-[10px] bg-red-900/20 px-3 py-2.5 text-left text-[14px] font-medium text-red-300 transition hover:bg-red-900/40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
            Reset Vault (Delete All Data)
          </button>
        </div>
    </div>
  )
}
