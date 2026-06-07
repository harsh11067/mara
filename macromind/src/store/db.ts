import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Database');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../mara.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
    runMigrations(_db);
    logger.info(`Database ready at ${DB_PATH}`);
  }
  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Macro events the agent is tracking
    CREATE TABLE IF NOT EXISTS events (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      date        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'UPCOMING',
      forecast    REAL,
      actual      REAL,
      previous    REAL,
      surprise_score REAL,
      crypto_bias TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    -- Every decision the AI made (including NO_TRADE)
    CREATE TABLE IF NOT EXISTS decisions (
      id              TEXT PRIMARY KEY,
      event_id        TEXT REFERENCES events(id),
      timestamp       INTEGER NOT NULL,
      conviction      TEXT NOT NULL,
      confidence      INTEGER NOT NULL,
      reasoning       TEXT NOT NULL,
      action          TEXT NOT NULL,
      no_trade_reason TEXT,
      news_context    TEXT,
      market_context  TEXT,
      created_at      INTEGER NOT NULL
    );

    -- Trades executed on SoDEX
    CREATE TABLE IF NOT EXISTS trades (
      id              TEXT PRIMARY KEY,
      decision_id     TEXT REFERENCES decisions(id),
      sodex_order_id  TEXT,
      symbol          TEXT NOT NULL,
      side            TEXT NOT NULL,
      entry_price     REAL,
      quantity        REAL,
      leverage        INTEGER,
      stop_loss       REAL,
      take_profit     REAL,
      status          TEXT NOT NULL DEFAULT 'OPEN',
      exit_price      REAL,
      pnl             REAL,
      pnl_percent     REAL,
      opened_at       INTEGER,
      closed_at       INTEGER
    );

    -- Cached news for audit trail
    CREATE TABLE IF NOT EXISTS news_cache (
      id                  TEXT PRIMARY KEY,
      title               TEXT,
      content             TEXT,
      category            INTEGER,
      release_time        INTEGER,
      matched_currencies  TEXT,
      tags                TEXT,
      fetched_at          INTEGER NOT NULL
    );

    -- SSI rotation records
    CREATE TABLE IF NOT EXISTS ssi_rotations (
      id              TEXT PRIMARY KEY,
      decision_id     TEXT REFERENCES decisions(id),
      direction       TEXT NOT NULL,
      plan_json       TEXT NOT NULL,
      executed        INTEGER NOT NULL DEFAULT 0,
      result_json     TEXT,
      created_at      INTEGER NOT NULL
    );

    -- Risk state snapshots
    CREATE TABLE IF NOT EXISTS risk_snapshots (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp           INTEGER NOT NULL,
      account_balance     REAL,
      open_positions      INTEGER,
      total_exposure      REAL,
      unrealized_pnl      REAL,
      drawdown_percent    REAL,
      kill_switch_active  INTEGER NOT NULL DEFAULT 0
    );

    -- Indices for fast lookups
    CREATE INDEX IF NOT EXISTS idx_events_date   ON events(date);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_decisions_event ON decisions(event_id);
    CREATE INDEX IF NOT EXISTS idx_trades_decision ON trades(decision_id);
    CREATE INDEX IF NOT EXISTS idx_trades_status   ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_news_time ON news_cache(release_time);
    CREATE INDEX IF NOT EXISTS idx_risk_ts ON risk_snapshots(timestamp);
  `);
  logger.info('Database migrations applied');
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
