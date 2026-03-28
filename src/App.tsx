import { KeyRound, Pencil, ShieldCheck, Trash2, User } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  DetailRow,
  HeaderRow,
  KeyHint,
  ReturnHint,
  ResultRow,
  SearchBar,
  SettingsPage,
} from '@/app/palette-ui'
import { ItemFormPage } from '@/app/item-form-page'
import type { DetailAction, ItemFormValues } from '@/app/palette-types'
import { createFormValues } from '@/app/palette-utils'
import { usePaletteStore } from '@/app/usePaletteStore'
import { DEFAULT_SETTINGS, type CreateIdentityInput, type ItemDetails, type UpdateIdentityInput } from '@/shared/types'

function detailActionsFor(identityId?: string): DetailAction[] {
  if (!identityId) {
    return []
  }

  return [
    {
      id: 'insert-username',
      title: 'Insert username',
      icon: User,
      actionId: `paste-username:${identityId}`,
    },
    {
      id: 'insert-password',
      title: 'Insert password',
      icon: KeyRound,
      actionId: `paste-password:${identityId}`,
    },
    {
      id: 'copy-username',
      title: 'Copy username',
      icon: User,
      modifier: 'none',
    },
    {
      id: 'copy-password',
      title: 'Copy password',
      icon: KeyRound,
      modifier: 'control',
    },
    {
      id: 'show-password',
      title: 'Show password',
      icon: ShieldCheck,
      modifier: 'alt',
    },
    {
      id: 'edit-item',
      title: 'Edit item',
      icon: Pencil,
      tone: 'success',
    },
    {
      id: 'delete-item',
      title: 'Delete item',
      icon: Trash2,
      tone: 'danger',
    },
  ]
}

function cleanFormValue(value: ItemFormValues) {
  const payload = {
    serviceName: value.serviceName.trim() || 'New item',
    username: value.username.trim() || undefined,
    password: value.password.trim() || undefined,
    notes: value.notes.trim() || undefined,
    websites: value.websites.map((website) => website.trim()).filter(Boolean),
    customFields: value.customFields
      .map((field) => ({
        ...field,
        label: field.label.trim(),
        value: field.value.trim(),
      }))
      .filter((field) => field.label || field.value),
  }

  return payload
}

