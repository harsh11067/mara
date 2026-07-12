/**
 * Verifiable Track Record (fixture.md §D / transformation.md §6 — Sonar pattern)
 *
 * Every decision is a dated thesis. Every trade is outcome-resolved:
 *   HIT   — take-profit level reached first (daily high/low vs TP)
 *   STOP  — stop-loss level reached first
 *   DRIFT — 7 days elapsed with neither level touched (or trade closed flat)
 *   OPEN  — still live, neither level touched yet
 *
 * Also builds the counterfactual equity curve (creative feature):
 *   MARA NAV  vs  BTC buy-and-hold  vs  did-nothing (flat)
 *
 * Honesty: resolution uses SoSoValue daily klines (free tier), so intra-day
 * TP/SL ordering on the same bar is ambiguous — those resolve conservatively
 * as STOP. Rejected theses (NO_TRADE) are listed beside accepted ones.
 */
import { DecisionStore } from '../store/decision-store.js';
import { TradeStore } from '../store/trade-store.js';
import { SoSoValueClient, BTC_CURRENCY_ID } from '../services/sosovalue-client.js';
import { config } from '../config.js';
import { globalCache } from '../utils/ttl-cache.js';
import { createLogger } from '../utils/logger.js';
import type { Kline } from '../services/types.js';

const logger = createLogger('TrackRecord');

export type Outcome = 'HIT' | 'STOP' | 'DRIFT' | 'OPEN';

export interface Thesis {
  signalId: string;            // decision id — the citable receipt
  timestamp: number;
  event: string;
  conviction: string;
  confidence: number;
  action: string;
  noTradeReason: string | null;
  reasoning: string;
  surpriseScore: number | null;
  trade: null | {
    tradeId: string;
    symbol: string;
    side: string;
    entry: number | null;
    stop: number | null;
    target: number | null;
    quantity: number | null;
    sodexOrderId: string | null;
    status: string;
    pnl: number | null;
    outcome: Outcome;
    outcomeDetail: string;
  };
}

export interface TrackRecordReport {
  theses: Thesis[];
  stats: {
    totalDecisions: number;
    accepted: number;          // decisions that produced a trade
    rejected: number;          // NO_TRADE theses (still logged — transparency)
    hits: number; stops: number; drifts: number; open: number;
    winRate: number | null;    // hits / (hits+stops)
    cumulativePnl: number;
  };
  counterfactual: {
    series: Array<{ ts: number; mara: number; buyHold: number; didNothing: number }>;
    baselineStart: number;     // starting NAV for all three curves
    note: string;
  };
  generatedAt: number;
}

const DRIFT_DAYS = 7;

function dayKey(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

async function getBtcDailyKlines(): Promise<Kline[]> {
  return globalCache.wrap('track:btc-klines', 10 * 60_000, async () => {
    const client = new SoSoValueClient(config.sosovalue.apiKey, config.sosovalue.baseUrl);
    return client.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 120 });
  });
}

/** Resolve HIT/STOP/DRIFT from daily bars after the trade opened. */
function resolveOutcome(
  side: string, entry: number | null, stop: number | null, target: number | null,
  openedAt: number | null, status: string, klines: Kline[],
): { outcome: Outcome; detail: string } {
  if (status === 'TAKEN_PROFIT') return { outcome: 'HIT', detail: 'Exchange reported take-profit fill.' };
  if (status === 'STOPPED') return { outcome: 'STOP', detail: 'Exchange reported stop-loss fill.' };
  if (status === 'CANCELLED') return { outcome: 'DRIFT', detail: 'Order cancelled before fill.' };

  if (!openedAt || !entry || !stop || !target) {
    return status === 'OPEN'
      ? { outcome: 'OPEN', detail: 'Live position; levels not fully recorded.' }
      : { outcome: 'DRIFT', detail: 'Closed without TP/SL resolution data.' };
  }

  const startDay = dayKey(openedAt);
  const bars = klines
    .filter((k) => dayKey(k.openTime) >= startDay)
    .sort((a, b) => a.openTime - b.openTime);

  const isLong = side === 'LONG';
  for (const bar of bars) {
    const hitTarget = isLong ? bar.high >= target : bar.low <= target;
    const hitStop = isLong ? bar.low <= stop : bar.high >= stop;
    if (hitTarget && hitStop) {
      // ambiguous same-bar: resolve conservatively as STOP (documented)
      return { outcome: 'STOP', detail: `Both levels inside ${dayKey(bar.openTime)} daily bar — resolved conservatively as STOP.` };
    }
    if (hitTarget) return { outcome: 'HIT', detail: `Target ${target} touched on ${dayKey(bar.openTime)} (daily ${isLong ? 'high' : 'low'}).` };
    if (hitStop) return { outcome: 'STOP', detail: `Stop ${stop} touched on ${dayKey(bar.openTime)} (daily ${isLong ? 'low' : 'high'}).` };
  }

  const ageDays = (Date.now() - openedAt) / 86_400_000;
  if (ageDays >= DRIFT_DAYS) {
    return { outcome: 'DRIFT', detail: `${DRIFT_DAYS}d elapsed without touching target or stop.` };
  }
  return status === 'OPEN'
    ? { outcome: 'OPEN', detail: `Live ${Math.floor(ageDays * 24)}h; neither level touched yet.` }
    : { outcome: 'DRIFT', detail: 'Closed manually before either level.' };
}

