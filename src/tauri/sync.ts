import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, generateNonce } from '@ave-id/sdk'
import { ConvexHttpClient } from 'convex/browser'
import { parseAveOAuthCallback } from '@/shared/ave-oauth'
import { SYNC_SCHEMA_VERSION, type LocalSyncRecord, type PlainVaultRecord, type SyncStatus, type SyncUpdateEvent } from '@/shared/sync'
import { normalizeSecureSyncUrl, secureSyncUrlError } from '@/shared/sync-transport'
import { DEFAULT_SETTINGS, type CreateItemInput, type ItemDetails, type UserSettings } from '@/shared/types'
import { decryptSyncRecord, encryptPlainRecord, hashPlainRecord, unwrapVaultKey, wrapVaultKey } from '@/tauri/sync-crypto'
import { missingDeletedRecords, recordsFromState, stringField } from '@/tauri/sync-records'
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
  pendingDeletes?: Record<string, PlainVaultRecord>
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
const pullBatchLimit = 200
const maxPullPages = 100
const maxPushBatchPayloadBytes = 512 * 1024

export function createTauriSync<State extends VaultState>(access: SyncAccess<State>) {
  let syncing = false
  let activeSync: Promise<SyncStatus> | undefined
  let syncSuspensionDepth = 0
  let deferredSyncOptions: { fullPull?: boolean } | undefined
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
    if (syncSuspensionDepth > 0) {
      requestSyncAfterSuspension(options)
      return status()
    }
    activeSync ??= runSync(options).finally(() => { activeSync = undefined })
    return activeSync
  }

  async function suspendSync() {
    if (activeSync) {
      await activeSync.catch(() => undefined)
    }

    syncSuspensionDepth += 1
    let released = false

    return () => {
      if (released) return
      released = true
      syncSuspensionDepth = Math.max(0, syncSuspensionDepth - 1)
      if (syncSuspensionDepth > 0 || !deferredSyncOptions) return

      const options = deferredSyncOptions
      deferredSyncOptions = undefined
      void syncNow(options).catch(() => undefined)
    }
  }

  function requestSyncAfterSuspension(options: { fullPull?: boolean } = {}) {
    deferredSyncOptions = { fullPull: Boolean(deferredSyncOptions?.fullPull || options.fullPull) }
    if (syncSuspensionDepth === 0) {
      const requestedOptions = deferredSyncOptions
      deferredSyncOptions = undefined
      void syncNow(requestedOptions).catch(() => undefined)
    }
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
    const dirty = await dirtyLocalRecords(recordsFromState(state), Object.values(sync.records))
    let vaultKey: Uint8Array | undefined
    let sequence = since
    let nextSince = since
    let decryptFailures = 0
    let appliedCount = 0

    for (let page = 0; page < maxPullPages; page++) {
      const pull = await client.query(syncFns.pullSince, { since: nextSince, limit: pullBatchLimit }).then(normalizePullResult)
      sequence = Math.max(sequence, pull.sequence)
      if (!vaultKey) {
        vaultKey = pull.wrappedVaultKey ? await unwrapVaultKey(sync.session!.appKey, pull.wrappedVaultKey) : await ensureVaultKey(client, sync.session!)
      }

      let pageSequence = nextSince
      for (const encrypted of pull.records) {
        pageSequence = Math.max(pageSequence, encrypted.serverSequence)
        const local = sync.records[encrypted.recordId]
        if (local?.contentHash === encrypted.contentHash) {
          sync.records[encrypted.recordId] = { ...local, revision: Math.max(local.revision, encrypted.revision), serverSequence: encrypted.serverSequence, deletedAt: encrypted.deletedAt }
          if (encrypted.deletedAt) delete sync.pendingDeletes?.[encrypted.recordId]
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
        if (sync.pendingDeletes?.[encrypted.recordId]) {
          if (plain.deletedAt) delete sync.pendingDeletes[encrypted.recordId]
          sync.records[encrypted.recordId] = { recordId: encrypted.recordId, ...recordMetadata(plain), revision: encrypted.revision, contentHash: encrypted.contentHash, serverSequence: encrypted.serverSequence, deletedAt: encrypted.deletedAt }
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

      if (pull.records.length < pullBatchLimit) {
        return { sequence, vaultKey: vaultKey ?? await ensureVaultKey(client, sync.session!), decryptFailures, appliedCount }
      }
      if (pageSequence <= nextSince) throw new Error('Sync pull did not advance.')
      nextSince = pageSequence
    }

    throw new Error('Sync pull returned too many records at once.')
  }

  async function pushLocal(client: ConvexHttpClient, sync: TauriSyncState, state: State, vaultKey: Uint8Array) {
    const active = recordsFromState(state)
    const pendingDeletes = Object.values(sync.pendingDeletes ?? {})
    const records = [...active, ...pendingDeletes, ...missingDeletedRecords([...active, ...pendingDeletes], Object.values(sync.records))]
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
    for (const batch of buildPushBatches(encrypted)) {
      const result = await client.mutation(syncFns.pushBatch, { records: batch }).then(normalizePushResult)
      sequence = Math.max(sequence, result.sequence)
      for (const accepted of result.accepted) {
        const plain = plainById.get(accepted.recordId)
        sync.records[accepted.recordId] = { recordId: accepted.recordId, ...recordMetadata(plain), revision: accepted.revision, contentHash: accepted.contentHash, serverSequence: accepted.serverSequence, deletedAt: plain?.deletedAt }
        if (plain?.deletedAt) delete sync.pendingDeletes?.[accepted.recordId]
      }
      for (const conflict of result.conflicts) {
        const local = plainById.get(conflict.recordId)
        if (local?.deletedAt) {
          sync.conflictCount++
          try {
            const plain = await decryptSyncRecord(vaultKey, sync.session!.account.aveIdentityId, conflict)
            if (plain.deletedAt) delete sync.pendingDeletes?.[conflict.recordId]
            sync.records[conflict.recordId] = { recordId: conflict.recordId, ...recordMetadata(plain), revision: conflict.revision, contentHash: conflict.contentHash, serverSequence: conflict.serverSequence, deletedAt: conflict.deletedAt }
          } catch {
            decryptFailures++
          }
          continue
        }
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

  return { status, signIn, signOut, syncNow, suspendSync, requestSyncAfterSuspension }
}

const syncPayloadEncoder = new TextEncoder()

function encodedJsonBytes(value: unknown) {
  return syncPayloadEncoder.encode(JSON.stringify(value)).byteLength
}

export function buildPushBatches(records: LocalSyncRecord[]) {
  const batches: LocalSyncRecord[][] = []
  let current: LocalSyncRecord[] = []
  let currentBytes = 2

  for (const record of records) {
    const recordBytes = encodedJsonBytes(record) + (current.length > 0 ? 1 : 0)
    if (
      current.length > 0 &&
      (current.length >= maxPushBatchRecords || currentBytes + recordBytes > maxPushBatchPayloadBytes)
    ) {
      batches.push(current)
      current = []
      currentBytes = 2
    }

    current.push(record)
    currentBytes += encodedJsonBytes(record) + (current.length > 1 ? 1 : 0)
  }

  if (current.length > 0) batches.push(current)
  return batches
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
  sync.pendingDeletes = {}
  sync.conflictCount = 0
  sync.serverSequence = 0
  sync.lastDeviceRegisteredAt = 0
  sync.lastSyncAt = undefined
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
