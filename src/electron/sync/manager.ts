import { randomBytes } from 'node:crypto'
import { hostname, platform } from 'node:os'
import { shell } from 'electron'
import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import {
  buildAuthorizeUrl,
  exchangeCode,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
} from '@ave-id/sdk'
import { parseAveOAuthCallback } from '@/shared/ave-oauth'
import {
  SYNC_SCHEMA_VERSION,
  type LocalSyncRecord,
  type PlainVaultRecord,
  type SyncRunOptions,
  type SyncStatus,
} from '@/shared/sync'
import type { VaultRepository } from '@/electron/repository'
import { decryptSyncRecord, encryptPlainRecord, hashPlainRecord, unwrapVaultKey, wrapVaultKey } from '@/electron/sync/crypto'
import { getEnvValue } from '@/electron/sync/env'
import { buildDirtyLocalRecordMap, buildMissingDeletedRecords } from '@/electron/sync/local-dirty'
import {
  acceptPushedRecords, countSyncConflicts, countRecordStates, ensureSyncAccountState, getRecordState, getSyncMeta,
  listRecordStates, recordConflict, setSyncMeta, syncRecordMetadata, upsertRecordState,
} from '@/electron/sync/state'
import {
  clearPendingOAuthRequest, clearSyncSession, readPendingOAuthRequest, readSyncSession, refreshSyncSession,
  sessionFromTokenResponse, tryReadSyncSession, writePendingOAuthRequest, writeSyncSession,
  type AveSyncConfig, type SyncSession,
} from '@/electron/sync/session'
import type { DatabaseHandle } from '@/electron/database'
import { isExternalBrowserUrl, safeErrorMessage } from '@/electron/security'
import { normalizeSecureSyncUrl, secureSyncUrlError } from '@/shared/sync-transport'
import {
  deviceRegistrationIntervalMs,
  maxPushBatchRecords,
  normalizeBootstrapResult,
  normalizePullResult,
  normalizePushResult,
  normalizeRemoteSyncStatus,
  redirectUri,
  syncFns,
  type PushLocalResult,
  type PullRemoteResult,
  type RemoteSyncStatus,
} from '@/electron/sync/remote-contract'

export class SyncManager {
  private readonly db: DatabaseHandle['db']
  private readonly deviceId: string
  private syncing = false
  private lastError?: string
  private realtimeClient?: ConvexClient
  private realtimeUnsubscribe?: () => void
  private realtimeKey?: string
  private activeSync?: Promise<SyncStatus>
  private lastRunVaultChanged = false
  private pendingRemoteSequence = 0
  private realtimeOnRemoteChange?: () => void

  constructor(database: DatabaseHandle) {
    this.db = database.db
    this.deviceId = this.ensureDeviceId()
  }

  getStatus(): SyncStatus {
    const config = this.config()
    const session = tryReadSyncSession()
    const convexUrl = this.convexUrl()
    return {
      configured: Boolean(config && convexUrl),
      signedIn: Boolean(session),
      syncing: this.syncing,
      deviceId: this.deviceId,
      deviceName: this.deviceName(),
      account: session?.account,
      lastSyncAt: getSyncMeta(this.db, 'lastSyncAt'),
      lastError: this.lastError ?? getSyncMeta(this.db, 'lastSyncError'),
      conflictCount: countSyncConflicts(this.db),
      serverSequence: Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0'),
    }
  }

  async startSignIn() {
    const config = this.requireConfig()
    const verifier = generateCodeVerifier()
    const state = randomBytes(18).toString('base64url')
    const nonce = generateNonce()
    const codeChallenge = await generateCodeChallenge(verifier)
    writePendingOAuthRequest({
      state,
      verifier,
      nonce,
      createdAt: Date.now(),
    })

    const url = buildAuthorizeUrl(config, {
      scope: ['openid', 'profile', 'email', 'offline_access'],
      state,
      nonce,
      codeChallenge,
      codeChallengeMethod: 'S256',
    })
    if (!isExternalBrowserUrl(url)) {
      throw new Error('Sync sign-in provider URL is not trusted.')
    }
    await shell.openExternal(url)
    return this.getStatus()
  }

