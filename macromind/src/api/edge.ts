/**
 * PROOF OF EDGE — "The Gauntlet" (Wave 5 USP)
 *
 * One question, answered head-to-head on the same real prints with zero
 * lookahead: does MARA's discipline (evidence floor + regime gate + sizing)
 * actually add value over what anyone else would do?
 *
 * Four strategies run over the identical corpus sequence (chronological,
 * all event families interleaved, real close-to-close BTC returns):
 *
 *   1. MARA policy      — the deterministic evidence layer the live agent
 *                         consults: no-lookahead analog medians (same family,
 *                         same surprise direction, strictly earlier prints),
 *                         a 3-analog evidence floor, the regime conviction
 *                         floor, and regime-conditional position sizing.
 *   2. No-stand-down    — the counterfactual: forced to trade the textbook
 *                         macro mapping on EVERY directional print (no floor,
 *                         no gate, same sizing). The gap between this and #1
 *                         is the measured value of MARA's restraint.
 *   3. Naive z-chaser   — position ∝ min(|z|,3)/3 on the mapped bias; what a
 *                         simple surprise-following bot would do.
 *   4. Buy-and-hold BTC — the benchmark every judge respects. (Cash = 0 line.)
 *
 * Honesty contract (returned in the payload, rendered on the page):
 *   - Deterministic policy replay — NOT a Gemini rerun (no quota burned, and
 *     no way to cherry-pick model outputs).
 *   - Corpus depth is ~24 prints per family (~2 years), daily close-to-close,
 *     no fees/slippage/intraday. We say "two years", never "a decade".
 *   - Sharpe is also reported ×0.5 per Harvey & Liu's backtest discount.
 *   - Per-regime table shows where MARA does NOT beat buy-and-hold.
 */
import type { Hono } from 'hono';
import { getDb } from '../store/db.js';
import { getEventMapping } from '../ai/event-mappings.js';
import { REGIME_RISK, type Regime } from '../risk/regime.js';
import { globalCache } from '../utils/ttl-cache.js';

// Same regime sizing the Time Machine uses (mirrors live sizing policy).
const REGIME_SIZE: Record<string, number> = {
  BULL_QUIET: 1.0, BULL_VOLATILE: 0.6, RANGING: 0.75, BEAR_VOLATILE: 0.5, CRASH: 0.25,
};

interface CorpusRow {
  id: string; event_type: string; date: string;
  actual: number | null; forecast: number | null;
  surprise_z: number | null; direction: string | null; regime_label: string | null;
  btc_ret_1d: number | null;
}

interface StrategyMetrics {
  label: string;
  totalReturnPct: number;
  sharpe: number | null;
  sharpeDiscounted: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  winRate: number | null;
  tradesTaken: number;
  stoodDown: number;
}

const ANNUALIZE = Math.sqrt(52);

function mean(xs: number[]): number { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function maxDrawdown(equity: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > mdd) mdd = dd;
  }
  return mdd * 100;
}

/** mapped macro bias: above-forecast CPI/NFP etc. → bearish → -1 */
function biasFor(eventType: string, direction: string): 1 | -1 | 0 {
  const mapping = getEventMapping(eventType);
  const above = mapping?.aboveForecast ?? (
    /CPI|PCE|PPI|NFP|Payroll/i.test(eventType) ? 'bearish' : 'neutral'
  );
  if (direction === 'above') return above === 'bearish' ? -1 : above === 'bullish' ? 1 : 0;
  if (direction === 'below') return above === 'bearish' ? 1 : above === 'bullish' ? -1 : 0;
  return 0;
}

function metricsFor(label: string, rets: number[], active: number, stood: number): StrategyMetrics {
  let eq = 1;
  const series: number[] = [];
  for (const r of rets) { eq *= 1 + r; series.push(eq); }
  const m = mean(rets), sd = std(rets);
  const downside = std(rets.filter((r) => r < 0));
  const sharpe = sd > 0 ? round2((m / sd) * ANNUALIZE) : null;
  const wins = rets.filter((r) => r > 0).length;
  return {
    label,
    totalReturnPct: round2((eq - 1) * 100),
    sharpe,
    sharpeDiscounted: sharpe != null ? round2(sharpe * 0.5) : null,
    sortino: downside > 0 ? round2((m / downside) * ANNUALIZE) : null,
    maxDrawdownPct: round2(maxDrawdown(series)),
    winRate: active > 0 ? Math.round((wins / active) * 100) : null,
    tradesTaken: active,
    stoodDown: stood,
  };
}

