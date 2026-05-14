import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, generateNonce } from '@ave-id/sdk'
import { ConvexHttpClient } from 'convex/browser'
import { parseAveOAuthCallback } from '@/shared/ave-oauth'
import { recordFromItemDetails, SYNC_SCHEMA_VERSION, type PlainVaultRecord, type SyncStatus, type SyncUpdateEvent } from '@/shared/sync'
import { normalizeSecureSyncUrl, secureSyncUrlError } from '@/shared/sync-transport'
import { DEFAULT_SETTINGS, type CreateItemInput, type ItemDetails, type UserSettings } from '@/shared/types'
import { decryptSyncRecord, encryptPlainRecord, hashPlainRecord, unwrapVaultKey, wrapVaultKey } from '@/tauri/sync-crypto'
import { deviceRegistrationIntervalMs, maxPushBatchRecords, normalizeBootstrapResult, normalizePullResult, normalizePushResult, syncFns } from '@/tauri/sync-remote'
import { exchangeOAuthCode, isFreshPendingOAuthRequest, refreshSyncSession, type AveSyncConfig, type PendingOAuthRequest, type SyncSession } from '@/tauri/sync-session'

type SyncRecordState = {
  recordId: string
  kind?: PlainVaultRecord['kind']
  itemId?: string
  credentialId?: string
  revision: number
  contentHash: string
  serverSequence: number
  deletedAt?: number
}

export type TauriSyncState = {
  accountId?: string
  deviceId: string
  conflictCount: number
  serverSequence: number
  lastDeviceRegisteredAt: number
  lastSyncAt?: string
  lastError?: string
  session?: SyncSession
  pendingOAuth?: PendingOAuthRequest
  records: Record<string, SyncRecordState>
}

type VaultState = {
  items: ItemDetails[]
  settings: UserSettings
  sitePasskeys: unknown[]
  sync?: TauriSyncState
}

type SyncAccess<State extends VaultState> = {
  nativeCall: <Result>(command: string, args?: Record<string, unknown>) => Promise<Result>
  loadState: () => State
  saveState: (state: State) => void
  requireUnlocked: () => boolean
  normalizeItem: (input: CreateItemInput, current?: ItemDetails) => ItemDetails
  id: (prefix: string) => string
  now: () => string
}

type SyncConfigResponse = {
  clientId?: string
  convexUrl?: string
  issuer?: string
  redirectUri?: string
}

const sensitiveErrorPattern = /(access_token|app_key|authorization|bearer|ciphertext|client_secret|cookie|credentialId|id_token|jwt|passcode|password|private|privateKey|refresh_token|secret|token|vault)/i
const urlErrorPattern = /(file:\/\/|[a-z]:\\|https?:\/\/\S+[?&][^ \t\r\n]+)/i

