/**
 * Portfolio data plane (Wave 5) — real account + market-structure surfaces
 * for the /portfolio desk. Nothing synthesized: every row is a live read.
 *
 *   GET /api/account  — signed SoDEX reads: perps balance, open positions,
 *                       open/recent orders, spot balances (operator account)
 *   GET /api/etf      — SoSoValue US spot-ETF flow history (BTC + ETH), the
 *                       institutional-flow context MARA's regime sits inside
 */
import type { Hono } from 'hono';
import { config } from '../config.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { SoSoValueClient } from '../services/sosovalue-client.js';
import { globalCache } from '../utils/ttl-cache.js';

/** Native SOSO balance of an address on the ValueChain EVM syschain. */
async function nativeSosoBalance(address: string): Promise<number | null> {
  const rpc = config.attestation.rpcUrl;
  if (!rpc || !address) return null;
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json() as { result?: string };
    if (!json.result) return null;
    return Number(BigInt(json.result) / 10n ** 12n) / 1e6; // wei → SOSO with 6dp
  } catch { return null; }
}

export function portfolioRoutes(app: Hono): void {
  // ── Live operator account state (signed reads — proves the API key works) ──
  app.get('/api/account', async (c) => {
    try {
      const data = await globalCache.wrap('account:state', 15_000, async () => {
        const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
        const addr = config.sodex.masterAddress;
        const [balance, positions, orders, spot, sosoNative] = await Promise.all([
          client.getPerpsBalances(addr).catch(() => null),
          client.getPerpsPositions(addr).catch(() => []),
          client.getPerpsOrders(addr).catch(() => []),
          client.getSpotBalances(addr).catch(() => []),
          nativeSosoBalance(addr),
        ]);
        return {
          operator: addr,
          venue: `SoDEX ${config.sodex.chainId === 138565 ? 'testnet' : 'mainnet'} (chainId ${config.sodex.chainId})`,
          perps: {
            availableBalance: balance ? parseFloat(balance.availableBalance) : null,
            positions,
            orders,
          },
          spot,
          // The wallet's REAL gas balance on the ValueChain EVM syschain —
          // what MetaMask shows, read via eth_getBalance, never synthesized.
          evm: {
            chainId: config.sodex.chainId,
            rpc: config.attestation.rpcUrl || null,
            sosoNative,
          },
          fetchedAt: Date.now(),
        };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 160) }, 503);
    }
  });

  // ── Real klines for price trails + the Charts tab (SoDEX public data) ──────
  app.get('/api/klines', async (c) => {
    const symbol = c.req.query('symbol') ?? 'BTC-USD';
    const interval = c.req.query('interval') ?? '1h';
    const limit = Math.min(parseInt(c.req.query('limit') ?? '48', 10) || 48, 200);
    if (!/^[A-Z]{2,6}-USD$/.test(symbol)) return c.json({ error: 'symbol like BTC-USD' }, 400);
    if (!['1m', '5m', '15m', '30m', '1h', '4h', '1d'].includes(interval)) {
      return c.json({ error: 'interval must be one of 1m 5m 15m 30m 1h 4h 1d' }, 400);
    }
    try {
      const data = await globalCache.wrap(`klines:${symbol}:${interval}:${limit}`, 60_000, async () => {
        const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
        const klines = await client.getPerpsKlines(symbol, { interval, limit });
        return {
          symbol, interval,
          candles: klines.map((k) => ({ t: k.openTime, o: k.open, h: k.high, l: k.low, c: k.close, v: k.volume })),
          fetchedAt: Date.now(),
        };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 120) }, 503);
    }
  });

  // ── SoSoValue SSI indices (unused API module → product surface) ────────────
  app.get('/api/indices', async (c) => {
    try {
      const data = await globalCache.wrap('indices:list', 10 * 60_000, async () => {
        const client = new SoSoValueClient(config.sosovalue.apiKey);
        const indices = await client.getIndices();
        return { indices, fetchedAt: Date.now() };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 120) }, 503);
    }
  });

  // ── BTC corporate treasuries (SoSoValue) ───────────────────────────────────
  app.get('/api/treasuries', async (c) => {
    try {
      const data = await globalCache.wrap('treasuries:btc', 60 * 60_000, async () => {
        const client = new SoSoValueClient(config.sosovalue.apiKey);
        const list = await client.getBtcTreasuries();
        return { treasuries: list.slice(0, 12), fetchedAt: Date.now() };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 120) }, 503);
    }
  });

  // ── US spot-ETF flows (SoSoValue's flagship dataset) ───────────────────────
  app.get('/api/etf', async (c) => {
    const symbol = (c.req.query('symbol') ?? 'BTC').toUpperCase();
    if (symbol !== 'BTC' && symbol !== 'ETH') {
      return c.json({ error: 'symbol must be BTC or ETH' }, 400);
    }
    try {
      const data = await globalCache.wrap(`etf:flows:${symbol}`, 10 * 60_000, async () => {
        const client = new SoSoValueClient(config.sosovalue.apiKey);
        const history = await client.getEtfSummaryHistory(symbol, 14);
        return {
          symbol,
          history,
          note: 'US spot ETF daily net flows via SoSoValue — end-of-day data; the institutional-flow backdrop, not an intraday signal.',
          fetchedAt: Date.now(),
        };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 160) }, 503);
    }
  });
}
