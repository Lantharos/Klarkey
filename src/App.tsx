import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { ItemDetailOverview } from '@/app/item-detail-overview'
import { ItemFormPage } from '@/app/item-form-page'
import { cleanFormValue } from '@/app/item-form-clean'
import { buildDetailActions } from '@/app/item-type-meta'
import {
  DetailRow,
  FooterOtpStatus,
  HeaderRow,
  KeyHint,
  ReturnHint,
  ResultRow,
  SearchBar,
} from '@/app/palette'
import { useDetailItem } from '@/app/palette/use-detail-item'
import { useDetailPaletteKeyboard } from '@/app/palette/use-detail-palette-keyboard'
import { useSettingsChrome } from '@/app/palette/use-settings-chrome'
import { useTargetWindow } from '@/app/palette/use-target-window'
import { createFormValues } from '@/app/palette-utils'
import { nextAutoLockMinutes, nextClipboardSeconds } from '@/app/settings-constants'
import { SettingsPage } from '@/app/settings/settings-page'
import { usePaletteStore } from '@/app/usePaletteStore'
import { VaultLockScreen, PasscodeScreen } from '@/app/vault-lock-screen'
import { MasterPasswordSetupScreen, PasscodeConfirmScreen, PasscodeSetupScreen } from '@/app/security-setup-screen'
import { DevPanel } from '@/app/dev-panel'
import { FormatPickerPage } from '@/app/format-picker-page'
import { ImportLoadingPage } from '@/app/import-loading-page'
import { DEFAULT_SETTINGS, type UpdateItemInput } from '@/shared/types'