function App() {
  const hydrated = usePaletteStore((state) => state.hydrated)
  const bootError = usePaletteStore((state) => state.bootError)
  const isLoadingResults = usePaletteStore((state) => state.isLoadingResults)
  const page = usePaletteStore((state) => state.page)
  const formMode = usePaletteStore((state) => state.formMode)
  const query = usePaletteStore((state) => state.query)
  const actions = usePaletteStore((state) => state.actions)
  const selectedIndex = usePaletteStore((state) => state.selectedIndex)
  const detailAction = usePaletteStore((state) => state.detailAction)
  const execution = usePaletteStore((state) => state.execution)
  const settings = usePaletteStore((state) => state.settings)
  const boot = usePaletteStore((state) => state.boot)
  const resetToHome = usePaletteStore((state) => state.resetToHome)
  const focusInput = usePaletteStore((state) => state.focusInput)
  const setTrailingText = usePaletteStore((state) => state.setTrailingText)
  const removeToken = usePaletteStore((state) => state.removeToken)
  const moveSelection = usePaletteStore((state) => state.moveSelection)
  const executeSelection = usePaletteStore((state) => state.executeSelection)
  const executeAction = usePaletteStore((state) => state.executeAction)
  const setSelectedIndex = usePaletteStore((state) => state.setSelectedIndex)
  const updateSettings = usePaletteStore((state) => state.updateSettings)
  const goBackOrClose = usePaletteStore((state) => state.goBackOrClose)
  const openEditForm = usePaletteStore((state) => state.openEditForm)
  const submitCreateForm = usePaletteStore((state) => state.submitCreateForm)
  const submitEditForm = usePaletteStore((state) => state.submitEditForm)
  const deleteCurrentItem = usePaletteStore((state) => state.deleteCurrentItem)

  const [formSeed, setFormSeed] = useState<Partial<ItemDetails>>({})
  const selection = actions[selectedIndex]
  const detailActions = useMemo(() => detailActionsFor(detailAction?.identityId), [detailAction?.identityId])
  const selectedDetailAction = detailActions[selectedIndex]
  const formLoading = page === 'form' && formMode === 'edit' && Boolean(detailAction?.identityId) && !formSeed.identityId
  const createSeed = useMemo(
    () => ({
      serviceName: query.serviceQuery ?? detailAction?.title.replace(/^Create\s+/i, '') ?? '',
      username: query.identityQuery ?? '',
      password: '',
      notes: '',
      websites: [''],
      customFields: [],
    }),
    [detailAction?.title, query.identityQuery, query.serviceQuery],
  )
  const footerMessage = execution?.secret ?? execution?.message

  useEffect(() => {
    void boot()
  }, [boot])

  useEffect(() => {
    if (!window.klarkey) {
      return undefined
    }

    return window.klarkey.onFocusRequest(() => {
      void resetToHome()
      focusInput()
    })
  }, [focusInput, resetToHome])

  useEffect(() => {
    if (page === 'home') {
      focusInput()
    }
  }, [focusInput, page])

  useEffect(() => {
    if (page !== 'form') {
      return
    }

    if (formMode === 'edit' && detailAction?.identityId) {
      void window.klarkey?.item
        .get(detailAction.identityId)
        .then((item) => {
          setFormSeed(item ?? {})
        })
      return
    }

  }, [detailAction, formMode, page])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        void goBackOrClose()
        return
      }

      const target = event.target
      const isInputTarget = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      if (isInputTarget) {
        return
      }

      if (page !== 'detail') {
        return
      }

      if (detailActions.length === 0) {
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((selectedIndex + 1 + detailActions.length) % detailActions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
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
        void deleteCurrentItem()
        return
      }

      if (selectedDetailAction.id === 'copy-username' && detailAction?.id) {
        void executeAction(detailAction.id, 'none')
        return
      }

      if ((selectedDetailAction.id === 'copy-password' || selectedDetailAction.id === 'show-password') && detailAction?.id) {
        void executeAction(detailAction.id, selectedDetailAction.modifier ?? 'none')
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
    detailAction,
    detailActions.length,
    executeAction,
    goBackOrClose,
    openEditForm,
    page,
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
    <div className="relative flex h-full min-h-full flex-col overflow-hidden bg-[#1a1a1b]/92 text-white backdrop-blur-[22px]">
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
          <HeaderRow title="Settings" subtitle="Preferences" onBack={() => void goBackOrClose()} />
        ) : page === 'form' ? (
          <HeaderRow
            title={formMode === 'edit' ? 'Edit item' : 'Create item'}
            subtitle={formSeed.serviceName || undefined}
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
            onToggleDemo={() =>
              void updateSettings({
                demoDataEnabled: !(settings ?? DEFAULT_SETTINGS).demoDataEnabled,
              })
            }
            onToggleStartup={() =>
              void updateSettings({
                launchOnStartup: !(settings ?? DEFAULT_SETTINGS).launchOnStartup,
              })
            }
            onTimeoutChange={(seconds) => void updateSettings({ clearClipboardSeconds: seconds })}
          />
        </div>
      ) : page === 'detail' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-1">
              {detailActions.map((action, index) => (
                <DetailRow
                  key={action.id}
                  action={action}
                  selected={index === selectedIndex}
                  onHover={() => setSelectedIndex(index)}
                />
              ))}
            </div>
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
            <span className={execution?.secret ? 'font-mono text-white/78' : undefined}>
              {footerMessage ?? selectedDetailAction?.title ?? detailAction?.title ?? 'Select an action.'}
            </span>
            <div className="flex items-center gap-2">
              <KeyHint>Esc</KeyHint>
              <ReturnHint />
            </div>
          </div>
        </>
      ) : page === 'form' ? (
        <ItemFormPage
          key={`${formMode ?? 'create'}:${detailAction?.identityId ?? 'new'}:${formSeed.identityId ?? 'blank'}`}
          mode={formMode ?? 'create'}
          loading={formLoading}
          initialValue={createFormValues(formMode === 'edit' ? formSeed : createSeed)}
          onAutoSave={(value) => {
            if (formMode !== 'edit' || !detailAction?.identityId) {
              return Promise.resolve(undefined)
            }

            const update: UpdateIdentityInput = {
              identityId: detailAction.identityId,
              ...cleanFormValue(value),
            }

            return submitEditForm(update)
          }}
          onSubmit={(value) => {
            const payload = cleanFormValue(value)

            if (formMode === 'edit' && detailAction?.identityId) {
              const update: UpdateIdentityInput = {
                identityId: detailAction.identityId,
                ...payload,
              }
              void submitEditForm(update)
              return
            }

            const create: CreateIdentityInput = payload
            void submitCreateForm(create)
          }}
        />
      ) : (
        <>
          <div className="px-5 py-3 text-[13px] text-white/34">{query.raw ? 'Results' : 'Suggestions'}</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {isLoadingResults ? (
              <div className="flex h-full items-start px-2 py-2">
                <div className="rounded-[10px] px-3 py-3 text-[14px] text-white/42">Loading...</div>
              </div>
            ) : (
              <div className="space-y-1">
                {actions.map((action, index) => (
                  <ResultRow
                    key={action.id}
                    action={action}
                    selected={index === selectedIndex}
                    onHover={() => setSelectedIndex(index)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="h-px bg-white/8" />
          <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
            <span className={execution?.secret ? 'font-mono text-white/78' : undefined}>
              {footerMessage ?? (isLoadingResults ? 'Refreshing...' : selection?.primaryHint ?? 'Type a service or action.')}
            </span>
            <div className="flex items-center gap-2">
              <KeyHint>Esc</KeyHint>
              <ReturnHint />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default App

