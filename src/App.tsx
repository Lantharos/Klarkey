import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { ItemDetailOverview } from '@/app/item-detail-overview'
import { ItemFormPage } from '@/app/item-form-page'
import { buildDetailActions } from '@/app/item-type-meta'
import {
  DetailRow,
  HeaderRow,
  KeyHint,
  ReturnHint,
  ResultRow,
  SearchBar,
  SettingsPage,
} from '@/app/palette-ui'
import type { ItemFormValues } from '@/app/palette-types'
import { createFormValues } from '@/app/palette-utils'
import { keyboardEventToAccelerator } from '@/app/hotkey-accelerator'
import { SETTINGS_FOCUSABLE_ROWS, nextClipboardSeconds } from '@/app/settings-constants'
import { usePaletteStore } from '@/app/usePaletteStore'
import { getTotpCode } from '@/shared/totp'
import {
  DEFAULT_SETTINGS,
  type CreateItemInput,
  type ExternalWindowContext,
  type ItemDetails,
  type TotpDetails,
  type UpdateItemInput,
} from '@/shared/types'

function cleanFormValue(value: ItemFormValues): CreateItemInput {
  const identityFullName = [value.firstName, value.middleName, value.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const identityAddress = [
    [value.addressLine1, value.addressLine2].map((part) => part.trim()).filter(Boolean).join(', '),
    [value.city, value.state, value.postalCode].map((part) => part.trim()).filter(Boolean).join(', '),
    value.country.trim(),
  ]
    .filter(Boolean)
    .join(', ')

  return {
    itemType: value.itemType,
    itemName: value.itemName.trim() || 'New item',
    username:
      value.itemType === 'login' || value.itemType === 'identity'
        ? value.username.trim() || undefined
        : undefined,
    password: value.itemType === 'login' ? value.password.trim() || undefined : undefined,
    otp: value.itemType === 'login' ? value.otp.trim() : undefined,
    fullName:
      value.itemType === 'identity'
        ? value.fullName.trim() || identityFullName || undefined
        : undefined,
    firstName: value.itemType === 'identity' ? value.firstName.trim() || undefined : undefined,
    middleName: value.itemType === 'identity' ? value.middleName.trim() || undefined : undefined,
    lastName: value.itemType === 'identity' ? value.lastName.trim() || undefined : undefined,
    company: value.itemType === 'identity' ? value.company.trim() || undefined : undefined,
    jobTitle: value.itemType === 'identity' ? value.jobTitle.trim() || undefined : undefined,
    birthDate: value.itemType === 'identity' ? value.birthDate.trim() || undefined : undefined,
    email: value.itemType === 'identity' ? value.email.trim() || undefined : undefined,
    phone: value.itemType === 'identity' ? value.phone.trim() || undefined : undefined,
    address:
      value.itemType === 'identity'
        ? value.address.trim() || identityAddress || undefined
        : undefined,
    addressLine1: value.itemType === 'identity' ? value.addressLine1.trim() || undefined : undefined,
    addressLine2: value.itemType === 'identity' ? value.addressLine2.trim() || undefined : undefined,
    city: value.itemType === 'identity' ? value.city.trim() || undefined : undefined,
    state: value.itemType === 'identity' ? value.state.trim() || undefined : undefined,
    postalCode: value.itemType === 'identity' ? value.postalCode.trim() || undefined : undefined,
    country: value.itemType === 'identity' ? value.country.trim() || undefined : undefined,
    cardholderName: value.itemType === 'card' ? value.cardholderName.trim() || undefined : undefined,
    cardNumber: value.itemType === 'card' ? value.cardNumber.replace(/\s+/g, '').trim() || undefined : undefined,
    cardExpiry:
      value.itemType === 'card'
        ? value.cardExpiry.trim() ||
          (value.cardExpiryMonth.trim() && value.cardExpiryYear.trim()
            ? `${value.cardExpiryMonth.trim()}/${value.cardExpiryYear.trim()}`
            : undefined)
        : undefined,
    cardExpiryMonth: value.itemType === 'card' ? value.cardExpiryMonth.trim() || undefined : undefined,
    cardExpiryYear: value.itemType === 'card' ? value.cardExpiryYear.trim() || undefined : undefined,
    cardCvc: value.itemType === 'card' ? value.cardCvc.trim() || undefined : undefined,
    cardBrand: value.itemType === 'card' ? value.cardBrand.trim() || undefined : undefined,
    billingPostalCode: value.itemType === 'card' ? value.billingPostalCode.trim() || undefined : undefined,
    content: value.itemType === 'note' ? value.content.trim() || undefined : undefined,
    notes: value.itemType !== 'note' ? value.notes.trim() || undefined : undefined,
    websites: value.itemType === 'login' ? value.websites.map((website) => website.trim()).filter(Boolean) : [],
    customFields:
      value.itemType !== 'note'
        ? value.customFields
            .map((field) => ({
              ...field,
              label: field.label.trim(),
              value: field.value.trim(),
            }))
            .filter((field) => field.label || field.value)
        : [],
  }
}

function FooterOtpStatus({ otp }: { otp: TotpDetails }) {
  const [now, setNow] = useState(() => Date.now())
  const code = useMemo(() => getTotpCode(otp, now), [now, otp])
  const warning = code.remainingSeconds <= 5
  const size = 20
  const stroke = 2.25
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * code.progress

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="inline-flex items-center gap-3">
      <span className={warning ? 'font-mono text-red-200' : 'font-mono text-white/78'}>{code.value}</span>
      <div className="relative flex h-5 w-5 items-center justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={warning ? 'rgba(248, 113, 113, 0.95)' : 'rgba(255,255,255,0.72)'}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <span className={warning ? 'absolute text-[9px] font-medium leading-none text-red-200' : 'absolute text-[9px] font-medium leading-none text-white/56'}>
          {code.remainingSeconds}
        </span>
      </div>
    </div>
  )
}

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

  const [detailItem, setDetailItem] = useState<ItemDetails>()
  const [pointerActive, setPointerActive] = useState(false)
  const [pendingDeleteConfirm, setPendingDeleteConfirm] = useState(false)
  const [hotkeyRecording, setHotkeyRecording] = useState(false)
  const [hotkeyError, setHotkeyError] = useState<string | undefined>()
  const [targetWindow, setTargetWindow] = useState<ExternalWindowContext>()
  const selection = actions[selectedIndex]
  const activeDetailItem = detailAction?.itemId === detailItem?.itemId ? detailItem : undefined
  const detailActions = useMemo(() => buildDetailActions(activeDetailItem, targetWindow), [activeDetailItem, targetWindow])
  const selectedDetailAction = detailActions[selectedIndex]
  const formLoading = page === 'form' && formMode === 'edit' && Boolean(detailAction?.itemId) && !activeDetailItem
  const createItemType =
    detailAction?.itemType && detailAction.itemType !== 'ssh-key'
      ? detailAction.itemType
      : query.entryType && query.entryType !== 'ssh-key'
        ? query.entryType
        : 'login'
  const formItemType =
    activeDetailItem?.itemType && activeDetailItem.itemType !== 'ssh-key' ? activeDetailItem.itemType : createItemType
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
    }
    return {
      barClass: '',
      primary: byRow[selectedIndex] ?? 'Choose a row to see what Enter does.',
      primaryClass: 'text-white/48',
      keyHints: ['↑↓', 'Enter', 'Esc'],
    }
  }, [hotkeyError, hotkeyRecording, selectedIndex])

  const resetSettingsChrome = useCallback(() => {
    setHotkeyRecording(false)
    setHotkeyError(undefined)
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    void window.klarkey.targetWindow.get().then((context) => {
      setTargetWindow(context)
    })

    return window.klarkey.onTargetWindowChange((context) => {
      setTargetWindow(context)
    })
  }, [])

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    return window.klarkey.onPrepareOpen(() => {
      setPointerActive(false)
      setPendingDeleteConfirm(false)
      resetSettingsChrome()
      setDetailItem(undefined)
      primeHome()
      focusInput()
      void resetToHome()
    })
  }, [focusInput, primeHome, resetSettingsChrome, resetToHome])

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
      }
    },
    [settings, updateSettings],
  )

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
        setSelectedIndex((current + 1) % SETTINGS_FOCUSABLE_ROWS)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const { selectedIndex: current, setSelectedIndex } = usePaletteStore.getState()
        setSelectedIndex((current - 1 + SETTINGS_FOCUSABLE_ROWS) % SETTINGS_FOCUSABLE_ROWS)
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

  useEffect(() => {
    if ((page !== 'detail' && page !== 'form') || !detailAction?.itemId) {
      return
    }

    void window.klarkey?.item.get(detailAction.itemId).then((item) => {
      setDetailItem(item)
    })
  }, [detailAction?.itemId, execution?.itemId, page])

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
    setSelectedIndex,
  ])

  if (!hydrated) {
    return (
      <div className="flex h-full min-h-full items-center justify-center px-6 py-5 text-white">
        <div className="text-[15px] text-white/72">
          {bootError ? `Klarkey could not finish loading. ${bootError}` : 'Starting Klarkey...'}
        </div>
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
                  pointerActive={pointerActive}
                />
              </div>
              <div className="h-px bg-white/8" />
              <div
                className={`flex shrink-0 items-center justify-between gap-4 px-5 py-3 text-[14px] ${settingsFooter.barClass}`}
              >
                <span className={`min-w-0 leading-snug ${settingsFooter.primaryClass}`}>{settingsFooter.primary}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {settingsFooter.keyHints.map((hint) => (
                    <KeyHint key={hint}>{hint}</KeyHint>
                  ))}
                </div>
              </div>
            </>
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
                  <KeyHint>Esc</KeyHint>
                </div>
              </div>
            </>
          )}
    </div>
  )
}

export default App
