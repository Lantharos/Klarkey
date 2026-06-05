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
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  email?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardLastFour?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  sshAlgorithm?: string
  sshFingerprint?: string
  sshPublicKey?: string
  sshComment?: string
  content?: string
  websites?: string[]
  notes?: string
  customFields?: Array<{ id: string; label: string; value: string }>
  hasPassword: boolean
  hasOtp: boolean
  hasPasskey: boolean
  hasRecoveryCodes: boolean
  ssoProvider?: string
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

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

export interface TotpDetails {
  secret: string
  issuer?: string
  accountName: string
  digits: number
  period: number
  algorithm: TotpAlgorithm
  uri: string
}

export interface PasskeyRecord {
  id: string
  itemId: string
  label: string
  createdAt: string
}

export interface ItemPasskey {
  id: string
  label: string
  credentialId?: string
  rpId?: string
  userName?: string
  createdAt: string
  lastUsedAt?: string
}

export interface VaultPasskeyRecord {
  id: string
  label: string
  credentialId: string
  transports: string[]
  createdAt: string
  lastUsedAt?: string
}

export interface PasskeySupport {
  available: boolean
  secureContext: boolean
  platformAuthenticatorAvailable: boolean
  conditionalMediationAvailable: boolean
  platform: NodeJS.Platform | 'unknown'
  safeStorageAvailable: boolean
  relyingPartyId: string
  origin: string
}

export interface CreateVaultPasskeyInput {
  label: string
  credentialId: string
  transports: string[]
}

export interface BrowserSiteMatch {
  itemId: string
  itemName: string
  username?: string
  websites: string[]
  hasPassword: boolean
  hasOtp: boolean
  hasPasskey: boolean
  ssoProvider?: string
  lastUsedAt?: string
}

export type BrowserSuggestionField =
  | 'username'
  | 'email'
  | 'fullName'
  | 'firstName'
  | 'middleName'
  | 'lastName'
  | 'company'
  | 'jobTitle'
  | 'birthDate'
  | 'phone'
  | 'address'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country'
  | 'cardholderName'
  | 'cardNumber'
  | 'cardExpiry'
  | 'cardExpiryMonth'
  | 'cardExpiryYear'
  | 'cardCvc'
  | 'cardBrand'
export type BrowserAuthFlow = 'login' | 'register' | 'payment'
export type BrowserFieldSuggestionSource = 'login-username' | 'identity' | 'card'

export interface BrowserFieldSuggestion {
  id: string
  itemId: string
  itemName: string
  value: string
  displayValue?: string
  displaySecondary?: string
  cardLastFour?: string
  cardBrand?: string
  field: BrowserSuggestionField
  source: BrowserFieldSuggestionSource
  lastUsedAt?: string
  fromSiteMatch: boolean
}

export interface BrowserFillLogin {
  itemId: string
  itemName: string
  username?: string
  password?: string
  otp?: string
  websites: string[]
  hasPasskey: boolean
  ssoProvider?: string
}

