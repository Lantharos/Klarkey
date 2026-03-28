import { create } from 'zustand'
import { composeCommandRaw } from '@/shared/command'
import type { KlarkeyApi } from '@/shared/ipc'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type CommandQuery,
  type CreateIdentityInput,
  type ModifierKey,
  type ResolvedAction,
  type SettingsUpdate,
  type UpdateIdentityInput,
  type UserSettings,
} from '@/shared/types'

const fallbackApi: KlarkeyApi = {
  palette: {
    open: async () => undefined,
    close: async () => undefined,
  },
  command: {
    parse: async (raw) => ({ raw, intent: 'search', tokens: [], trailingText: raw }),
  },
  search: {
    resolve: async () => ({ actions: [], locked: false }),
  },
  action: {
    execute: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
  },
  item: {
    get: async () => undefined,
    create: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    update: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    delete: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
  },
  vault: {
    unlock: async () => ({ status: 'success', title: 'Ready', message: 'Vault unlocked.' }),
  },
  settings: {
    get: async () => DEFAULT_SETTINGS,
    set: async () => DEFAULT_SETTINGS,
  },
  onPrepareOpen: () => () => undefined,
  onFocusRequest: () => () => undefined,
}

const api = window.klarkey ?? fallbackApi

interface PaletteState {
  hydrated: boolean
  isLoadingResults: boolean
  bootError?: string
  execution?: ActionExecutionResult
  page: 'home' | 'settings' | 'detail' | 'form'
  query: CommandQuery
  actions: ResolvedAction[]
  selectedIndex: number
  detailAction?: ResolvedAction
  formMode?: 'create' | 'edit'
  settings?: UserSettings
  boot: () => Promise<void>
  primeHome: () => void
  resetToHome: () => Promise<void>
  refresh: (raw: string) => Promise<void>
  setTrailingText: (value: string) => Promise<void>
  removeToken: (token: CommandQuery['tokens'][number]) => void
  moveSelection: (delta: number) => void
  setSelectedIndex: (index: number) => void
  executeSelection: () => Promise<void>
  executeAction: (actionId: string, modifier: ModifierKey) => Promise<ActionExecutionResult | undefined>
  openCreateForm: () => void
  openEditForm: () => void
  submitCreateForm: (input: CreateIdentityInput) => Promise<ActionExecutionResult | undefined>
  submitEditForm: (input: UpdateIdentityInput) => Promise<ActionExecutionResult | undefined>
  deleteCurrentItem: () => Promise<ActionExecutionResult | undefined>
  goBackOrClose: () => Promise<void>
  closePalette: () => Promise<void>
  unlockVault: () => Promise<void>
  focusInput: () => void
  updateSettings: (update: SettingsUpdate) => Promise<void>
}

const defaultQuery: CommandQuery = {
  raw: '',
  intent: 'search',
  tokens: [],
  trailingText: '',
}

