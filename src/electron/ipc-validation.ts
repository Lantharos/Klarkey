import { AVAILABLE_ITEM_TYPES, ALL_ITEM_TYPES, isCreatableItemType, type CreatableItemType, type ItemType } from '@/shared/item-types'
import { AUTO_LOCK_MINUTE_OPTIONS, CLIPBOARD_CLEAR_OPTIONS } from '@/shared/settings-options'
import { normalizeHotkeyAccelerator } from '@/shared/hotkey-accelerator'
import type {
  CommandIntent,
  CommandQuery,
  CommandTokenKind,
  CreateItemInput,
  CreateVaultPasskeyInput,
  CredentialKind,
  ModifierKey,
  SearchRequest,
  SettingsUpdate,
  UpdateItemInput,
} from '@/shared/types'
import type { ExportFormat, ImportFormat } from '@/shared/import-export'

const COMMAND_TEXT_MAX = 2048
const ACTION_ID_MAX = 4096
const ITEM_ID_MAX = 128
const LABEL_MAX = 256
const SMALL_TEXT_MAX = 4096
const LARGE_TEXT_MAX = 100_000
const ARRAY_MAX = 128
const WEBSITE_MAX = 2048
const CUSTOM_FIELDS_MAX = 64
const SEARCH_LIMIT_MAX = 50
const SEARCH_OFFSET_MAX = 10_000
const PASSWORD_MAX = 4096
const HOTKEY_MAX = 64

const commandIntents = new Set<CommandIntent>([
  'search',
  'create',
  'insert',
  'show',
  'copy',
  'generate',
  'login',
  'share',
  'switch',
  'settings',
  'unknown',
])
const tokenKinds = new Set<CommandTokenKind>(['intent', 'item-type', 'credential', 'identity'])
const credentialKinds = new Set<CredentialKind>(['username', 'password', 'otp', 'passkey'])
const modifierKeys = new Set<ModifierKey>(['none', 'control', 'alt'])
const itemTypes = new Set<ItemType>(ALL_ITEM_TYPES)
const directActionFields = new Set([
  'username',
  'password',
  'otp',
  'fullName',
  'email',
  'phone',
  'address',
  'cardholderName',
  'cardNumber',
  'cardExpiry',
  'cardCvc',
  'billingPostalCode',
  'content',
  'sshPublicKey',
  'sshPrivateKey',
  'sshFingerprint',
  'sshGitConfig',
])
const importFormats = new Set<ImportFormat>([
  'auto',
  'klarkey-json',
  'csv',
  '1pux',
  'bitwarden-json',
  'lastpass-csv',
  'dashlane-csv',
  'dashlane-json',
  'chrome-csv',
])
const exportFormats = new Set<ExportFormat>(['klarkey-json', 'csv'])
const allowedSettingsKeys = new Set([
  'hotkey',
  'clearClipboardSeconds',
  'launchOnStartup',
  'browserAutoOpenMenu',
  'browserAutoSubmitLogin',
  'browserSavePrompts',
  'passcodeEnabled',
  'autoLockMinutes',
  'sshAgentEnabled',
])
const itemStringFields = new Map<keyof (CreateItemInput & UpdateItemInput), number>([
  ['username', SMALL_TEXT_MAX],
  ['password', LARGE_TEXT_MAX],
  ['otp', LARGE_TEXT_MAX],
  ['fullName', SMALL_TEXT_MAX],
  ['firstName', SMALL_TEXT_MAX],
  ['middleName', SMALL_TEXT_MAX],
  ['lastName', SMALL_TEXT_MAX],
  ['company', SMALL_TEXT_MAX],
  ['jobTitle', SMALL_TEXT_MAX],
  ['birthDate', SMALL_TEXT_MAX],
  ['email', SMALL_TEXT_MAX],
  ['phone', SMALL_TEXT_MAX],
  ['address', SMALL_TEXT_MAX],
  ['addressLine1', SMALL_TEXT_MAX],
  ['addressLine2', SMALL_TEXT_MAX],
  ['city', SMALL_TEXT_MAX],
  ['state', SMALL_TEXT_MAX],
  ['postalCode', SMALL_TEXT_MAX],
  ['country', SMALL_TEXT_MAX],
  ['cardholderName', SMALL_TEXT_MAX],
  ['cardNumber', SMALL_TEXT_MAX],
  ['cardExpiry', SMALL_TEXT_MAX],
  ['cardExpiryMonth', SMALL_TEXT_MAX],
  ['cardExpiryYear', SMALL_TEXT_MAX],
  ['cardCvc', SMALL_TEXT_MAX],
  ['cardBrand', SMALL_TEXT_MAX],
  ['billingPostalCode', SMALL_TEXT_MAX],
  ['sshPublicKey', LARGE_TEXT_MAX],
  ['sshPrivateKey', LARGE_TEXT_MAX],
  ['sshComment', SMALL_TEXT_MAX],
  ['sshAlgorithm', SMALL_TEXT_MAX],
  ['sshFingerprint', SMALL_TEXT_MAX],
  ['content', LARGE_TEXT_MAX],
  ['notes', LARGE_TEXT_MAX],
  ['ssoProvider', SMALL_TEXT_MAX],
])
const itemKeys = new Set([
  'itemId',
  'itemType',
  'itemName',
  'preserveEmptyPassword',
  'websites',
  'customFields',
  'recoveryCodes',
  ...itemStringFields.keys(),
])

