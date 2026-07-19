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

    -- Macro-catalyst corpus: historical macro prints tagged with BTC/ETH
    -- forward returns + regime labels (MARA's data moat — fixture.md §C)
    CREATE TABLE IF NOT EXISTS macro_catalysts (
      id            TEXT PRIMARY KEY,
      event_type    TEXT NOT NULL,
      date          TEXT NOT NULL,
      actual        REAL,
      forecast      REAL,
      previous      REAL,
      surprise_z    REAL,
      direction     TEXT,             -- 'above' | 'below' | 'inline'
      regime_label  TEXT,             -- regime at the print date
      btc_ret_1d    REAL,
      btc_ret_3d    REAL,
      btc_ret_7d    REAL,
      btc_ret_30d   REAL,
      eth_ret_1d    REAL,
      eth_ret_3d    REAL,
      eth_ret_7d    REAL,
      eth_ret_30d   REAL,
      seeded_at     INTEGER NOT NULL,
      UNIQUE(event_type, date)
    );

    CREATE INDEX IF NOT EXISTS idx_corpus_event ON macro_catalysts(event_type);
    CREATE INDEX IF NOT EXISTS idx_corpus_dir   ON macro_catalysts(direction);

    -- Accounts: Google / wallet / guest identities (Wave 3.5)
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      provider       TEXT NOT NULL,            -- 'google' | 'wallet' | 'guest'
      provider_id    TEXT NOT NULL,            -- google sub | wallet address | guest uuid
      email          TEXT,
      name           TEXT,
      avatar         TEXT,
      wallet_address TEXT,
      created_at     INTEGER NOT NULL,
      UNIQUE(provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- MARA credits: append-only ledger, balance = SUM(delta)
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id),
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,                -- 'signup_grant' | 'duel_stake' | 'duel_win' | 'duel_push' | ...
      ref        TEXT,                         -- duel id / decision id
      created_at INTEGER NOT NULL
    );

    -- Signal Duel: operator vs the agent, staked in credits
    CREATE TABLE IF NOT EXISTS duels (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id),
      event_name      TEXT NOT NULL,
      actual          REAL NOT NULL,
      forecast        REAL NOT NULL,
      prediction      TEXT NOT NULL,           -- 'BULL' | 'BEAR'
      stake           INTEGER NOT NULL,
      mara_verdict    TEXT,                    -- conviction when resolved
      mara_confidence INTEGER,
      decision_id     TEXT,
      outcome         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | WIN | LOSS | PUSH | ERROR
      payout          INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL,
      resolved_at     INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user   ON credit_ledger(user_id);
    CREATE INDEX IF NOT EXISTS idx_duels_user    ON duels(user_id);
    CREATE INDEX IF NOT EXISTS idx_duels_outcome ON duels(outcome);

    -- Wave 6: Arcade — fast credit bets on real BTC price moves (web + Telegram)
    CREATE TABLE IF NOT EXISTS arcade_bets (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      game         TEXT NOT NULL,                     -- 'PULSE' | 'OVERUNDER'
      pick         TEXT NOT NULL,                     -- UP/DOWN | OVER/UNDER
      stake        INTEGER NOT NULL,
      symbol       TEXT NOT NULL,
      strike       REAL NOT NULL,                     -- live price at bet time
      threshold    REAL,                              -- OVERUNDER band in %
      resolve_at   INTEGER NOT NULL,
      settle_price REAL,
      outcome      TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING | WIN | LOSS | VOID
      payout       INTEGER NOT NULL DEFAULT 0,
      source       TEXT NOT NULL DEFAULT 'web',       -- 'web' | 'telegram'
      tg_chat_id   TEXT,                              -- DM target for telegram bets
      created_at   INTEGER NOT NULL,
      resolved_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_arcade_user    ON arcade_bets(user_id);
    CREATE INDEX IF NOT EXISTS idx_arcade_pending ON arcade_bets(outcome, resolve_at);

    -- Wave 6: Concierge chat quota (3 free questions, credit-unlocked packs)
    CREATE TABLE IF NOT EXISTS chat_usage (
      user_id    TEXT PRIMARY KEY REFERENCES users(id),
      used       INTEGER NOT NULL DEFAULT 0,
      quota      INTEGER NOT NULL DEFAULT 3,
      updated_at INTEGER NOT NULL
    );

    -- Wave 6: Feedback requests (surfaced to the operator via Telegram)
    CREATE TABLE IF NOT EXISTS feedback (
      id          TEXT PRIMARY KEY,
      user_id     TEXT,
      email       TEXT NOT NULL,
      category    TEXT NOT NULL,
      subject     TEXT,
      description TEXT NOT NULL,
      page        TEXT,
      created_at  INTEGER NOT NULL
    );

    -- Wave 6: The Floor — community strategy comments
    CREATE TABLE IF NOT EXISTS comments (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_time ON comments(created_at);

    -- Wave 6: Referrals — invited user → referrer, one bonus each
    CREATE TABLE IF NOT EXISTS referrals (
      user_id     TEXT PRIMARY KEY REFERENCES users(id),
      referrer_id TEXT NOT NULL REFERENCES users(id),
      created_at  INTEGER NOT NULL
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
