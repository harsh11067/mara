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

export function portfolioRoutes(app: Hono): void {
  // ── Live operator account state (signed reads — proves the API key works) ──
  app.get('/api/account', async (c) => {
    try {
      const data = await globalCache.wrap('account:state', 15_000, async () => {
        const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
        const addr = config.sodex.masterAddress;
        const [balance, positions, orders, spot] = await Promise.all([
          client.getPerpsBalances(addr).catch(() => null),
          client.getPerpsPositions(addr).catch(() => []),
          client.getPerpsOrders(addr).catch(() => []),
          client.getSpotBalances(addr).catch(() => []),
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
          fetchedAt: Date.now(),
        };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 160) }, 503);
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