function invalid(): never {
  throw new Error('Invalid IPC payload')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    invalid()
  }
  return value
}

function rejectUnknownKeys(record: Record<string, unknown>, allowedKeys: Set<string>) {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      invalid()
    }
  }
}

function expectString(value: unknown, maxLength: number, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) {
    invalid()
  }
  if (!allowEmpty && value.trim().length === 0) {
    invalid()
  }
  return value
}

function optionalString(record: Record<string, unknown>, key: string, maxLength: number, allowEmpty = true) {
  if (!(key in record) || record[key] === undefined) {
    return undefined
  }
  return expectString(record[key], maxLength, allowEmpty)
}

function optionalBoolean(record: Record<string, unknown>, key: string) {
  if (!(key in record) || record[key] === undefined) {
    return undefined
  }
  if (typeof record[key] !== 'boolean') {
    invalid()
  }
  return record[key]
}

function expectInteger(value: unknown, min: number, max: number) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    invalid()
  }
  return value as number
}

function optionalInteger(record: Record<string, unknown>, key: string, min: number, max: number) {
  if (!(key in record) || record[key] === undefined) {
    return undefined
  }
  return expectInteger(record[key], min, max)
}

function expectMember<T extends string>(value: unknown, values: Set<T>) {
  if (typeof value !== 'string' || !values.has(value as T)) {
    invalid()
  }
  return value as T
}

function expectItemId(value: unknown) {
  return expectString(value, ITEM_ID_MAX, false)
}

function optionalStringArray(record: Record<string, unknown>, key: string, maxItems: number, maxLength: number) {
  if (!(key in record) || record[key] === undefined) {
    return undefined
  }
  const value = record[key]
  if (!Array.isArray(value) || value.length > maxItems) {
    invalid()
  }
  return value.map((entry) => expectString(entry, maxLength))
}

function optionalCustomFields(record: Record<string, unknown>) {
  if (!('customFields' in record) || record.customFields === undefined) {
    return undefined
  }
  if (!Array.isArray(record.customFields) || record.customFields.length > CUSTOM_FIELDS_MAX) {
    invalid()
  }
  return record.customFields.map((field) => {
    const source = expectRecord(field)
    rejectUnknownKeys(source, new Set(['id', 'label', 'value']))
    return {
      id: expectString(source.id, ITEM_ID_MAX, false),
      label: expectString(source.label, LABEL_MAX),
      value: expectString(source.value, LARGE_TEXT_MAX),
    }
  })
}

function readItemType(value: unknown): CreatableItemType {
  const itemType = expectMember(value, new Set(AVAILABLE_ITEM_TYPES))
  if (!isCreatableItemType(itemType)) {
    invalid()
  }
  return itemType
}

