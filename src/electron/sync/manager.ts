import { randomBytes } from 'node:crypto'
import { hostname, platform } from 'node:os'
import { shell } from 'electron'
import { ConvexClient, ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'
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
  type SyncPushResult,
  type SyncRecord,
  type SyncStatus,
  type WrappedVaultKey,
} from '@/shared/sync'
import type { VaultRepository } from '@/electron/repository'
import { decryptSyncRecord, encryptPlainRecord, hashPlainRecord, unwrapVaultKey, wrapVaultKey } from '@/electron/sync/crypto'
import { getEnvValue } from '@/electron/sync/env'
import {
  acceptPushedRecords,
  countSyncConflicts,
  countRecordStates,
  getRecordState,
  getSyncMeta,
  listRecordStates,
  recordConflict,
  setSyncMeta,
  upsertRecordState,
} from '@/electron/sync/state'
import {
  clearPendingOAuthRequest,
  clearSyncSession,
  readPendingOAuthRequest,
  readSyncSession,
  refreshSyncSession,
  sessionFromTokenResponse,
  tryReadSyncSession,
  writePendingOAuthRequest,
  writeSyncSession,
  type AveSyncConfig,
  type SyncSession,
} from '@/electron/sync/session'
import type { DatabaseHandle } from '@/electron/database'

const redirectUri = 'klarkey://oauth/callback'
const deviceRegistrationIntervalMs = 1000 * 60 * 60 * 6
const syncFns = {
  bootstrapVault: makeFunctionReference<'mutation'>('sync:bootstrapVault'),
  registerDevice: makeFunctionReference<'mutation'>('sync:registerDevice'),
  getSyncStatus: makeFunctionReference<'query'>('sync:getSyncStatus'),
  pullSince: makeFunctionReference<'query'>('sync:pullSince'),
  pushBatch: makeFunctionReference<'mutation'>('sync:pushBatch'),
}

type BootstrapResult = {
  wrappedVaultKey?: WrappedVaultKey
  sequence: number
  needsSetup: boolean
}

type PullResult = {
  wrappedVaultKey?: WrappedVaultKey
  sequence: number
  records: SyncRecord[]
}

type PullRemoteResult = {
  sequence: number
  vaultKey: Buffer
  decryptFailures: number
  appliedCount: number
}

type PushLocalResult = {
  sequence: number
  appliedCount: number
}

