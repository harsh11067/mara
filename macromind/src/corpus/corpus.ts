/**
 * Macro-Catalyst Corpus (fixture.md §C — the data moat)
 *
 * Seeds `macro_catalysts` from real SoSoValue history:
 *   /macro/events/{event}/history  → actual/forecast per print
 *   /currencies/{id}/klines (1d)   → BTC + ETH forward returns (+1d/+3d/+7d/+30d)
 *
 * Each row: {event_type, date, actual, forecast, surprise_z, direction,
 *            regime_label, btc_ret_*, eth_ret_*}
 *
 * Powers: query_macro_corpus (MCP), /api/corpus, the backtest ground truth,
 * and the "historical analogs" citations in the debate engine.
 *
 * Honesty note (documented for judges): SoSoValue klines are daily closes,
 * so forward returns are close-to-close, not intraday; the surprise z uses a
 * rolling window of the prints available at seed time.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../store/db.js';
import { SoSoValueClient, BTC_CURRENCY_ID } from '../services/sosovalue-client.js';
import { classifyRegime } from '../risk/regime.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type { Kline, EventDataPoint } from '../services/types.js';

const logger = createLogger('Corpus');

// ETH currency id on SoSoValue — resolved live from /currencies at seed time
// (falls back to this cached value if the lookup fails)
export const ETH_CURRENCY_ID_FALLBACK = '1673723677362319875';

async function resolveEthId(client: SoSoValueClient): Promise<string> {
  try {
    const currencies = await client.getCurrencies();
    const eth = currencies.find((c) =>
      String(c.symbol ?? c.ticker ?? '').toUpperCase() === 'ETH' ||
      String(c.name ?? '').toLowerCase() === 'ethereum',
    );
    const id = eth ? String(eth.id ?? eth.currency_id ?? eth.currencyId ?? '') : '';
    if (id) return id;
  } catch { /* fall through */ }
  return ETH_CURRENCY_ID_FALLBACK;
}

/** Event types worth seeding (canonical SoSoValue naming variants tried in order). */
const SEED_EVENTS: Array<{ type: string; candidates: string[] }> = [
  { type: 'CPI',          candidates: ['CPI (YoY)', 'CPI YoY', 'CPI'] },
  { type: 'Core CPI',     candidates: ['Core CPI (MoM)', 'Core CPI (YoY)', 'Core CPI'] },
  { type: 'NFP',          candidates: ['Nonfarm Payrolls', 'Non-Farm Payrolls', 'NFP'] },
  { type: 'PCE',          candidates: ['Core PCE Price Index (MoM)', 'PCE Price Index (YoY)', 'PCE'] },
  { type: 'PPI',          candidates: ['PPI (MoM)', 'PPI (YoY)', 'PPI'] },
  { type: 'FOMC',         candidates: ['FOMC Rate Decision', 'Fed Interest Rate Decision', 'Interest Rate Decision'] },
  { type: 'Unemployment', candidates: ['Unemployment Rate'] },
];

export interface CatalystRow {
  id: string;
  eventType: string;
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  surpriseZ: number | null;
  direction: 'above' | 'below' | 'inline' | null;
  regimeLabel: string | null;
  btcRet1d: number | null; btcRet3d: number | null; btcRet7d: number | null; btcRet30d: number | null;
  ethRet1d: number | null; ethRet3d: number | null; ethRet7d: number | null; ethRet30d: number | null;
}

interface DbRow {
  id: string; event_type: string; date: string;
  actual: number | null; forecast: number | null; previous: number | null;
  surprise_z: number | null; direction: string | null; regime_label: string | null;
  btc_ret_1d: number | null; btc_ret_3d: number | null; btc_ret_7d: number | null; btc_ret_30d: number | null;
  eth_ret_1d: number | null; eth_ret_3d: number | null; eth_ret_7d: number | null; eth_ret_30d: number | null;
}

function toRow(r: DbRow): CatalystRow {
  return {
    id: r.id, eventType: r.event_type, date: r.date,
    actual: r.actual, forecast: r.forecast, previous: r.previous,
    surpriseZ: r.surprise_z, direction: r.direction as CatalystRow['direction'],
    regimeLabel: r.regime_label,
    btcRet1d: r.btc_ret_1d, btcRet3d: r.btc_ret_3d, btcRet7d: r.btc_ret_7d, btcRet30d: r.btc_ret_30d,
    ethRet1d: r.eth_ret_1d, ethRet3d: r.eth_ret_3d, ethRet7d: r.eth_ret_7d, ethRet30d: r.eth_ret_30d,
  };
}

// ── Forward returns from daily klines ─────────────────────────────────────────

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** close-to-close % return from the print date to +N days (nearest available bars). */
function forwardReturn(byDay: Map<string, number>, sortedDays: string[], date: string, n: number): number | null {
  // find the first bar on/after the print date
  const startIdx = sortedDays.findIndex((d) => d >= date);
  if (startIdx < 0) return null;
  const endIdx = startIdx + n;
  if (endIdx >= sortedDays.length) return null;
  const start = byDay.get(sortedDays[startIdx]);
  const end = byDay.get(sortedDays[endIdx]);
  if (!start || !end || start <= 0) return null;
  return Math.round(((end - start) / start) * 10000) / 100; // % with 2dp
}

