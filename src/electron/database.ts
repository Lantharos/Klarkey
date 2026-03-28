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

export function createDatabase(): DatabaseHandle {
  const dbPath = join(app.getPath('userData'), 'klarkey.sqlite')
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new BetterSqlite3(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS identities (
      id TEXT PRIMARY KEY,
      serviceId TEXT NOT NULL,
      label TEXT NOT NULL,
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
      updatedAt TEXT NOT NULL,
      FOREIGN KEY(serviceId) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      identityId TEXT NOT NULL,
      serviceId TEXT NOT NULL,
      label TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(identityId) REFERENCES identities(id) ON DELETE CASCADE,
      FOREIGN KEY(serviceId) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recent_actions (
      id TEXT PRIMARY KEY,
      actionId TEXT NOT NULL,
      serviceId TEXT,
      identityId TEXT,
      label TEXT NOT NULL,
      usedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  const columns = db.prepare(`PRAGMA table_info(identities)`).all() as Array<{ name: string }>
  const names = new Set(columns.map((column) => column.name))
  if (!names.has('websites')) {
    db.exec('ALTER TABLE identities ADD COLUMN websites TEXT')
  }
  if (!names.has('notes')) {
    db.exec('ALTER TABLE identities ADD COLUMN notes TEXT')
  }
  if (!names.has('customFields')) {
    db.exec('ALTER TABLE identities ADD COLUMN customFields TEXT')
  }

  return {
    db,
    close: () => db.close(),
  }
}