export const usePaletteStore = create<PaletteState>((set, get) => ({
  hydrated: false,
  isLoadingResults: false,
  bootError: undefined,
  execution: undefined,
  page: 'home',
  query: defaultQuery,
  actions: [],
  selectedIndex: 0,
  detailAction: undefined,
  formMode: undefined,
  settings: DEFAULT_SETTINGS,
  async boot() {
    try {
      const settings = await api.settings.get()
      set({
        settings,
        page: 'home',
        detailAction: undefined,
        formMode: undefined,
        execution: undefined,
        query: defaultQuery,
        actions: [],
        selectedIndex: 0,
        isLoadingResults: true,
      })
      const response = await api.search.resolve(defaultQuery)
      set({ actions: response.actions, isLoadingResults: false })
      set({ hydrated: true, bootError: undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Klarkey failed to boot.'
      console.error('Klarkey boot failed', error)
      set({ bootError: message, isLoadingResults: false })
    }
  },
  primeHome() {
    set({
      page: 'home',
      query: defaultQuery,
      actions: [],
      selectedIndex: 0,
      detailAction: undefined,
      formMode: undefined,
      execution: undefined,
      isLoadingResults: true,
    })
  },
  async resetToHome() {
    get().primeHome()
    try {
      const response = await api.search.resolve(defaultQuery)
      set({ actions: response.actions, isLoadingResults: false })
    } catch {
      set({ isLoadingResults: false })
    }
  },
  async refresh(raw) {
    const query = await api.command.parse(raw)
    const previousActions = get().actions
    set({
      page: 'home',
      query,
      actions: previousActions,
      selectedIndex: 0,
      detailAction: undefined,
      formMode: undefined,
      execution: undefined,
      isLoadingResults: true,
    })
    try {
      const response = await api.search.resolve(query)
      set({
        actions: response.actions,
        isLoadingResults: false,
      })
    } catch {
      set({ isLoadingResults: false })
    }
  },
  async setTrailingText(value) {
    const current = get().query
    const raw = [...current.tokens.map((token) => token.value), value].filter(Boolean).join(' ')
    await get().refresh(raw)
  },
  removeToken(token) {
    const nextTokens = get().query.tokens.filter((candidate) => candidate.id !== token.id)
    void get().refresh(composeCommandRaw({ tokens: nextTokens, trailingText: '' }))
  },
  moveSelection(delta) {
    const items = get().page === 'home' ? get().actions.length : 0

    if (items === 0) {
      return
    }

    const nextIndex = (get().selectedIndex + delta + items) % items
    set({ selectedIndex: nextIndex, execution: undefined })
  },
  setSelectedIndex(index) {
    set({ selectedIndex: index, execution: undefined })
  },
  async executeSelection() {
    const action = get().actions[get().selectedIndex]
    if (!action) {
      return
    }

    if (action.kind === 'open-settings') {
      set({ page: 'settings', selectedIndex: 0, execution: undefined })
      return
    }

    if (action.kind === 'create-login') {
      set({ page: 'form', formMode: 'create', detailAction: action, selectedIndex: 0, execution: undefined })
      return
    }

    if (
      action.id.startsWith('paste-') ||
      action.kind === 'copy-password' ||
      action.kind === 'show-password' ||
      action.kind === 'show-otp' ||
      action.kind === 'copy-otp'
    ) {
      await get().executeAction(action.id, 'none')
      return
    }

    set({ page: 'detail', detailAction: action, selectedIndex: 0, formMode: undefined, execution: undefined })
  },
  async executeAction(actionId, modifier) {
    const execution = await api.action.execute(actionId, modifier)
    set({ execution })
    return execution
  },
  openCreateForm() {
    set({ page: 'form', formMode: 'create', selectedIndex: 0, execution: undefined })
  },
  openEditForm() {
    if (!get().detailAction?.identityId) {
      return
    }

    set({ page: 'form', formMode: 'edit', selectedIndex: 0, execution: undefined })
  },
  async submitCreateForm(input) {
    const execution = await api.item.create(input)
    await get().refresh('')
    return execution
  },
  async submitEditForm(input) {
    const execution = await api.item.update(input)
    if (execution.status !== 'error') {
      const currentDetailAction = get().detailAction
      if (currentDetailAction?.identityId === input.identityId) {
        const title = input.itemName?.trim() || currentDetailAction.title
        const username = input.username?.trim() || ''
        const subtitle = username || currentDetailAction.subtitle

        set({
          detailAction: {
            ...currentDetailAction,
            title,
            subtitle,
          },
          execution,
        })
      } else {
        set({ execution })
      }
      return execution
    }

    set({ execution })
    return execution
  },
  async deleteCurrentItem() {
    const identityId = get().detailAction?.identityId
    if (!identityId) {
      return undefined
    }

    const execution = await api.item.delete(identityId)
    if (execution.status !== 'error') {
      await get().refresh('')
    }
    return execution
  },
  async goBackOrClose() {
    const { page, query, formMode } = get()

    if (page === 'form') {
      if (formMode === 'create') {
        set({
          page: 'home',
          selectedIndex: 0,
          detailAction: undefined,
          formMode: undefined,
          execution: undefined,
        })
        return
      }

      set({ page: 'detail', selectedIndex: 0, formMode: undefined, execution: undefined })
      return
    }

    if (page === 'detail') {
      set({ page: 'home', detailAction: undefined, selectedIndex: 0, formMode: undefined, execution: undefined })
      return
    }

    if (page === 'settings') {
      set({ page: 'home', selectedIndex: 0, formMode: undefined, execution: undefined })
      return
    }

    if (query.raw || query.tokens.length > 0 || query.trailingText) {
      await get().refresh('')
      return
    }

    await api.palette.close()
  },
  async closePalette() {
    await api.palette.close()
  },
  async unlockVault() {
    await api.vault.unlock()
  },
  focusInput() {
    document.querySelector('input')?.focus()
  },
  async updateSettings(update) {
    const settings = await api.settings.set(update)
    set({ settings })
  },
}))
