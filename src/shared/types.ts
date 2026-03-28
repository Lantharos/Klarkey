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
  | 'login'
  | 'copy-password'
  | 'show-password'
  | 'show-otp'
  | 'copy-otp'
  | 'create-login'
  | 'update-login'
  | 'delete-login'
  | 'generate-passkey'
  | 'switch-identity'
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
  entryType?: 'login'
  itemQuery?: string
  identityQuery?: string
  credential?: CredentialKind
}

export interface IdentityProfile {
  id: string
  itemName: string
  username: string
  email?: string
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
  identityId: string
  kind: CredentialKind
  value: string
  updatedAt: string
}

export interface OtpSecret {
  id: string
  identityId: string
  secret: string
  issuer: string
  accountName: string
}

export interface PasskeyRecord {
  id: string
  identityId: string
  label: string
  createdAt: string
}

export interface RecentAction {
  id: string
  actionId: string
  identityId?: string
  label: string
  usedAt: string
}

export interface ResolvedAction {
  id: string
  kind: ActionKind
  title: string
  subtitle: string
  identityId?: string
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
  identityId?: string
}

export interface SearchResponse {
  actions: ResolvedAction[]
  locked: boolean
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

export interface CreateIdentityInput {
  itemName: string
  username?: string
  password?: string
  notes?: string
  websites?: string[]
  customFields?: Array<{ id: string; label: string; value: string }>
}

export interface UpdateIdentityInput {
  identityId: string
  itemName?: string
  username?: string
  password?: string
  notes?: string
  websites?: string[]
  customFields?: Array<{ id: string; label: string; value: string }>
}

export interface ItemDetails {
  identityId: string
  itemName: string
  username: string
  password?: string
  notes?: string
  websites: string[]
  customFields: Array<{ id: string; label: string; value: string }>
}

export interface VaultSnapshot {
  items: IdentityProfile[]
  recents: RecentAction[]
}

export const DEFAULT_SETTINGS: UserSettings = {
  hotkey: 'Alt+S',
  clearClipboardSeconds: 45,
  launchOnStartup: false,
}
