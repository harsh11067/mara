/**
 * Regime Classifier — adaptive market-regime detection (transformation.md §8).
 *
 * Classifies BTC into one of five regimes from daily klines:
 *   BULL_QUIET | BULL_VOLATILE | RANGING | BEAR_VOLATILE | CRASH
 *
 * Method (standard, documented approach):
 *   - trendPct  = close-over-close % change across the lookback window
 *   - realized vol = stddev of daily log returns, annualized (×√365)
 *   - CRASH: ≤ -15% over window OR any single-day drop ≤ -8%
 *   - vol threshold splits QUIET vs VOLATILE (60% annualized ≈ BTC's long-run median)
 *
 * Risk parameters are regime-conditional (used by position sizer + analyzer):
 *   sizeMultiplier scales position size, stopMultiplier widens stops in
 *   volatile regimes, and convictionFloor raises the trade bar when regime risk is high.
 */
import type { Kline } from '../services/types.js';

export type Regime = 'BULL_QUIET' | 'BULL_VOLATILE' | 'RANGING' | 'BEAR_VOLATILE' | 'CRASH';

export interface RegimeState {
  regime: Regime;
  trendPct: number;          // % move over lookback
  realizedVolAnnual: number; // annualized realized vol %
  lookbackDays: number;
  computedAt: number;
  /** regime-conditional risk params */
  risk: {
    sizeMultiplier: number;    // × base position size
    stopMultiplier: number;    // × base ATR stop distance
    convictionFloor: number;   // min confidence to trade in this regime
  };
  explanation: string;
}

const REGIME_RISK: Record<Regime, RegimeState['risk']> = {
  BULL_QUIET:    { sizeMultiplier: 1.0,  stopMultiplier: 1.0, convictionFloor: 60 },
  BULL_VOLATILE: { sizeMultiplier: 0.6,  stopMultiplier: 1.4, convictionFloor: 65 },
  RANGING:       { sizeMultiplier: 0.75, stopMultiplier: 1.0, convictionFloor: 65 },
  BEAR_VOLATILE: { sizeMultiplier: 0.5,  stopMultiplier: 1.5, convictionFloor: 70 },
  CRASH:         { sizeMultiplier: 0.25, stopMultiplier: 2.0, convictionFloor: 80 },
};

const VOL_THRESHOLD_ANNUAL = 60;   // % — quiet/volatile split
const TREND_BULL = 5;              // % over lookback
const TREND_BEAR = -5;
const CRASH_WINDOW = -15;          // % over lookback
const CRASH_DAY = -8;              // % single-day

export function classifyRegime(klines: Kline[]): RegimeState {
  const closes = klines.map((k) => k.close).filter((c) => c > 0);
  const lookbackDays = closes.length;
  const now = Date.now();

  if (closes.length < 5) {
    return {
      regime: 'RANGING', trendPct: 0, realizedVolAnnual: 0, lookbackDays,
      computedAt: now, risk: REGIME_RISK.RANGING,
      explanation: `Insufficient kline history (${closes.length} bars) — defaulting to RANGING with reduced size.`,
    };
  }

  const first = closes[0];
  const last = closes[closes.length - 1];
  const trendPct = ((last - first) / first) * 100;

  // daily log returns
  const rets: number[] = [];
  let worstDay = 0;
  for (let i = 1; i < closes.length; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    rets.push(r);
    const dayPct = (closes[i] / closes[i - 1] - 1) * 100;
    if (dayPct < worstDay) worstDay = dayPct;
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const realizedVolAnnual = Math.sqrt(variance) * Math.sqrt(365) * 100;

  let regime: Regime;
  if (trendPct <= CRASH_WINDOW || worstDay <= CRASH_DAY) {
    regime = 'CRASH';
  } else if (trendPct >= TREND_BULL) {
    regime = realizedVolAnnual >= VOL_THRESHOLD_ANNUAL ? 'BULL_VOLATILE' : 'BULL_QUIET';
  } else if (trendPct <= TREND_BEAR) {
    regime = 'BEAR_VOLATILE';
  } else {
    regime = 'RANGING';
  }

  const risk = REGIME_RISK[regime];
  return {
    regime, trendPct: round2(trendPct), realizedVolAnnual: round2(realizedVolAnnual),
    lookbackDays, computedAt: now, risk,
    explanation:
      `BTC ${trendPct >= 0 ? '+' : ''}${round2(trendPct)}% over ${lookbackDays}d with ` +
      `${round2(realizedVolAnnual)}% annualized realized vol (worst day ${round2(worstDay)}%) → ${regime}. ` +
      `Position size ×${risk.sizeMultiplier}, stops ×${risk.stopMultiplier}, conviction floor ${risk.convictionFloor}%.`,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
