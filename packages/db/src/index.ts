import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(filename = process.env.DATABASE_URL ?? "./data/family-erp.db") {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS homes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🏠',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      default_currency TEXT NOT NULL DEFAULT 'CNY',
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      base_unit TEXT NOT NULL,
      reorder_point REAL NOT NULL DEFAULT 0,
      reorder_quantity REAL NOT NULL DEFAULT 1,
      default_location_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(home_id, sku)
    );
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      item_id TEXT NOT NULL REFERENCES items(id),
      location_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('receipt', 'issue')),
      quantity REAL NOT NULL CHECK(quantity > 0),
      reason TEXT,
      idempotency_key TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE(home_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(home_id, name)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );
  `);
  try { db.exec("ALTER TABLE items ADD COLUMN default_location_id TEXT"); } catch { /* existing column */ }
  try { db.exec("ALTER TABLE homes ADD COLUMN icon TEXT NOT NULL DEFAULT '🏠'"); } catch { /* existing column */ }
  return db;
}