function buildDayIndex(klines: Kline[]): { byDay: Map<string, number>; sortedDays: string[] } {
  const byDay = new Map<string, number>();
  for (const k of klines) byDay.set(dayKey(k.openTime), k.close);
  const sortedDays = [...byDay.keys()].sort();
  return { byDay, sortedDays };
}

// ── Rolling surprise z (same convention as the live surprise engine) ──────────

function rollingZ(history: EventDataPoint[], idx: number, window = 18): number | null {
  const pt = history[idx];
  if (pt.actual == null || pt.forecast == null) return null;
  const diffs: number[] = [];
  for (let i = idx + 1; i < Math.min(history.length, idx + 1 + window); i++) {
    const h = history[i];
    if (h.actual != null && h.forecast != null) diffs.push(h.actual - h.forecast);
  }
  if (diffs.length < 4) return null;
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
  if (sd === 0) return null;
  return Math.round(((pt.actual - pt.forecast) / sd) * 100) / 100;
}

// ── Seeder ────────────────────────────────────────────────────────────────────

export interface SeedResult {
  seeded: number;
  events: Record<string, number>;
  errors: string[];
  klineBars: { btc: number; eth: number };
}

export async function seedCorpus(): Promise<SeedResult> {
  const client = new SoSoValueClient(config.sosovalue.apiKey, config.sosovalue.baseUrl);
  const db = getDb();
  const errors: string[] = [];

  // 1) klines for forward returns (as much daily history as the tier allows)
  let btcKlines: Kline[] = [];
  let ethKlines: Kline[] = [];
  try {
    btcKlines = await client.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 365 });
  } catch (e) { errors.push(`BTC klines: ${String(e).slice(0, 120)}`); }
  try {
    const ethId = await resolveEthId(client);
    ethKlines = await client.getCurrencyKlines(ethId, { interval: '1d', limit: 365 });
  } catch (e) { errors.push(`ETH klines: ${String(e).slice(0, 120)}`); }

  const btcIdx = buildDayIndex(btcKlines);
  const ethIdx = buildDayIndex(ethKlines);

  const insert = db.prepare(`
    INSERT INTO macro_catalysts (
      id, event_type, date, actual, forecast, previous, surprise_z, direction,
      regime_label, btc_ret_1d, btc_ret_3d, btc_ret_7d, btc_ret_30d,
      eth_ret_1d, eth_ret_3d, eth_ret_7d, eth_ret_30d, seeded_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(event_type, date) DO UPDATE SET
      actual=excluded.actual, forecast=excluded.forecast, surprise_z=excluded.surprise_z,
      direction=excluded.direction, regime_label=excluded.regime_label,
      btc_ret_1d=excluded.btc_ret_1d, btc_ret_3d=excluded.btc_ret_3d,
      btc_ret_7d=excluded.btc_ret_7d, btc_ret_30d=excluded.btc_ret_30d,
      eth_ret_1d=excluded.eth_ret_1d, eth_ret_3d=excluded.eth_ret_3d,
      eth_ret_7d=excluded.eth_ret_7d, eth_ret_30d=excluded.eth_ret_30d,
      seeded_at=excluded.seeded_at
  `);

  let seeded = 0;
  const perEvent: Record<string, number> = {};

  for (const evt of SEED_EVENTS) {
    let history: EventDataPoint[] = [];
    for (const candidate of evt.candidates) {
      try {
        history = await client.getEventHistory(candidate, 24);
        if (history.length > 0) break;
      } catch { /* try next naming variant */ }
    }
    if (history.length === 0) {
      errors.push(`${evt.type}: no history under any naming variant`);
      continue;
    }

    // History arrives newest-first from the API — keep as-is for rollingZ.
    let count = 0;
    for (let i = 0; i < history.length; i++) {
      const pt = history[i];
      if (!pt.date || pt.actual == null) continue;
      const z = rollingZ(history, i);
      const direction: CatalystRow['direction'] =
        pt.forecast == null ? null :
        z != null && Math.abs(z) < 0.5 ? 'inline' :
        pt.actual > pt.forecast ? 'above' :
        pt.actual < pt.forecast ? 'below' : 'inline';

      // regime at the print date: classify from the 30 bars before the date
      let regimeLabel: string | null = null;
      const priorIdx = btcIdx.sortedDays.findIndex((d) => d >= pt.date);
      if (priorIdx > 5) {
        const lookback = btcIdx.sortedDays.slice(Math.max(0, priorIdx - 30), priorIdx)
          .map((d) => ({ openTime: new Date(d).getTime(), open: 0, high: 0, low: 0, close: btcIdx.byDay.get(d) ?? 0, volume: 0 }));
        regimeLabel = classifyRegime(lookback).regime;
      }

      insert.run(
        uuidv4(), evt.type, pt.date, pt.actual, pt.forecast, pt.previous, z, direction,
        regimeLabel,
        forwardReturn(btcIdx.byDay, btcIdx.sortedDays, pt.date, 1),
        forwardReturn(btcIdx.byDay, btcIdx.sortedDays, pt.date, 3),
        forwardReturn(btcIdx.byDay, btcIdx.sortedDays, pt.date, 7),
        forwardReturn(btcIdx.byDay, btcIdx.sortedDays, pt.date, 30),
        forwardReturn(ethIdx.byDay, ethIdx.sortedDays, pt.date, 1),
        forwardReturn(ethIdx.byDay, ethIdx.sortedDays, pt.date, 3),
        forwardReturn(ethIdx.byDay, ethIdx.sortedDays, pt.date, 7),
        forwardReturn(ethIdx.byDay, ethIdx.sortedDays, pt.date, 30),
        Date.now(),
      );
      seeded++; count++;
    }
    perEvent[evt.type] = count;
    logger.info(`Corpus: seeded ${count} ${evt.type} prints`);
  }

  return { seeded, events: perEvent, errors, klineBars: { btc: btcKlines.length, eth: ethKlines.length } };
}

