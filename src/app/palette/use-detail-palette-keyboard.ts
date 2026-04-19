import { useEffect } from 'react'
import type { DetailAction } from '@/app/palette-types'
import type { ModifierKey } from '@/shared/types'

export function useDetailPaletteKeyboard({
  page,
  detailActions,
  selectedDetailAction,
  setSelectedIndex,
  executeAction,
  openEditForm,
  deleteCurrentItem,
  goBackOrClose,
  hotkeyRecording,
  resetSettingsChrome,
  selectedIndex,
  pendingDeleteConfirm,
  setPendingDeleteConfirm,
  deleteConfirmActive,
}: {
  page: 'home' | 'settings' | 'detail' | 'form' | 'dev' | 'locked' | 'passcode' | 'set-passcode' | 'set-master-password' | 'confirm-passcode-removal'
  detailActions: DetailAction[]
  selectedDetailAction: DetailAction | undefined
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  executeAction: (actionId: string, modifier: ModifierKey) => Promise<unknown>
  openEditForm: () => void
  deleteCurrentItem: () => Promise<unknown>
  goBackOrClose: () => Promise<void>
  hotkeyRecording: boolean
  resetSettingsChrome: () => void
  pendingDeleteConfirm: boolean
  setPendingDeleteConfirm: (value: boolean) => void
  deleteConfirmActive: boolean
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        if (hotkeyRecording) {
          resetSettingsChrome()
          return
        }
        if (deleteConfirmActive) {
          setPendingDeleteConfirm(false)
          return
        }
        if (page === 'settings') {
          resetSettingsChrome()
        }
        void goBackOrClose()
        return
      }

      const target = event.target
      const isInputTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      if (isInputTarget) {
        return
      }

      if (page !== 'detail' || detailActions.length === 0) {
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPendingDeleteConfirm(false)
        setSelectedIndex((selectedIndex + 1 + detailActions.length) % detailActions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPendingDeleteConfirm(false)
        setSelectedIndex((selectedIndex - 1 + detailActions.length) % detailActions.length)
        return
      }

      if (event.key !== 'Enter' || !selectedDetailAction || selectedDetailAction.disabled) {
        return
      }

      event.preventDefault()

      if (selectedDetailAction.id === 'edit-item') {
        openEditForm()
        return
      }

      if (selectedDetailAction.id === 'delete-item') {
        if (!pendingDeleteConfirm) {
          setPendingDeleteConfirm(true)
          return
        }

        setPendingDeleteConfirm(false)
        void deleteCurrentItem()
        return
      }

      if (selectedDetailAction.actionId) {
        void executeAction(selectedDetailAction.actionId, selectedDetailAction.modifier ?? 'none')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    deleteCurrentItem,
    deleteConfirmActive,
    detailActions.length,
    executeAction,
    goBackOrClose,
    hotkeyRecording,
    openEditForm,
    page,
    pendingDeleteConfirm,
    resetSettingsChrome,
    selectedDetailAction,
    selectedIndex,
    setPendingDeleteConfirm,
    setSelectedIndex,
  ])
}
