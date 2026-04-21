import type {
  ActionExecutionResult,
  CommandQuery,
  CreateItemInput,
  CreateVaultPasskeyInput,
  ExternalWindowContext,
  ItemDetails,
  ModifierKey,
  PasskeySupport,
  SearchRequest,
  SearchResponse,
  SettingsUpdate,
  UpdateItemInput,
  UserSettings,
  VaultLockInfo,
  VaultOperationResult,
  VaultPasskeyRecord,
} from '@/shared/types'

export interface KlarkeyApi {
  palette: {
    open: () => Promise<void>
    close: () => Promise<void>
  }
  command: {
    parse: (raw: string) => Promise<CommandQuery>
  }
  search: {
    resolve: (request: SearchRequest) => Promise<SearchResponse>
  }
  action: {
    execute: (actionId: string, modifier: ModifierKey) => Promise<ActionExecutionResult>
  }
  item: {
    get: (itemId: string) => Promise<ItemDetails | undefined>
    create: (input: CreateItemInput) => Promise<ActionExecutionResult>
    update: (input: UpdateItemInput) => Promise<ActionExecutionResult>
    delete: (itemId: string) => Promise<ActionExecutionResult>
  }
  vault: {
    unlock: () => Promise<ActionExecutionResult>
    lockState: () => Promise<VaultLockInfo>
    unlockWithHello: () => Promise<VaultOperationResult>
    unlockWithPassword: (password: string) => Promise<VaultOperationResult>
    lock: () => Promise<void>
    setupMasterPassword: (password: string) => Promise<VaultOperationResult>
    changeMasterPassword: (currentPassword: string, newPassword: string) => Promise<VaultOperationResult>
    removeMasterPassword: (currentPassword: string) => Promise<VaultOperationResult>
    setPasscode: (passcode: string) => Promise<VaultOperationResult>
    removePasscode: () => Promise<VaultOperationResult>
    confirmPasscode: (passcode: string) => Promise<VaultOperationResult>
    verifyPasscode: (passcode: string) => Promise<VaultOperationResult>
  }
  settings: {
    get: () => Promise<UserSettings>
    set: (update: SettingsUpdate) => Promise<UserSettings>
  }
  passkeys: {
    getSupport: () => Promise<PasskeySupport>
    list: () => Promise<VaultPasskeyRecord[]>
    create: (label?: string) => Promise<ActionExecutionResult>
    authenticate: () => Promise<ActionExecutionResult>
    save: (input: CreateVaultPasskeyInput) => Promise<ActionExecutionResult>
    remove: (passkeyId: string) => Promise<ActionExecutionResult>
  }
  targetWindow: {
    get: () => Promise<ExternalWindowContext | undefined>
  }
  onPrepareOpen: (callback: () => void) => () => void
  onFocusRequest: (callback: () => void) => () => void
  onTargetWindowChange: (callback: (context: ExternalWindowContext) => void) => () => void
  onLockStateChanged: (callback: (info: VaultLockInfo) => void) => () => void
  dev?: {
    forceLock: () => Promise<VaultLockInfo>
    forceUnlock: () => Promise<VaultLockInfo>
    forcePasscode: () => Promise<VaultLockInfo>
    dumpLockInfo: () => Promise<VaultLockInfo & { keyInMemory: boolean; keyFileExists: boolean }>
    resetVault: () => Promise<{ status: string }>
  }
}
