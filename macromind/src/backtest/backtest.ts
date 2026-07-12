/**
 * Macro-Surprise Backtest (transformation.md §6 — proof-of-edge)
 *
 * Strategy under test (the naive-PnL convention from the economic-surprise
 * literature): at each corpus print with a valid surprise z, take a position
 * proportional to the *mapped* crypto bias, sized min(|z|,3)/3, held for the
 * next daily bar (uses corpus btc_ret_1d — real close-to-close returns).
 *
 *   CPI/PCE/PPI above forecast  → bearish → short
 *   NFP above forecast          → bearish → short
 *   below forecast              → bullish → long
 *
 * Baselines: BTC buy-and-hold over the same print dates, and always-flat.
 * Metrics: Sharpe, Sortino, max drawdown, win rate, Calmar, correlation to B&H.
 * Robustness: 1000-path Monte Carlo bootstrap → VaR/CVaR of terminal equity.
 *
 * Honesty (shown in the API response): per Harvey & Liu ("Backtesting"),
 * reported Sharpe ratios of backtests should be discounted ~50% for data
 * mining; macro-surprise PnL is highly seasonal. This is evidence of process,
 * not a guarantee of returns.
 */
import { getDb } from '../store/db.js';
import { getEventMapping } from '../ai/event-mappings.js';

export interface BacktestReport {
  n: number;
  window: { from: string | null; to: string | null };
  strategy: {
    totalReturnPct: number;
    sharpe: number | null;
    sharpeDiscounted: number | null;  // ×0.5 per Harvey & Liu
    sortino: number | null;
    maxDrawdownPct: number;
    winRate: number | null;
    calmar: number | null;
    equity: Array<{ date: string; value: number }>;
  };
  buyHold: {
    totalReturnPct: number;
    sharpe: number | null;
    maxDrawdownPct: number;
    correlationToStrategy: number | null;
  };
  monteCarlo: {
    paths: number;
    var95Pct: number | null;   // 5th percentile terminal return
    cvar95Pct: number | null;  // mean of worst 5%
  };
  perTrade: Array<{
    date: string; eventType: string; z: number; direction: string;
    position: number; btcRet1d: number; stratRet: number;
  }>;
  caveats: string[];
  generatedAt: number;
}

interface CorpusTradeRow {
  event_type: string; date: string; surprise_z: number | null;
  direction: string | null; btc_ret_1d: number | null;
}

function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** annualization: macro prints are ~monthly per event type; with multiple event
 *  types the blended cadence is ~weekly. We annualize per-print returns by √52
 *  and state the convention openly. */
const ANNUALIZE = Math.sqrt(52);

function maxDrawdown(equity: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > mdd) mdd = dd;
  }
  return mdd * 100;
}

function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? Math.round((num / den) * 100) / 100 : null;
}

/** mapped bias for a surprise direction. */
function biasFor(eventType: string, direction: string): 1 | -1 | 0 {
  const mapping = getEventMapping(eventType);
  const above = mapping?.aboveForecast ?? (
    /CPI|PCE|PPI|NFP|Payroll/i.test(eventType) ? 'bearish' : 'neutral'
  );
  if (direction === 'above') return above === 'bearish' ? -1 : above === 'bullish' ? 1 : 0;
  if (direction === 'below') return above === 'bearish' ? 1 : above === 'bullish' ? -1 : 0;
  return 0;
}

