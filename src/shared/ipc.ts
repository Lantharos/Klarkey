import type {
  ActionExecutionResult,
  CommandQuery,
  ItemDetails,
  ModifierKey,
  SearchResponse,
  UpdateItemInput,
  CreateItemInput,
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
  onPrepareOpen: (callback: () => void) => () => void
  onFocusRequest: (callback: () => void) => () => void
}
