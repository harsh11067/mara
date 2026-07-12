/**
 * TIME MACHINE — scrub any historical macro print through MARA's decision
 * logic and watch what would have happened, on real data.
 *
 * Honest-by-construction rules:
 *   - Every print comes from the seeded macro-catalyst corpus (real SoSoValue
 *     history + real BTC/ETH forward returns).
 *   - NO LOOKAHEAD: the replay verdict for a given date only uses analog
 *     prints strictly BEFORE that date. Early prints honestly return NEUTRAL
 *     ("insufficient history") instead of pretending.
 *   - No Gemini calls — the replay is the deterministic evidence layer the
 *     agent itself consults (analog medians + consistency), so scrubbing is
 *     instant and free.
 *   - Hypothetical P&L uses the REAL +1d/+7d close-to-close returns stored
 *     per print, scaled by the regime size multiplier recorded at seed time.
 */
import type { Hono } from 'hono';
import { getDb } from '../store/db.js';

const REGIME_SIZE: Record<string, number> = {
  BULL_QUIET: 1.0, BULL_VOLATILE: 0.6, RANGING: 0.75, BEAR_VOLATILE: 0.5, CRASH: 0.25,
};

interface CorpusRow {
  id: string; event_type: string; date: string;
  actual: number | null; forecast: number | null; previous: number | null;
  surprise_z: number | null; direction: string | null; regime_label: string | null;
  btc_ret_1d: number | null; btc_ret_3d: number | null; btc_ret_7d: number | null; btc_ret_30d: number | null;
  eth_ret_1d: number | null; eth_ret_3d: number | null; eth_ret_7d: number | null; eth_ret_30d: number | null;
}

interface ReplayVerdict {
  verdict: 'BULL' | 'BEAR' | 'NEUTRAL';
  confidence: number;           // 0-100
  analogCount: number;
  analogMedianRet1d: number | null;
  analogHitRate: number | null; // % of analogs where BTC went the verdict's way next day
  explanation: string;
  hypotheticalPnlPct1d: number | null;  // regime-sized, real next-day return
  hypotheticalPnlPct7d: number | null;
  sizeMultiplier: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Replay one print using only prints strictly before it (no lookahead). */
function replayPrint(row: CorpusRow, history: CorpusRow[]): ReplayVerdict {
  const size = REGIME_SIZE[row.regime_label ?? ''] ?? 0.75;
  const analogs = history.filter(
    (h) => h.direction === row.direction && h.btc_ret_1d !== null && h.date < row.date,
  );

  if (!row.direction || row.direction === 'inline' || analogs.length < 3) {
    return {
      verdict: 'NEUTRAL', confidence: 50,
      analogCount: analogs.length, analogMedianRet1d: null, analogHitRate: null,
      explanation: !row.direction || row.direction === 'inline'
        ? 'Print landed in line with forecast — no surprise edge, the agent stands down.'
        : `Only ${analogs.length} prior ${row.direction}-surprise analog(s) at this point in history — below the 3-analog evidence floor, so NO TRADE. Honesty beats a coin flip.`,
      hypotheticalPnlPct1d: null, hypotheticalPnlPct7d: null, sizeMultiplier: size,
    };
  }

  const rets = analogs.map((a) => a.btc_ret_1d as number);
  const med = median(rets);
  const verdict: 'BULL' | 'BEAR' | 'NEUTRAL' = Math.abs(med) < 0.05 ? 'NEUTRAL' : med > 0 ? 'BULL' : 'BEAR';
  const agreeing = rets.filter((r) => (med > 0 ? r > 0 : r < 0)).length;
  const hitRate = Math.round((agreeing / rets.length) * 100);
  const zBoost = Math.min(15, Math.abs(row.surprise_z ?? 0) * 5);
  const confidence = verdict === 'NEUTRAL' ? 50 : Math.min(92, Math.round(50 + (hitRate - 50) * 0.7 + zBoost));

  let pnl1d: number | null = null, pnl7d: number | null = null;
  if (verdict !== 'NEUTRAL') {
    const sign = verdict === 'BULL' ? 1 : -1;
    pnl1d = row.btc_ret_1d !== null ? Math.round(sign * row.btc_ret_1d * size * 100) / 100 : null;
    pnl7d = row.btc_ret_7d !== null ? Math.round(sign * row.btc_ret_7d * size * 100) / 100 : null;
  }

  return {
    verdict, confidence,
    analogCount: analogs.length,
    analogMedianRet1d: Math.round(med * 100) / 100,
    analogHitRate: hitRate,
    explanation:
      `${analogs.length} prior ${row.event_type} prints surprised ${row.direction} → BTC next-day median ` +
      `${med >= 0 ? '+' : ''}${med.toFixed(2)}% (${hitRate}% consistent). ` +
      `Surprise z=${(row.surprise_z ?? 0).toFixed(2)}σ in ${row.regime_label ?? 'unknown'} regime ` +
      `(size ×${size}) → ${verdict} ${confidence}%.`,
    hypotheticalPnlPct1d: pnl1d, hypotheticalPnlPct7d: pnl7d,
    sizeMultiplier: size,
  };
}

export function replayRoutes(app: Hono): void {
  // Families available for replay
  app.get('/api/replay/events', (c) => {
    const rows = getDb().prepare(
      'SELECT event_type, COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM macro_catalysts GROUP BY event_type ORDER BY n DESC',
    ).all() as Array<{ event_type: string; n: number; first: string; last: string }>;
    return c.json({ families: rows, generatedAt: Date.now() });
  });

  // Full timeline for one family, each print replayed without lookahead
  app.get('/api/replay', (c) => {
    const eventType = c.req.query('event_type') ?? 'CPI';
    const all = getDb().prepare(
      'SELECT * FROM macro_catalysts WHERE event_type = ? ORDER BY date ASC',
    ).all(eventType) as CorpusRow[];

    if (all.length === 0) {
      return c.json({
        eventType, prints: [],
        note: 'Corpus empty for this family — seed it first: POST /api/corpus/seed',
      });
    }

    let cumulative = 0;
    const prints = all.map((row) => {
      const replay = replayPrint(row, all);
      if (replay.hypotheticalPnlPct1d !== null) cumulative += replay.hypotheticalPnlPct1d;
      return {
        id: row.id,
        date: row.date,
        actual: row.actual,
        forecast: row.forecast,
        previous: row.previous,
        surpriseZ: row.surprise_z,
        direction: row.direction,
        regime: row.regime_label,
        btcRet: { d1: row.btc_ret_1d, d3: row.btc_ret_3d, d7: row.btc_ret_7d, d30: row.btc_ret_30d },
        ethRet: { d1: row.eth_ret_1d, d3: row.eth_ret_3d, d7: row.eth_ret_7d, d30: row.eth_ret_30d },
        replay,
        cumulativePnlPct: Math.round(cumulative * 100) / 100,
      };
    });

    const traded = prints.filter((p) => p.replay.hypotheticalPnlPct1d !== null);
    const wins = traded.filter((p) => (p.replay.hypotheticalPnlPct1d ?? 0) > 0);
    return c.json({
      eventType,
      prints,
      summary: {
        totalPrints: prints.length,
        traded: traded.length,
        stoodDown: prints.length - traded.length,
        winRate: traded.length ? Math.round((wins.length / traded.length) * 100) : null,
        cumulativePnlPct: Math.round(cumulative * 100) / 100,
      },
      method: 'Deterministic no-lookahead replay: analog medians from prints strictly before each date; real close-to-close BTC returns; regime-sized. This is the evidence layer the live agent consults — not a Gemini rerun.',
      generatedAt: Date.now(),
    });
  });
}