function sanitizeItemPayload(value: unknown, mode: 'create'): CreateItemInput
function sanitizeItemPayload(value: unknown, mode: 'update'): UpdateItemInput
function sanitizeItemPayload(value: unknown, mode: 'create' | 'update'): CreateItemInput | UpdateItemInput {
  const source = expectRecord(value)
  rejectUnknownKeys(source, itemKeys)
  const input: Record<string, unknown> = {}

  if (mode === 'create') {
    input.itemType = readItemType(source.itemType)
    input.itemName = expectString(source.itemName, LABEL_MAX, false)
    if (source.itemId !== undefined) {
      input.itemId = expectItemId(source.itemId)
    }
    if (source.preserveEmptyPassword !== undefined) {
      if (typeof source.preserveEmptyPassword !== 'boolean') {
        invalid()
      }
      input.preserveEmptyPassword = source.preserveEmptyPassword
    }
  } else {
    input.itemId = expectItemId(source.itemId)
    if (source.itemType !== undefined) {
      input.itemType = readItemType(source.itemType)
    }
    const itemName = optionalString(source, 'itemName', LABEL_MAX)
    if (itemName !== undefined) {
      input.itemName = itemName
    }
  }

  for (const [key, maxLength] of itemStringFields.entries()) {
    const valueForKey = optionalString(source, key, maxLength)
    if (valueForKey !== undefined) {
      input[key] = valueForKey
    }
  }

  const websites = optionalStringArray(source, 'websites', 32, WEBSITE_MAX)
  if (websites !== undefined) {
    input.websites = websites
  }

  const customFields = optionalCustomFields(source)
  if (customFields !== undefined) {
    input.customFields = customFields
  }

  const recoveryCodes = optionalStringArray(source, 'recoveryCodes', ARRAY_MAX, SMALL_TEXT_MAX)
  if (recoveryCodes !== undefined) {
    input.recoveryCodes = recoveryCodes
  }

  return input as unknown as CreateItemInput | UpdateItemInput
}

function isKnownDirectAction(actionId: string) {
  if (actionId === 'settings' || actionId === 'dev') {
    return true
  }

  const firstSeparator = actionId.indexOf(':')
  const kind = firstSeparator === -1 ? actionId : actionId.slice(0, firstSeparator)
  const rest = firstSeparator === -1 ? '' : actionId.slice(firstSeparator + 1)
  const expectActionItemId = (value: string) => expectString(value, ITEM_ID_MAX, false)

  if ((kind === 'open' || kind === 'switch') && rest) {
    expectActionItemId(rest)
    return true
  }

  const lastSeparator = rest.lastIndexOf(':')
  const itemId = lastSeparator === -1 ? '' : rest.slice(0, lastSeparator)
  const field = lastSeparator === -1 ? '' : rest.slice(lastSeparator + 1)

  if ((kind === 'copy' || kind === 'show' || kind === 'paste') && itemId && field && directActionFields.has(field)) {
    expectActionItemId(itemId)
    return true
  }

  if (kind === 'configure' && itemId && field === 'gitSigning') {
    expectActionItemId(itemId)
    return true
  }

  if (kind === 'create') {
    const parts = actionId.split(':')
    return parts.length >= 3 && itemTypes.has(parts[1] as ItemType) && parts.slice(2).join(':').length <= COMMAND_TEXT_MAX
  }

  if (kind === 'coming-soon') {
    const parts = actionId.split(':')
    return parts.length === 2 && itemTypes.has(parts[1] as ItemType)
  }

  return false
}

export function sanitizeCommandRaw(value: unknown) {
  return expectString(value, COMMAND_TEXT_MAX)
}

export function sanitizePassword(value: unknown) {
  return expectString(value, PASSWORD_MAX)
}

export function sanitizeClipboardSecret(value: unknown) {
  return expectString(value, LARGE_TEXT_MAX, false)
}

export function sanitizeCredentialId(value: unknown) {
  return expectString(value, SMALL_TEXT_MAX, false)
}

export function sanitizePasscode(value: unknown) {
  const passcode = expectString(value, 6, false)
  if (!/^\d{4,6}$/.test(passcode)) {
    invalid()
  }
  return passcode
}

export function sanitizeItemId(value: unknown) {
  return expectItemId(value)
}

export function sanitizeActionExecutionRequest(actionId: unknown, modifier: unknown) {
  const safeActionId = expectString(actionId, ACTION_ID_MAX, false)
  if (!isKnownDirectAction(safeActionId)) {
    invalid()
  }
  return {
    actionId: safeActionId,
    modifier: expectMember(modifier, modifierKeys),
  }
}

