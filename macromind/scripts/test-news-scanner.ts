/**
 * Gate 1.5: News Scanner pattern matching test
 * Run: npx tsx scripts/test-news-scanner.ts
 * No API keys required.
 */
import { NewsScanner } from '../src/scheduler/news-scanner.js';

const scanner = new NewsScanner();

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${label}${detail ? ` → ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

console.log('\n🔍 Testing News Scanner patterns...\n');

const TEST_CASES: Array<{
  headline: string;
  expectedEvent: string | null;
  expectedActual?: number | 'hold' | null;
  description: string;
}> = [
  // ── Should match ──────────────────────────────────────────────────────────
  {
    headline: 'CPI comes in at 3.4%, above 3.2% consensus',
    expectedEvent: 'CPI',
    expectedActual: 3.4,
    description: 'CPI standard release headline',
  },
  {
    headline: 'CPI prints 3.1%, below 3.3% forecast',
    expectedEvent: 'CPI',
    expectedActual: 3.1,
    description: 'CPI alternative wording',
  },
  {
    headline: 'Nonfarm Payrolls prints 275K vs 250K expected',
    expectedEvent: 'NFP',
    expectedActual: 275,
    description: 'NFP standard release',
  },
  {
    headline: 'Non-Farm Payrolls came in at 180K, missing 210K estimate',
    expectedEvent: 'NFP',
    expectedActual: 180,
    description: 'NFP hyphenated variant',
  },
  {
    headline: 'FOMC holds rate unchanged at 5.25-5.50%',
    expectedEvent: 'FOMC',
    expectedActual: 'hold',
    description: 'FOMC hold decision',
  },
  {
    headline: 'Fed hikes interest rates by 25bps to 5.50-5.75%',
    expectedEvent: 'FOMC',
    expectedActual: 1,  // sentinel for hike
    description: 'FOMC rate hike',
  },
  {
    headline: 'Core CPI at 3.8%, above 3.6% expectations',
    expectedEvent: 'Core CPI',
    expectedActual: 3.8,
    description: 'Core CPI release',
  },
  {
    headline: 'Unemployment Rate falls to 3.8%, below 4.0% forecast',
    expectedEvent: 'Unemployment Rate',
    expectedActual: 3.8,
    description: 'Unemployment rate release',
  },
  {
    headline: 'GDP grows at 2.5% in Q1, beating 2.1% estimate',
    expectedEvent: 'GDP',
    expectedActual: 2.5,
    description: 'GDP release',
  },

  // ── Should NOT match (false positive prevention) ─────────────────────────
  {
    headline: 'Bitcoin drops 2% on profit taking',
    expectedEvent: null,
    description: 'Bitcoin price movement - NOT a macro event',
  },
  {
    headline: 'Analyst expects CPI to come in at 3.3% next week',
    expectedEvent: null,
    description: 'CPI prediction - NOT a release (expect keyword)',
  },
  {
    headline: 'Forecast for GDP growth revised to 2.2%',
    expectedEvent: null,
    description: 'GDP forecast revision - NOT a release',
  },
  {
    headline: 'Market pricing in 25bps rate cut at December FOMC',
    expectedEvent: null,
    description: 'FOMC prediction - NOT a decision',
  },
  {
    headline: 'Crypto market cap climbs to $3.2 trillion',
    expectedEvent: null,
    description: 'Crypto market cap - NOT a macro event',
  },
];

for (const tc of TEST_CASES) {
  const match = scanner.matchHeadline(tc.headline);
  scanner.reset();

  if (tc.expectedEvent === null) {
    // Should NOT match
    check(`NO MATCH: "${tc.headline.slice(0, 60)}..."`, match === null,
      match ? `WRONGLY matched as ${match.event}` : 'correctly not matched');
  } else {
    // Should match
    const correctEvent = match?.event === tc.expectedEvent;
    const correctActual = tc.expectedActual === undefined
      ? true
      : match?.actual === tc.expectedActual;

    check(`MATCH "${tc.description}": event=${tc.expectedEvent}`,
      match !== null && correctEvent,
      match ? `event=${match.event}${match.actual !== null ? ` actual=${match.actual}` : ''}` : 'NO MATCH');

    if (match && tc.expectedActual !== undefined) {
      check(`  → actual extracted correctly`,
        match.actual === tc.expectedActual,
        `expected=${tc.expectedActual} got=${match.actual}`);
    }
  }
}

console.log('\n─────────────────────────────────────────');
const exitCode = process.exitCode ?? 0;
if (exitCode === 0) {
  console.log('✅  News scanner tests passed!\n');
} else {
  console.log('❌  Some tests FAILED.\n');
}
