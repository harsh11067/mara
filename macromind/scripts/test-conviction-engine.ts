/**
 * Gate 3: AI Conviction Engine test
 * Run: npx tsx scripts/test-conviction-engine.ts
 *
 * Requires ANTHROPIC_API_KEY in .env
 */
import 'dotenv/config';
import { ConvictionEngine } from '../src/ai/conviction-engine.js';
import type { SurpriseResult, MarketContext } from '../src/ai/types.js';

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${label}${detail ? ` → ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

const engine = new ConvictionEngine();

const BASE_MARKET: MarketContext = {
  btcPrice: 108500,
  btcChange1h: -0.8,
  btcChange24h: -1.2,
  btcVolume24h: 32_000_000_000,
  atr14: 450,
  etfFlowDirection: 'outflow',
  etfFlowMagnitude: 80_000_000,
  recentHeadlines: [
    'CPI comes in hot at 3.4%, above 3.2% consensus',
    'Rate cut expectations pushed to Q4 after inflation data',
    'Bitcoin drops 1.2% in immediate reaction to CPI',
    'Fed officials likely to maintain hawkish stance',
  ],
};

async function run(): Promise<void> {
  console.log('\n🔍 Testing AI Conviction Engine...\n');
  console.log('  This makes real Gemini API calls. ~3 calls, free tier.\n');

  // ── Scenario A: Strong bearish (hot CPI) ──────────────────────────────────
  {
    console.log('SCENARIO A: CPI +1.33σ surprise, bearish news, ETF outflows');
    const surprise: SurpriseResult = {
      event: 'CPI',
      actual: 3.4,
      forecast: 3.2,
      previous: 3.1,
      surpriseScore: 1.33,
      surpriseDirection: 'above',
      stddev: 0.15,
      historicalCount: 20,
      historicalAvgMove: 3.32,
      cryptoBias: 'bearish',
      impactMagnitude: 'high',
      confidence: 'high',
    };

    const decision = await engine.analyze(surprise, BASE_MARKET);
    console.log(`  conviction=${decision.conviction} confidence=${decision.confidence}% action=${decision.action}`);
    console.log(`  reasoning: ${decision.reasoning.slice(0, 120)}...`);
    check('Conviction is BEAR or STRONG_BEAR', decision.conviction === 'STRONG_BEAR' || decision.conviction === 'BEAR',
      decision.conviction);
    check('Confidence > 60', decision.confidence > 60, String(decision.confidence));
    check('Action is SHORT', decision.action === 'SHORT', decision.action);
    check('Reasoning is non-empty', decision.reasoning.length > 10);
  }

  console.log();

  // ── Scenario B: Inline CPI → NEUTRAL ─────────────────────────────────────
  {
    console.log('SCENARIO B: CPI inline with consensus (0σ), mixed news');
    const surprise: SurpriseResult = {
      event: 'CPI',
      actual: 3.2,
      forecast: 3.2,
      previous: 3.1,
      surpriseScore: 0.0,
      surpriseDirection: 'inline',
      stddev: 0.15,
      historicalCount: 15,
      historicalAvgMove: 0,
      cryptoBias: 'neutral',
      impactMagnitude: 'high',
      confidence: 'high',
    };

    const neutralMarket: MarketContext = {
      ...BASE_MARKET,
      btcChange1h: 0.1,
      etfFlowDirection: 'neutral',
      etfFlowMagnitude: 0,
      recentHeadlines: ['CPI in line with expectations at 3.2%', 'Market reaction muted to CPI data'],
    };

    const decision = await engine.analyze(surprise, neutralMarket);
    console.log(`  conviction=${decision.conviction} confidence=${decision.confidence}% action=${decision.action}`);
    check('Conviction is NEUTRAL or low conviction',
      decision.conviction === 'NEUTRAL' || decision.confidence < 70, decision.conviction);
    check('Action is NO_TRADE', decision.action === 'NO_TRADE', decision.action);
  }

  console.log();

  // ── Scenario C: Strong bullish (NFP miss) ─────────────────────────────────
  {
    console.log('SCENARIO C: NFP miss (-1.5σ), bullish news, ETF inflows');
    const surprise: SurpriseResult = {
      event: 'NFP',
      actual: 150,
      forecast: 220,
      previous: 250,
      surpriseScore: -1.5,
      surpriseDirection: 'below',
      stddev: 46,
      historicalCount: 18,
      historicalAvgMove: 3.0,
      cryptoBias: 'bullish',
      impactMagnitude: 'high',
      confidence: 'high',
    };

    const bullMarket: MarketContext = {
      btcPrice: 107000,
      btcChange1h: 1.5,
      btcChange24h: 2.1,
      btcVolume24h: 38_000_000_000,
      atr14: 480,
      etfFlowDirection: 'inflow',
      etfFlowMagnitude: 120_000_000,
      recentHeadlines: [
        'Nonfarm Payrolls prints 150K vs 220K expected, labor market cooling',
        'Rate cut bets surge after weak jobs data',
        'Bitcoin surges on rate cut hopes',
        'ETF inflows accelerate ahead of payrolls data',
      ],
    };

    const decision = await engine.analyze(surprise, bullMarket);
    console.log(`  conviction=${decision.conviction} confidence=${decision.confidence}% action=${decision.action}`);
    check('Conviction is BULL or STRONG_BULL',
      decision.conviction === 'STRONG_BULL' || decision.conviction === 'BULL', decision.conviction);
    check('Confidence > 60', decision.confidence > 60, String(decision.confidence));
    check('Action is LONG', decision.action === 'LONG', decision.action);
  }

  console.log('\n─────────────────────────────────────────');
  const exitCode = process.exitCode ?? 0;
  if (exitCode === 0) {
    console.log('✅  AI conviction engine tests passed!\n');
  } else {
    console.log('❌  Some tests FAILED.\n');
  }
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
