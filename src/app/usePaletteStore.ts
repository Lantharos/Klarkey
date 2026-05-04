import { create } from 'zustand'
import { composeCommandRaw } from '@/shared/command'
import type { KlarkeyApi } from '@/shared/ipc'
import {
  DEFAULT_SETTINGS,
  type ActionExecutionResult,
  type CommandQuery,
  type CreateItemInput,
  type ModifierKey,
  type ResolvedAction,
  type SettingsUpdate,
  type UpdateItemInput,
  type UserSettings,
  type VaultLockInfo,
  type VaultOperationResult,
} from '@/shared/types'
import type { SyncStatus } from '@/shared/sync'

const searchPageSize = 20

const fallbackApi: KlarkeyApi = {
  palette: {
    open: async () => undefined,
    close: async () => undefined,
  },
  command: {
    parse: async (raw) => ({ raw, intent: 'search', tokens: [], trailingText: raw }),
  },
  search: {
    resolve: async () => ({ actions: [], locked: false, hasMore: false, nextOffset: 0 }),
  },
  action: {
    execute: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
  },
  clipboard: {
    copySecret: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
  },
  item: {
    get: async () => undefined,
    create: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    update: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    delete: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
  },
  vault: {
    unlock: async () => ({ status: 'locked', title: 'Bridge unavailable', message: 'Desktop bridge unavailable. Vault remains locked.' }),
    lockState: async () => ({ state: 'locked' as const, primaryMethods: [], passcodeEnabled: true, passcodeSet: false, passcodeLength: 4, masterPasswordSet: false, autoLockMinutes: 15, safeStorageAvailable: false }),
    unlockWithHello: async () => ({ success: false, message: 'Desktop bridge unavailable.' }),
    unlockWithPassword: async () => ({ success: false, message: 'Desktop bridge unavailable.' }),
    lock: async () => undefined,
    setupMasterPassword: async () => ({ success: false, message: 'Not available.' }),
    changeMasterPassword: async () => ({ success: false, message: 'Not available.' }),
    removeMasterPassword: async () => ({ success: false, message: 'Not available.' }),
    setPasscode: async () => ({ success: false, message: 'Not available.' }),
    removePasscode: async () => ({ success: false, message: 'Not available.' }),
    confirmPasscode: async () => ({ success: false, message: 'Not available.' }),
    verifyPasscode: async () => ({ success: false, message: 'Not available.' }),
  },
  settings: {
    get: async () => DEFAULT_SETTINGS,
    set: async () => DEFAULT_SETTINGS,
  },
  sync: {
    status: async () => fallbackSyncStatus,
    signIn: async () => fallbackSyncStatus,
    signOut: async () => fallbackSyncStatus,
    syncNow: async () => fallbackSyncStatus,
  },
  passkeys: {
    getSupport: async () => ({
      available: false,
      secureContext: false,
      platformAuthenticatorAvailable: false,
      conditionalMediationAvailable: false,
      platform: 'unknown',
      safeStorageAvailable: false,
      relyingPartyId: 'app.klarkey',
      origin: 'klarkey://app',
    }),
    list: async () => [],
    create: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    authenticate: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    save: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
    remove: async () => ({ status: 'error', title: 'Unavailable', message: 'Desktop bridge unavailable.' }),
  },
  targetWindow: {
    get: async () => undefined,
  },
  importExport: {
    exportVault: async () => ({ success: false, exportedCount: 0, message: 'Desktop bridge unavailable.' }),
    importVault: async () => ({ success: false, importedCount: 0, skippedCount: 0, errorCount: 0, message: 'Desktop bridge unavailable.' }),
    pickImportFile: async () => undefined,
    pickExportFile: async () => undefined,
  },
  onPrepareOpen: () => () => undefined,
  onFocusRequest: () => () => undefined,
  onTargetWindowChange: () => () => undefined,
  onLockStateChanged: () => () => undefined,
  onSyncChanged: () => () => undefined,
}