export function runBacktest(): BacktestReport {
  const db = getDb();
  const rows = db.prepare(`
    SELECT event_type, date, surprise_z, direction, btc_ret_1d
    FROM macro_catalysts
    WHERE surprise_z IS NOT NULL AND btc_ret_1d IS NOT NULL AND direction IN ('above','below')
    ORDER BY date ASC
  `).all() as CorpusTradeRow[];

  const perTrade: BacktestReport['perTrade'] = [];
  const stratRets: number[] = [];
  const bhRets: number[] = [];

  for (const r of rows) {
    const z = r.surprise_z as number;
    const bias = biasFor(r.event_type, r.direction as string);
    const position = bias * Math.min(Math.abs(z), 3) / 3;    // capped at 3σ
    const btcRet = (r.btc_ret_1d as number) / 100;
    const stratRet = position * btcRet;
    stratRets.push(stratRet);
    bhRets.push(btcRet);
    perTrade.push({
      date: r.date, eventType: r.event_type, z: round2(z),
      direction: r.direction as string, position: round2(position),
      btcRet1d: round2(btcRet * 100), stratRet: round2(stratRet * 100),
    });
  }

  const n = stratRets.length;
  const emptyReport = (why: string): BacktestReport => ({
    n: 0, window: { from: null, to: null },
    strategy: { totalReturnPct: 0, sharpe: null, sharpeDiscounted: null, sortino: null, maxDrawdownPct: 0, winRate: null, calmar: null, equity: [] },
    buyHold: { totalReturnPct: 0, sharpe: null, maxDrawdownPct: 0, correlationToStrategy: null },
    monteCarlo: { paths: 0, var95Pct: null, cvar95Pct: null },
    perTrade: [], caveats: [why], generatedAt: Date.now(),
  });
  if (n === 0) return emptyReport('Corpus is empty or has no resolvable surprise prints — run POST /api/corpus/seed first.');

  // equity curves (compounded)
  let eq = 1, bh = 1;
  const equity: Array<{ date: string; value: number }> = [];
  const eqSeries: number[] = [];
  const bhSeries: number[] = [];
  for (let i = 0; i < n; i++) {
    eq *= 1 + stratRets[i];
    bh *= 1 + bhRets[i];
    eqSeries.push(eq);
    bhSeries.push(bh);
    equity.push({ date: perTrade[i].date, value: round2(eq * 10_000) });
  }

  const sMean = mean(stratRets), sStd = std(stratRets);
  const downside = std(stratRets.filter((r) => r < 0));
  const sharpe = sStd > 0 ? round2((sMean / sStd) * ANNUALIZE) : null;
  const sortino = downside > 0 ? round2((sMean / downside) * ANNUALIZE) : null;
  const mdd = round2(maxDrawdown(eqSeries));
  const totalRet = round2((eq - 1) * 100);
  const wins = stratRets.filter((r) => r > 0).length;
  const active = stratRets.filter((r) => r !== 0).length;

  const bhMean = mean(bhRets), bhStd = std(bhRets);

  // Monte Carlo bootstrap: resample per-print returns with replacement
  const PATHS = 1000;
  const terminals: number[] = [];
  for (let p = 0; p < PATHS; p++) {
    let v = 1;
    for (let i = 0; i < n; i++) {
      v *= 1 + stratRets[Math.floor(Math.random() * n)];
    }
    terminals.push((v - 1) * 100);
  }
  terminals.sort((a, b) => a - b);
  const varIdx = Math.floor(PATHS * 0.05);
  const var95 = round2(terminals[varIdx]);
  const cvar95 = round2(mean(terminals.slice(0, Math.max(1, varIdx))));

  return {
    n,
    window: { from: perTrade[0]?.date ?? null, to: perTrade[n - 1]?.date ?? null },
    strategy: {
      totalReturnPct: totalRet,
      sharpe,
      sharpeDiscounted: sharpe != null ? round2(sharpe * 0.5) : null,
      sortino,
      maxDrawdownPct: mdd,
      winRate: active > 0 ? Math.round((wins / active) * 100) : null,
      calmar: mdd > 0 ? round2(totalRet / mdd) : null,
      equity,
    },
    buyHold: {
      totalReturnPct: round2((bh - 1) * 100),
      sharpe: bhStd > 0 ? round2((bhMean / bhStd) * ANNUALIZE) : null,
      maxDrawdownPct: round2(maxDrawdown(bhSeries)),
      correlationToStrategy: correlation(stratRets, bhRets),
    },
    monteCarlo: { paths: PATHS, var95Pct: var95, cvar95Pct: cvar95 },
    perTrade,
    caveats: [
      'Backtest on historical macro prints with daily close-to-close returns (no intraday, no fees/slippage).',
      'Per Harvey & Liu ("Backtesting"), discount reported Sharpe ~50% for data-mining — the discounted figure is included.',
      'Macro-surprise PnL is documented to be highly seasonal (concentrated in recession/recovery windows).',
      `Annualization convention: per-print returns × √52 (blended multi-event cadence).`,
    ],
    generatedAt: Date.now(),
  };
}