  async completeCallback(callbackUrl: string) {
    const config = this.requireConfig()
    const callback = parseAveOAuthCallback(callbackUrl)
    const pending = readPendingOAuthRequest()
    if (!pending || pending.state !== callback.state) {
      throw new Error('Ave sign-in state did not match this Klarkey session.')
    }

    const tokens = await exchangeCode(config, {
      code: callback.code,
      codeVerifier: pending.verifier,
    })
    const session = await sessionFromTokenResponse(config, callbackUrl, tokens, pending.nonce)
    writeSyncSession(session)
    ensureSyncAccountState(this.db, session.account.aveIdentityId)
    clearPendingOAuthRequest()
    this.lastError = undefined
    setSyncMeta(this.db, 'lastSyncError', '')
    return this.getStatus()
  }

  signOut() {
    this.stopRealtime()
    clearSyncSession()
    clearPendingOAuthRequest()
    return this.getStatus()
  }

  didLastRunChangeVault() {
    return this.lastRunVaultChanged
  }

  startRealtime(onRemoteChange: () => void, onStatusChange?: (status: SyncStatus) => void) {
    const config = this.config()
    const session = tryReadSyncSession()
    const convexUrl = this.convexUrl()
    if (!config || !session || !convexUrl) {
      return false
    }

    this.realtimeOnRemoteChange = onRemoteChange

    const key = `${convexUrl}:${session.account.aveIdentityId}`
    ensureSyncAccountState(this.db, session.account.aveIdentityId)
    if (this.realtimeKey === key && this.realtimeClient && !this.realtimeClient.closed) {
      return true
    }

    this.stopRealtime()
    const client = new ConvexClient(convexUrl)
    client.setAuth(async () => {
      const current = tryReadSyncSession()
      if (!current) {
        return null
      }

      try {
        const refreshed = await refreshSyncSession(config, current)
        return refreshed.idToken
      } catch (error) {
        const message = safeErrorMessage(error, 'Sync session refresh failed.')
        this.lastError = message
        setSyncMeta(this.db, 'lastSyncError', message)
        return null
      }
    }, () => {
      onStatusChange?.(this.getStatus())
    })

    this.realtimeUnsubscribe = client.onUpdate(syncFns.getSyncStatus, {}, (remote: unknown) => {
      let status: RemoteSyncStatus
      try {
        status = normalizeRemoteSyncStatus(remote)
      } catch (error) {
        const message = safeErrorMessage(error, 'Realtime sync returned an invalid status.')
        this.lastError = message
        setSyncMeta(this.db, 'lastSyncError', message)
        onStatusChange?.(this.getStatus())
        return
      }
      const localSequence = Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0')
      if (status.sequence > localSequence) {
        if (this.syncing || this.activeSync) {
          this.pendingRemoteSequence = Math.max(this.pendingRemoteSequence, status.sequence)
        } else {
          onRemoteChange()
        }
      }
      onStatusChange?.(this.getStatus())
    }, (error) => {
      const message = safeErrorMessage(error, 'Realtime sync is unavailable.')
      this.lastError = message
      setSyncMeta(this.db, 'lastSyncError', message)
      onStatusChange?.(this.getStatus())
    })
    this.realtimeClient = client
    this.realtimeKey = key
    return true
  }

  stopRealtime() {
    this.realtimeUnsubscribe?.()
    this.realtimeUnsubscribe = undefined
    this.realtimeOnRemoteChange = undefined
    this.pendingRemoteSequence = 0
    const client = this.realtimeClient
    this.realtimeClient = undefined
    this.realtimeKey = undefined
    void client?.close()
  }

  async syncNow(repository: VaultRepository, options: SyncRunOptions = {}) {
    this.activeSync ??= this.runSync(repository, options).finally(() => {
      this.activeSync = undefined
    })
    return await this.activeSync
  }