export interface EdgeReport {
  n: number;
  window: { from: string | null; to: string | null };
  strategies: {
    mara: StrategyMetrics;
    maraNoStandDown: StrategyMetrics;
    naive: StrategyMetrics;
    buyHold: StrategyMetrics;
  };
  restraintValuePct: number; // mara total − counterfactual total: the measured value of standing down
  equity: Array<{ date: string; mara: number; noStandDown: number; naive: number; buyHold: number }>;
  standDowns: Array<{
    date: string; eventType: string; z: number | null; regime: string | null;
    reason: string; dodgedRetPct: number | null;
  }>;
  perRegime: Array<{
    regime: string; prints: number;
    maraRetPct: number; buyHoldRetPct: number; maraWins: boolean;
  }>;
  monteCarlo: { paths: number; var95Pct: number | null; cvar95Pct: number | null };
  method: string;
  caveats: string[];
  generatedAt: number;
}

export function runEdge(): EdgeReport {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, event_type, date, actual, forecast, surprise_z, direction, regime_label, btc_ret_1d
    FROM macro_catalysts
    WHERE btc_ret_1d IS NOT NULL
    ORDER BY date ASC
  `).all() as CorpusRow[];

  const maraRets: number[] = [];
  const cfRets: number[] = [];
  const naiveRets: number[] = [];
  const bhRets: number[] = [];
  const equity: EdgeReport['equity'] = [];
  const standDowns: EdgeReport['standDowns'] = [];
  const regimeAgg = new Map<string, { prints: number; mara: number; bh: number }>();

  let maraActive = 0, cfActive = 0, naiveActive = 0;
  let eqM = 1, eqC = 1, eqN = 1, eqB = 1;

  for (const row of rows) {
    const ret = (row.btc_ret_1d as number) / 100;
    const size = REGIME_SIZE[row.regime_label ?? ''] ?? 0.75;
    const floor = REGIME_RISK[(row.regime_label ?? 'RANGING') as Regime]?.convictionFloor ?? 65;
    const directional = row.direction === 'above' || row.direction === 'below';
    const bias = directional ? biasFor(row.event_type, row.direction as string) : 0;

    // ── 1. MARA policy: no-lookahead analog replay + gates ────────────────────
    let maraRet = 0;
    let reason: string | null = null;
    if (!directional) {
      reason = 'in-line print — no surprise edge';
    } else {
      const analogs = rows.filter(
        (h) => h.event_type === row.event_type && h.direction === row.direction
          && h.btc_ret_1d !== null && h.date < row.date,
      );
      if (analogs.length < 3) {
        reason = `only ${analogs.length} prior analog(s) — below the 3-analog evidence floor`;
      } else {
        const med = median(analogs.map((a) => a.btc_ret_1d as number));
        if (Math.abs(med) < 0.05) {
          reason = 'analog median ~0 — no directional evidence';
        } else {
          const agreeing = analogs.filter((a) => (med > 0 ? (a.btc_ret_1d as number) > 0 : (a.btc_ret_1d as number) < 0)).length;
          const hitRate = Math.round((agreeing / analogs.length) * 100);
          const zBoost = Math.min(15, Math.abs(row.surprise_z ?? 0) * 5);
          const confidence = Math.min(92, Math.round(50 + (hitRate - 50) * 0.7 + zBoost));
          if (confidence < floor) {
            reason = `confidence ${confidence}% below the ${row.regime_label ?? 'RANGING'} conviction floor (${floor}%)`;
          } else {
            maraRet = (med > 0 ? 1 : -1) * size * ret;
            maraActive++;
          }
        }
      }
    }

    // ── 2. Counterfactual: forced textbook trade on every directional print ──
    let cfRet = 0;
    if (bias !== 0) { cfRet = bias * size * ret; cfActive++; }

    // ── 3. Naive z-chaser ─────────────────────────────────────────────────────
    let naiveRet = 0;
    if (bias !== 0 && row.surprise_z != null) {
      naiveRet = bias * (Math.min(Math.abs(row.surprise_z), 3) / 3) * ret;
      naiveActive++;
    }

    if (reason !== null && bias !== 0) {
      standDowns.push({
        date: row.date, eventType: row.event_type, z: row.surprise_z,
        regime: row.regime_label, reason,
        dodgedRetPct: round2(cfRet * 100),
      });
    }

    maraRets.push(maraRet); cfRets.push(cfRet); naiveRets.push(naiveRet); bhRets.push(ret);
    eqM *= 1 + maraRet; eqC *= 1 + cfRet; eqN *= 1 + naiveRet; eqB *= 1 + ret;
    equity.push({
      date: row.date,
      mara: round2(eqM * 100), noStandDown: round2(eqC * 100),
      naive: round2(eqN * 100), buyHold: round2(eqB * 100),
    });

    const key = row.regime_label ?? 'UNLABELED';
    const agg = regimeAgg.get(key) ?? { prints: 0, mara: 1, bh: 1 };
    agg.prints++; agg.mara *= 1 + maraRet; agg.bh *= 1 + ret;
    regimeAgg.set(key, agg);
  }

  const empty = (why: string): EdgeReport => ({
    n: 0, window: { from: null, to: null },
    strategies: {
      mara: metricsFor('MARA policy', [], 0, 0),
      maraNoStandDown: metricsFor('No stand-downs', [], 0, 0),
      naive: metricsFor('Naive z-chaser', [], 0, 0),
      buyHold: metricsFor('Buy & hold BTC', [], 0, 0),
    },
    restraintValuePct: 0, equity: [], standDowns: [], perRegime: [],
    monteCarlo: { paths: 0, var95Pct: null, cvar95Pct: null },
    method: '', caveats: [why], generatedAt: Date.now(),
  });
  if (rows.length === 0) return empty('Corpus is empty — run POST /api/corpus/seed first.');

  // Monte Carlo bootstrap on the MARA leg
  const PATHS = 1000;
  const terminals: number[] = [];
  for (let p = 0; p < PATHS; p++) {
    let v = 1;
    for (let i = 0; i < maraRets.length; i++) v *= 1 + maraRets[Math.floor(Math.random() * maraRets.length)];
    terminals.push((v - 1) * 100);
  }
  terminals.sort((a, b) => a - b);
  const varIdx = Math.floor(PATHS * 0.05);

  const mara = metricsFor('MARA policy', maraRets, maraActive, rows.length - maraActive);
  const cf = metricsFor('No stand-downs (counterfactual)', cfRets, cfActive, rows.length - cfActive);

  return {
    n: rows.length,
    window: { from: rows[0]?.date ?? null, to: rows[rows.length - 1]?.date ?? null },
    strategies: {
      mara,
      maraNoStandDown: cf,
      naive: metricsFor('Naive z-chaser', naiveRets, naiveActive, rows.length - naiveActive),
      buyHold: metricsFor('Buy & hold BTC', bhRets, bhRets.length, 0),
    },
    restraintValuePct: round2(mara.totalReturnPct - cf.totalReturnPct),
    equity,
    standDowns,
    perRegime: [...regimeAgg.entries()].map(([regime, a]) => ({
      regime, prints: a.prints,
      maraRetPct: round2((a.mara - 1) * 100),
      buyHoldRetPct: round2((a.bh - 1) * 100),
      maraWins: a.mara > a.bh,
    })).sort((x, y) => y.prints - x.prints),
    monteCarlo: {
      paths: PATHS,
      var95Pct: round2(terminals[varIdx]),
      cvar95Pct: round2(mean(terminals.slice(0, Math.max(1, varIdx)))),
    },
    method:
      'Deterministic no-lookahead policy replay over the seeded macro corpus: for each print, MARA sees only ' +
      'prints strictly before it (same family, same surprise direction), needs ≥3 analogs, must clear the ' +
      'regime conviction floor, and sizes by the regime multiplier. Real daily close-to-close BTC returns. ' +
      'No Gemini calls — this is the evidence layer the live agent consults, so it cannot be cherry-picked.',
    caveats: [
      'Corpus depth is ~24 prints per family (~2 years of history) — this is two years of evidence, not a decade.',
      'Prints older than the 365-day kline window carry no regime label (shown as UNLABELED) — they trade under default RANGING gates.',
      'Daily close-to-close returns; no fees, slippage, or intraday paths.',
      'Sharpe also shown ×0.5 per Harvey & Liu ("Backtesting") data-mining discount.',
      'Where buy-and-hold beats MARA in a regime, the table says so. Calibrated honesty over inflated Sharpe.',
    ],
    generatedAt: Date.now(),
  };
}

export function edgeRoutes(app: Hono): void {
  app.get('/api/edge', (c) => {
    const report = globalCache.get<EdgeReport>('edge:report')
      ?? globalCache.set('edge:report', runEdge(), 5 * 60_000);
    return c.json(report);
  });
}
