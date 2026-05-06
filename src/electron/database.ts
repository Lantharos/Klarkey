import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type Database from 'better-sqlite3'

const require = createRequire(import.meta.url)
const BetterSqlite3 = require('better-sqlite3') as typeof Database

export interface DatabaseHandle {
  db: Database.Database
  close: () => void
}

function hasColumn(db: Database.Database, tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return columns.some((column) => column.name === columnName)
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string) {
  if (hasColumn(db, tableName, columnName)) {
    return
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`)
}

function dedupePasskeysByItem(db: Database.Database) {
  db.exec(`
    DELETE FROM passkeys
    WHERE rowid NOT IN (
      SELECT chosen.rowid
      FROM passkeys AS chosen
      WHERE chosen.rowid = (
        SELECT candidate.rowid
        FROM passkeys AS candidate
        WHERE candidate.itemId = chosen.itemId
        ORDER BY COALESCE(candidate.lastUsedAt, candidate.createdAt) DESC, candidate.createdAt DESC, candidate.rowid DESC
        LIMIT 1
      )
    )
  `)
}

function resetLegacySchema(db: Database.Database) {
  const hasIdentitiesTable = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'identities'").get(),
  )

  if (!hasIdentitiesTable) {
    return
  }

  if (hasColumn(db, 'identities', 'itemName')) {
    return
  }

  db.exec('DROP TABLE IF EXISTS passkeys')
  db.exec('DROP TABLE IF EXISTS recent_actions')
  db.exec('DROP TABLE IF EXISTS identities')
  db.exec('DROP TABLE IF EXISTS services')
}

function protectDatabaseFiles(dbPath: string) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      chmodSync(path, 0o600)
    } catch {
      void 0
    }
  }
}

function ensureDatabaseDirectory(directoryPath: string) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
  const stats = lstatSync(directoryPath)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Klarkey database directory must be a normal directory.')
  }

  try {
    chmodSync(directoryPath, 0o700)
  } catch {
    void 0
  }
}

function validateDatabasePath(dbPath: string) {
  if (!existsSync(dbPath)) {
    return
  }

  const stats = lstatSync(dbPath)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('Klarkey database path must be a normal file.')
  }
}

export function createDatabase(): DatabaseHandle {
  const dbPath = join(app.getPath('userData'), 'klarkey.sqlite')
  ensureDatabaseDirectory(dirname(dbPath))
  validateDatabasePath(dbPath)
  const db = new BetterSqlite3(dbPath)
  protectDatabaseFiles(dbPath)
  db.pragma('journal_mode = WAL')
  protectDatabaseFiles(dbPath)
  db.pragma('foreign_keys = ON')
  db.pragma('secure_delete = ON')
  db.pragma('temp_store = MEMORY')
  db.pragma('trusted_schema = OFF')
  resetLegacySchema(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      itemType TEXT NOT NULL DEFAULT 'login',
      itemName TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      websites TEXT,
      notes TEXT,
      customFields TEXT,
      itemData TEXT,
      passwordPayload TEXT,
      otpPayload TEXT,
      hasPasskey INTEGER NOT NULL DEFAULT 0,
      lastUsedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      identityId TEXT,
      itemId TEXT NOT NULL,
      label TEXT NOT NULL,
      credentialId TEXT,
      rpId TEXT,
      userName TEXT,
      transports TEXT,
      lastUsedAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(itemId) REFERENCES identities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pending_passkeys (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      credentialId TEXT NOT NULL UNIQUE,
      rpId TEXT,
      userName TEXT,
      userHandle TEXT,
      transports TEXT,
      privateKeyPayload TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_passkeys (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      credentialId TEXT NOT NULL UNIQUE,
      transports TEXT,
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS recent_actions (
      id TEXT PRIMARY KEY,
      actionId TEXT NOT NULL,
      itemId TEXT,
      label TEXT NOT NULL,
      usedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_record_state (
      recordId TEXT PRIMARY KEY,
      kind TEXT,
      itemId TEXT,
      credentialId TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      contentHash TEXT NOT NULL DEFAULT '',
      serverSequence INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT NOT NULL,
      deletedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      recordId TEXT NOT NULL,
      localContentHash TEXT NOT NULL,
      remoteContentHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `)

  ensureColumn(db, 'identities', 'itemType', "TEXT NOT NULL DEFAULT 'login'")
  ensureColumn(db, 'identities', 'itemData', 'TEXT')

  if (hasColumn(db, 'recent_actions', 'identityId') && !hasColumn(db, 'recent_actions', 'itemId')) {
    ensureColumn(db, 'recent_actions', 'itemId', 'TEXT')
    db.exec('UPDATE recent_actions SET itemId = identityId WHERE itemId IS NULL')
  }

  if (hasColumn(db, 'passkeys', 'identityId') && !hasColumn(db, 'passkeys', 'itemId')) {
    ensureColumn(db, 'passkeys', 'itemId', 'TEXT')
    db.exec('UPDATE passkeys SET itemId = identityId WHERE itemId IS NULL')
  }

  ensureColumn(db, 'passkeys', 'identityId', 'TEXT')
  db.exec('UPDATE passkeys SET identityId = itemId WHERE identityId IS NULL AND itemId IS NOT NULL')
  ensureColumn(db, 'passkeys', 'credentialId', 'TEXT')
  ensureColumn(db, 'passkeys', 'rpId', 'TEXT')
  ensureColumn(db, 'passkeys', 'userName', 'TEXT')
  ensureColumn(db, 'passkeys', 'transports', 'TEXT')
  ensureColumn(db, 'passkeys', 'lastUsedAt', 'TEXT')
  ensureColumn(db, 'passkeys', 'privateKeyPayload', 'TEXT')
  ensureColumn(db, 'passkeys', 'userHandle', 'TEXT')
  ensureColumn(db, 'passkeys', 'signCount', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'sync_record_state', 'kind', 'TEXT')
  ensureColumn(db, 'sync_record_state', 'itemId', 'TEXT')
  ensureColumn(db, 'sync_record_state', 'credentialId', 'TEXT')
  dedupePasskeysByItem(db)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS passkeys_credential_id_idx ON passkeys(credentialId) WHERE credentialId IS NOT NULL')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS passkeys_item_id_idx ON passkeys(itemId)')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS pending_passkeys_credential_id_idx ON pending_passkeys(credentialId)')

  return {
    db,
    close: () => db.close(),
  }
}

export function ensureLockSettings(db: Database.Database) {
  const statement = db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'passcode_hash'").get() as { value: string } | undefined
  if (!existing) {
    statement.run('passcode_hash', '')
    statement.run('passcode_salt', '')
  }
}