  private async runSync(repository: VaultRepository, options: SyncRunOptions) {
    const config = this.requireConfig()
    let session = readSyncSession()
    if (!session) {
      throw new Error('Sign in with Ave before syncing.')
    }

    this.syncing = true
    this.lastError = undefined
    this.lastRunVaultChanged = false
    let followupRemoteChange = false
    let syncVaultKey: Buffer | undefined
    try {
      session = await refreshSyncSession(config, session)
      ensureSyncAccountState(this.db, session.account.aveIdentityId)
      const client = this.client(config, session)
      await this.registerDeviceIfNeeded(client)
      const pulled = await this.pullRemote(client, session, repository, options)
      syncVaultKey = pulled.vaultKey
      const pushed = await this.pushLocal(client, pulled.vaultKey, session, repository)
      const sequence = Math.max(pulled.sequence, pushed.sequence)
      setSyncMeta(this.db, 'lastServerSequence', String(sequence))
      setSyncMeta(this.db, 'lastSyncAt', new Date().toISOString())
      this.lastRunVaultChanged = pulled.appliedCount > 0 || pushed.appliedCount > 0
      if (this.pendingRemoteSequence > sequence) {
        followupRemoteChange = true
      }
      this.pendingRemoteSequence = 0
      const decryptFailures = pulled.decryptFailures + pushed.decryptFailures
      const repairMessage = decryptFailures > 0
        ? `${decryptFailures} sync record${decryptFailures === 1 ? '' : 's'} need repair from another device.`
        : ''
      this.lastError = repairMessage || undefined
      setSyncMeta(this.db, 'lastSyncError', repairMessage)
    } catch (error) {
      const message = safeErrorMessage(error, 'Sync failed.')
      this.lastError = message
      setSyncMeta(this.db, 'lastSyncError', message)
      throw error
    } finally {
      syncVaultKey?.fill(0)
      this.syncing = false
      if (followupRemoteChange) {
        queueMicrotask(() => this.realtimeOnRemoteChange?.())
      }
    }
    return this.getStatus()
  }

  private config(): AveSyncConfig | undefined {
    const clientId = getEnvValue('KLARKEY_AVE_CLIENT_ID', 'AVE_CLIENT_ID', 'VITE_KLARKEY_AVE_CLIENT_ID', 'VITE_AVE_CLIENT_ID')
    if (!clientId) {
      return undefined
    }
    return {
      clientId,
      redirectUri,
      issuer: 'https://aveid.net',
    }
  }

  private requireConfig() {
    const config = this.config()
    if (!config) {
      throw new Error('Set KLARKEY_AVE_CLIENT_ID or AVE_CLIENT_ID in .env.local before using Klarkey sync.')
    }
    this.requireConvexUrl()
    return config
  }

  private rawConvexUrl() {
    return getEnvValue('KLARKEY_CONVEX_URL', 'CONVEX_URL', 'VITE_KLARKEY_CONVEX_URL', 'VITE_CONVEX_URL')
  }

  private convexUrl() {
    return normalizeSecureSyncUrl(this.rawConvexUrl())
  }

  private requireConvexUrl() {
    const rawUrl = this.rawConvexUrl()
    if (!rawUrl) {
      throw new Error('Set KLARKEY_CONVEX_URL in .env.local before using Klarkey sync.')
    }
    const normalized = normalizeSecureSyncUrl(rawUrl)
    if (!normalized) {
      throw new Error(secureSyncUrlError('KLARKEY_CONVEX_URL'))
    }
    return normalized
  }

  private client(_config: AveSyncConfig, session: SyncSession) {
    return new ConvexHttpClient(this.requireConvexUrl(), { auth: session.idToken })
  }

  private async ensureVaultKey(client: ConvexHttpClient, session: SyncSession) {
    const existing = await client.mutation(syncFns.bootstrapVault, {
      schemaVersion: SYNC_SCHEMA_VERSION,
    }).then(normalizeBootstrapResult)

    if (existing.wrappedVaultKey) {
      return unwrapVaultKey(session.appKey, existing.wrappedVaultKey)
    }

    const vaultKey = randomBytes(32)
    const wrappedVaultKey = wrapVaultKey(session.appKey, vaultKey)
    const setup = await client.mutation(syncFns.bootstrapVault, {
      schemaVersion: SYNC_SCHEMA_VERSION,
      wrappedVaultKey,
    }).then(normalizeBootstrapResult)
    if (setup.wrappedVaultKey) {
      vaultKey.fill(0)
      return unwrapVaultKey(session.appKey, setup.wrappedVaultKey)
    }
    return vaultKey
  }