export async function buildTrackRecord(): Promise<TrackRecordReport> {
  const decisions = DecisionStore.getRecent(200);
  const trades = TradeStore.getRecent(500);
  const tradeByDecision = new Map(trades.filter((t) => t.decisionId).map((t) => [t.decisionId as string, t]));

  let klines: Kline[] = [];
  try { klines = await getBtcDailyKlines(); }
  catch (e) { logger.warn('Track record: klines unavailable, outcomes limited', { error: String(e).slice(0, 120) }); }

  const theses: Thesis[] = [];
  let hits = 0, stops = 0, drifts = 0, open = 0, accepted = 0, rejected = 0;

  for (const d of decisions) {
    const t = tradeByDecision.get(d.id) ?? null;
    let trade: Thesis['trade'] = null;
    if (t) {
      accepted++;
      const { outcome, detail } = resolveOutcome(
        t.side, t.entryPrice, t.stopLoss, t.takeProfit, t.openedAt, t.status, klines,
      );
      if (outcome === 'HIT') hits++;
      else if (outcome === 'STOP') stops++;
      else if (outcome === 'DRIFT') drifts++;
      else open++;
      trade = {
        tradeId: t.id, symbol: t.symbol, side: t.side,
        entry: t.entryPrice, stop: t.stopLoss, target: t.takeProfit,
        quantity: t.quantity, sodexOrderId: t.sodexOrderId,
        status: t.status, pnl: t.pnl, outcome, outcomeDetail: detail,
      };
    } else {
      rejected++;
    }
    const mc = (d.marketContext ?? {}) as Record<string, unknown>;
    theses.push({
      signalId: d.id,
      timestamp: d.timestamp,
      event: (mc.eventName as string) ?? d.eventId ?? 'Macro Event',
      conviction: d.conviction,
      confidence: d.confidence,
      action: d.action,
      noTradeReason: d.noTradeReason,
      reasoning: d.reasoning,
      surpriseScore: (mc.surpriseScore as number) ?? null,
      trade,
    });
  }

  // ── Counterfactual equity curve ────────────────────────────────────────────
  const baselineStart = 10_000;
  const series: TrackRecordReport['counterfactual']['series'] = [];
  if (klines.length > 1) {
    const sorted = [...klines].sort((a, b) => a.openTime - b.openTime).slice(-60);
    const firstDecisionTs = decisions.length ? Math.min(...decisions.map((d) => d.timestamp)) : Date.now();
    const startClose = sorted[0].close;
    // realized pnl per day from closed trades
    const pnlByDay = new Map<string, number>();
    for (const t of trades) {
      if (t.pnl != null && t.closedAt) {
        const k = dayKey(t.closedAt);
        pnlByDay.set(k, (pnlByDay.get(k) ?? 0) + t.pnl);
      }
    }
    let maraNav = baselineStart;
    for (const bar of sorted) {
      const day = dayKey(bar.openTime);
      maraNav += pnlByDay.get(day) ?? 0;
      series.push({
        ts: bar.openTime,
        mara: Math.round(maraNav * 100) / 100,
        buyHold: Math.round((baselineStart * (bar.close / startClose)) * 100) / 100,
        didNothing: baselineStart,
      });
    }
    void firstDecisionTs;
  }

  const resolvedCount = hits + stops;
  return {
    theses,
    stats: {
      totalDecisions: decisions.length,
      accepted, rejected, hits, stops, drifts, open,
      winRate: resolvedCount > 0 ? Math.round((hits / resolvedCount) * 100) : null,
      cumulativePnl: TradeStore.getCumulativePnl(),
    },
    counterfactual: {
      series,
      baselineStart,
      note: 'MARA NAV = $10k + realized P&L by close date. Buy-and-hold = $10k in BTC at window start (SoSoValue 1d closes). Did-nothing = flat $10k. Rejected theses are listed with reasons — losses and passes are never hidden.',
    },
    generatedAt: Date.now(),
  };
}