const fallbackSyncStatus: SyncStatus = {
  configured: false,
  signedIn: false,
  syncing: false,
  deviceId: 'unavailable',
  deviceName: 'Desktop bridge unavailable',
  conflictCount: 0,
  serverSequence: 0,
}

const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|pendingPasskeyId|private|privateKey|recovery|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

function safeClientErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback
  }

  const message = error.message.trim()
  if (!message || message.length > 160 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message)) {
    return fallback
  }

  return message
}

function syncStatusError(error: unknown): SyncStatus {
  return {
    ...fallbackSyncStatus,
    lastError: safeClientErrorMessage(error, 'Sync is unavailable.'),
  }
}

async function safeSyncStatus() {
  try {
    return await api.sync.status()
  } catch (error) {
    console.warn('Sync status unavailable:', safeClientErrorMessage(error, 'Sync is unavailable.'))
    return syncStatusError(error)
  }
}

const api = window.klarkey ?? fallbackApi
let nextResolveKey = 0
let syncListenerAttached = false
let lockListenerAttached = false

function preserveSelectedIndex(actions: ResolvedAction[], selectedActionId: string | undefined, previousIndex: number) {
  if (selectedActionId) {
    const nextIndex = actions.findIndex((action) => action.id === selectedActionId)
    if (nextIndex >= 0) {
      return nextIndex
    }
  }
  return Math.max(0, Math.min(previousIndex, Math.max(0, actions.length - 1)))
}

interface PaletteState {
  hydrated: boolean
  isLoadingResults: boolean
  isLoadingMore: boolean
  resolveKey: number
  bootError?: string
  execution?: ActionExecutionResult
  page: 'home' | 'settings' | 'detail' | 'form' | 'locked' | 'passcode' | 'dev' | 'set-passcode' | 'set-master-password' | 'confirm-passcode-removal' | 'export' | 'import' | 'import-loading' | 'recovery-codes'
  query: CommandQuery
  actions: ResolvedAction[]
  hasMoreResults: boolean
  nextOffset: number
  selectedIndex: number
  detailAction?: ResolvedAction
  formMode?: 'create' | 'edit'
  recoveryCodesMode?: 'add' | 'view'
  settings?: UserSettings
  lockInfo?: VaultLockInfo
  syncStatus?: SyncStatus
  boot: () => Promise<void>
  primeHome: () => void
  resetToHome: () => Promise<void>
  refresh: (raw: string, options?: { preserveSelection?: boolean }) => Promise<void>
  setTrailingText: (value: string) => Promise<void>
  removeToken: (token: CommandQuery['tokens'][number]) => void
  moveSelection: (delta: number) => void
  setSelectedIndex: (index: number) => void
  executeSelection: () => Promise<void>
  executeAction: (actionId: string, modifier: ModifierKey) => Promise<ActionExecutionResult | undefined>
  openCreateForm: () => void
  openEditForm: () => void
  submitCreateForm: (input: CreateItemInput) => Promise<ActionExecutionResult | undefined>
  submitEditForm: (input: UpdateItemInput) => Promise<ActionExecutionResult | undefined>
  deleteCurrentItem: () => Promise<ActionExecutionResult | undefined>
  goBackOrClose: () => Promise<void>
  closePalette: () => Promise<void>
  unlockVault: () => Promise<void>
  lockVault: () => Promise<void>
  unlockWithHello: () => Promise<VaultOperationResult>
  unlockWithPassword: (password: string) => Promise<VaultOperationResult>
  verifyPasscode: (passcode: string) => Promise<{ success: boolean; message: string }>
  setupMasterPassword: (password: string) => Promise<VaultOperationResult>
  setPasscode: (passcode: string) => Promise<VaultOperationResult>
  removePasscode: () => Promise<VaultOperationResult>
  openSetPasscodePage: () => void
  openSetMasterPasswordPage: () => void
  submitSetPasscode: (passcode: string, confirmPasscode: string) => Promise<{ success: boolean; message: string }>
  submitSetMasterPassword: (password: string, confirmPassword: string) => Promise<{ success: boolean; message: string }>
  openConfirmPasscodeRemovalPage: () => void
  confirmPasscodeRemoval: (passcode: string) => Promise<{ success: boolean; message: string }>
  openExportPage: () => void
  openImportPage: () => void
  openRecoveryCodesPage: (mode?: 'add' | 'view') => void
  submitRecoveryCodes: (codes: string[]) => Promise<ActionExecutionResult | undefined>
  updateRecoveryCodesInPlace: (codes: string[]) => Promise<ActionExecutionResult | undefined>
  focusInput: () => void
  updateSettings: (update: SettingsUpdate) => Promise<void>
  refreshSyncStatus: () => Promise<void>
  syncSignIn: () => Promise<void>
  syncSignOut: () => Promise<void>
  syncNow: () => Promise<void>
  loadMoreActions: () => Promise<void>
  exportVault: (format: 'klarkey-json' | 'csv') => Promise<{ success: boolean; message: string }>
  importVault: (format: 'auto' | 'klarkey-json' | 'csv' | '1pux' | 'bitwarden-json' | 'lastpass-csv' | 'dashlane-csv' | 'dashlane-json' | 'chrome-csv') => Promise<{ success: boolean; message: string }>
}