export function sanitizeCommandQuery(value: unknown): CommandQuery {
  const source = expectRecord(value)
  rejectUnknownKeys(source, new Set(['raw', 'intent', 'tokens', 'trailingText', 'entryType', 'itemQuery', 'identityQuery', 'credential']))
  const raw = expectString(source.raw, COMMAND_TEXT_MAX)
  const intent = expectMember(source.intent, commandIntents)
  const tokensValue = source.tokens

  if (!Array.isArray(tokensValue) || tokensValue.length > 32) {
    invalid()
  }

  const tokens = tokensValue.map((token) => {
    const tokenSource = expectRecord(token)
    rejectUnknownKeys(tokenSource, new Set(['id', 'kind', 'label', 'value']))
    return {
      id: expectString(tokenSource.id, ITEM_ID_MAX, false),
      kind: expectMember(tokenSource.kind, tokenKinds),
      label: expectString(tokenSource.label, LABEL_MAX),
      value: expectString(tokenSource.value, SMALL_TEXT_MAX),
    }
  })

  const query: CommandQuery = {
    raw,
    intent,
    tokens,
    trailingText: expectString(source.trailingText, COMMAND_TEXT_MAX),
  }

  if (source.entryType !== undefined) {
    query.entryType = expectMember(source.entryType, itemTypes)
  }
  const itemQuery = optionalString(source, 'itemQuery', COMMAND_TEXT_MAX)
  if (itemQuery !== undefined) {
    query.itemQuery = itemQuery
  }
  const identityQuery = optionalString(source, 'identityQuery', COMMAND_TEXT_MAX)
  if (identityQuery !== undefined) {
    query.identityQuery = identityQuery
  }
  if (source.credential !== undefined) {
    query.credential = expectMember(source.credential, credentialKinds)
  }

  return query
}

export function sanitizeSearchRequest(value: unknown): SearchRequest {
  const source = expectRecord(value)
  rejectUnknownKeys(source, new Set(['query', 'offset', 'limit']))
  return {
    query: sanitizeCommandQuery(source.query),
    offset: optionalInteger(source, 'offset', 0, SEARCH_OFFSET_MAX),
    limit: optionalInteger(source, 'limit', 1, SEARCH_LIMIT_MAX),
  }
}

export function sanitizeSettingsUpdate(value: unknown): SettingsUpdate {
  const source = expectRecord(value)
  rejectUnknownKeys(source, allowedSettingsKeys)
  const update: SettingsUpdate = {}

  const hotkey = optionalString(source, 'hotkey', HOTKEY_MAX, false)
  if (hotkey !== undefined) {
    const normalizedHotkey = normalizeHotkeyAccelerator(hotkey)
    if (!normalizedHotkey) {
      invalid()
    }
    update.hotkey = normalizedHotkey
  }
  if (source.clearClipboardSeconds !== undefined) {
    const seconds = expectInteger(source.clearClipboardSeconds, 0, 3600)
    if (!CLIPBOARD_CLEAR_OPTIONS.includes(seconds as (typeof CLIPBOARD_CLEAR_OPTIONS)[number])) {
      invalid()
    }
    update.clearClipboardSeconds = seconds
  }
  if (source.autoLockMinutes !== undefined) {
    const minutes = expectInteger(source.autoLockMinutes, 1, 1440)
    if (!AUTO_LOCK_MINUTE_OPTIONS.includes(minutes as (typeof AUTO_LOCK_MINUTE_OPTIONS)[number])) {
      invalid()
    }
    update.autoLockMinutes = minutes
  }

  for (const key of [
    'launchOnStartup',
    'browserAutoOpenMenu',
    'browserAutoSubmitLogin',
    'browserSavePrompts',
    'passcodeEnabled',
    'sshAgentEnabled',
  ] as const) {
    const valueForKey = optionalBoolean(source, key)
    if (valueForKey !== undefined) {
      update[key] = valueForKey
    }
  }

  return update
}

export function sanitizeCreateItemInput(value: unknown): CreateItemInput {
  return sanitizeItemPayload(value, 'create')
}

export function sanitizeUpdateItemInput(value: unknown): UpdateItemInput {
  return sanitizeItemPayload(value, 'update')
}

export function sanitizeCreateVaultPasskeyInput(value: unknown): CreateVaultPasskeyInput {
  const source = expectRecord(value)
  rejectUnknownKeys(source, new Set(['label', 'credentialId', 'transports']))
  return {
    label: expectString(source.label, LABEL_MAX),
    credentialId: expectString(source.credentialId, SMALL_TEXT_MAX, false),
    transports: optionalStringArray(source, 'transports', 16, 32) ?? [],
  }
}

export function sanitizeImportFormat(value: unknown): ImportFormat {
  return expectMember(value, importFormats)
}

export function sanitizeExportFormat(value: unknown): ExportFormat {
  return expectMember(value, exportFormats)
}
