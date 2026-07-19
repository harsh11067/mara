/**
 * Neon Postgres Snapshot Replicator (mocks.md B7 — the deploy-persistence fix)
 *
 * Render free web services have an ephemeral filesystem: the SQLite file is
 * wiped on every redeploy/spin-down, which would silently destroy MARA's
 * track record. Litestream-style fix without rewriting every sync store:
 *
 *   - on boot:     if mara.db is missing/empty, restore the newest snapshot
 *                  from Neon (bytea) before any store opens the DB
 *   - continuous:  serialize + push a snapshot every REPLICATE_INTERVAL when
 *                  the DB changed (data_version pragma), and on shutdown
 *
 * Uses DATABASE_URL (Neon pooled connection string). Cleanly disabled when
 * unset — local dev keeps plain SQLite. Status is surfaced on /api/diag.
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import { getDb } from './db.js';

const logger = createLogger('DbReplicator');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../../mara.db');

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REPLICATE_INTERVAL_MS = 60_000;

interface ReplicatorStatus {
  enabled: boolean;
  lastPushAt: number | null;
  lastRestoreAt: number | null;
  lastError: string | null;
  snapshotBytes: number | null;
}

const status: ReplicatorStatus = {
  enabled: false, lastPushAt: null, lastRestoreAt: null, lastError: null, snapshotBytes: null,
};

let pool: pg.Pool | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastDataVersion = -1;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 2,
      ssl: DATABASE_URL.includes('localhost') ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export function replicatorEnabled(): boolean {
  return DATABASE_URL.startsWith('postgres');
}

export function replicatorStatus(): ReplicatorStatus {
  return { ...status, enabled: replicatorEnabled() };
}

async function ensureTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS mara_snapshots (
      id         BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      bytes      BYTEA NOT NULL
    )
  `);
}

/**
 * Restore the newest snapshot into mara.db — MUST run before getDb() is first
 * called anywhere (i.e. first thing in main()).
 */
export async function restoreFromNeon(): Promise<boolean> {
  if (!replicatorEnabled()) return false;
  try {
    const exists = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 4096;
    if (exists) {
      logger.info('Local mara.db present — skipping Neon restore');
      return false;
    }
    await ensureTable();
    const res = await getPool().query(
      'SELECT bytes FROM mara_snapshots ORDER BY id DESC LIMIT 1',
    );
    if (res.rows.length === 0) {
      logger.info('No Neon snapshot yet — starting fresh');
      return false;
    }
    const bytes: Buffer = res.rows[0].bytes;
    fs.writeFileSync(DB_PATH, bytes);
    status.lastRestoreAt = Date.now();
    status.snapshotBytes = bytes.length;
    logger.info(`Restored mara.db from Neon snapshot (${(bytes.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    status.lastError = String(err).slice(0, 200);
    logger.warn('Neon restore failed — continuing with local DB', { error: status.lastError });
    return false;
  }
}

async function pushSnapshot(force = false): Promise<void> {
  if (!replicatorEnabled()) return;
  try {
    const db = getDb();
    const version = (db.pragma('data_version', { simple: true }) as number) ?? 0;
    if (!force && version === lastDataVersion) return; // nothing changed
    lastDataVersion = version;

    // WAL mode keeps recent transactions in mara.db-wal; db.serialize() only
    // captures the main file. Checkpoint first or the snapshot silently
    // rolls back everything still in the WAL (kickup §7B).
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* busy — snapshot still consistent, just older */ }
    const bytes = db.serialize();
    await ensureTable();
    await getPool().query('INSERT INTO mara_snapshots (bytes) VALUES ($1)', [bytes]);
    // keep only the 10 newest snapshots (Neon free tier is 0.5 GB)
    await getPool().query(
      'DELETE FROM mara_snapshots WHERE id NOT IN (SELECT id FROM mara_snapshots ORDER BY id DESC LIMIT 10)',
    );
    status.lastPushAt = Date.now();
    status.snapshotBytes = bytes.length;
    status.lastError = null;
    logger.debug(`Pushed snapshot to Neon (${(bytes.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    status.lastError = String(err).slice(0, 200);
    logger.warn('Neon snapshot push failed', { error: status.lastError });
  }
}

export function startReplicator(): void {
  if (!replicatorEnabled()) {
    logger.info('DATABASE_URL not set — Neon replication disabled (local SQLite only)');
    return;
  }
  if (timer) return;
  timer = setInterval(() => void pushSnapshot(), REPLICATE_INTERVAL_MS);
  logger.info(`Neon snapshot replication ON (every ${REPLICATE_INTERVAL_MS / 1000}s when dirty)`);
}

export async function stopReplicator(): Promise<void> {
  if (timer) { clearInterval(timer); timer = null; }
  await pushSnapshot(true); // final flush
  if (pool) { await pool.end(); pool = null; }
}