export function createTauriSync<State extends VaultState>(access: SyncAccess<State>) {
  let syncing = false
  let activeSync: Promise<SyncStatus> | undefined
  accessNormalizeItem = access.normalizeItem

  const notify = (status: SyncStatus, vaultChanged = false, returnHome = vaultChanged) => {
    window.dispatchEvent(new CustomEvent<SyncUpdateEvent>('klarkey-sync-changed', { detail: { status, vaultChanged, returnHome } }))
  }

  window.addEventListener('klarkey-oauth-callback', (event) => {
    const urls = (event as CustomEvent<string[]>).detail ?? []
    void completeCallback(urls[0])
  })

  async function status(): Promise<SyncStatus> {
    const state = access.loadState()
    const sync = viewSyncState(state)
    const config = await readConfig().catch(() => undefined)
    return {
      configured: Boolean(config),
      signedIn: Boolean(sync.session),
      syncing,
      deviceId: sync.deviceId,
      deviceName: deviceName(),
      account: sync.session?.account,
      lastSyncAt: sync.lastSyncAt,
      lastError: sync.lastError,
      conflictCount: sync.conflictCount,
      serverSequence: sync.serverSequence,
    }
  }

  async function signIn() {
    if (!access.requireUnlocked()) return setError('Unlock Klarkey before connecting sync.')
    const config = await requireConfig()
    const verifier = generateCodeVerifier()
    const pending = { state: randomBase64Url(18), verifier, nonce: generateNonce(), createdAt: Date.now() }
    const state = access.loadState()
    const sync = ensureSyncState(state)
    sync.pendingOAuth = pending
    sync.lastError = undefined
    access.saveState(state)
    const url = buildAuthorizeUrl(config, {
      scope: ['openid', 'profile', 'email', 'offline_access'],
      state: pending.state,
      nonce: pending.nonce,
      codeChallenge: await generateCodeChallenge(verifier),
      codeChallengeMethod: 'S256',
    })
    await access.nativeCall('open_external_url', { url })
    return status()
  }

  async function signOut() {
    const state = access.loadState()
    const sync = ensureSyncState(state)
    sync.session = undefined
    sync.pendingOAuth = undefined
    sync.lastError = undefined
    access.saveState(state)
    const next = await status()
    notify(next)
    return next
  }

  async function syncNow(options: { fullPull?: boolean } = {}) {
    if (!access.requireUnlocked()) return setError('Unlock Klarkey before syncing.')
    activeSync ??= runSync(options).finally(() => { activeSync = undefined })
    return activeSync
  }

  async function completeCallback(callbackUrl: string | undefined) {
    if (!callbackUrl) return
    if (!access.requireUnlocked()) {
      await setError('Unlock Klarkey, then start sync sign-in again.')
      return
    }
    const state = access.loadState()
    const sync = ensureSyncState(state)
    const pending = sync.pendingOAuth
    if (!pending) return
    try {
      const config = await requireConfig()
      const callback = parseAveOAuthCallback(callbackUrl)
      if (!isFreshPendingOAuthRequest(pending)) {
        throw new Error('Ave sign-in request expired. Try again.')
      }
      if (pending.state !== callback.state) {
        throw new Error('Ave sign-in state did not match this Klarkey session.')
      }
      sync.session = await exchangeOAuthCode(config, callbackUrl, callback.code, pending.verifier, pending.nonce)
      sync.pendingOAuth = undefined
      ensureAccountState(sync, sync.session.account.aveIdentityId)
      sync.lastError = undefined
      access.saveState(state)
      await syncNow({ fullPull: true })
    } catch (error) {
      await setError(safeSyncErrorMessage(error, 'Ave sign-in failed.'))
    }
  }

  async function runSync(options: { fullPull?: boolean }) {
    const config = await requireConfig()
    const state = access.loadState()
    const sync = ensureSyncState(state)
    if (!sync.session) throw new Error('Sign in with Ave before syncing.')
    syncing = true
    notify(await status())
    let vaultChanged: boolean
    try {
      sync.session = await refreshSyncSession(config, sync.session)
      ensureAccountState(sync, sync.session.account.aveIdentityId)
      const client = new ConvexHttpClient(config.convexUrl, { auth: sync.session.idToken, logger: false })
      await registerDeviceIfNeeded(client, sync)
      const pulled = await pullRemote(client, sync, state, options)
      const pushed = await pushLocal(client, sync, state, pulled.vaultKey)
      sync.serverSequence = Math.max(pulled.sequence, pushed.sequence)
      sync.lastSyncAt = access.now()
      sync.lastError = pulled.decryptFailures + pushed.decryptFailures > 0 ? `${pulled.decryptFailures + pushed.decryptFailures} sync records need repair from another device.` : undefined
      vaultChanged = pulled.appliedCount > 0 || pushed.appliedCount > 0
      access.saveState(state)
    } catch (error) {
      sync.lastError = safeSyncErrorMessage(error, 'Sync failed.')
      access.saveState(state)
      throw error
    } finally {
      syncing = false
    }
    const next = await status()
    notify(next, vaultChanged)
    return next
  }

  async function pullRemote(client: ConvexHttpClient, sync: TauriSyncState, state: State, options: { fullPull?: boolean }) {
    const since = options.fullPull || (sync.serverSequence > 0 && Object.keys(sync.records).length === 0) ? 0 : sync.serverSequence
    const pull = await client.query(syncFns.pullSince, { since, limit: 500 }).then(normalizePullResult)
    const vaultKey = pull.wrappedVaultKey ? await unwrapVaultKey(sync.session!.appKey, pull.wrappedVaultKey) : await ensureVaultKey(client, sync.session!)
    const dirty = await dirtyLocalRecords(recordsFromState(state), Object.values(sync.records))
    let sequence = Math.max(since, pull.sequence)
    let decryptFailures = 0
    let appliedCount = 0
    for (const encrypted of pull.records) {
      sequence = Math.max(sequence, encrypted.serverSequence)
      const local = sync.records[encrypted.recordId]
      if (local?.contentHash === encrypted.contentHash) {
        sync.records[encrypted.recordId] = { ...local, revision: Math.max(local.revision, encrypted.revision), serverSequence: encrypted.serverSequence, deletedAt: encrypted.deletedAt }
        continue
      }
      let plain: PlainVaultRecord
      try {
        plain = await decryptSyncRecord(vaultKey, sync.session!.account.aveIdentityId, encrypted)
      } catch {
        decryptFailures++
        sync.records[encrypted.recordId] = { recordId: encrypted.recordId, kind: local?.kind, itemId: local?.itemId, credentialId: local?.credentialId, revision: encrypted.revision, contentHash: '', serverSequence: encrypted.serverSequence, deletedAt: encrypted.deletedAt }
        continue
      }
      if (local?.contentHash && local.contentHash !== encrypted.contentHash && local.revision >= encrypted.revision) {
        sync.conflictCount++
        continue
      }
      const dirtyRecord = dirty.get(encrypted.recordId)
      if (local?.contentHash && dirtyRecord && dirtyRecord.contentHash !== encrypted.contentHash) {
        preserveSyncConflict(state, dirtyRecord.record)
        sync.conflictCount++
      }
      applySyncRecord(state, plain)
      appliedCount++
      sync.records[encrypted.recordId] = { recordId: encrypted.recordId, ...recordMetadata(plain), revision: encrypted.revision, contentHash: encrypted.contentHash, serverSequence: encrypted.serverSequence, deletedAt: encrypted.deletedAt }
    }
    return { sequence, vaultKey, decryptFailures, appliedCount }
  }

  async function pushLocal(client: ConvexHttpClient, sync: TauriSyncState, state: State, vaultKey: Uint8Array) {
    const active = recordsFromState(state)
    const records = [...active, ...missingDeletedRecords(active, Object.values(sync.records))]
    const encrypted = []
    const plainById = new Map<string, PlainVaultRecord>()
    for (const record of records) {
      const hash = await hashPlainRecord(record)
      const current = sync.records[record.recordId]
      if (current?.contentHash === hash) {
        sync.records[record.recordId] = { ...current, ...recordMetadata(record), contentHash: hash }
        continue
      }
      const revision = (current?.revision ?? 0) + 1
      encrypted.push(await encryptPlainRecord(vaultKey, sync.session!.account.aveIdentityId, sync.deviceId, revision, record))
      plainById.set(record.recordId, record)
    }
    if (encrypted.length === 0) return { sequence: sync.serverSequence, appliedCount: 0, decryptFailures: 0 }
    let sequence = sync.serverSequence
    let appliedCount = 0
    let decryptFailures = 0
    for (let offset = 0; offset < encrypted.length; offset += maxPushBatchRecords) {
      const result = await client.mutation(syncFns.pushBatch, { records: encrypted.slice(offset, offset + maxPushBatchRecords) }).then(normalizePushResult)
      sequence = Math.max(sequence, result.sequence)
      for (const accepted of result.accepted) {
        const plain = plainById.get(accepted.recordId)
        sync.records[accepted.recordId] = { recordId: accepted.recordId, ...recordMetadata(plain), revision: accepted.revision, contentHash: accepted.contentHash, serverSequence: accepted.serverSequence, deletedAt: plain?.deletedAt }
      }
      for (const conflict of result.conflicts) {
        const local = plainById.get(conflict.recordId)
        if (local) {
          preserveSyncConflict(state, local)
          sync.conflictCount++
        }
        try {
          const plain = await decryptSyncRecord(vaultKey, sync.session!.account.aveIdentityId, conflict)
          applySyncRecord(state, plain)
          appliedCount++
          sync.records[conflict.recordId] = { recordId: conflict.recordId, ...recordMetadata(plain), revision: conflict.revision, contentHash: conflict.contentHash, serverSequence: conflict.serverSequence, deletedAt: conflict.deletedAt }
        } catch {
          decryptFailures++
        }
      }
    }
    return { sequence, appliedCount, decryptFailures }
  }

  async function ensureVaultKey(client: ConvexHttpClient, session: SyncSession) {
    const existing = await client.mutation(syncFns.bootstrapVault, { schemaVersion: SYNC_SCHEMA_VERSION }).then(normalizeBootstrapResult)
    if (existing.wrappedVaultKey) return unwrapVaultKey(session.appKey, existing.wrappedVaultKey)
    const vaultKey = crypto.getRandomValues(new Uint8Array(32))
    const setup = await client.mutation(syncFns.bootstrapVault, { schemaVersion: SYNC_SCHEMA_VERSION, wrappedVaultKey: await wrapVaultKey(session.appKey, vaultKey) }).then(normalizeBootstrapResult)
    return setup.wrappedVaultKey ? unwrapVaultKey(session.appKey, setup.wrappedVaultKey) : vaultKey
  }

  async function registerDeviceIfNeeded(client: ConvexHttpClient, sync: TauriSyncState) {
    if (Date.now() - sync.lastDeviceRegisteredAt < deviceRegistrationIntervalMs) return
    await client.mutation(syncFns.registerDevice, { deviceId: sync.deviceId, name: deviceName(), platform: platformName() })
    sync.lastDeviceRegisteredAt = Date.now()
  }

  async function readConfig(): Promise<AveSyncConfig | undefined> {
    const response = await access.nativeCall<SyncConfigResponse>('sync_config')
    const clientId = response.clientId?.trim()
    const convexUrl = normalizeSecureSyncUrl(response.convexUrl)
    if (!clientId || !convexUrl) return undefined
    return { clientId, convexUrl, issuer: response.issuer?.trim() || 'https://aveid.net', redirectUri: response.redirectUri?.trim() || 'klarkey://oauth/callback' }
  }

  async function requireConfig() {
    const config = await readConfig()
    if (!config) throw new Error(secureSyncUrlError('KLARKEY_CONVEX_URL'))
    return config
  }

  async function setError(message: string) {
    const state = access.loadState()
    ensureSyncState(state).lastError = message
    access.saveState(state)
    const next = await status()
    notify(next)
    return next
  }

  return { status, signIn, signOut, syncNow }
}

