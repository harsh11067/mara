/**
 * Gate 1: SoDEX read-only API connectivity test
 * Run: npx tsx scripts/test-sodex-read.ts
 */
import 'dotenv/config';
import { SoDEXClient } from '../src/services/sodex-client.js';
import { config } from '../src/config.js';

const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
const address = config.sodex.masterAddress;

function check(label: string, passed: boolean, detail?: string): void {
  const icon = passed ? '✓' : '✗';
  const color = passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}${icon}\x1b[0m  ${label}${detail ? ` → ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

async function run(): Promise<void> {
  console.log('\n🔍 Testing SoDEX API (testnet: ' + config.sodex.endpoint + ')\n');

  // ── PERPS: Public endpoints ──────────────────────────────────────────────

  // 1. Symbols
  try {
    const symbols = await client.getPerpsSymbols();
    const hasBtc = symbols.some((s) => s.symbol?.includes('BTC'));
    check('GET /perps/markets/symbols', symbols.length > 0, `${symbols.length} symbols`);
    check('  → BTC-USD exists', hasBtc, symbols.map((s) => s.symbol).join(', ').slice(0, 80));
  } catch (err) {
    check('GET /perps/markets/symbols', false, String(err));
  }

  // 2. Tickers
  try {
    const tickers = await client.getPerpsTickers();
    const btc = tickers.find((t) => t.symbol?.includes('BTC'));
    check('GET /perps/markets/tickers', tickers.length > 0, `${tickers.length} tickers`);
    if (btc) {
      check('  → BTC-USD lastPrice', !!btc.lastPrice, `$${parseFloat(btc.lastPrice).toLocaleString()}`);
    }
  } catch (err) {
    check('GET /perps/markets/tickers', false, String(err));
  }

  // 3. Orderbook
  try {
    const ob = await client.getPerpsOrderbook('BTC-USD');
    const hasBids = ob?.bids?.length > 0;
    const hasAsks = ob?.asks?.length > 0;
    check('GET /perps/markets/BTC-USD/orderbook', hasBids && hasAsks,
      `${ob?.bids?.length} bids, ${ob?.asks?.length} asks`);

    if (hasBids && hasAsks) {
      const bidDepth = client.calcOrderbookDepthUsd(ob.bids, 5);
      const askDepth = client.calcOrderbookDepthUsd(ob.asks, 5);
      check('  → Orderbook depth >= $1000', bidDepth >= 1000 && askDepth >= 1000,
        `bid depth: $${bidDepth.toFixed(0)}, ask depth: $${askDepth.toFixed(0)}`);
    }
  } catch (err) {
    check('GET /perps/markets/BTC-USD/orderbook', false, String(err));
  }

  // 4. Klines
  try {
    const klines = await client.getPerpsKlines('BTC-USD', { interval: '1h', limit: 14 });
    check('GET /perps/markets/BTC-USD/klines', klines.length > 0, `${klines.length} candles`);
    if (klines.length > 0) {
      const atr = client.calcATR(klines);
      check('  → ATR(14) calculated', atr > 0, `ATR = $${atr.toFixed(0)}`);
    }
  } catch (err) {
    check('GET /perps/markets/BTC-USD/klines', false, String(err));
  }

  // ── PERPS: Authenticated endpoints ──────────────────────────────────────
  if (address) {
    console.log(`\n  Testing authenticated endpoints for: ${address}`);

    try {
      const balances = await client.getPerpsBalances(address);
      const avail = balances?.availableBalance ?? 'N/A';
      check('GET /perps/accounts/{addr}/balances', !!balances, `available: ${avail}`);
    } catch (err) {
      check('GET /perps/accounts/{addr}/balances', false, String(err));
    }

    try {
      const positions = await client.getPerpsPositions(address);
      check('GET /perps/accounts/{addr}/positions', Array.isArray(positions),
        `${positions.length} open positions`);
    } catch (err) {
      check('GET /perps/accounts/{addr}/positions', false, String(err));
    }

    try {
      const orders = await client.getPerpsOrders(address);
      check('GET /perps/accounts/{addr}/orders', Array.isArray(orders),
        `${orders.length} open orders`);
    } catch (err) {
      check('GET /perps/accounts/{addr}/orders', false, String(err));
    }
  } else {
    console.log('\n  ⚠️  SODEX_MASTER_ADDRESS not set — skipping authenticated perps endpoints');
  }

  // ── SPOT: Public endpoints ────────────────────────────────────────────────
  console.log('\n  SPOT endpoints:');

  try {
    const symbols = await client.getSpotSymbols();
    check('GET /spot/markets/symbols', symbols.length >= 0, `${symbols.length} symbols`);

    const ssiTokens = ['MAG7', 'DEFI', 'MEME', 'USSI', 'ssi', 'SSI'];
    const found = symbols.filter((s) =>
      ssiTokens.some((t) => s.symbol?.toUpperCase().includes(t.toUpperCase()))
    );
    console.log(`  SSI tokens on testnet: ${found.length > 0
      ? found.map((s) => s.symbol).join(', ')
      : '(none found — will demo with available pair)'
    }`);
  } catch (err) {
    check('GET /spot/markets/symbols', false, String(err));
  }

  try {
    const tickers = await client.getSpotTickers();
    check('GET /spot/markets/tickers', Array.isArray(tickers), `${tickers.length} pairs`);
    if (tickers.length > 0) {
      console.log(`  Available spot pairs: ${tickers.slice(0, 5).map((t) => t.symbol).join(', ')}`);
    }
  } catch (err) {
    check('GET /spot/markets/tickers', false, String(err));
  }

  if (address) {
    try {
      const balances = await client.getSpotBalances(address);
      check('GET /spot/accounts/{addr}/balances', Array.isArray(balances),
        `${balances.length} assets`);
      if (balances.length > 0) {
        console.log('  Spot balances: ' + balances.map((b) => `${b.asset}: ${b.free}`).join(', '));
      }
    } catch (err) {
      check('GET /spot/accounts/{addr}/balances', false, String(err));
    }
  }

  console.log('\n─────────────────────────────────────────');
  const exitCode = process.exitCode ?? 0;
  if (exitCode === 0) {
    console.log('✅  All SoDEX read checks passed!\n');
  } else {
    console.log('❌  Some checks FAILED. Fix before proceeding.\n');
  }
}

run().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});
