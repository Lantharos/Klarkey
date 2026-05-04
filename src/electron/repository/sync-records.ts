import type Database from 'better-sqlite3'
import { encryptValue } from '@/electron/crypto'
import { insertIdentity, updateIdentity } from '@/electron/repository/identity-crud'
import {
  id,
  now,
  parseJson,
  tryDecrypt,
  type PasskeyRow,
} from '@/electron/repository/helpers'
import { loadItemDetails } from '@/electron/repository/item-details'
import { readVaultSettings, mergeVaultSettings } from '@/electron/repository/vault-settings'
import { buildVaultSnapshot } from '@/electron/repository/vault-snapshot'
import { recordFromItemDetails, type PlainVaultRecord } from '@/shared/sync'
import type { ActionExecutionResult, CreateItemInput } from '@/shared/types'

function isDeviceLocalPasskeyItemRecord(record: PlainVaultRecord) {
  return record.kind === 'item' && record.itemId.startsWith('passkey:')
}

function itemInputFromSyncRecord(record: Extract<PlainVaultRecord, { kind: 'item' }>) {
  const password = record.itemType === 'login'
    ? record.item.password?.trim() ?? ''
    : record.item.password
  return {
    ...record.item,
    itemId: record.itemId,
    itemType: record.itemType as CreateItemInput['itemType'],
    password,
    preserveEmptyPassword: true,
  } satisfies CreateItemInput
}

function deleteDeviceLocalPasskeyArtifacts(db: Database.Database) {
  db.prepare("DELETE FROM passkeys WHERE itemId LIKE 'passkey:%' OR identityId LIKE 'passkey:%'").run()
  db.prepare("DELETE FROM identities WHERE id LIKE 'passkey:%'").run()
  db.prepare("DELETE FROM recent_actions WHERE itemId LIKE 'passkey:%'").run()
}

export function buildPlainVaultRecords(db: Database.Database, key: Buffer): PlainVaultRecord[] {
  deleteDeviceLocalPasskeyArtifacts(db)
  const snapshot = buildVaultSnapshot(db)
  const itemRecords = snapshot.items
    .map((item) => loadItemDetails(db, key, item.id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((details) => recordFromItemDetails(details, details.updatedAt ?? ''))

  const passkeyRows = db.prepare(`
    SELECT id, itemId, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, signCount, createdAt, lastUsedAt
    FROM passkeys
    WHERE credentialId IS NOT NULL
  `).all() as PasskeyRow[]

  const passkeyRecords = passkeyRows.flatMap((row): PlainVaultRecord[] => {
    if (!row.credentialId) {
      return []
    }

    const privateKeyJwk = row.privateKeyPayload
      ? parseJson<JsonWebKey | undefined>(tryDecrypt(key, row.privateKeyPayload), undefined)
      : undefined

    if (!privateKeyJwk) {
      return []
    }

    return [
      {
        kind: 'site-passkey',
        recordId: `site-passkey:${row.credentialId}`,
        passkeyId: row.id,
        itemId: row.itemId,
        credentialId: row.credentialId,
        label: row.label,
        rpId: row.rpId,
        userName: row.userName,
        userHandle: row.userHandle,
        transports: parseJson<string[]>(row.transports, []),
        privateKeyJwk,
        signCount: 0,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        syncedCounter: true,
      },
    ]
  })

  return [
    ...itemRecords,
    ...passkeyRecords,
    {
      kind: 'settings',
      recordId: 'settings:user',
      settings: readVaultSettings(db),
      updatedAt: now(),
    },
  ]
}

export function applyPlainVaultRecord(db: Database.Database, key: Buffer, record: PlainVaultRecord): ActionExecutionResult {
  if (record.deletedAt !== undefined) {
    return applyTombstone(db, record)
  }

  if (record.kind === 'settings') {
    mergeVaultSettings(db, record.settings)
    return {
      status: 'success',
      title: 'Settings synced',
      message: 'Sync settings were applied.',
    }
  }

  if (record.kind === 'item') {
    if (isDeviceLocalPasskeyItemRecord(record)) {
      return applyTombstone(db, record)
    }
    const existing = db.prepare('SELECT id FROM identities WHERE id = ?').get(record.itemId)
    const input = itemInputFromSyncRecord(record)

    return existing
      ? updateIdentity(db, key, { ...input, itemId: record.itemId })
      : insertIdentity(db, key, input)
  }

  const privateKeyPayload = record.privateKeyJwk
    ? JSON.stringify(encryptValue(key, JSON.stringify(record.privateKeyJwk)))
    : null
  const timestamp = now()
  const existing = db.prepare('SELECT id FROM passkeys WHERE credentialId = ?').get(record.credentialId) as { id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE passkeys
      SET identityId = ?, itemId = ?, label = ?, rpId = ?, userName = ?, userHandle = ?, transports = ?, privateKeyPayload = ?, signCount = 0, lastUsedAt = ?
      WHERE id = ?
    `).run(
      record.itemId,
      record.itemId,
      record.label,
      record.rpId ?? null,
      record.userName ?? null,
      record.userHandle ?? null,
      JSON.stringify(record.transports),
      privateKeyPayload,
      record.lastUsedAt ?? timestamp,
      existing.id,
    )
  } else {
    db.prepare(`
      INSERT INTO passkeys(id, identityId, itemId, label, credentialId, rpId, userName, userHandle, transports, privateKeyPayload, signCount, lastUsedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.passkeyId || id('passkey'),
      record.itemId,
      record.itemId,
      record.label,
      record.credentialId,
      record.rpId ?? null,
      record.userName ?? null,
      record.userHandle ?? null,
      JSON.stringify(record.transports),
      privateKeyPayload,
      0,
      record.lastUsedAt ?? timestamp,
      record.createdAt || timestamp,
    )
  }

  db.prepare('UPDATE identities SET hasPasskey = 1, updatedAt = ? WHERE id = ?').run(timestamp, record.itemId)
  return {
    status: 'success',
    title: 'Passkey synced',
    message: `${record.label} was synced.`,
    itemId: record.itemId,
  }
}

export function createConflictCopy(db: Database.Database, key: Buffer, record: PlainVaultRecord): ActionExecutionResult | undefined {
  if (record.kind !== 'item' || record.deletedAt !== undefined) {
    return undefined
  }

  return insertIdentity(db, key, {
    ...itemInputFromSyncRecord(record),
    itemId: id('item'),
    itemName: `${record.item.itemName} conflict`,
  })
}

function applyTombstone(db: Database.Database, record: PlainVaultRecord): ActionExecutionResult {
  if (record.kind === 'item') {
    db.prepare('DELETE FROM passkeys WHERE itemId = ? OR identityId = ?').run(record.itemId, record.itemId)
    db.prepare('DELETE FROM identities WHERE id = ?').run(record.itemId)
    db.prepare('DELETE FROM recent_actions WHERE itemId = ?').run(record.itemId)
  }

  if (record.kind === 'site-passkey') {
    db.prepare('DELETE FROM passkeys WHERE credentialId = ?').run(record.credentialId)
    const hasPasskey = Boolean(db.prepare('SELECT 1 FROM passkeys WHERE itemId = ? LIMIT 1').get(record.itemId))
    db.prepare('UPDATE identities SET hasPasskey = ?, updatedAt = ? WHERE id = ?').run(hasPasskey ? 1 : 0, now(), record.itemId)
  }

  return {
    status: 'success',
    title: 'Record deleted',
    message: 'The synced deletion was applied.',
  }
}
