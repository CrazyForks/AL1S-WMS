import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export function openDatabase(
  filename = process.env.DATABASE_URL ?? "./data/family-erp.db",
) {
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
      category TEXT NOT NULL DEFAULT '其他',
      base_unit TEXT NOT NULL,
      reorder_point REAL NOT NULL DEFAULT 0,
      reorder_quantity REAL NOT NULL DEFAULT 1,
      default_location_id TEXT,
      manufactured_date TEXT,
      expiry_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(home_id, sku)
    );
    CREATE TABLE IF NOT EXISTS item_categories (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      parent_id TEXT REFERENCES item_categories(id),
      name TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(home_id, parent_id, name)
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
    CREATE TABLE IF NOT EXISTS item_events (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      item_id TEXT NOT NULL REFERENCES items(id),
      item_name TEXT NOT NULL,
      location_id TEXT,
      location_name TEXT,
      type TEXT NOT NULL CHECK(type IN ('delete', 'reclassify', 'move', 'update')),
      quantity REAL,
      reason TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      parent_id TEXT REFERENCES locations(id),
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
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS shopping_list (
      id TEXT PRIMARY KEY,
      home_id TEXT NOT NULL REFERENCES homes(id),
      item_id TEXT REFERENCES items(id),
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);
  try {
    db.exec("ALTER TABLE items ADD COLUMN default_location_id TEXT");
  } catch {
    /* existing column */
  }
  try {
    db.exec("ALTER TABLE shopping_list ADD COLUMN category TEXT");
  } catch {
    /* existing column */
  }
  try {
    db.exec(
      "ALTER TABLE shopping_list ADD COLUMN location_id TEXT REFERENCES locations(id)",
    );
  } catch {
    /* existing column */
  }
  try {
    db.exec("ALTER TABLE homes ADD COLUMN icon TEXT NOT NULL DEFAULT '🏠'");
  } catch {
    /* existing column */
  }
  try {
    db.exec("ALTER TABLE items ADD COLUMN manufactured_date TEXT");
  } catch {
    /* existing column */
  }
  try {
    db.exec("ALTER TABLE items ADD COLUMN expiry_date TEXT");
  } catch {
    /* existing column */
  }
  try {
    db.exec(
      "ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT '其他'",
    );
  } catch {
    /* existing column */
  }
  try {
    db.exec(
      "ALTER TABLE locations ADD COLUMN parent_id TEXT REFERENCES locations(id)",
    );
  } catch {
    /* existing column */
  }
  const itemColumns = db.prepare("PRAGMA table_info(items)").all() as { name: string }[];
  if (!itemColumns.some(column => column.name === "icon")) db.exec("ALTER TABLE items ADD COLUMN icon TEXT");
  const eventDefinition = db.prepare("SELECT sql FROM sqlite_master WHERE name='item_events'").get() as { sql: string };
  if (!eventDefinition.sql.includes("'update'")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(eventDefinition.sql.replace("item_events", "item_events_next").replace("'move'", "'move', 'update'"));
      db.exec("INSERT INTO item_events_next SELECT * FROM item_events; DROP TABLE item_events; ALTER TABLE item_events_next RENAME TO item_events; COMMIT;");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS stock_batches (
    id TEXT PRIMARY KEY, home_id TEXT NOT NULL REFERENCES homes(id), item_id TEXT NOT NULL REFERENCES items(id),
    label TEXT, manufactured_date TEXT, expiry_date TEXT, received_at TEXT NOT NULL, legacy INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS stock_operations (
    home_id TEXT NOT NULL REFERENCES homes(id), idempotency_key TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL,
    PRIMARY KEY(home_id, idempotency_key)
  );`);
  const stockColumns = db.prepare("PRAGMA table_info(stock_transactions)").all() as {name:string}[];
  if (!stockColumns.some(column => column.name === "batch_id")) db.exec("ALTER TABLE stock_transactions ADD COLUMN batch_id TEXT REFERENCES stock_batches(id)");
  const eventColumns = db.prepare("PRAGMA table_info(item_events)").all() as {name:string}[];
  if (!eventColumns.some(column => column.name === "batch_id")) db.exec("ALTER TABLE item_events ADD COLUMN batch_id TEXT REFERENCES stock_batches(id)");
  if (!db.prepare("SELECT 1 FROM app_settings WHERE key='batch_migration_v1'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const legacyItems = db.prepare("SELECT id, home_id, manufactured_date, expiry_date FROM items WHERE id IN (SELECT item_id FROM stock_transactions WHERE batch_id IS NULL)").all() as {id:string;home_id:string;manufactured_date:string|null;expiry_date:string|null}[];
      for (const item of legacyItems) {
        const batchId = randomUUID();
        const first = db.prepare("SELECT MIN(occurred_at) AS date FROM stock_transactions WHERE item_id=? AND home_id=?").get(item.id,item.home_id) as {date:string};
        db.prepare("INSERT INTO stock_batches(id,home_id,item_id,label,manufactured_date,expiry_date,received_at,legacy) VALUES (?,?,?,'历史库存',?,?,?,1)").run(batchId,item.home_id,item.id,item.manufactured_date,item.expiry_date,first.date);
        db.prepare("UPDATE stock_transactions SET batch_id=? WHERE item_id=? AND home_id=? AND batch_id IS NULL").run(batchId,item.id,item.home_id);
      }
      db.prepare("INSERT INTO app_settings(key,value) VALUES ('batch_migration_v1','true')").run();
      db.exec("COMMIT");
    } catch(error) { db.exec("ROLLBACK"); throw error; }
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_batch ON stock_transactions(home_id,item_id,batch_id,location_id);
    CREATE INDEX IF NOT EXISTS idx_stock_history ON stock_transactions(home_id,occurred_at,id);
    CREATE INDEX IF NOT EXISTS idx_item_history ON item_events(home_id,occurred_at,id);`);
  // SQLite treats NULLs as distinct in UNIQUE constraints; normalize the
  // catalog before enforcing one name per sibling branch.
  db.exec(`
    DELETE FROM item_categories
    WHERE rowid NOT IN (
      SELECT MIN(rowid)
      FROM item_categories
      GROUP BY home_id, COALESCE(parent_id, ''), name
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_item_categories_sibling_name
      ON item_categories(home_id, COALESCE(parent_id, ''), name);
  `);
  return db;
}