  private async registerDeviceIfNeeded(client: ConvexHttpClient) {
    const lastRegisteredAt = Number(getSyncMeta(this.db, 'lastDeviceRegisteredAt') ?? '0')
    if (Date.now() - lastRegisteredAt < deviceRegistrationIntervalMs) {
      return
    }

    await client.mutation(syncFns.registerDevice, {
      deviceId: this.deviceId,
      name: this.deviceName(),
      platform: platform(),
    })
    setSyncMeta(this.db, 'lastDeviceRegisteredAt', String(Date.now()))
  }

  private async pullRemote(client: ConvexHttpClient, session: SyncSession, repository: VaultRepository, options: SyncRunOptions): Promise<PullRemoteResult> {
    const storedSequence = Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0')
    const since = options.fullPull || (storedSequence > 0 && countRecordStates(this.db) === 0) ? 0 : storedSequence
    const pull = await client.query(syncFns.pullSince, { since, limit: 500 }).then(normalizePullResult)
    const dirtyLocalRecords = buildDirtyLocalRecordMap(repository.getSyncRecords(), listRecordStates(this.db))
    const vaultKey = pull.wrappedVaultKey
      ? unwrapVaultKey(session.appKey, pull.wrappedVaultKey)
      : await this.ensureVaultKey(client, session)
    let maxSequence = since
    let decryptFailures = 0
    let appliedCount = 0

    for (const encrypted of pull.records) {
      maxSequence = Math.max(maxSequence, encrypted.serverSequence)
      const localState = getRecordState(this.db, encrypted.recordId)
      if (localState?.contentHash === encrypted.contentHash) {
        upsertRecordState(this.db, {
          recordId: encrypted.recordId,
          kind: localState.kind,
          itemId: localState.itemId,
          credentialId: localState.credentialId,
          revision: Math.max(localState.revision, encrypted.revision),
          contentHash: encrypted.contentHash,
          serverSequence: encrypted.serverSequence,
          deletedAt: encrypted.deletedAt,
        })
        continue
      }

      let plain: PlainVaultRecord
      try {
        plain = decryptSyncRecord(vaultKey, session.account.aveIdentityId, encrypted)
      } catch {
        decryptFailures += 1
        upsertRecordState(this.db, {
          recordId: encrypted.recordId,
          kind: localState?.kind,
          itemId: localState?.itemId,
          credentialId: localState?.credentialId,
          revision: encrypted.revision,
          contentHash: '',
          serverSequence: encrypted.serverSequence,
          deletedAt: encrypted.deletedAt,
        })
        continue
      }
      if (localState && localState.contentHash && localState.contentHash !== encrypted.contentHash && localState.revision >= encrypted.revision) {
        recordConflict(this.db, encrypted.recordId, localState.contentHash, encrypted.contentHash)
        continue
      }

      const dirtyLocalRecord = dirtyLocalRecords.get(encrypted.recordId)
      if (localState?.contentHash && dirtyLocalRecord && dirtyLocalRecord.contentHash !== encrypted.contentHash) {
        repository.preserveSyncConflict(dirtyLocalRecord.record)
        recordConflict(this.db, encrypted.recordId, dirtyLocalRecord.contentHash, encrypted.contentHash)
      }

      repository.applySyncRecord(plain)
      appliedCount += 1
      const metadata = syncRecordMetadata(plain)
      upsertRecordState(this.db, {
        recordId: encrypted.recordId,
        kind: metadata.kind,
        itemId: metadata.itemId,
        credentialId: metadata.credentialId,
        revision: encrypted.revision,
        contentHash: encrypted.contentHash,
        serverSequence: encrypted.serverSequence,
        deletedAt: encrypted.deletedAt,
      })
    }

    return { sequence: Math.max(pull.sequence, maxSequence), vaultKey, decryptFailures, appliedCount }
  }