export interface BrowserFillIdentity {
  itemId: string
  itemName: string
  username?: string
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  email?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

export interface BrowserFillCard {
  itemId: string
  itemName: string
  cardholderName?: string
  cardNumber?: string
  cardLastFour?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
}

export interface BrowserPasskeyStatus {
  supported: boolean
  status?: 'locked'
  locked?: boolean
  browser: 'chromium' | 'firefox' | 'other'
  mode: 'desktop-proxy' | 'browser-limited'
  conditionalUi: boolean
  availablePasskeyCount: number
  exactMatchCount: number
  linkedMatchCount: number
  reason?: string
}

export interface BrowserPasskeySavePlan {
  credentialId?: string
  rpId?: string
  userName?: string
  itemName: string
  suggestedMatch?: BrowserSiteMatch
  existingCredentialItemId?: string
  existingItemName?: string
}

export interface BrowserPasskeyChoice {
  credentialId: string
  itemId: string
  itemName: string
  userName?: string
  rpId?: string
  lastUsedAt?: string
}

export interface BrowserSaveLoginInput {
  url: string
  title?: string
  username?: string
  password?: string
  ssoProvider?: string
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
  disabled?: boolean
  disabledReason?: string
}

export interface ExternalWindowContext {
  handle: string
  appName?: string
  windowTitle?: string
  iconDataUrl?: string
  processPath?: string
}

export interface ActionExecutionResult {
  status: 'success' | 'error' | 'locked' | 'info'
  title: string
  message: string
  secret?: string
  copied?: boolean
  itemId?: string
  pendingPasskeyId?: string
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

export type VaultLockState = 'locked' | 'passcode' | 'unlocked'

export type VaultUnlockMethod = 'windowsHello' | 'masterPassword'
export type SystemUnlockPolicy = 'startup' | 'timed'

export interface VaultOperationResult {
  success: boolean
  message: string
}

export interface VaultLockInfo {
  state: VaultLockState
  primaryMethods: VaultUnlockMethod[]
  passcodeEnabled: boolean
  passcodeSet: boolean
  passcodeLength?: number
  lockWarningSeconds?: number
  masterPasswordSet: boolean
  autoLockMinutes: number
  safeStorageAvailable: boolean
}

export interface UserSettings {
  hotkey: string
  clearClipboardSeconds: number
  launchOnStartup: boolean
  browserAutoOpenMenu: boolean
  browserAutoSubmitLogin: boolean
  browserSavePrompts: boolean
  passcodeEnabled: boolean
  autoLockMinutes: number
  systemUnlockPolicy: SystemUnlockPolicy
  sshAgentEnabled: boolean
}

export interface SettingsUpdate {
  hotkey?: string
  clearClipboardSeconds?: number
  launchOnStartup?: boolean
  browserAutoOpenMenu?: boolean
  browserAutoSubmitLogin?: boolean
  browserSavePrompts?: boolean
  passcodeEnabled?: boolean
  autoLockMinutes?: number
  systemUnlockPolicy?: SystemUnlockPolicy
  sshAgentEnabled?: boolean
}

export interface CreateItemInput {
  itemId?: string
  itemType: CreatableItemType
  itemName: string
  preserveEmptyPassword?: boolean
  username?: string
  password?: string
  otp?: string
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  email?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  sshPublicKey?: string
  sshPrivateKey?: string
  sshComment?: string
  sshAlgorithm?: string
  sshFingerprint?: string
  content?: string
  notes?: string
  websites?: string[]
  customFields?: Array<{ id: string; label: string; value: string }>
  recoveryCodes?: string[]
  ssoProvider?: string
}

export interface UpdateItemInput {
  itemId: string
  itemType?: CreatableItemType
  itemName?: string
  username?: string
  password?: string
  otp?: string
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  email?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  sshPublicKey?: string
  sshPrivateKey?: string
  sshComment?: string
  sshAlgorithm?: string
  sshFingerprint?: string
  content?: string
  notes?: string
  websites?: string[]
  customFields?: Array<{ id: string; label: string; value: string }>
  recoveryCodes?: string[]
  ssoProvider?: string
}

export interface ItemDetails {
  itemId: string
  itemType: ItemType
  itemName: string
  updatedAt?: string
  username: string
  password?: string
  otp?: TotpDetails
  fullName?: string
  firstName?: string
  middleName?: string
  lastName?: string
  company?: string
  jobTitle?: string
  birthDate?: string
  email?: string
  phone?: string
  address?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  cardholderName?: string
  cardNumber?: string
  cardLastFour?: string
  cardExpiry?: string
  cardExpiryMonth?: string
  cardExpiryYear?: string
  cardCvc?: string
  cardBrand?: string
  billingPostalCode?: string
  sshAlgorithm?: string
  sshFingerprint?: string
  sshPublicKey?: string
  sshPrivateKey?: string
  sshComment?: string
  content?: string
  notes?: string
  websites: string[]
  customFields: Array<{ id: string; label: string; value: string }>
  recoveryCodes: string[]
  ssoProvider?: string
  passkeys: ItemPasskey[]
}

export interface VaultSnapshot {
  items: ItemProfile[]
  recents: RecentAction[]
}

export const DEFAULT_SETTINGS: UserSettings = {
  hotkey: 'Alt+S',
  clearClipboardSeconds: 45,
  launchOnStartup: false,
  browserAutoOpenMenu: true,
  browserAutoSubmitLogin: false,
  browserSavePrompts: true,
  passcodeEnabled: true,
  autoLockMinutes: 15,
  systemUnlockPolicy: 'timed',
  sshAgentEnabled: false,
}
