import { mkdirSync } from 'node:fs'
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

export function createDatabase(): DatabaseHandle {
  const dbPath = join(app.getPath('userData'), 'klarkey.sqlite')
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new BetterSqlite3(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  resetLegacySchema(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      itemName TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      websites TEXT,
      notes TEXT,
      customFields TEXT,
      passwordPayload TEXT,
      otpPayload TEXT,
      hasPasskey INTEGER NOT NULL DEFAULT 0,
      lastUsedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      identityId TEXT NOT NULL,
      label TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(identityId) REFERENCES identities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recent_actions (
      id TEXT PRIMARY KEY,
      actionId TEXT NOT NULL,
      identityId TEXT,
      label TEXT NOT NULL,
      usedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  return {
    db,
    close: () => db.close(),
  }
}
