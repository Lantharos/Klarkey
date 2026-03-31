import type {
  ActionExecutionResult,
  CommandQuery,
  CreateVaultPasskeyInput,
  ItemDetails,
  ModifierKey,
  PasskeySupport,
  SearchRequest,
  SearchResponse,
  UpdateItemInput,
  CreateItemInput,
  SettingsUpdate,
  UserSettings,
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
  onPrepareOpen: (callback: () => void) => () => void
  onFocusRequest: (callback: () => void) => () => void
}
