import { buildAuthorizeUrl, generateCodeChallenge, generateCodeVerifier, generateNonce } from '@ave-id/sdk'
import { ConvexHttpClient } from 'convex/browser'
import { parseAveOAuthCallback } from '@/shared/ave-oauth'
import { SYNC_SCHEMA_VERSION, type LocalSyncRecord, type PlainVaultRecord, type SyncStatus, type SyncUpdateEvent } from '@/shared/sync'
import { normalizeSecureSyncUrl, secureSyncUrlError } from '@/shared/sync-transport'
import type { CreateItemInput, ItemDetails, UserSettings } from '@/shared/types'
import { decryptSyncRecord, encryptPlainRecord, hashPlainRecord, unwrapVaultKey, wrapVaultKey } from '@/desktop/sync-crypto'
import { missingDeletedRecords, recordsFromState } from '@/desktop/sync-records'
import { deviceRegistrationIntervalMs, maxPushBatchRecords, normalizeBootstrapResult, normalizePullResult, normalizePushResult, syncFns } from '@/desktop/sync-remote'
import { exchangeOAuthCode, isFreshPendingOAuthRequest, refreshSyncSession, type AveSyncConfig, type PendingOAuthRequest, type SyncSession } from '@/desktop/sync-session'
import {
  applySyncRecord,
  bindSyncNormalizer,
  deviceName,
  ensureAccountState,
  ensureSyncState,
  platformName,
  preserveSyncConflict,
  randomBase64Url,
  recordMetadata,
  safeSyncErrorMessage,
  viewSyncState,
} from '@/desktop/sync-state'

export type SyncRecordState = {
  recordId: string
  kind?: PlainVaultRecord['kind']
  itemId?: string
  credentialId?: string
  revision: number
  contentHash: string
  serverSequence: number
  deletedAt?: number
}

export type DesktopSyncState = {
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

export type VaultState = {
  items: ItemDetails[]
  settings: UserSettings
  sitePasskeys: unknown[]
  sync?: DesktopSyncState
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

const pullBatchLimit = 200
const maxPullPages = 100
const maxPushBatchPayloadBytes = 512 * 1024

export function createDesktopSync<State extends VaultState>(access: SyncAccess<State>) {
  let syncing = false
  let activeSync: Promise<SyncStatus> | undefined
  let syncSuspensionDepth = 0
  let deferredSyncOptions: { fullPull?: boolean } | undefined
  bindSyncNormalizer(access.normalizeItem)

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

  async function pullRemote(client: ConvexHttpClient, sync: DesktopSyncState, state: State, options: { fullPull?: boolean }) {
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

  async function pushLocal(client: ConvexHttpClient, sync: DesktopSyncState, state: State, vaultKey: Uint8Array) {
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

  async function registerDeviceIfNeeded(client: ConvexHttpClient, sync: DesktopSyncState) {
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

export { bindSyncNormalizer } from '@/desktop/sync-state'
