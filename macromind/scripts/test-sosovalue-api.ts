/**
 * Gate 1: SoSoValue API connectivity test
 * Run: npx tsx scripts/test-sosovalue-api.ts
 *
 * Every ✓ should print. Any ✗ = stop and fix before proceeding.
 */
import 'dotenv/config';
import { SoSoValueClient, BTC_CURRENCY_ID } from '../src/services/sosovalue-client.js';
import { config } from '../src/config.js';

const client = new SoSoValueClient(config.sosovalue.apiKey, config.sosovalue.baseUrl);

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${label}${detail ? ` → ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

async function run(): Promise<void> {
  console.log('\n🔍 Testing SoSoValue API...\n');

  // ── 1. Macro Events ──────────────────────────────────────────────────────
  try {
    const events = await client.getUpcomingEvents();
    check('GET /macro/events', events.length > 0, `${events.length} events`);
    if (events.length > 0) {
      const e = events[0];
      check('  → event has name', typeof e.name === 'string' && e.name.length > 0, e.name);
      check('  → event has date', typeof e.date === 'string', e.date);
    }
  } catch (err) {
    check('GET /macro/events', false, String(err));
  }

  // ── 2. Event History (real event name format: "CPI (YoY)") ───────────────
  try {
    const history = await client.getEventHistory('CPI (YoY)', 5);
    check('GET /macro/events/CPI (YoY)/history', history.length > 0, `${history.length} data points`);
    if (history.length > 0) {
      const h = history[0];
      check('  → has date', typeof h.date === 'string', h.date);
      check('  → has actual or forecast', h.actual !== null || h.forecast !== null,
        `actual=${h.actual} forecast=${h.forecast}`);
    }
  } catch (err) {
    check('GET /macro/events/CPI (YoY)/history', false, String(err));
  }

  // ── 3. News ───────────────────────────────────────────────────────────────
  try {
    const news = await client.getLatestNews({ pageSize: 5 });
    check('GET /news', news.length > 0, `${news.length} items`);
    if (news.length > 0) {
      check('  → news has title or content', typeof news[0].title === 'string',
        (news[0].title ?? '(no title — content used as fallback)').slice(0, 60));
    }
  } catch (err) {
    check('GET /news', false, String(err));
  }

  // ── 4. Hot News ───────────────────────────────────────────────────────────
  try {
    const hot = await client.getHotNews();
    check('GET /news/hot', hot.length >= 0, `${hot.length} items`);
  } catch (err) {
    check('GET /news/hot', false, String(err));
  }

  // ── 5. News Search ────────────────────────────────────────────────────────
  try {
    const results = await client.searchNews('Bitcoin');
    check('GET /news/search?keyword=Bitcoin', results.length >= 0, `${results.length} results`);
  } catch (err) {
    check('GET /news/search', false, String(err));
  }

  // ── 6. Currency Snapshot (BTC) ─────────────────────────────────────────────
  // BTC_CURRENCY_ID = '1673723677362319866' (discovered from /currencies list)
  try {
    const snap = await client.getCurrencySnapshot(BTC_CURRENCY_ID);
    check(`GET /currencies/{btc_id}/market-snapshot`, snap.price > 0,
      `BTC price: $${snap.price.toLocaleString()}`);
  } catch (err) {
    check('GET /currencies/{btc_id}/market-snapshot', false, String(err));
  }

  // ── 7. Klines (1d only on free-tier) ───────────────────────────────────────
  try {
    const klines = await client.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 5 });
    check('GET /currencies/{btc_id}/klines?interval=1d', klines.length > 0,
      `${klines.length} candles, last close: $${klines[klines.length - 1]?.close}`);
  } catch (err) {
    check('GET /currencies/{btc_id}/klines', false, String(err));
  }

  // ── 8. ETF Summary History (country_code=US&symbol=BTC) ──────────────────
  try {
    const etf = await client.getEtfSummaryHistory('BTC', 3);
    check('GET /etfs/summary-history?country_code=US&symbol=BTC', etf.length > 0,
      `${etf.length} entries, flow[0]: ${etf[0]?.dailyNetFlow?.toLocaleString() ?? 'N/A'}`);
  } catch (err) {
    check('GET /etfs/summary-history', false, String(err));
  }

  // ── 9. Indices ────────────────────────────────────────────────────────────
  try {
    const indices = await client.getIndices();
    check('GET /indices', indices.length >= 0, `${indices.length} indices`);
    if (indices.length > 0) {
      console.log('\n  SSI Indices found:');
      indices.slice(0, 5).forEach((idx) => console.log(`    - ${idx.ticker ?? idx.id}: ${idx.name}`));
    }
  } catch (err) {
    check('GET /indices', false, String(err));
  }

  console.log('\n─────────────────────────────────────────');
  const exitCode = process.exitCode ?? 0;
  if (exitCode === 0) {
    console.log('✅  All SoSoValue checks passed!\n');
  } else {
    console.log('❌  Some checks FAILED. Fix before proceeding.\n');
  }
}

run().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});
