import { useCallback, useEffect, useMemo, useState } from 'react'
import { keyboardEventToAccelerator } from '@/app/hotkey-accelerator'
import { isSettingsRowVisible, moveVisibleSettingsRow, nearestVisibleSettingsRow } from '@/app/settings/settings-row-visibility'
import { nextAutoLockMinutes, nextClipboardSeconds } from '@/app/settings-constants'
import { usePaletteStore } from '@/app/usePaletteStore'
import { DEFAULT_SETTINGS, type SettingsUpdate, type UserSettings, type VaultLockInfo } from '@/shared/types'

export function useSettingsChrome(
  page:
    | 'home'
    | 'settings'
    | 'detail'
    | 'form'
    | 'locked'
    | 'passcode'
    | 'dev'
    | 'set-passcode'
    | 'set-master-password'
    | 'confirm-passcode-removal'
    | 'export'
    | 'import'
    | 'import-loading'
    | 'recovery-codes',
  settings: UserSettings | undefined,
  lockInfo: VaultLockInfo | undefined,
  selectedIndex: number,
  updateSettings: (update: SettingsUpdate) => Promise<void>,
) {
  const [hotkeyRecording, setHotkeyRecording] = useState(false)
  const [hotkeyError, setHotkeyError] = useState<string | undefined>()
  const syncStatus = usePaletteStore((state) => state.syncStatus)

  const resetSettingsChrome = useCallback(() => {
    setHotkeyRecording(false)
    setHotkeyError(undefined)
  }, [])

  const settingsFooter = useMemo(() => {
    if (hotkeyError) {
      return {
        barClass: 'border-t border-red-500/15 bg-red-500/5',
        primary: hotkeyError,
        primaryClass: 'text-red-200/88',
        keyHints: [] as string[],
      }
    }
    if (hotkeyRecording) {
      return {
        barClass: 'border-t border-emerald-500/25 bg-emerald-500/[0.07]',
        primary: 'Press the new shortcut. It replaces the old one as soon as the combo registers.',
        primaryClass: 'text-emerald-100/85',
        keyHints: ['Esc'],
      }
    }
    const byRow: Record<number, string> = {
      0: 'Enter listens for a new global shortcut that opens the palette from any app.',
      1: 'Enter cycles clipboard auto-clear: 30s → 45s → 60s → 90s → off.',
      2: 'Enter toggles opening Klarkey when Windows starts.',
      3: 'Enter toggles the inline autofill menu in the browser extension.',
      4: 'Enter toggles auto-submitting login forms after autofill.',
      5: 'Enter toggles saving new credentials when the extension offers to store them.',
      6: 'Enter toggles passcode-on-open, or sets a new passcode if none exists.',
      7: 'Enter sets up a master password.',
      8: 'Enter cycles auto-lock minutes.',
      9: 'Enter toggles the SSH agent socket for Git and OpenSSH clients.',
      10: !syncStatus?.configured
        ? 'Add sync environment values to .env.local, then restart Klarkey.'
        : syncStatus.signedIn
          ? 'Enter syncs encrypted vault changes now.'
          : 'Enter connects Klarkey sync through Ave.',
      11: 'Enter pushes and pulls encrypted vault changes.',
      12: 'Enter disconnects this device from cloud sync.',
      13: 'Enter exports your vault to a file.',
      14: 'Enter imports items from another password manager.',
    }
    return {
      barClass: '',
      primary: byRow[selectedIndex] ?? 'Choose a row to see what Enter does.',
      primaryClass: 'text-white/48',
      keyHints: ['↑↓', 'Enter', 'Esc'],
    }
  }, [hotkeyError, hotkeyRecording, selectedIndex, syncStatus?.configured, syncStatus?.signedIn])

  const activateSettingsRow = useCallback(
    (index: number) => {
      const resolved = settings ?? DEFAULT_SETTINGS
      if (index === 0) {
        setHotkeyError(undefined)
        setHotkeyRecording(true)
        return
      }
      if (index === 1) {
        void updateSettings({ clearClipboardSeconds: nextClipboardSeconds(resolved.clearClipboardSeconds) })
        return
      }
      if (index === 2) {
        void updateSettings({ launchOnStartup: !resolved.launchOnStartup })
        return
      }
      if (index === 3) {
        void updateSettings({ browserAutoOpenMenu: !resolved.browserAutoOpenMenu })
        return
      }
      if (index === 4) {
        void updateSettings({ browserAutoSubmitLogin: !resolved.browserAutoSubmitLogin })
        return
      }
      if (index === 5) {
        void updateSettings({ browserSavePrompts: !resolved.browserSavePrompts })
        return
      }
      if (index === 6) {
        if (!lockInfo?.passcodeSet) {
          usePaletteStore.getState().openSetPasscodePage()
          return
        }

        if (resolved.passcodeEnabled) {
          usePaletteStore.getState().openConfirmPasscodeRemovalPage()
          return
        }

        usePaletteStore.getState().openSetPasscodePage()
        return
      }

      if (index === 7) {
        usePaletteStore.getState().openSetMasterPasswordPage()
        return
      }

      if (index === 8) {
        void updateSettings({ autoLockMinutes: nextAutoLockMinutes(resolved.autoLockMinutes) })
        return
      }

      if (index === 9) {
        void updateSettings({ sshAgentEnabled: !resolved.sshAgentEnabled })
        return
      }

      if (index === 10) {
        const { syncStatus, syncNow, syncSignIn } = usePaletteStore.getState()
        void (syncStatus?.signedIn ? syncNow() : syncSignIn())
        return
      }

      if (index === 11) {
        if (!usePaletteStore.getState().syncStatus?.signedIn) {
          return
        }
        void usePaletteStore.getState().syncNow()
        return
      }

      if (index === 12) {
        if (!usePaletteStore.getState().syncStatus?.signedIn) {
          return
        }
        void usePaletteStore.getState().syncSignOut()
        return
      }

      if (index === 13) {
        usePaletteStore.getState().openExportPage()
        return
      }

      if (index === 14) {
        usePaletteStore.getState().openImportPage()
        return
      }
    },
    [lockInfo?.passcodeSet, settings, updateSettings],
  )

  useEffect(() => {
    if (page !== 'settings' || isSettingsRowVisible(selectedIndex, syncStatus)) {
      return
    }

    usePaletteStore.getState().setSelectedIndex(nearestVisibleSettingsRow(selectedIndex, syncStatus))
  }, [page, selectedIndex, syncStatus])

  useEffect(() => {
    if (!hotkeyRecording || page !== 'settings') {
      return undefined
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopImmediatePropagation()

      if (event.key === 'Escape') {
        resetSettingsChrome()
        return
      }

      const accelerator = keyboardEventToAccelerator(event)
      if (!accelerator) {
        return
      }

      void (async () => {
        try {
          await updateSettings({ hotkey: accelerator })
          setHotkeyRecording(false)
          setHotkeyError(undefined)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not register shortcut'
          setHotkeyError(message)
        }
      })()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hotkeyRecording, page, resetSettingsChrome, updateSettings])

  useEffect(() => {
    if (page !== 'settings') {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (hotkeyRecording) {
        return
      }

      if (event.defaultPrevented) {
        return
      }

      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const { selectedIndex: current, setSelectedIndex } = usePaletteStore.getState()
        setSelectedIndex(moveVisibleSettingsRow(current, 1, usePaletteStore.getState().syncStatus))
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const { selectedIndex: current, setSelectedIndex } = usePaletteStore.getState()
        setSelectedIndex(moveVisibleSettingsRow(current, -1, usePaletteStore.getState().syncStatus))
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const { selectedIndex: current } = usePaletteStore.getState()
        activateSettingsRow(current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activateSettingsRow, hotkeyRecording, page])

  return {
    hotkeyRecording,
    hotkeyError,
    settingsFooter,
    resetSettingsChrome,
    setHotkeyRecording,
    setHotkeyError,
  }
}