async function dirtyLocalRecords(records: PlainVaultRecord[], states: SyncRecordState[]) {
  const stateById = new Map(states.map((state) => [state.recordId, state]))
  const dirty = new Map<string, { record: PlainVaultRecord; contentHash: string }>()
  for (const record of records) {
    const contentHash = await hashPlainRecord(record)
    if (stateById.get(record.recordId)?.contentHash !== contentHash) dirty.set(record.recordId, { record, contentHash })
  }
  return dirty
}

function ensureSyncState<State extends VaultState>(state: State) {
  state.sync ??= { deviceId: `device_${randomBase64Url(9)}`, conflictCount: 0, serverSequence: 0, lastDeviceRegisteredAt: 0, records: {} }
  return state.sync
}

function viewSyncState(state: VaultState): TauriSyncState {
  return state.sync ?? { deviceId: 'tauri-local', conflictCount: 0, serverSequence: 0, lastDeviceRegisteredAt: 0, records: {} }
}

function ensureAccountState(sync: TauriSyncState, accountId: string) {
  if (sync.accountId === accountId) return
  sync.accountId = accountId
  sync.records = {}
  sync.conflictCount = 0
  sync.serverSequence = 0
  sync.lastDeviceRegisteredAt = 0
  sync.lastSyncAt = undefined
}