  private async pushLocal(client: ConvexHttpClient, vaultKey: Buffer, session: SyncSession, repository: VaultRepository): Promise<PushLocalResult> {
    const activeRecords = repository.getSyncRecords()
    const records = [...activeRecords, ...buildMissingDeletedRecords(activeRecords, listRecordStates(this.db))]
    const encryptedRecords: LocalSyncRecord[] = []
    const plainById = new Map<string, PlainVaultRecord>()
    const deletedAtByRecordId = new Map<string, number | undefined>()
    const metadataByRecordId = new Map<string, ReturnType<typeof syncRecordMetadata>>()

    for (const record of records) {
      const hash = hashPlainRecord(record)
      const state = getRecordState(this.db, record.recordId)
      const metadata = syncRecordMetadata(record)
      if (state?.contentHash === hash) {
        if (state.kind !== metadata.kind || state.itemId !== metadata.itemId || state.credentialId !== metadata.credentialId) {
          upsertRecordState(this.db, {
            ...state,
            ...metadata,
            contentHash: hash,
          })
        }
        continue
      }

      const revision = (state?.revision ?? 0) + 1
      encryptedRecords.push(encryptPlainRecord(vaultKey, session.account.aveIdentityId, this.deviceId, revision, record))
      plainById.set(record.recordId, record)
      deletedAtByRecordId.set(record.recordId, record.deletedAt)
      metadataByRecordId.set(record.recordId, metadata)
    }

    if (encryptedRecords.length === 0) {
      return { sequence: Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0'), appliedCount: 0, decryptFailures: 0 }
    }

    let appliedCount = 0
    let decryptFailures = 0
    let sequence = Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0')

    for (let offset = 0; offset < encryptedRecords.length; offset += maxPushBatchRecords) {
      const chunk = encryptedRecords.slice(offset, offset + maxPushBatchRecords)
      const result = await client.mutation(syncFns.pushBatch, { records: chunk }).then(normalizePushResult)
      acceptPushedRecords(this.db, result.accepted, deletedAtByRecordId, metadataByRecordId)
      sequence = Math.max(sequence, result.sequence)

      for (const conflict of result.conflicts) {
        const local = plainById.get(conflict.recordId)
        if (local) {
          repository.preserveSyncConflict(local)
          recordConflict(this.db, conflict.recordId, hashPlainRecord(local), conflict.contentHash)
        }
        let plain: PlainVaultRecord
        try {
          plain = decryptSyncRecord(vaultKey, session.account.aveIdentityId, conflict)
        } catch {
          const current = getRecordState(this.db, conflict.recordId)
          decryptFailures += 1
          upsertRecordState(this.db, {
            recordId: conflict.recordId,
            kind: current?.kind,
            itemId: current?.itemId,
            credentialId: current?.credentialId,
            revision: conflict.revision,
            contentHash: '',
            serverSequence: conflict.serverSequence,
            deletedAt: conflict.deletedAt,
          })
          continue
        }
        repository.applySyncRecord(plain)
        appliedCount += 1
        const metadata = syncRecordMetadata(plain)
        upsertRecordState(this.db, {
          recordId: conflict.recordId,
          kind: metadata.kind,
          itemId: metadata.itemId,
          credentialId: metadata.credentialId,
          revision: conflict.revision,
          contentHash: conflict.contentHash,
          serverSequence: conflict.serverSequence,
          deletedAt: conflict.deletedAt,
        })
      }
    }

    return { sequence, appliedCount, decryptFailures }
  }

  private ensureDeviceId() {
    const existing = getSyncMeta(this.db, 'deviceId')
    if (existing) {
      return existing
    }
    const next = `device_${randomBytes(9).toString('hex')}`
    setSyncMeta(this.db, 'deviceId', next)
    return next
  }

  private deviceName() {
    return hostname() || 'Klarkey desktop'
  }
}