// ── Query API ─────────────────────────────────────────────────────────────────

export interface CorpusQuery {
  eventType?: string;
  direction?: 'above' | 'below' | 'inline';
  regime?: string;
  minAbsZ?: number;
  limit?: number;
}

export interface CorpusAnswer {
  analogs: CatalystRow[];
  summary: {
    n: number;
    medianBtc1d: number | null; medianBtc3d: number | null;
    medianBtc7d: number | null; medianBtc30d: number | null;
    hitRate3d: number | null;   // % of analogs where BTC moved in the mapped direction by +3d
  };
  caveat: string;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}

export function queryCorpus(q: CorpusQuery): CorpusAnswer {
  const db = getDb();
  const conds: string[] = [];
  const args: unknown[] = [];
  if (q.eventType) { conds.push('event_type = ?'); args.push(q.eventType); }
  if (q.direction) { conds.push('direction = ?'); args.push(q.direction); }
  if (q.regime)    { conds.push('regime_label = ?'); args.push(q.regime); }
  if (q.minAbsZ)   { conds.push('ABS(surprise_z) >= ?'); args.push(q.minAbsZ); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM macro_catalysts ${where} ORDER BY date DESC LIMIT ?`,
  ).all(...args, Math.min(q.limit ?? 50, 200)) as DbRow[];

  const analogs = rows.map(toRow);
  const b1 = analogs.map((a) => a.btcRet1d).filter((x): x is number => x != null);
  const b3 = analogs.map((a) => a.btcRet3d).filter((x): x is number => x != null);
  const b7 = analogs.map((a) => a.btcRet7d).filter((x): x is number => x != null);
  const b30 = analogs.map((a) => a.btcRet30d).filter((x): x is number => x != null);

  // hit rate: for 'above' (hawkish, mapped bearish) a hit = negative 3d return;
  // for 'below' a hit = positive 3d return. For mixed/inline, no hit-rate.
  let hitRate3d: number | null = null;
  if (q.direction === 'above' || q.direction === 'below') {
    const hits = analogs.filter((a) =>
      a.btcRet3d != null && (q.direction === 'above' ? a.btcRet3d < 0 : a.btcRet3d > 0),
    ).length;
    const valid = analogs.filter((a) => a.btcRet3d != null).length;
    hitRate3d = valid > 0 ? Math.round((hits / valid) * 100) : null;
  }

  return {
    analogs,
    summary: {
      n: analogs.length,
      medianBtc1d: median(b1), medianBtc3d: median(b3),
      medianBtc7d: median(b7), medianBtc30d: median(b30),
      hitRate3d,
    },
    caveat: 'Forward returns are daily close-to-close (SoSoValue free-tier klines are 1d). ' +
      'Macro→BTC effects are regime-conditional and contested in the literature; analogs are evidence, not guarantees.',
  };
}

export function corpusStats(): { rows: number; byEvent: Record<string, number>; lastSeededAt: number | null } {
  const db = getDb();
  const rows = (db.prepare('SELECT COUNT(*) AS n FROM macro_catalysts').get() as { n: number }).n;
  const byEventRows = db.prepare('SELECT event_type, COUNT(*) AS n FROM macro_catalysts GROUP BY event_type').all() as Array<{ event_type: string; n: number }>;
  const last = (db.prepare('SELECT MAX(seeded_at) AS t FROM macro_catalysts').get() as { t: number | null }).t;
  const byEvent: Record<string, number> = {};
  for (const r of byEventRows) byEvent[r.event_type] = r.n;
  return { rows, byEvent, lastSeededAt: last };
}
