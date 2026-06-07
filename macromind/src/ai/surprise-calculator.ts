import { createLogger } from '../utils/logger.js';
import { getCryptoBias, getEventMapping } from './event-mappings.js';
import type { SurpriseResult } from './types.js';
import type { EventDataPoint } from '../services/types.js';

const logger = createLogger('SurpriseCalc');

/**
 * Rolling window size for surprise calibration.
 * Using the last 18 releases keeps stddev calibrated to current consensus
 * volatility. A full-history stddev dilutes with old regimes (e.g., zero-rate
 * era surprises are structurally smaller than 2022-2024 surprises).
 * 18 ≈ 1.5 years of monthly data (CPI, PCE, NFP) or 4.5 years of quarterly.
 */
const ROLLING_WINDOW = 18;
const MIN_WINDOW = 5;

/**
 * Calculate the standard deviation of recent historical surprise values.
 * Uses a rolling window so the stddev reflects current market sensitivity.
 * surprise(i) = actual(i) - forecast(i)  [only where both are non-null]
 */
function calcStddev(points: EventDataPoint[]): { stddev: number; mean: number; count: number; windowUsed: number } {
  // Sort newest first, apply rolling window
  const sorted = [...points]
    .filter((p) => p.actual !== null && p.forecast !== null && p.date)
    .sort((a, b) => b.date.localeCompare(a.date));

  const windowPoints = sorted.length >= MIN_WINDOW ? sorted.slice(0, ROLLING_WINDOW) : sorted;
  const surprises = windowPoints.map((p) => (p.actual as number) - (p.forecast as number));

  if (surprises.length === 0) return { stddev: 1, mean: 0, count: 0, windowUsed: 0 };

  const mean = surprises.reduce((s, v) => s + v, 0) / surprises.length;
  const variance = surprises.reduce((s, v) => s + (v - mean) ** 2, 0) / surprises.length;
  const stddev = Math.sqrt(variance) || 1;

  return { stddev, mean, count: surprises.length, windowUsed: windowPoints.length };
}

/**
 * Calculate historical average BTC move for above/below surprises.
 * NOTE: We don't have BTC price history here, so we use the event mapping's
 * typicalBtcMove as a proxy.
 */
function getHistoricalAvgMove(eventName: string, surpriseScore: number): number {
  const mapping = getEventMapping(eventName);
  if (!mapping) return 1.0;
  // Scale by surprise magnitude: 1σ → typicalBtcMove, 2σ → 2x, etc.
  return Math.abs(surpriseScore) * mapping.typicalBtcMove;
}

/**
 * Compute the macro surprise score and crypto bias for a given event.
 *
 * @param eventName  e.g. "CPI", "Nonfarm Payrolls"
 * @param actual     The actual released value
 * @param forecast   The consensus forecast
 * @param previous   The prior release value
 * @param history    Historical data points from SoSoValue API
 */
export function computeSurprise(
  eventName: string,
  actual: number,
  forecast: number,
  previous: number | null,
  history: EventDataPoint[],
): SurpriseResult {
  // ── 1. Calculate surprise score (rolling window) ──────────────────────────
  const { stddev, count, windowUsed } = calcStddev(history);
  const rawSurprise = actual - forecast;

  // Avoid division by zero (can happen if all historical surprises = 0)
  const surpriseScore = stddev > 0 ? rawSurprise / stddev : 0;

  // ── 2. Direction ──────────────────────────────────────────────────────────
  const mapping = getEventMapping(eventName);
  const inlineTolerance = mapping?.inlineTolerance ?? 0.5;

  let surpriseDirection: 'above' | 'below' | 'inline';
  if (Math.abs(surpriseScore) <= inlineTolerance) {
    surpriseDirection = 'inline';
  } else if (rawSurprise > 0) {
    surpriseDirection = 'above';
  } else {
    surpriseDirection = 'below';
  }

  // ── 3. Crypto bias ────────────────────────────────────────────────────────
  const { bias: cryptoBias, impactMagnitude, typicalBtcMove } = getCryptoBias(
    eventName,
    surpriseDirection,
    surpriseScore,
  );

  // ── 4. Historical avg move (scaled by surprise size) ─────────────────────
  const historicalAvgMove = getHistoricalAvgMove(eventName, surpriseScore);

  // ── 5. Confidence ─────────────────────────────────────────────────────────
  let confidence: 'high' | 'medium' | 'low';
  if (count >= 12) confidence = 'high';
  else if (count >= 6) confidence = 'medium';
  else confidence = 'low';

  const result: SurpriseResult = {
    event: eventName,
    actual,
    forecast,
    previous,
    surpriseScore,
    surpriseDirection,
    stddev,
    historicalCount: count,
    historicalAvgMove,
    cryptoBias,
    impactMagnitude,
    confidence,
  };

  logger.info(`Surprise computed for ${eventName}`, {
    actual,
    forecast,
    surpriseScore: surpriseScore.toFixed(2),
    direction: surpriseDirection,
    bias: cryptoBias,
    rollingWindow: windowUsed,
    totalHistory: history.length,
  });

  return result;
}

/** Simple description of the surprise for LLM context */
export function describeSurprise(s: SurpriseResult): string {
  const sign = s.surpriseScore > 0 ? '+' : '';
  const sigma = `${sign}${s.surpriseScore.toFixed(2)}σ`;
  const dir = s.surpriseDirection === 'inline'
    ? 'inline with consensus'
    : `${s.surpriseDirection.toUpperCase()} consensus by ${Math.abs(s.actual - s.forecast).toFixed(2)}`;

  return `${s.event}: actual=${s.actual}, forecast=${s.forecast} (${dir}, surprise_score=${sigma}) → crypto bias: ${s.cryptoBias.toUpperCase()}`;
}
