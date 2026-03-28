import type {
  ActionExecutionResult,
  CommandQuery,
  ItemDetails,
  ModifierKey,
  SearchResponse,
  UpdateIdentityInput,
  CreateIdentityInput,
  SettingsUpdate,
  UserSettings,
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
    resolve: (query: CommandQuery) => Promise<SearchResponse>
  }
  action: {
    execute: (actionId: string, modifier: ModifierKey) => Promise<ActionExecutionResult>
  }
  item: {
    get: (identityId: string) => Promise<ItemDetails | undefined>
    create: (input: CreateIdentityInput) => Promise<ActionExecutionResult>
    update: (input: UpdateIdentityInput) => Promise<ActionExecutionResult>
    delete: (identityId: string) => Promise<ActionExecutionResult>
  }
  vault: {
    unlock: () => Promise<ActionExecutionResult>
  }
  settings: {
    get: () => Promise<UserSettings>
    set: (update: SettingsUpdate) => Promise<UserSettings>
  }
  onFocusRequest: (callback: () => void) => () => void
}
