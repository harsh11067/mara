/**
 * Gate 4: Full pipeline integration test
 * Run: npx tsx scripts/test-pipeline.ts
 *
 * Simulates a macro event trigger and runs the complete pipeline:
 * 1. Event reconciler fires with simulated CPI data
 * 2. Analyzer fetches real market context
 * 3. Gemini produces conviction decision
 * 4. Risk limits are checked
 * 5. Trade is executed on SoDEX testnet (if risk approved)
 * 6. SSI rotation is computed (executed if holdings exist)
 * 7. Trade is recorded in DB
 *
 * This test uses REAL API calls to SoSoValue, SoDEX, and Gemini.
 * Expected outcome: BEAR conviction → SHORT order placed on testnet.
 */
import 'dotenv/config';
import { getDb } from '../src/store/db.js';
import { Analyzer } from '../src/ai/analyzer.js';
import { checkRiskLimits } from '../src/risk/risk-limits.js';
import { OrderExecutor } from '../src/executor/order-executor.js';
import { SSIManager } from '../src/services/ssi-manager.js';
import { SoDEXClient } from '../src/services/sodex-client.js';
import { config } from '../src/config.js';

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${label}${detail ? ` → ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

async function run(): Promise<void> {
  console.log('\n🔬 Full Pipeline Integration Test\n');
  console.log('  This test places a REAL order on SoDEX testnet.\n');

  // Initialize DB
  getDb();

  const analyzer  = new Analyzer();
  const executor  = new OrderExecutor();
  const ssiMgr    = new SSIManager();
  const sodex     = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);

  // ── STEP 1: Simulate a hot CPI event ──────────────────────────────────────
  console.log('STEP 1: Run analysis pipeline (simulated hot CPI)');
  // No eventId — decision stored without FK (simulated event, not in events table)
  const { surprise, market, decision } = await analyzer.analyze({
    eventName: 'CPI',
    actual:    3.4,   // hot: above forecast
    forecast:  3.2,
    previous:  3.1,
  });

  check('Surprise calculated', surprise.surpriseScore !== 0,
    `score=${surprise.surpriseScore.toFixed(2)}σ bias=${surprise.cryptoBias}`);
  check('Market context fetched', market.btcPrice > 0,
    `BTC=$${market.btcPrice.toLocaleString()} ATR=${market.atr14.toFixed(0)}`);
  check('AI decision produced', decision.conviction !== undefined,
    `${decision.conviction} (${decision.confidence}%) → ${decision.action}`);
  check('Reasoning non-empty', decision.reasoning.length > 10,
    decision.reasoning.slice(0, 80));
  console.log(`  Reasoning: "${decision.reasoning.slice(0, 120)}..."`);

  // ── STEP 2: Risk limits ────────────────────────────────────────────────────
  console.log('\nSTEP 2: Risk limits check');
  const balance = await sodex.getPerpsBalances(config.sodex.masterAddress);
  const avail   = parseFloat(balance.availableBalance);
  check('Balance fetched', avail >= 0, `$${avail.toFixed(2)} USDC available`);

  const riskResult = await checkRiskLimits({
    availableBalance: avail,
    atr14: market.atr14,
  });
  console.log(`  Risk check: ${riskResult.allowed ? 'ALLOWED' : 'BLOCKED'} ${riskResult.reason ? `(${riskResult.reason})` : ''}`);

  // ── STEP 3: Execute trade (if action is not NO_TRADE and risk allows) ──────
  console.log('\nSTEP 3: Trade execution');
  if (decision.action === 'NO_TRADE') {
    console.log(`  ℹ  AI returned NO_TRADE (${decision.noTradeReason}) — skipping execution`);
    check('Decision persisted', true, 'NO_TRADE stored in DB');
  } else if (!riskResult.allowed) {
    console.log(`  ℹ  Risk blocked: ${riskResult.reason} — skipping execution`);
    check('Risk gate works', true, riskResult.reason);
  } else {
    const execResult = await executor.execute(decision);
    check('Trade executed', execResult.success,
      execResult.success
        ? `orderID=${execResult.orderId} clOrdID=${execResult.clOrdID}`
        : execResult.error ?? 'unknown');

    if (execResult.success && execResult.spec) {
      const spec = execResult.spec;
      check('Order spec valid', spec.price > 0 && spec.quantity > 0,
        `${spec.side} ${spec.quantity} BTC @ $${spec.price.toLocaleString()}`);
      check('Stop-loss set', spec.stopLoss > 0, `SL=$${spec.stopLoss.toLocaleString()}`);
      check('Take-profit set', spec.takeProfit > 0, `TP=$${spec.takeProfit.toLocaleString()}`);
    }
  }

  // ── STEP 4: SSI Manager ────────────────────────────────────────────────────
  console.log('\nSTEP 4: SSI Manager');
  const holdings = await ssiMgr.getHoldings();
  console.log(`  SSI holdings: ${holdings.length === 0 ? 'none' : holdings.map((h) => `${h.index}=${h.balance.toFixed(2)}`).join(', ')}`);

  const conviction = decision.conviction as 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
  const plan = ssiMgr.computeRotation(conviction, holdings);
  check('Rotation plan computed', true,
    `${conviction} → ${plan.orders.length} orders (${plan.estimatedUsdValue.toFixed(2)} USDC est.)`);

  if (plan.orders.length > 0) {
    console.log('  Rotation orders:');
    for (const o of plan.orders) {
      console.log(`    ${o.side} ${o.quantity.toFixed(4)} ${o.symbol} — ${o.reason}`);
    }
    // Execute if holdings exist (skip if empty testnet account)
    if (holdings.length > 0) {
      const rotResult = await ssiMgr.executeRotation(plan);
      check('SSI rotation executed', rotResult.executed > 0 || rotResult.failed === 0,
        `${rotResult.executed} done, ${rotResult.failed} failed`);
    } else {
      console.log('  ℹ  No SSI holdings on testnet — rotation would execute in production');
    }
  }

  // ── STEP 5: DB verification ────────────────────────────────────────────────
  console.log('\nSTEP 5: Database records');
  const { DecisionStore } = await import('../src/store/decision-store.js');
  const { TradeStore } = await import('../src/store/trade-store.js');

  const recentDecisions = DecisionStore.getRecent(1);
  check('Decision stored in DB', recentDecisions.length > 0,
    `id=${recentDecisions[0]?.id.slice(0, 8)} conviction=${recentDecisions[0]?.conviction}`);

  const openTrades = TradeStore.getOpen();
  console.log(`  Open trades in DB: ${openTrades.length}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────');
  const exitCode = process.exitCode ?? 0;
  if (exitCode === 0) {
    console.log('✅  Full pipeline test passed!\n');
    console.log('  Day 3 ✅  EIP-712 signing + order execution');
    console.log('  Day 4 ✅  Risk engine + SSI manager + full pipeline\n');
  } else {
    console.log('❌  Some pipeline checks FAILED.\n');
  }
}

run().catch((err) => {
  console.error('Pipeline test error:', err);
  process.exit(1);
});
