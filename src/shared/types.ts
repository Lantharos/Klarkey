import type { CreatableItemType, ItemType } from '@/shared/item-types'

export type CommandIntent =
  | 'search'
  | 'create'
  | 'insert'
  | 'show'
  | 'copy'
  | 'generate'
  | 'login'
  | 'share'
  | 'switch'
  | 'settings'
  | 'unknown'

export type CommandTokenKind = 'intent' | 'item-type' | 'credential' | 'identity'
export type CredentialKind = 'username' | 'password' | 'otp' | 'passkey'
export type ModifierKey = 'none' | 'control' | 'alt'
export type ActionKind =
  | 'open-item'
  | 'copy-password'
  | 'show-password'
  | 'show-otp'
  | 'copy-otp'
  | 'copy-value'
  | 'create-item'
  | 'generate-passkey'
  | 'switch-item'
  | 'coming-soon'
  | 'open-settings'

export interface CommandToken {
  id: string
  kind: CommandTokenKind
  label: string
  value: string
}

export interface CommandQuery {
  raw: string
  intent: CommandIntent
  tokens: CommandToken[]
  trailingText: string
  entryType?: ItemType
  itemQuery?: string
  identityQuery?: string
  credential?: CredentialKind
}

export interface ItemProfile {
  id: string
  itemType: ItemType
  itemName: string
  username?: string
  fullName?: string
  email?: string
  phone?: string
  address?: string
  content?: string
  websites?: string[]
  notes?: string
  customFields?: Array<{ id: string; label: string; value: string }>
  hasPassword: boolean
  hasOtp: boolean
  hasPasskey: boolean
  passwordPreview?: string
  lastUsedAt?: string
}

export interface Credential {
  id: string
  itemId: string
  kind: CredentialKind
  value: string
  updatedAt: string
}

export interface OtpSecret {
  id: string
  itemId: string
  secret: string
  issuer: string
  accountName: string
}

export interface PasskeyRecord {
  id: string
  itemId: string
  label: string
  createdAt: string
}

export interface RecentAction {
  id: string
  actionId: string
  itemId?: string
  label: string
  usedAt: string
}

export interface ResolvedAction {
  id: string
  kind: ActionKind
  title: string
  subtitle: string
  itemId?: string
  itemType?: ItemType
  logoDomain?: string
  logoName?: string
  primaryHint: string
  modifiers?: Partial<Record<Exclude<ModifierKey, 'none'>, string>>
  requiresUnlock: boolean
  score: number
}

export interface ActionExecutionResult {
  status: 'success' | 'error' | 'locked' | 'info'
  title: string
  message: string
  secret?: string
  copied?: boolean
  itemId?: string
}

export interface SearchRequest {
  query: CommandQuery
  offset?: number
  limit?: number
}

export interface SearchResponse {
  actions: ResolvedAction[]
  locked: boolean
  hasMore: boolean
  nextOffset: number
}

export interface UserSettings {
  hotkey: string
  clearClipboardSeconds: number
  launchOnStartup: boolean
}

export interface SettingsUpdate {
  hotkey?: string
  clearClipboardSeconds?: number
  launchOnStartup?: boolean
}

export interface CreateItemInput {
  itemType: CreatableItemType
  itemName: string
  username?: string
  password?: string
  fullName?: string
  email?: string
  phone?: string
  address?: string
  content?: string
  notes?: string
  websites?: string[]
  customFields?: Array<{ id: string; label: string; value: string }>
}

export interface UpdateItemInput {
  itemId: string
  itemType?: CreatableItemType
  itemName?: string
  username?: string
  password?: string
  fullName?: string
  email?: string
  phone?: string
  address?: string
  content?: string
  notes?: string
  websites?: string[]
  customFields?: Array<{ id: string; label: string; value: string }>
}

export interface ItemDetails {
  itemId: string
  itemType: ItemType
  itemName: string
  username: string
  password?: string
  fullName?: string
  email?: string
  phone?: string
  address?: string
  content?: string
  notes?: string
  websites: string[]
  customFields: Array<{ id: string; label: string; value: string }>
}

export interface VaultSnapshot {
  items: ItemProfile[]
  recents: RecentAction[]
}

export const DEFAULT_SETTINGS: UserSettings = {
  hotkey: 'Alt+S',
  clearClipboardSeconds: 45,
  launchOnStartup: false,
}
