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
import { usePaletteStore } from '@/app/usePaletteStore'
import { getTotpCode } from '@/shared/totp'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type CreateItemInput,
  type ExternalWindowContext,
  type ItemDetails,
  type PasskeySupport,
  type TotpDetails,
  type UpdateItemInput,
  type VaultPasskeyRecord,
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
  const [passkeySupport, setPasskeySupport] = useState<PasskeySupport>()
  const [vaultPasskeys, setVaultPasskeys] = useState<VaultPasskeyRecord[]>([])
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyExecution, setPasskeyExecution] = useState<ActionExecutionResult>()
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
      email: '',
      phone: '',
      address: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
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

  const refreshPasskeys = useCallback(async () => {
    if (!window.klarkey) {
      return
    }

    const [support, passkeys] = await Promise.all([
      window.klarkey.passkeys.getSupport(),
      window.klarkey.passkeys.list(),
    ])

    setPasskeySupport(support)
    setVaultPasskeys(passkeys)
  }, [])

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshPasskeys()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshPasskeys])

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
      setDetailItem(undefined)
      primeHome()
      focusInput()
      void resetToHome()
    })
  }, [focusInput, primeHome, resetToHome])

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
        if (deleteConfirmActive) {
          setPendingDeleteConfirm(false)
          return
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
    openEditForm,
    page,
    pendingDeleteConfirm,
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
      <div className="flex items-center gap-4 px-5 pb-3 pt-4">
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
          <HeaderRow title="Settings" subtitle="Preferences" onBack={() => void goBackOrClose()} showIcon={false} />
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SettingsPage
                settings={settings ?? DEFAULT_SETTINGS}
                passkeySupport={passkeySupport}
                passkeys={vaultPasskeys}
                passkeyBusy={passkeyBusy}
                passkeyExecution={passkeyExecution}
                pointerActive={pointerActive}
                onToggleStartup={() =>
                  void updateSettings({
                    launchOnStartup: !(settings ?? DEFAULT_SETTINGS).launchOnStartup,
                  })
                }
                onTimeoutChange={(seconds) => void updateSettings({ clearClipboardSeconds: seconds })}
                onCreatePasskey={() => {
                  setPasskeyBusy(true)
                  setPasskeyExecution(undefined)
                  void window.klarkey?.passkeys.create().then(async (result) => {
                    setPasskeyExecution(result)
                    await refreshPasskeys()
                  }).finally(() => {
                    setPasskeyBusy(false)
                  })
                }}
                onVerifyPasskey={() => {
                  setPasskeyBusy(true)
                  setPasskeyExecution(undefined)
                  void window.klarkey?.passkeys.authenticate().then(async (result) => {
                    setPasskeyExecution(result)
                    await refreshPasskeys()
                  }).finally(() => {
                    setPasskeyBusy(false)
                  })
                }}
                onDeletePasskey={(passkeyId) => {
                  setPasskeyBusy(true)
                  setPasskeyExecution(undefined)
                  void window.klarkey?.passkeys.remove(passkeyId).then(async (result) => {
                    setPasskeyExecution(result)
                    await refreshPasskeys()
                  }).finally(() => {
                    setPasskeyBusy(false)
                  })
                }}
              />
            </div>
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
