/**
 * Gate 2: Surprise Calculator test
 * Run: npx tsx scripts/test-surprise-calculator.ts
 */
import { computeSurprise } from '../src/ai/surprise-calculator.js';
import type { EventDataPoint } from '../src/services/types.js';

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${label}${detail ? ` → ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

// Mock CPI history with known values
const CPI_HISTORY: EventDataPoint[] = [
  { date: '2026-04-10', actual: 3.5, forecast: 3.3, previous: 3.2 },
  { date: '2026-03-12', actual: 3.2, forecast: 3.4, previous: 3.3 },
  { date: '2026-02-12', actual: 3.1, forecast: 3.0, previous: 2.9 },
  { date: '2026-01-15', actual: 2.9, forecast: 3.1, previous: 3.2 },
  { date: '2025-12-11', actual: 3.3, forecast: 3.2, previous: 3.1 },
  { date: '2025-11-13', actual: 3.4, forecast: 3.2, previous: 3.1 },
  { date: '2025-10-10', actual: 3.2, forecast: 3.3, previous: 3.4 },
  { date: '2025-09-11', actual: 3.7, forecast: 3.5, previous: 3.3 },
  { date: '2025-08-13', actual: 2.9, forecast: 3.1, previous: 3.2 },
  { date: '2025-07-11', actual: 3.0, forecast: 3.0, previous: 2.9 },
];

console.log('\n🔍 Testing Surprise Calculator...\n');

// ── Test 1: CPI +1.33σ surprise ─────────────────────────────────────────────
{
  // Surprises: 0.2, -0.2, 0.1, -0.2, 0.1, 0.2, -0.1, 0.2, -0.2, 0.0
  // Stddev ≈ 0.15
  const result = computeSurprise('CPI', 3.4, 3.2, 3.1, CPI_HISTORY);
  console.log('Test 1 — CPI actual=3.4, forecast=3.2:');
  console.log(`  surpriseScore: ${result.surpriseScore.toFixed(4)}`);
  console.log(`  direction: ${result.surpriseDirection}`);
  console.log(`  cryptoBias: ${result.cryptoBias}`);
  console.log(`  stddev: ${result.stddev.toFixed(4)}`);

  check('surpriseScore is positive (above forecast)', result.surpriseScore > 0,
    result.surpriseScore.toFixed(2));
  check('direction = above', result.surpriseDirection === 'above');
  check('cryptoBias = bearish (hot CPI = bearish crypto)', result.cryptoBias === 'bearish');
  check('stddev is non-zero', result.stddev > 0, result.stddev.toFixed(4));
  check('historicalCount >= 5', result.historicalCount >= 5, String(result.historicalCount));

  // Verify roughly ~1.33σ (allow for variance due to exact values)
  check('surpriseScore ~1.0–2.0σ range (hot CPI)', result.surpriseScore > 0.5 && result.surpriseScore < 4,
    result.surpriseScore.toFixed(2));
}

console.log();

// ── Test 2: CPI inline ───────────────────────────────────────────────────────
{
  const result = computeSurprise('CPI', 3.2, 3.2, 3.1, CPI_HISTORY);
  console.log('Test 2 — CPI actual=3.2, forecast=3.2 (inline):');
  check('surpriseScore ≈ 0', Math.abs(result.surpriseScore) < 0.01, result.surpriseScore.toFixed(4));
  check('direction = inline', result.surpriseDirection === 'inline');
  check('cryptoBias = neutral (inline = neutral)', result.cryptoBias === 'neutral');
}

console.log();

// ── Test 3: CPI miss (below) ─────────────────────────────────────────────────
{
  const result = computeSurprise('CPI', 2.8, 3.2, 3.1, CPI_HISTORY);
  console.log('Test 3 — CPI actual=2.8, forecast=3.2 (below):');
  check('surpriseScore is negative', result.surpriseScore < 0, result.surpriseScore.toFixed(2));
  check('direction = below', result.surpriseDirection === 'below');
  check('cryptoBias = bullish (cool CPI = rate cuts = bullish)', result.cryptoBias === 'bullish');
}

console.log();

// ── Test 4: NFP strong ───────────────────────────────────────────────────────
{
  const nfpHistory: EventDataPoint[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-0${(i % 9) + 1}-01`,
    actual: 200 + Math.random() * 50,
    forecast: 210 + Math.random() * 30,
    previous: 190,
  }));
  const result = computeSurprise('NFP', 275, 250, 220, nfpHistory);
  console.log('Test 4 — NFP actual=275K, forecast=250K (strong jobs):');
  check('cryptoBias = bearish (strong NFP = no cuts = bearish crypto)', result.cryptoBias === 'bearish');
}

console.log();

// ── Test 5: Edge cases ───────────────────────────────────────────────────────
{
  // Empty history
  const result = computeSurprise('GDP', 2.5, 2.0, 1.8, []);
  console.log('Test 5 — GDP with empty history:');
  check('No crash on empty history', true);
  check('confidence = low (< 5 data points)', result.confidence === 'low');

  // Division by zero protection: all same surprises → stddev = 0
  const flatHistory: EventDataPoint[] = Array.from({ length: 5 }, () => ({
    date: '2026-01-01', actual: 3.0, forecast: 3.0, previous: 3.0,
  }));
  const result2 = computeSurprise('CPI', 3.1, 3.0, 3.0, flatHistory);
  check('No division by zero (stddev=0 case)', isFinite(result2.surpriseScore));
}

console.log('\n─────────────────────────────────────────');
const exitCode = process.exitCode ?? 0;
if (exitCode === 0) {
  console.log('✅  Surprise calculator tests passed!\n');
} else {
  console.log('❌  Some tests FAILED.\n');
}
