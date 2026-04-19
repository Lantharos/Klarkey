import type Database from 'better-sqlite3'
import { type ActionExecutionResult, type CreateVaultPasskeyInput, type VaultPasskeyRecord } from '@/shared/types'
import { id, now, parseJson } from '@/electron/repository/helpers'

export function listVaultDevicePasskeys(db: Database.Database): VaultPasskeyRecord[] {
  const rows = db
    .prepare(
      `
        SELECT id, label, credentialId, transports, createdAt, lastUsedAt
        FROM vault_passkeys
        ORDER BY COALESCE(lastUsedAt, createdAt) DESC, createdAt DESC
      `,
    )
    .all() as Array<{
      id: string
      label: string
      credentialId: string
      transports?: string
      createdAt: string
      lastUsedAt?: string
    }>

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    credentialId: row.credentialId,
    transports: parseJson<string[]>(row.transports, []),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }))
}

export function createVaultDevicePasskey(db: Database.Database, input: CreateVaultPasskeyInput): ActionExecutionResult {
  const label = input.label.trim() || 'Klarkey passkey'
  const existing = db
    .prepare('SELECT id, label FROM vault_passkeys WHERE credentialId = ?')
    .get(input.credentialId) as { id: string; label: string } | undefined

  if (existing) {
    db.prepare('UPDATE vault_passkeys SET label = ?, transports = ?, lastUsedAt = ? WHERE id = ?').run(
      label,
      JSON.stringify(input.transports ?? []),
      now(),
      existing.id,
    )

    return {
      status: 'success',
      title: 'Passkey ready',
      message: `${existing.label} is already enrolled on this device.`,
    } satisfies ActionExecutionResult
  }

  db.prepare(
    `
        INSERT INTO vault_passkeys(id, label, credentialId, transports, createdAt, lastUsedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
  ).run(id('vault_passkey'), label, input.credentialId, JSON.stringify(input.transports ?? []), now(), now())

  return {
    status: 'success',
    title: 'Passkey created',
    message: `${label} can now verify this Klarkey vault.`,
  } satisfies ActionExecutionResult
}

export function touchVaultDevicePasskey(db: Database.Database, credentialId: string): ActionExecutionResult {
  const current = db
    .prepare('SELECT id, label FROM vault_passkeys WHERE credentialId = ?')
    .get(credentialId) as { id: string; label: string } | undefined

  if (!current) {
    return {
      status: 'error',
      title: 'Passkey missing',
      message: 'That passkey is not enrolled in this vault yet.',
    } satisfies ActionExecutionResult
  }

  db.prepare('UPDATE vault_passkeys SET lastUsedAt = ? WHERE id = ?').run(now(), current.id)

  return {
    status: 'success',
    title: 'Passkey verified',
    message: `${current.label} completed a provider-backed passkey check.`,
  } satisfies ActionExecutionResult
}

export function deleteVaultDevicePasskey(db: Database.Database, passkeyId: string): ActionExecutionResult {
  const current = db.prepare('SELECT label FROM vault_passkeys WHERE id = ?').get(passkeyId) as { label: string } | undefined

  if (!current) {
    return {
      status: 'error',
      title: 'Passkey missing',
      message: 'This passkey could not be found.',
    } satisfies ActionExecutionResult
  }

  db.prepare('DELETE FROM vault_passkeys WHERE id = ?').run(passkeyId)

  return {
    status: 'success',
    title: 'Passkey removed',
    message: `${current.label} was removed from this vault.`,
  } satisfies ActionExecutionResult
}