function recordsFromState(state: VaultState): PlainVaultRecord[] {
  return [
    ...state.items.map((item) => recordFromItemDetails(item, item.updatedAt || new Date().toISOString())),
    ...state.sitePasskeys.flatMap(sitePasskeyRecord),
    { kind: 'settings', recordId: 'settings:user', settings: state.settings, updatedAt: new Date().toISOString() },
  ]
}

function sitePasskeyRecord(value: unknown): PlainVaultRecord[] {
  const passkey = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  const credentialId = stringField(passkey, 'credentialId')
  const itemId = stringField(passkey, 'itemId')
  if (!credentialId || !itemId) return []
  return [{
    kind: 'site-passkey',
    recordId: `site-passkey:${credentialId}`,
    passkeyId: stringField(passkey, 'id') ?? credentialId,
    itemId,
    credentialId,
    label: stringField(passkey, 'label') ?? 'Saved passkey',
    rpId: stringField(passkey, 'rpId'),
    userName: stringField(passkey, 'userName'),
    userHandle: stringField(passkey, 'userHandle'),
    transports: arrayStrings(passkey?.transports),
    privateKeyJwk: validPrivateKeyJwk(passkey?.privateKeyJwk),
    signCount: typeof passkey?.signCount === 'number' ? passkey.signCount : 0,
    createdAt: stringField(passkey, 'createdAt') ?? new Date().toISOString(),
    lastUsedAt: stringField(passkey, 'lastUsedAt'),
    syncedCounter: true,
  }]
}

