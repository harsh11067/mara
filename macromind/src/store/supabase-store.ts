/**
 * Supabase durable store (Wave 7).
 *
 * The user's Supabase project is reachable over PostgREST (verified live with
 * the service-role key); the direct Postgres socket is IPv6-only and NOT
 * reachable from this host or Render, so DDL can't run from here. Strategy:
 *
 *   - boot: probe each table with a HEAD select. Table exists → Supabase is
 *     the durable copy for that surface. Missing → log the exact SQL to paste
 *     into the Supabase SQL editor once, and fall back to SQLite+Neon.
 *   - writes: dual-write (SQLite stays the fast local source of truth;
 *     Supabase rows survive redeploys independently of the snapshot cycle).
 *   - reads: The Floor prefers Supabase when ready, so posts survive even a
 *     total loss of the SQLite file.
 *
 * Status is surfaced on /api/diag — never silently degraded.
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Supabase');

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const SETUP_SQL = `-- Paste once into the Supabase SQL editor (Dashboard → SQL) to activate
create table if not exists floor_posts (
  id text primary key,
  user_id text,
  name text,
  body text not null,
  created_at bigint not null
);
create table if not exists feedback_inbox (
  id text primary key,
  user_id text,
  email text not null,
  category text,
  subject text,
  description text not null,
  page text,
  created_at bigint not null
);
alter table floor_posts enable row level security;
alter table feedback_inbox enable row level security;`;

interface SupabaseStatus {
  configured: boolean;
  reachable: boolean;
  tables: Record<string, boolean>;
  lastError: string | null;
  checkedAt: number | null;
}

const status: SupabaseStatus = {
  configured: Boolean(SUPABASE_URL && SERVICE_KEY),
  reachable: false,
  tables: {},
  lastError: null,
  checkedAt: null,
};

const TABLES = ['floor_posts', 'feedback_inbox'];

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function supabaseStatus(): SupabaseStatus {
  return { ...status, tables: { ...status.tables } };
}

export function supabaseTableReady(table: string): boolean {
  return status.configured && status.reachable && status.tables[table] === true;
}

/** Boot-time probe: is the project up, and do our tables exist yet? */
export async function checkSupabase(): Promise<SupabaseStatus> {
  if (!status.configured) {
    logger.info('Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — SQLite+Neon only');
    return supabaseStatus();
  }
  try {
    for (const table of TABLES) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`, {
        method: 'HEAD', headers: headers(), signal: AbortSignal.timeout(8000),
      });
      status.tables[table] = res.ok;
      if (!res.ok && res.status !== 404 && res.status !== 406) {
        // 404 = table missing (expected pre-setup); anything else is a project problem
        throw new Error(`HTTP ${res.status} probing ${table}`);
      }
    }
    status.reachable = true;
    status.lastError = null;
    const ready = TABLES.filter((t) => status.tables[t]);
    const missing = TABLES.filter((t) => !status.tables[t]);
    if (missing.length > 0) {
      logger.warn(`Supabase reachable but tables missing: ${missing.join(', ')} — falling back to SQLite for those. Run the setup SQL once in the Supabase dashboard:\n${SETUP_SQL}`);
    }
    if (ready.length > 0) {
      logger.info(`Supabase durable store ON for: ${ready.join(', ')}`);
    }
  } catch (err) {
    status.reachable = false;
    status.lastError = String(err).slice(0, 200);
    logger.warn('Supabase unreachable — SQLite+Neon fallback', { error: status.lastError });
  }
  status.checkedAt = Date.now();
  return supabaseStatus();
}

/** Fire-and-forget durable insert; failures are logged + surfaced, never thrown. */
export function sbInsert(table: string, row: Record<string, unknown>): void {
  if (!supabaseTableReady(table)) return;
  void fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(8000),
  }).then((res) => {
    if (!res.ok) {
      void res.text().then((t) => {
        status.lastError = `insert ${table}: HTTP ${res.status} ${t.slice(0, 120)}`;
        logger.warn(status.lastError);
      });
    }
  }).catch((err) => {
    status.lastError = `insert ${table}: ${String(err).slice(0, 120)}`;
    logger.warn(status.lastError);
  });
}

/** Durable select (returns null on any failure so callers can fall back). */
export async function sbSelect<T>(table: string, query: string): Promise<T[] | null> {
  if (!supabaseTableReady(table)) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: headers(), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json() as T[];
  } catch {
    return null;
  }
}

/** Durable delete by filter (used for floor post moderation/retention). */
export async function sbDelete(table: string, query: string): Promise<boolean> {
  if (!supabaseTableReady(table)) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'DELETE', headers: headers({ Prefer: 'return=minimal' }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
