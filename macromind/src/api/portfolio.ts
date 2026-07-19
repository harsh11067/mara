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

  // ── Connected-wallet balance (Wave 7): any address's REAL native SOSO ──────
  // Lets the desk show the signed-in user's own MetaMask balance, not just
  // the operator's. Same eth_getBalance read, per-address 15s cache.
  app.get('/api/evm/balance', async (c) => {
    const address = (c.req.query('address') ?? '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.json({ error: 'address must be 0x…40 hex chars' }, 400);
    const data = await globalCache.wrap(`evm:bal:${address.toLowerCase()}`, 15_000, async () => ({
      address,
      chainId: config.sodex.chainId,
      rpc: config.attestation.rpcUrl || null,
      sosoNative: await nativeSosoBalance(address),
      fetchedAt: Date.now(),
    }));
    return c.json(data);
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

  // ── Rolling ticker tape (Wave 7): the ENTIRE live board in one call ────────
  // Every SoDEX perps symbol + every spot pair + the SoSoValue SSI indices,
  // merged for the marquee bar. Prices are venue marks, cached 15s.
  app.get('/api/ticker', async (c) => {
    try {
      const data = await globalCache.wrap('ticker:tape', 15_000, async () => {
        const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
        const [perps, spot] = await Promise.all([
          client.getPerpsTickers().catch(() => []),
          client.getSpotTickers().catch(() => []),
        ]);
        // Indices piggyback on the 10-min cache — no extra SoSoValue budget
        const idx = await globalCache.wrap('indices:list', 10 * 60_000, async () => {
          const soso = new SoSoValueClient(config.sosovalue.apiKey);
          return { indices: await soso.getIndices(), fetchedAt: Date.now() };
        }).catch(() => ({ indices: [] as Array<{ ticker: string; price?: number; changePercent24h?: number }> }));

        const num = (v: string | undefined) => {
          const n = parseFloat(v ?? '');
          return Number.isFinite(n) ? n : null;
        };
        const items = [
          ...perps.map((t) => ({ symbol: t.symbol, price: num(t.lastPrice), changePct: num(t.priceChange24h), src: 'perps' as const })),
          ...spot.map((t) => ({ symbol: t.symbol, price: num(t.lastPrice), changePct: num(t.priceChange24h), src: 'spot' as const })),
          ...(idx.indices ?? []).map((i) => ({ symbol: i.ticker, price: i.price ?? null, changePct: i.changePercent24h ?? null, src: 'ssi' as const })),
        ].filter((t) => t.symbol && t.price !== null);
        return { items, count: items.length, fetchedAt: Date.now() };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ items: [], error: String(err).slice(0, 120), fetchedAt: Date.now() }, 503);
    }
  });

  // ── Market microstructure (Wave 7, SoDEX public data) ──────────────────────
  // The venue's REAL order book — bids/asks, mid, spread — for the depth ladder.
  app.get('/api/depth', async (c) => {
    const symbol = c.req.query('symbol') ?? 'BTC-USD';
    if (!/^[A-Z0-9]{2,10}-USD$/.test(symbol)) return c.json({ error: 'symbol like BTC-USD' }, 400);
    try {
      const data = await globalCache.wrap(`depth:${symbol}`, 5_000, async () => {
        const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
        const book = await client.getPerpsOrderbook(symbol);
        const toLevel = (l: { price: string; quantity: string }) => [parseFloat(l.price), parseFloat(l.quantity)] as [number, number];
        const bids = book.bids.slice(0, 12).map(toLevel);
        const asks = book.asks.slice(0, 12).map(toLevel);
        const bestBid = bids[0]?.[0] ?? null;
        const bestAsk = asks[0]?.[0] ?? null;
        return {
          symbol, bids, asks,
          mid: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
          spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
          fetchedAt: Date.now(),
        };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 120) }, 503);
    }
  });

  // The venue's REAL prints — every fill on the tape, side/price/size/time.
  app.get('/api/tape', async (c) => {
    const symbol = c.req.query('symbol') ?? 'BTC-USD';
    if (!/^[A-Z0-9]{2,10}-USD$/.test(symbol)) return c.json({ error: 'symbol like BTC-USD' }, 400);
    try {
      const data = await globalCache.wrap(`tape:${symbol}`, 5_000, async () => {
        const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
        const trades = await client.getPerpsTrades(symbol, 30);
        return { symbol, trades, fetchedAt: Date.now() };
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

  // ── Sector Spotlight (Wave 7, SoSoValue) — which crypto sector is moving ───
  app.get('/api/sectors', async (c) => {
    try {
      const data = await globalCache.wrap('sectors:spotlight', 10 * 60_000, async () => {
        const client = new SoSoValueClient(config.sosovalue.apiKey);
        // Payload shape is data.sector[] — unwrap manually (extractList can't see it)
        const res = await client.raw('/currencies/sector-spotlight') as { data?: { sector?: Array<{ name: string; change_pct_24h: number; marketcap_dom: number }> }; sector?: Array<{ name: string; change_pct_24h: number; marketcap_dom: number }> };
        const sectors = (res?.data?.sector ?? res?.sector ?? [])
          .map((s) => ({ name: s.name, changePct24h: s.change_pct_24h * 100, marketcapDom: s.marketcap_dom * 100 }))
          .sort((a, b) => b.marketcapDom - a.marketcapDom);
        return { sectors, fetchedAt: Date.now() };
      });
      return c.json(data);
    } catch (err) {
      return c.json({ error: String(err).slice(0, 120) }, 503);
    }
  });

  // ── SSI X-Ray (Wave 7, SoSoValue) — what's actually inside an SSI index ────
  app.get('/api/indices/:ticker/constituents', async (c) => {
    const ticker = c.req.param('ticker').toLowerCase();
    if (!/^[a-z0-9.]{2,24}$/.test(ticker)) return c.json({ error: 'bad ticker' }, 400);
    try {
      const data = await globalCache.wrap(`ssi:xray:${ticker}`, 30 * 60_000, async () => {
        const client = new SoSoValueClient(config.sosovalue.apiKey);
        const constituents = await client.getIndexConstituents(ticker);
        return {
          ticker,
          constituents: constituents
            .map((x) => ({ symbol: x.symbol, weight: Math.round(x.weight * 10000) / 100 }))
            .sort((a, b) => b.weight - a.weight),
          fetchedAt: Date.now(),
        };
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