type RemoteSyncStatus = {
  syncAllowed: boolean
  sequence: number
  schemaVersion: number
  hasVaultKey: boolean
}

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
    return {
      configured: Boolean(config),
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
    const session = await sessionFromTokenResponse(config, callbackUrl, tokens)
    writeSyncSession(session)
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
        const message = error instanceof Error ? error.message : 'Sync session refresh failed.'
        this.lastError = message
        setSyncMeta(this.db, 'lastSyncError', message)
        return null
      }
    }, () => {
      onStatusChange?.(this.getStatus())
    })

    this.realtimeUnsubscribe = client.onUpdate(syncFns.getSyncStatus, {}, (remote: RemoteSyncStatus) => {
      const localSequence = Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0')
      if (remote.sequence > localSequence) {
        if (this.syncing || this.activeSync) {
          this.pendingRemoteSequence = Math.max(this.pendingRemoteSequence, remote.sequence)
        } else {
          onRemoteChange()
        }
      }
      onStatusChange?.(this.getStatus())
    }, (error) => {
      const message = error instanceof Error ? error.message : 'Realtime sync is unavailable.'
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
    try {
      session = await refreshSyncSession(config, session)
      const client = this.client(config, session)
      await this.registerDeviceIfNeeded(client)
      const pulled = await this.pullRemote(client, session, repository, options)
      const pushed = await this.pushLocal(client, pulled.vaultKey, session, repository)
      const sequence = Math.max(pulled.sequence, pushed.sequence)
      setSyncMeta(this.db, 'lastServerSequence', String(sequence))
      setSyncMeta(this.db, 'lastSyncAt', new Date().toISOString())
      this.lastRunVaultChanged = pulled.appliedCount > 0 || pushed.appliedCount > 0
      if (this.pendingRemoteSequence > sequence) {
        followupRemoteChange = true
      }
      this.pendingRemoteSequence = 0
      const repairMessage = pulled.decryptFailures > 0
        ? `${pulled.decryptFailures} sync record${pulled.decryptFailures === 1 ? '' : 's'} need repair from another device.`
        : ''
      this.lastError = repairMessage || undefined
      setSyncMeta(this.db, 'lastSyncError', repairMessage)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed.'
      this.lastError = message
      setSyncMeta(this.db, 'lastSyncError', message)
      throw error
    } finally {
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
    if (!this.convexUrl()) {
      throw new Error('Set KLARKEY_CONVEX_URL in .env.local before using Klarkey sync.')
    }
    return config
  }

  private convexUrl() {
    return getEnvValue('KLARKEY_CONVEX_URL', 'CONVEX_URL', 'VITE_KLARKEY_CONVEX_URL', 'VITE_CONVEX_URL')
  }

  private client(_config: AveSyncConfig, session: SyncSession) {
    const convexUrl = this.convexUrl()
    if (!convexUrl) {
      throw new Error('Set KLARKEY_CONVEX_URL in .env.local before using Klarkey sync.')
    }
    return new ConvexHttpClient(convexUrl, { auth: session.idToken })
  }

  private async ensureVaultKey(client: ConvexHttpClient, session: SyncSession) {
    const existing = await client.mutation(syncFns.bootstrapVault, {
      schemaVersion: SYNC_SCHEMA_VERSION,
    }) as BootstrapResult

    if (existing.wrappedVaultKey) {
      return unwrapVaultKey(session.appKey, existing.wrappedVaultKey)
    }

    const vaultKey = randomBytes(32)
    const wrappedVaultKey = wrapVaultKey(session.appKey, vaultKey)
    const setup = await client.mutation(syncFns.bootstrapVault, {
      schemaVersion: SYNC_SCHEMA_VERSION,
      wrappedVaultKey,
    }) as BootstrapResult
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
    const pull = await client.query(syncFns.pullSince, { since, limit: 500 }) as PullResult
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

      repository.applySyncRecord(plain)
      appliedCount += 1
      upsertRecordState(this.db, {
        recordId: encrypted.recordId,
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
    const records = [...activeRecords, ...this.deletedItemRecords(activeRecords)]
    const encryptedRecords: LocalSyncRecord[] = []
    const plainById = new Map<string, PlainVaultRecord>()
    const deletedAtByRecordId = new Map<string, number | undefined>()

    for (const record of records) {
      const hash = hashPlainRecord(record)
      const state = getRecordState(this.db, record.recordId)
      if (state?.contentHash === hash) {
        continue
      }

      const revision = (state?.revision ?? 0) + 1
      encryptedRecords.push(encryptPlainRecord(vaultKey, session.account.aveIdentityId, this.deviceId, revision, record))
      plainById.set(record.recordId, record)
      deletedAtByRecordId.set(record.recordId, record.deletedAt)
    }

    if (encryptedRecords.length === 0) {
      return { sequence: Number(getSyncMeta(this.db, 'lastServerSequence') ?? '0'), appliedCount: 0 }
    }

    const result = await client.mutation(syncFns.pushBatch, { records: encryptedRecords }) as SyncPushResult
    acceptPushedRecords(this.db, result.accepted, deletedAtByRecordId)
    let appliedCount = 0

    for (const conflict of result.conflicts) {
      const local = plainById.get(conflict.recordId)
      if (local) {
        repository.preserveSyncConflict(local)
        recordConflict(this.db, conflict.recordId, hashPlainRecord(local), conflict.contentHash)
      }
      repository.applySyncRecord(decryptSyncRecord(vaultKey, session.account.aveIdentityId, conflict))
      appliedCount += 1
      upsertRecordState(this.db, {
        recordId: conflict.recordId,
        revision: conflict.revision,
        contentHash: conflict.contentHash,
        serverSequence: conflict.serverSequence,
        deletedAt: conflict.deletedAt,
      })
    }

    return { sequence: result.sequence, appliedCount }
  }

  private deletedItemRecords(activeRecords: PlainVaultRecord[]): PlainVaultRecord[] {
    const activeRecordIds = new Set(activeRecords.map((record) => record.recordId))
    const deletedAt = Date.now()
    return listRecordStates(this.db)
      .filter((state) => state.recordId.startsWith('item:') && !state.deletedAt && !activeRecordIds.has(state.recordId))
      .map((state) => {
        const itemId = state.recordId.slice('item:'.length)
        return {
          kind: 'item',
          recordId: state.recordId,
          itemId,
          itemType: 'login',
          item: {
            itemId,
            itemType: 'login',
            itemName: 'Deleted item',
            password: '',
            preserveEmptyPassword: true,
          },
          updatedAt: new Date(deletedAt).toISOString(),
          deletedAt,
        } satisfies PlainVaultRecord
      })
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