function missingDeletedRecords(activeRecords: PlainVaultRecord[], states: SyncRecordState[]) {
  const activeIds = new Set(activeRecords.map((record) => record.recordId))
  return states.flatMap((state): PlainVaultRecord[] => {
    if (state.deletedAt || activeIds.has(state.recordId)) return []
    const deletedAt = Date.now()
    if (state.kind === 'item' || state.recordId.startsWith('item:')) {
      const itemId = state.itemId ?? state.recordId.slice('item:'.length)
      return [{ kind: 'item', recordId: state.recordId, itemId, itemType: 'login', item: { itemId, itemType: 'login', itemName: 'Deleted item', password: '', preserveEmptyPassword: true }, updatedAt: new Date(deletedAt).toISOString(), deletedAt }]
    }
    if (state.kind === 'site-passkey' || state.recordId.startsWith('site-passkey:')) {
      const credentialId = state.credentialId ?? state.recordId.slice('site-passkey:'.length)
      return [{ kind: 'site-passkey', recordId: `site-passkey:${credentialId}`, passkeyId: credentialId, itemId: state.itemId ?? 'deleted', credentialId, label: 'Deleted passkey', transports: [], signCount: 0, createdAt: new Date(deletedAt).toISOString(), syncedCounter: true, deletedAt }]
    }
    return []
  })
}

function applySyncRecord<State extends VaultState>(state: State, record: PlainVaultRecord) {
  if (record.kind === 'item') {
    state.items = record.deletedAt ? state.items.filter((item) => item.itemId !== record.itemId) : upsertItem(state, record)
  } else if (record.kind === 'settings' && !record.deletedAt) {
    state.settings = { ...DEFAULT_SETTINGS, ...record.settings }
  } else if (record.kind === 'site-passkey') {
    applySitePasskey(state, record)
  }
}

function upsertItem<State extends VaultState>(state: State, record: Extract<PlainVaultRecord, { kind: 'item' }>) {
  const index = state.items.findIndex((item) => item.itemId === record.itemId)
  const item = accessNormalizeItem(record.item, index >= 0 ? state.items[index] : undefined)
  item.updatedAt = record.updatedAt
  if (index < 0) return [...state.items, item]
  const items = [...state.items]
  items[index] = item
  return items
}

let accessNormalizeItem: (input: CreateItemInput, current?: ItemDetails) => ItemDetails

function applySitePasskey<State extends VaultState>(state: State, record: Extract<PlainVaultRecord, { kind: 'site-passkey' }>) {
  state.sitePasskeys = record.deletedAt
    ? state.sitePasskeys.filter((passkey) => stringField(passkey as Record<string, unknown>, 'credentialId') !== record.credentialId)
    : [
      ...state.sitePasskeys.filter((passkey) => stringField(passkey as Record<string, unknown>, 'credentialId') !== record.credentialId),
      { id: record.passkeyId, itemId: record.itemId, label: record.label, credentialId: record.credentialId, rpId: record.rpId, userName: record.userName, userHandle: record.userHandle, transports: record.transports, privateKeyJwk: record.privateKeyJwk, signCount: record.signCount, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt },
    ]
  for (const item of state.items) {
    item.passkeys = item.passkeys.filter((passkey) => passkey.credentialId !== record.credentialId)
    if (!record.deletedAt && item.itemId === record.itemId) item.passkeys.push({ id: record.passkeyId, label: record.label, credentialId: record.credentialId, rpId: record.rpId, userName: record.userName, createdAt: record.createdAt, lastUsedAt: record.lastUsedAt })
  }
}

function preserveSyncConflict<State extends VaultState>(state: State, record: PlainVaultRecord) {
  if (record.kind !== 'item' || record.deletedAt) return
  state.items.push(accessNormalizeItem({ ...record.item, itemId: `item_${randomBase64Url(9)}`, itemName: `${record.item.itemName} conflict copy` }))
}

function recordMetadata(record: PlainVaultRecord | undefined) {
  if (!record) return {}
  if (record.kind === 'item') return { kind: record.kind, itemId: record.itemId }
  if (record.kind === 'site-passkey') return { kind: record.kind, itemId: record.itemId, credentialId: record.credentialId }
  return { kind: record.kind }
}

function stringField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function validPrivateKeyJwk(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const jwk = value as JsonWebKey
  return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string' && typeof jwk.d === 'string' ? jwk : undefined
}

function randomBase64Url(bytes: number) {
  const random = crypto.getRandomValues(new Uint8Array(bytes))
  let binary = ''
  for (const byte of random) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function safeSyncErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const message = error.message.trim()
  return !message || message.length > 160 || sensitiveErrorPattern.test(message) || urlErrorPattern.test(message) ? fallback : message
}

function platformName() {
  if (navigator.userAgent.includes('Windows')) return 'win32'
  if (navigator.userAgent.includes('Mac')) return 'darwin'
  return 'linux'
}

function deviceName() {
  return navigator.platform || 'Klarkey Desktop'
}

export function bindSyncNormalizer(normalize: (input: CreateItemInput, current?: ItemDetails) => ItemDetails) {
  accessNormalizeItem = normalize
}