const defaultQuery: CommandQuery = {
  raw: '',
  intent: 'search',
  tokens: [],
  trailingText: '',
}

function lockedRendererState(lockInfo: VaultLockInfo) {
  return {
    resolveKey: ++nextResolveKey,
    lockInfo,
    page: lockInfo.state === 'passcode' ? 'passcode' as const : 'locked' as const,
    query: defaultQuery,
    actions: [],
    hasMoreResults: false,
    nextOffset: 0,
    selectedIndex: 0,
    detailAction: undefined,
    formMode: undefined,
    recoveryCodesMode: undefined,
    execution: undefined,
    isLoadingResults: false,
    isLoadingMore: false,
  }
}

export const usePaletteStore = create<PaletteState>((set, get) => ({
  hydrated: false,
  isLoadingResults: false,
  isLoadingMore: false,
  resolveKey: 0,
  bootError: undefined,
  execution: undefined,
  page: 'home',
  query: defaultQuery,
  actions: [],
  hasMoreResults: false,
  nextOffset: 0,
  selectedIndex: 0,
  detailAction: undefined,
  recoveryCodesMode: undefined,
  lockInfo: undefined,
  syncStatus: fallbackSyncStatus,
  settings: DEFAULT_SETTINGS,
  async boot() {
    if (!lockListenerAttached) {
      lockListenerAttached = true
      api.onLockStateChanged((lockInfo) => {
        if (lockInfo.state !== 'unlocked') {
          set(lockedRendererState(lockInfo))
          return
        }

        set({ lockInfo })
        if (get().page === 'locked' || get().page === 'passcode') {
          get().primeHome()
          void get().resetToHome()
        }
      })
    }

    if (!syncListenerAttached) {
      syncListenerAttached = true
      api.onSyncChanged((update) => {
        set({ syncStatus: update.status })
        if (update.returnHome && get().page === 'settings') {
          get().primeHome()
          void get().resetToHome()
          return
        }
        if (update.vaultChanged && get().page === 'home') {
          void get().refresh(get().query.raw, { preserveSelection: true })
        }
      })
    }

    try {
      const resolveKey = ++nextResolveKey
      const [settings, lockInfo, syncStatus] = await Promise.all([
        api.settings.get(),
        api.vault.lockState(),
        safeSyncStatus(),
      ])
      const startPage = lockInfo.state === 'locked' ? 'locked' as const : lockInfo.state === 'passcode' ? 'passcode' as const : 'home' as const
        set({
          resolveKey,
          settings,
          lockInfo,
          syncStatus,
          page: startPage,
          detailAction: undefined,
          formMode: undefined,
          recoveryCodesMode: undefined,
          execution: undefined,
        query: defaultQuery,
        actions: [],
        hasMoreResults: false,
        nextOffset: 0,
        selectedIndex: 0,
        isLoadingResults: true,
        isLoadingMore: false,
      })
      const response = await api.search.resolve({ query: defaultQuery, offset: 0, limit: searchPageSize })
      if (get().resolveKey !== resolveKey) {
        return
      }
      set({
        actions: response.actions,
        hasMoreResults: response.hasMore,
        isLoadingResults: false,
      })
      set({ hydrated: true, bootError: undefined })
    } catch (error) {
      const message = safeClientErrorMessage(error, 'Klarkey failed to boot.')
      console.error('Klarkey boot failed:', message)
      set({ bootError: message, isLoadingResults: false })
    }
  },
  primeHome() {
    const resolveKey = ++nextResolveKey
    set({
      resolveKey,
      page: 'home',
      query: defaultQuery,
      actions: [],
      hasMoreResults: false,
      nextOffset: 0,
      selectedIndex: 0,
      detailAction: undefined,
      formMode: undefined,
      execution: undefined,
      isLoadingResults: true,
      isLoadingMore: false,
    })
  },
  async resetToHome() {
    const resolveKey = get().resolveKey
    try {
      const response = await api.search.resolve({ query: defaultQuery, offset: 0, limit: searchPageSize })
      if (get().resolveKey !== resolveKey) {
        return
      }
      set({
        actions: response.actions,
        hasMoreResults: response.hasMore,
        nextOffset: response.nextOffset,
        isLoadingResults: false,
      })
    } catch {
      if (get().resolveKey === resolveKey) {
        set({ isLoadingResults: false })
      }
    }
  },
  async refresh(raw, options) {
    const query = await api.command.parse(raw)
    const previousActions = get().actions
    const previousHasMoreResults = get().hasMoreResults
    const previousNextOffset = get().nextOffset
    const previousIndex = get().selectedIndex
    const selectedActionId = options?.preserveSelection ? previousActions[previousIndex]?.id : undefined
    const limit = options?.preserveSelection ? Math.max(searchPageSize, previousActions.length) : searchPageSize
    const resolveKey = ++nextResolveKey
    set({
      resolveKey,
      page: 'home',
      query,
      actions: previousActions,
      hasMoreResults: options?.preserveSelection ? previousHasMoreResults : false,
      nextOffset: options?.preserveSelection ? previousNextOffset : 0,
      selectedIndex: options?.preserveSelection ? previousIndex : 0,
      detailAction: undefined,
      formMode: undefined,
      execution: undefined,
      isLoadingResults: true,
      isLoadingMore: false,
    })
    try {
      const response = await api.search.resolve({ query, offset: 0, limit })
      if (get().resolveKey !== resolveKey) {
        return
      }
      set({
        actions: response.actions,
        hasMoreResults: response.hasMore,
        nextOffset: response.nextOffset,
        selectedIndex: options?.preserveSelection
          ? preserveSelectedIndex(response.actions, selectedActionId, previousIndex)
          : get().selectedIndex,
        isLoadingResults: false,
      })
    } catch {
      if (get().resolveKey === resolveKey) {
        set({ isLoadingResults: false })
      }
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
      if (action.id === 'dev') {
        set({ page: 'dev' as const, selectedIndex: 0, execution: undefined })
        return
      }
      set({ page: 'settings', selectedIndex: 0, execution: undefined })
      return
    }

    if (action.kind === 'create-item') {
      set({ page: 'form', formMode: 'create', detailAction: action, selectedIndex: 0, execution: undefined })
      return
    }

    if (
      action.id.startsWith('paste:') ||
      action.id.startsWith('copy:') ||
      action.id.startsWith('show:') ||
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
    if (!get().detailAction?.itemId) {
      return
    }

    set({ page: 'form', formMode: 'edit', selectedIndex: 0, execution: undefined })
  },
  async submitCreateForm(input) {
    const execution = await api.item.create(input)
    if (execution.status === 'error') {
      set({ execution })
      return execution
    }

    await get().refresh('')
    set({ execution })
    return execution
  },
  async submitEditForm(input) {
    const execution = await api.item.update(input)
    if (execution.status !== 'error') {
      const currentDetailAction = get().detailAction
      const nextTitle = input.itemName?.trim()
      const nextFullName = [input.firstName, input.middleName, input.lastName]
        .map((value) => value?.trim())
        .filter(Boolean)
        .join(' ')
      const nextSubtitle =
        input.username?.trim() || input.fullName?.trim() || nextFullName || input.content?.trim() || currentDetailAction?.subtitle

      const nextActions = get().actions.map((action) =>
        action.itemId === input.itemId
          ? {
              ...action,
              title: nextTitle || action.title,
              subtitle: nextSubtitle || action.subtitle,
            }
          : action,
      )

      if (currentDetailAction?.itemId === input.itemId) {
        set({
          actions: nextActions,
          detailAction: {
            ...currentDetailAction,
            title: nextTitle || currentDetailAction.title,
            subtitle: nextSubtitle || currentDetailAction.subtitle,
          },
          execution,
        })
      } else {
        set({ actions: nextActions, execution })
      }
      return execution
    }

    set({ execution })
    return execution
  },
  async deleteCurrentItem() {
    const itemId = get().detailAction?.itemId
    if (!itemId) {
      return undefined
    }

    const execution = await api.item.delete(itemId)
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
      set({ page: 'home', detailAction: undefined, selectedIndex: 0, formMode: undefined, recoveryCodesMode: undefined, execution: undefined })
      return
    }

    if (page === 'set-passcode' || page === 'set-master-password' || page === 'confirm-passcode-removal') {
      set({ page: 'settings', selectedIndex: 0, formMode: undefined, execution: undefined })
      return
    }

    if (page === 'export' || page === 'import' || page === 'recovery-codes') {
      if (page === 'recovery-codes') {
        set({ page: 'detail', selectedIndex: 0, formMode: undefined, recoveryCodesMode: undefined, execution: undefined })
        return
      }
      set({ page: 'settings', selectedIndex: page === 'export' ? 13 : 14, formMode: undefined, execution: undefined })
      return
    }

    if (page === 'settings' || page === 'dev') {
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
  async lockVault() {
    await api.vault.lock()
    const lockInfo = await api.vault.lockState()
    set({ lockInfo, page: 'locked', actions: [], hasMoreResults: false, nextOffset: 0, selectedIndex: 0, detailAction: undefined, formMode: undefined, execution: undefined })
  },
  async unlockWithHello() {
    const result = await api.vault.unlockWithHello()
    if (result.success) {
      const lockInfo = await api.vault.lockState()
      set({ lockInfo, page: lockInfo.state === 'passcode' ? 'passcode' : lockInfo.state === 'unlocked' ? 'home' : 'locked' })
      if (lockInfo.state === 'unlocked' || lockInfo.state === 'passcode') {
        await get().resetToHome()
      }
    } else {
      set({ lockInfo: { ...(get().lockInfo ?? { state: 'locked' as const, primaryMethods: [], passcodeEnabled: true, passcodeSet: false, masterPasswordSet: false, autoLockMinutes: 15, safeStorageAvailable: true }), state: 'locked' } })
    }
    return result
  },
  async unlockWithPassword(password: string) {
    const result = await api.vault.unlockWithPassword(password)
    if (result.success) {
      const lockInfo = await api.vault.lockState()
      set({ lockInfo, page: lockInfo.state === 'passcode' ? 'passcode' : lockInfo.state === 'unlocked' ? 'home' : 'locked' })
      if (lockInfo.state === 'unlocked' || lockInfo.state === 'passcode') {
        await get().resetToHome()
      }
    }
    return result
  },
  async verifyPasscode(passcode: string) {
    const result = await api.vault.verifyPasscode(passcode)
    if (result.success) {
      const lockInfo = await api.vault.lockState()
      set({ lockInfo, page: 'home' })
      await get().resetToHome()
    }
    return result
  },
  async setupMasterPassword(password: string) {
    return await api.vault.setupMasterPassword(password)
  },
  async setPasscode(passcode: string) {
    return await api.vault.setPasscode(passcode)
  },
  async removePasscode() {
    const result = await api.vault.removePasscode()
    if (result.success) {
      const [lockInfo, settings] = await Promise.all([api.vault.lockState(), api.settings.get()])
      set({ lockInfo, settings, page: 'settings', selectedIndex: 6 })
    }
    return result
  },
  openSetPasscodePage() {
    set({ page: 'set-passcode', execution: undefined })
  },
  openSetMasterPasswordPage() {
    set({ page: 'set-master-password', execution: undefined })
  },
  openConfirmPasscodeRemovalPage() {
    set({ page: 'confirm-passcode-removal', execution: undefined })
  },
  openExportPage() {
    set({ page: 'export', selectedIndex: 0, execution: undefined })
  },
  openImportPage() {
    set({ page: 'import', selectedIndex: 0, execution: undefined })
  },
  openRecoveryCodesPage(mode = 'add') {
    set({ page: 'recovery-codes', recoveryCodesMode: mode, selectedIndex: 0, execution: undefined })
  },
  async submitRecoveryCodes(codes) {
    const itemId = get().detailAction?.itemId
    if (!itemId) return undefined
    const result = await api.item.update({ itemId, recoveryCodes: codes })
    set({ execution: result, page: 'detail', recoveryCodesMode: undefined, selectedIndex: 0 })
    return result
  },
  async updateRecoveryCodesInPlace(codes) {
    const itemId = get().detailAction?.itemId
    if (!itemId) return undefined
    const result = await api.item.update({ itemId, recoveryCodes: codes })
    set({ execution: result, page: 'recovery-codes', selectedIndex: 0 })
    return result
  },
  async submitSetPasscode(passcode: string, confirmPasscode: string) {
    if (passcode !== confirmPasscode) {
      return { success: false, message: 'Passcodes do not match.' }
    }

    const result = await api.vault.setPasscode(passcode)
    if (result.success) {
      const settings = await api.settings.set({ passcodeEnabled: true })
      const lockInfo = await api.vault.lockState()
      set({ lockInfo, settings, page: 'settings', selectedIndex: 6 })
    }
    return result
  },
  async submitSetMasterPassword(password: string, confirmPassword: string) {
    if (password !== confirmPassword) {
      return { success: false, message: 'Passwords do not match.' }
    }

    const result = await api.vault.setupMasterPassword(password)
    if (result.success) {
      const [lockInfo, settings] = await Promise.all([api.vault.lockState(), api.settings.get()])
      set({ lockInfo, settings, page: 'settings', selectedIndex: 7 })
    }
    return result
  },
  async confirmPasscodeRemoval(passcode: string) {
    const confirm = await api.vault.confirmPasscode(passcode)
    if (!confirm.success) {
      return confirm
    }

    const remove = await api.vault.removePasscode()
    if (!remove.success) {
      return remove
    }

    const settings = await api.settings.set({ passcodeEnabled: false })
    const lockInfo = await api.vault.lockState()
    set({ lockInfo, settings, page: 'settings', selectedIndex: 6 })
    return { success: true, message: 'Passcode removed.' }
  },
  focusInput() {
    document.querySelector('input')?.focus()
  },
  async updateSettings(update) {
    const settings = await api.settings.set(update)
    set({ settings })
  },
  async refreshSyncStatus() {
    const syncStatus = await safeSyncStatus()
    set({ syncStatus })
  },
  async syncSignIn() {
    try {
      const syncStatus = await api.sync.signIn()
      set({
        syncStatus,
        execution: {
          status: 'info',
          title: 'Ave opened',
          message: 'Finish sign-in in the browser to connect sync.',
        },
      })
    } catch (error) {
      set({
        execution: {
          status: 'error',
          title: 'Sync sign-in failed',
          message: safeClientErrorMessage(error, 'Klarkey could not start Ave sign-in.'),
        },
      })
    }
  },
  async syncSignOut() {
    const syncStatus = await api.sync.signOut()
    set({
      syncStatus,
      selectedIndex: 10,
      execution: {
        status: 'success',
        title: 'Sync disconnected',
        message: 'This device stopped using cloud sync.',
      },
    })
  },
  async syncNow() {
    try {
      set({
        syncStatus: {
          ...(get().syncStatus ?? fallbackSyncStatus),
          syncing: true,
          lastError: undefined,
        },
        execution: {
          status: 'info',
          title: 'Syncing',
          message: 'Checking encrypted vault changes.',
        },
      })
      const syncStatus = await api.sync.syncNow()
      set({
        syncStatus,
        execution: {
          status: syncStatus.conflictCount > 0 ? 'info' : 'success',
          title: syncStatus.conflictCount > 0 ? 'Sync finished with conflicts' : 'Sync complete',
          message: syncStatus.conflictCount > 0 ? `${syncStatus.conflictCount} conflict copy saved.` : 'Your vault is up to date.',
        },
      })
    } catch (error) {
      const syncStatus = await safeSyncStatus()
      set({
        syncStatus,
        execution: {
          status: 'error',
          title: 'Sync failed',
          message: safeClientErrorMessage(error, 'Klarkey could not sync.'),
        },
      })
    }
  },
  async exportVault(format) {
    const filePath = await api.importExport.pickExportFile(format)
    if (!filePath) {
      return { success: false, message: 'Export cancelled.' }
    }

    set({ page: 'import-loading' as const, execution: undefined })
    const result = await api.importExport.exportVault({ format, filePath })
    if (result.success) {
      set({ page: 'settings', selectedIndex: 13, execution: { status: 'success', title: 'Export complete', message: result.message } })
    } else {
      set({ page: 'settings', selectedIndex: 13, execution: { status: 'error', title: 'Export failed', message: result.message } })
    }
    return { success: result.success, message: result.message }
  },
  async importVault(format) {
    const filePath = await api.importExport.pickImportFile(format)
    if (!filePath) {
      return { success: false, message: 'Import cancelled.' }
    }

    set({ page: 'import-loading' as const, execution: undefined })
    const result = await api.importExport.importVault({ format, filePath })
    if (result.success) {
      set({ page: 'settings', selectedIndex: 14, execution: { status: 'success', title: 'Import complete', message: result.message } })
      await get().resetToHome()
    } else {
      set({ page: 'settings', selectedIndex: 14, execution: { status: 'error', title: 'Import failed', message: result.message } })
    }
    return { success: result.success, message: result.message }
  },
  async loadMoreActions() {
    const { hasMoreResults, isLoadingMore, isLoadingResults, nextOffset, query, page, resolveKey } = get()

    if (!hasMoreResults || isLoadingMore || isLoadingResults || page !== 'home') {
      return
    }

    set({ isLoadingMore: true })

    try {
      const response = await api.search.resolve({
        query,
        offset: nextOffset,
        limit: searchPageSize,
      })
      if (get().resolveKey !== resolveKey) {
        return
      }

      set((state) => ({
        actions: [...state.actions, ...response.actions],
        hasMoreResults: response.hasMore,
        nextOffset: response.nextOffset,
        isLoadingMore: false,
      }))
    } catch {
      set({ isLoadingMore: false })
    }
  },
}))
