import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const DB_PATH = process.env.DB_PATH || './data/location.db'

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  tst INTEGER,
  lat REAL,
  lon REAL,
  acc REAL,
  batt REAL,
  event TEXT,
  desc TEXT,
  rid TEXT,
  raw_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_tst ON events(type, tst);
CREATE INDEX IF NOT EXISTS idx_events_rid ON events(rid);
`)