function App() {
  const hydrated = usePaletteStore((state) => state.hydrated)
  const bootError = usePaletteStore((state) => state.bootError)
  const page = usePaletteStore((state) => state.page)
  const formMode = usePaletteStore((state) => state.formMode)
  const query = usePaletteStore((state) => state.query)
  const actions = usePaletteStore((state) => state.actions)
  const selectedIndex = usePaletteStore((state) => state.selectedIndex)
  const detailAction = usePaletteStore((state) => state.detailAction)
  const execution = usePaletteStore((state) => state.execution)
  const settings = usePaletteStore((state) => state.settings)
  const hasMoreResults = usePaletteStore((state) => state.hasMoreResults)
  const isLoadingMore = usePaletteStore((state) => state.isLoadingMore)
  const boot = usePaletteStore((state) => state.boot)
  const primeHome = usePaletteStore((state) => state.primeHome)
  const resetToHome = usePaletteStore((state) => state.resetToHome)
  const focusInput = usePaletteStore((state) => state.focusInput)
  const setTrailingText = usePaletteStore((state) => state.setTrailingText)
  const removeToken = usePaletteStore((state) => state.removeToken)
  const moveSelection = usePaletteStore((state) => state.moveSelection)
  const executeSelection = usePaletteStore((state) => state.executeSelection)
  const executeAction = usePaletteStore((state) => state.executeAction)
  const setSelectedIndex = usePaletteStore((state) => state.setSelectedIndex)
  const updateSettings = usePaletteStore((state) => state.updateSettings)
  const loadMoreActions = usePaletteStore((state) => state.loadMoreActions)
  const goBackOrClose = usePaletteStore((state) => state.goBackOrClose)
  const openEditForm = usePaletteStore((state) => state.openEditForm)
  const submitCreateForm = usePaletteStore((state) => state.submitCreateForm)
  const submitEditForm = usePaletteStore((state) => state.submitEditForm)
  const deleteCurrentItem = usePaletteStore((state) => state.deleteCurrentItem)
  const unlockWithHello = usePaletteStore((state) => state.unlockWithHello)
  const unlockWithPassword = usePaletteStore((state) => state.unlockWithPassword)
  const verifyPasscode = usePaletteStore((state) => state.verifyPasscode)
  const openSetPasscodePage = usePaletteStore((state) => state.openSetPasscodePage)
  const openSetMasterPasswordPage = usePaletteStore((state) => state.openSetMasterPasswordPage)
  const openConfirmPasscodeRemovalPage = usePaletteStore((state) => state.openConfirmPasscodeRemovalPage)
  const submitSetPasscode = usePaletteStore((state) => state.submitSetPasscode)
  const submitSetMasterPassword = usePaletteStore((state) => state.submitSetMasterPassword)
  const confirmPasscodeRemoval = usePaletteStore((state) => state.confirmPasscodeRemoval)
  const lockInfo = usePaletteStore((state) => state.lockInfo)
  const exportVault = usePaletteStore((state) => state.exportVault)
  const importVault = usePaletteStore((state) => state.importVault)

  const targetWindow = useTargetWindow()
  const [detailItem, setDetailItem] = useDetailItem(detailAction?.itemId, page, execution?.itemId)

  const [pointerActive, setPointerActive] = useState(false)
  const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false)

  const {
    hotkeyRecording,
    settingsFooter,
    resetSettingsChrome,
    setHotkeyRecording,
    setHotkeyError,
  } = useSettingsChrome(page, settings, lockInfo, selectedIndex, updateSettings)

  const selection = actions[selectedIndex]
  const activeDetailItem = detailAction?.itemId === detailItem?.itemId ? detailItem : undefined
  const detailActions = useMemo(() => buildDetailActions(activeDetailItem, targetWindow), [activeDetailItem, targetWindow])
  const selectedDetailAction = detailActions[selectedIndex]
  const formLoading = page === 'form' && formMode === 'edit' && Boolean(detailAction?.itemId) && !activeDetailItem
  const createItemType = detailAction?.itemType || query.entryType || 'login'
  const formItemType = activeDetailItem?.itemType || createItemType
  const createSeed = useMemo(
    () => ({
      itemType: createItemType,
      itemName:
        (detailAction?.kind === 'create-item' ? detailAction.subtitle : undefined) ||
        query.itemQuery ||
        '',
      username: query.identityQuery || '',
      password: '',
      otp: '',
      fullName: '',
      firstName: '',
      middleName: '',
      lastName: '',
      company: '',
      jobTitle: '',
      birthDate: '',
      email: '',
      phone: '',
      address: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      cardholderName: '',
      cardNumber: '',
      cardExpiry: '',
      cardExpiryMonth: '',
      cardExpiryYear: '',
      cardCvc: '',
      cardBrand: '',
      billingPostalCode: '',
      sshPublicKey: '',
      sshPrivateKey: '',
      sshComment: '',
      content: '',
      notes: '',
      websites: [''],
      customFields: [],
    }),
    [createItemType, detailAction?.kind, detailAction?.subtitle, query.identityQuery, query.itemQuery],
  )
  const footerMessage = execution?.secret ?? execution?.message
  const deleteConfirmActive = page === 'detail' && selectedDetailAction?.id === 'delete-item' && pendingDeleteConfirm
  const footerOtp = execution?.title === 'Current OTP' ? activeDetailItem?.otp : undefined
  const lockWarningText =
    lockInfo?.lockWarningSeconds && lockInfo.lockWarningSeconds > 0
      ? `Locking in ${lockInfo.lockWarningSeconds}s`
      : undefined

  useDetailPaletteKeyboard({
    page,
    detailActions,
    selectedDetailAction,
    selectedIndex,
    setSelectedIndex,
    executeAction,
    openEditForm,
    deleteCurrentItem,
    goBackOrClose,
    hotkeyRecording,
    resetSettingsChrome,
    pendingDeleteConfirm,
    setPendingDeleteConfirm,
    deleteConfirmActive,
  })

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    return window.klarkey.onLockStateChanged((info) => {
      const previousState = usePaletteStore.getState().lockInfo?.state
      usePaletteStore.setState({ lockInfo: info })

      if (previousState === info.state) {
        return
      }

      if (info.state === 'locked') {
        usePaletteStore.setState({ page: 'locked', actions: [], hasMoreResults: false, nextOffset: 0, selectedIndex: 0, detailAction: undefined, formMode: undefined, execution: undefined })
      } else if (info.state === 'passcode') {
        usePaletteStore.setState({ page: 'passcode' })
      } else if (info.state === 'unlocked') {
        usePaletteStore.setState({ page: 'home' })
        void usePaletteStore.getState().resetToHome()
      }
    })
  }, [])

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    return window.klarkey.onPrepareOpen(() => {
      const { lockInfo: currentLockInfo } = usePaletteStore.getState()
      if (currentLockInfo?.state === 'locked') {
        usePaletteStore.setState({ page: 'locked', actions: [], hasMoreResults: false, nextOffset: 0, selectedIndex: 0, detailAction: undefined, formMode: undefined, execution: undefined })
        return
      }

      if (currentLockInfo?.state === 'passcode') {
        usePaletteStore.setState({ page: 'passcode', actions: [], hasMoreResults: false, nextOffset: 0, selectedIndex: 0, detailAction: undefined, formMode: undefined, execution: undefined })
        return
      }

      setPointerActive(false)
      setPendingDeleteConfirm(false)
      resetSettingsChrome()
      setDetailItem(undefined)
      primeHome()
      focusInput()
      void resetToHome()
    })
  }, [focusInput, primeHome, resetSettingsChrome, resetToHome, setDetailItem])

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    return window.klarkey.onFocusRequest(() => {
      focusInput()
    })
  }, [focusInput])

  useEffect(() => {
    if (page === 'home') {
      focusInput()
    }
  }, [focusInput, page])

  useEffect(() => {
    if (page !== 'export' && page !== 'import') {
      return undefined
    }

    const optionCount = page === 'export' ? 2 : 8

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        usePaletteStore.setState({ page: 'settings', selectedIndex: page === 'export' ? 10 : 11 })
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((selectedIndex + 1) % optionCount)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((selectedIndex - 1 + optionCount) % optionCount)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (page === 'export') {
          const formats = ['klarkey-json', 'csv'] as const
          void exportVault(formats[selectedIndex] ?? 'klarkey-json')
        } else {
          const formats = ['auto', '1pux', 'bitwarden-json', 'dashlane-json', 'csv', 'lastpass-csv', 'dashlane-csv', 'chrome-csv'] as const
          void importVault(formats[selectedIndex] ?? 'auto')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [exportVault, importVault, page, selectedIndex, setSelectedIndex])

  if (!hydrated) {
    return (
      <div className="flex h-full min-h-full items-center justify-center px-6 py-5 text-white">
        <div className="text-[15px] text-white/72">
          {bootError ? `Klarkey could not finish loading. ${bootError}` : 'Starting Klarkey...'}
        </div>
      </div>
    )
  }

  if (lockInfo?.state === 'locked' && page !== 'locked') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <VaultLockScreen
          lockInfo={lockInfo}
          onUnlockWithHello={unlockWithHello}
          onUnlockWithPassword={unlockWithPassword}
        />
      </div>
    )
  }

  if (lockInfo?.state === 'passcode' && page !== 'passcode') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <PasscodeScreen
          passcodeLength={lockInfo.passcodeLength ?? 4}
          onVerifyPasscode={verifyPasscode}
        />
      </div>
    )
  }

  if (page === 'locked') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <VaultLockScreen
          lockInfo={lockInfo ?? { state: 'locked', primaryMethods: [], passcodeEnabled: true, passcodeSet: false, masterPasswordSet: false, autoLockMinutes: 15, safeStorageAvailable: false }}
          onUnlockWithHello={unlockWithHello}
          onUnlockWithPassword={unlockWithPassword}
        />
      </div>
    )
  }

  if (page === 'passcode') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <PasscodeScreen
          passcodeLength={lockInfo?.passcodeLength ?? 4}
          onVerifyPasscode={verifyPasscode}
        />
      </div>
    )
  }

  if (page === 'set-passcode') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <PasscodeSetupScreen onSubmit={submitSetPasscode} onCancel={() => void goBackOrClose()} />
      </div>
    )
  }

  if (page === 'set-master-password') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <MasterPasswordSetupScreen onSubmit={submitSetMasterPassword} onCancel={() => void goBackOrClose()} />
      </div>
    )
  }

  if (page === 'confirm-passcode-removal') {
    return (
      <div className="flex h-full min-h-full flex-col bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
        <PasscodeConfirmScreen
          title="Confirm passcode to turn it off"
          passcodeLength={lockInfo?.passcodeLength ?? 4}
          onSubmit={confirmPasscodeRemoval}
          onCancel={() => void goBackOrClose()}
        />
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full min-h-full flex-col overflow-hidden bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]"
      onMouseMove={() => {
        if (!pointerActive) {
          setPointerActive(true)
        }
      }}
    >
      <div className="flex items-center gap-4 px-5 pt-4 pb-3">
        {page === 'home' ? (
          <SearchBar
            query={query}
            onChange={(value) => {
              void setTrailingText(value)
            }}
            onRemoveToken={(tokenId) => {
              const token = query.tokens.find((candidate) => candidate.id === tokenId)
              if (token) {
                removeToken(token)
              }
            }}
            onBackspaceEmpty={() => {
              const token = query.tokens[query.tokens.length - 1]
              if (token) {
                removeToken(token)
              }
            }}
            onMoveSelection={moveSelection}
            onEnter={() => {
              void executeSelection()
            }}
          />
        ) : page === 'settings' ? (
          <HeaderRow
            title="Settings"
            onBack={() => {
              resetSettingsChrome()
              void goBackOrClose()
            }}
            showIcon={false}
          />
        ) : page === 'dev' ? (
          <HeaderRow
            title="Developer Options"
            onBack={() => void goBackOrClose()}
            showIcon={false}
          />
        ) : page === 'export' ? (
          <HeaderRow
            title="Export vault"
            onBack={() => void goBackOrClose()}
            showIcon={false}
          />
        ) : page === 'import' ? (
          <HeaderRow
            title="Import vault"
            onBack={() => void goBackOrClose()}
            showIcon={false}
          />
        ) : page === 'form' ? (
          <HeaderRow
            title={formMode === 'edit' ? 'Edit item' : 'Create item'}
            subtitle={activeDetailItem?.itemName || createSeed.itemName || undefined}
            onBack={() => void goBackOrClose()}
            showIcon={false}
          />
        ) : (
          <HeaderRow
            title={detailAction?.title ?? 'Item'}
            subtitle={detailAction?.subtitle}
            onBack={() => void goBackOrClose()}
            showIcon={false}
          />
        )}
      </div>

      <div className="h-px bg-white/8" />

      {page === 'settings' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SettingsPage
              settings={settings ?? DEFAULT_SETTINGS}
              lockInfo={lockInfo}
              selectedIndex={selectedIndex}
              hotkeyRecording={hotkeyRecording}
              onSelectRow={setSelectedIndex}
              onPaletteShortcutPress={() => {
                setHotkeyError(undefined)
                setHotkeyRecording(true)
              }}
              onCycleClipboardClear={() =>
                void updateSettings({
                  clearClipboardSeconds: nextClipboardSeconds((settings ?? DEFAULT_SETTINGS).clearClipboardSeconds),
                })
              }
              onToggleStartup={() =>
                void updateSettings({
                  launchOnStartup: !(settings ?? DEFAULT_SETTINGS).launchOnStartup,
                })
              }
              onToggleAutoOpenMenu={() =>
                void updateSettings({
                  browserAutoOpenMenu: !(settings ?? DEFAULT_SETTINGS).browserAutoOpenMenu,
                })
              }
              onToggleAutoSubmit={() =>
                void updateSettings({
                  browserAutoSubmitLogin: !(settings ?? DEFAULT_SETTINGS).browserAutoSubmitLogin,
                })
              }
              onToggleSavePrompts={() =>
                void updateSettings({
                  browserSavePrompts: !(settings ?? DEFAULT_SETTINGS).browserSavePrompts,
                })
              }
              onCycleAutoLock={() =>
                void updateSettings({
                  autoLockMinutes: nextAutoLockMinutes((settings ?? DEFAULT_SETTINGS).autoLockMinutes),
                })
              }
              onTogglePasscode={() =>
                !lockInfo?.passcodeSet
                  ? openSetPasscodePage()
                  : (settings ?? DEFAULT_SETTINGS).passcodeEnabled
                    ? openConfirmPasscodeRemovalPage()
                    : openSetPasscodePage()
              }
              onSetPasscode={() => {
                openSetPasscodePage()
              }}
              onSetupMasterPassword={() => {
                openSetMasterPasswordPage()
              }}
              onToggleSshAgent={() =>
                void updateSettings({
                  sshAgentEnabled: !(settings ?? DEFAULT_SETTINGS).sshAgentEnabled,
                })
              }
              onExportVault={() => {
                usePaletteStore.setState({ page: 'export', selectedIndex: 0, execution: undefined })
              }}
              onImportVault={() => {
                usePaletteStore.setState({ page: 'import', selectedIndex: 0, execution: undefined })
              }}
              pointerActive={pointerActive}
            />
          </div>
          <div className="h-px bg-white/8" />
          <div
            className={`flex shrink-0 items-center justify-between gap-4 px-5 py-3 text-[14px] ${settingsFooter.barClass}`}
          >
            <span className={`min-w-0 leading-snug ${settingsFooter.primaryClass}`}>{settingsFooter.primary}</span>
            <div className="flex shrink-0 items-center gap-2">
              {lockWarningText ? <span className="rounded-[7px] bg-red-500/18 px-2 py-1 text-[12px] text-red-200">{lockWarningText}</span> : null}
              {settingsFooter.keyHints.map((hint) => (
                <KeyHint key={hint}>{hint}</KeyHint>
              ))}
            </div>
          </div>
        </>
      ) : page === 'dev' ? (
        <DevPanel />
      ) : page === 'export' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FormatPickerPage
              title="Choose format"
              options={[
                { id: 'klarkey-json', label: 'Klarkey JSON', description: 'Full backup with all data' },
                { id: 'csv', label: 'CSV', description: 'Standard spreadsheet format' },
              ]}
              selectedIndex={selectedIndex}
              onSelectRow={setSelectedIndex}
              onPick={(id) => void exportVault(id as 'klarkey-json' | 'csv')}
              pointerActive={pointerActive}
            />
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
            <span className="text-white/48">Enter exports your vault in the selected format.</span>
            <div className="flex items-center gap-2">
              <KeyHint>Esc</KeyHint>
            </div>
          </div>
        </>
      ) : page === 'import' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FormatPickerPage
              title="Choose source"
              options={[
                { id: 'auto', label: 'Auto-detect', description: 'Best for most files' },
                { id: '1pux', label: '1Password (.1pux)', description: '1Password export' },
                { id: 'bitwarden-json', label: 'Bitwarden (.json)', description: 'Bitwarden export' },
                { id: 'dashlane-json', label: 'Dashlane (.json)', description: 'Dashlane export' },
                { id: 'csv', label: 'Generic CSV', description: 'Standard CSV format' },
                { id: 'lastpass-csv', label: 'LastPass (.csv)', description: 'LastPass export' },
                { id: 'dashlane-csv', label: 'Dashlane (.csv)', description: 'Dashlane CSV export' },
                { id: 'chrome-csv', label: 'Chrome / Edge (.csv)', description: 'Browser password export' },
              ]}
              selectedIndex={selectedIndex}
              onSelectRow={setSelectedIndex}
              onPick={(id) => void importVault(id as 'auto' | 'klarkey-json' | 'csv' | '1pux' | 'bitwarden-json' | 'lastpass-csv' | 'dashlane-csv' | 'dashlane-json' | 'chrome-csv')}
              pointerActive={pointerActive}
            />
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
            <span className="text-white/48">Enter imports items from the selected source.</span>
            <div className="flex items-center gap-2">
              <KeyHint>Esc</KeyHint>
            </div>
          </div>
        </>
      ) : page === 'import-loading' ? (
        <ImportLoadingPage
          message="Importing your items…"
          submessage="This may take a moment"
        />
      ) : page === 'detail' ? (
        <>
          <ItemDetailOverview item={activeDetailItem} />
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-1">
              {detailActions.map((action, index) => (
                <DetailRow
                  key={action.id}
                  action={action}
                  pointerActive={pointerActive}
                  selected={index === selectedIndex}
                  onHover={() => {
                    setPendingDeleteConfirm(false)
                    setSelectedIndex(index)
                  }}
                />
              ))}
            </div>
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
            <span className={execution?.secret ? 'inline-flex items-center gap-3' : undefined}>
              {deleteConfirmActive ? (
                <span className="inline-flex items-center gap-2 text-red-200/86">
                  <span>Are you sure? Click</span>
                  <ReturnHint />
                  <span>to confirm</span>
                </span>
               ) : footerOtp ? (
                 <FooterOtpStatus otp={footerOtp} />
               ) : (
                 <>
                   <span>{footerMessage ?? selectedDetailAction?.title ?? detailAction?.title ?? 'Select an action.'}</span>
                 </>
              )}
            </span>
            <div className="flex items-center gap-2">
              {lockWarningText ? <span className="rounded-[7px] bg-red-500/18 px-2 py-1 text-[12px] text-red-200">{lockWarningText}</span> : null}
              <KeyHint>Esc</KeyHint>
            </div>
          </div>
        </>
      ) : page === 'form' ? (
        <ItemFormPage
          key={`${formMode ?? 'create'}:${detailAction?.itemId ?? 'new'}:${detailItem?.itemId ?? 'blank'}:${createItemType}`}
          mode={formMode ?? 'create'}
          loading={formLoading}
          initialValue={createFormValues(formMode === 'edit' ? formItemType : createItemType, formMode === 'edit' ? activeDetailItem : createSeed)}
          existingOtp={activeDetailItem?.otp}
          execution={execution}
          onAutoSave={(value) => {
            if (formMode !== 'edit' || !detailAction?.itemId) {
              return Promise.resolve(undefined)
            }

            const update: UpdateItemInput = {
              itemId: detailAction.itemId,
              ...cleanFormValue(value),
            }

            return submitEditForm(update)
          }}
          onSubmit={(value) => {
            const payload = cleanFormValue(value)

            if (formMode === 'edit' && detailAction?.itemId) {
              const update: UpdateItemInput = {
                itemId: detailAction.itemId,
                ...payload,
              }
              void submitEditForm(update)
              return
            }

            void submitCreateForm(payload)
          }}
        />
      ) : (
        <>
          <div className="px-5 py-3 text-[13px] text-white/34">{query.raw ? 'Results' : 'Suggestions'}</div>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
            onScroll={(event) => {
              const target = event.currentTarget
              const remaining = target.scrollHeight - target.scrollTop - target.clientHeight

              if (remaining < 96) {
                void loadMoreActions()
              }
            }}
          >
            <div className="space-y-1">
              {actions.map((action, index) => (
                <ResultRow
                  key={action.id}
                  action={action}
                  pointerActive={pointerActive}
                  selected={index === selectedIndex}
                  onHover={() => setSelectedIndex(index)}
                />
              ))}
              {isLoadingMore ? <div className="px-3 py-3 text-[13px] text-white/34">Loading more…</div> : null}
              {!isLoadingMore && hasMoreResults ? <div className="px-3 py-3 text-[13px] text-white/24">Scroll for more</div> : null}
            </div>
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
            <span className={execution?.secret ? 'font-mono text-white/78' : undefined}>
              {footerMessage ?? selection?.primaryHint ?? 'Type an item or action.'}
            </span>
            <div className="flex items-center gap-2">
              {lockWarningText ? <span className="rounded-[7px] bg-red-500/18 px-2 py-1 text-[12px] text-red-200">{lockWarningText}</span> : null}
              <KeyHint>Esc</KeyHint>
            </div>
          </div>
        </>
      )}

    </div>
  )
}

export default App
