import { createLogger } from '../utils/logger.js';
import type {
  PerpsSymbol, PerpsTicker, Orderbook, PerpsBalance, PerpsPosition, PerpsOrder,
  SpotSymbol, SpotTicker, SpotBalance, Kline,
} from './types.js';

const logger = createLogger('SoDEXClient');

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function get<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const opts: RequestInit = { method: 'GET' };
  if (headers) opts.headers = headers;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error('Request failed');
}

// SoDEX actual API response wrapper
interface SodexEnvelope<T> {
  code?: number;
  timestamp?: number;
  data?: T;
}

function unwrapData<T>(res: SodexEnvelope<T> | T): T {
  if (res && typeof res === 'object' && 'data' in (res as object)) {
    return (res as SodexEnvelope<T>).data as T;
  }
  return res as T;
}

// ── Real SoDEX field shapes (from API inspection) ─────────────────────────────

interface RawSymbol {
  id: number;
  name: string;
  displayName: string;
  baseCoin: string;
  quoteCoin: string;
  tickSize: string;
  stepSize: string;
  minQuantity: string;
  maxQuantity: string;
  maxLeverage: number;
  status: string;
}

interface RawTicker {
  symbol: string;
  lastPx: string;
  markPrice: string;
  indexPrice: string;
  openInterest: string;
  fundingRate: string;
  volume: string;         // base volume
  quoteVolume: string;    // quote volume (USD)
  change: string;         // absolute price change
  changePct: number;      // percent change
  highPx: string;
  lowPx: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
}

// Orderbook: bids/asks are arrays of [price, qty] strings
interface RawOrderbook {
  bids: [string, string][];
  asks: [string, string][];
  blockTime?: number;
}

// Klines: {t, o, h, l, c, v, q}
interface RawKline {
  t: number;   // timestamp
  o: string;   // open
  h: string;   // high
  l: string;   // low
  c: string;   // close
  v: string;   // base volume
  q: string;   // quote volume
}

interface RawBalance {
  blockTime?: number;
  balances: Array<{ id: number; coin: string; total: string; locked?: string; collateral?: string }>;
}

interface RawPosition {
  symbol?: string;
  side?: number;      // 1=LONG, 2=SHORT
  quantity?: string;
  entryPrice?: string;
  markPrice?: string;
  unrealizedPnl?: string;
  leverage?: number;
  liquidationPrice?: string;
}

// ── Normalizers ────────────────────────────────────────────────────────────────

function normalizeSymbol(s: RawSymbol): PerpsSymbol {
  return {
    symbolId: s.id,
    symbol: s.name,
    baseCurrency: s.baseCoin,
    quoteCurrency: s.quoteCoin,
    status: s.status,
    tickSize: s.tickSize,
    stepSize: s.stepSize,
    minOrderSize: s.minQuantity,
    maxLeverage: s.maxLeverage,
  };
}

function normalizeTicker(t: RawTicker): PerpsTicker {
  return {
    symbol: t.symbol,
    lastPrice: t.lastPx,
    markPrice: t.markPrice,
    indexPrice: t.indexPrice,
    openInterest: t.openInterest,
    fundingRate: t.fundingRate,
    volume24h: t.quoteVolume,         // use quote (USD) volume
    priceChange24h: t.change,
    high24h: t.highPx,
    low24h: t.lowPx,
  };
}

function normalizeOrderbook(ob: RawOrderbook): Orderbook {
  return {
    symbol: '',
    bids: ob.bids.map(([price, quantity]) => ({ price, quantity })),
    asks: ob.asks.map(([price, quantity]) => ({ price, quantity })),
    timestamp: ob.blockTime,
  };
}

function normalizeKline(k: RawKline): Kline {
  return {
    openTime: k.t,
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
  };
}

// ── SpotSymbol raw shape ───────────────────────────────────────────────────────

interface RawSpotSymbol {
  id?: number;
  name?: string;
  symbol?: string;
  baseCoin?: string;
  quoteCoin?: string;
  tickSize?: string;
  stepSize?: string;
  minQuantity?: string;
  status?: string;
}

interface RawSpotTicker {
  symbol: string;
  lastPx?: string;
  lastPrice?: string;
  volume?: string;
  quoteVolume?: string;
  change?: string;
  changePct?: number;
  highPx?: string;
  lowPx?: string;
}

// ── Client ─────────────────────────────────────────────────────────────────────

export class SoDEXClient {
  private readonly base: string;
  private readonly authHeaders: Record<string, string>;

  constructor(endpoint: string, apiKeyName?: string) {
    this.base = endpoint;
    this.authHeaders = apiKeyName ? { 'X-API-Key': apiKeyName } : {};
  }

  // ── PERPS — Public ───────────────────────────────────────────────────────────

  async getPerpsSymbols(): Promise<PerpsSymbol[]> {
    const res = await get<SodexEnvelope<RawSymbol[]>>(`${this.base}/perps/markets/symbols`);
    const raw = unwrapData(res);
    return Array.isArray(raw) ? raw.map(normalizeSymbol) : [];
  }

  async getPerpsTickers(): Promise<PerpsTicker[]> {
    const res = await get<SodexEnvelope<RawTicker[]>>(`${this.base}/perps/markets/tickers`);
    const raw = unwrapData(res);
    return Array.isArray(raw) ? raw.map(normalizeTicker) : [];
  }

  async getPerpsTicker(symbol: string): Promise<PerpsTicker | null> {
    const tickers = await this.getPerpsTickers();
    return tickers.find((t) => t.symbol === symbol) ?? null;
  }

  async getPerpsOrderbook(symbol: string): Promise<Orderbook> {
    const res = await get<SodexEnvelope<RawOrderbook>>(
      `${this.base}/perps/markets/${encodeURIComponent(symbol)}/orderbook`,
    );
    const raw = unwrapData(res);
    return normalizeOrderbook(raw as RawOrderbook);
  }

  async getPerpsKlines(symbol: string, params = { interval: '1h', limit: 14 }): Promise<Kline[]> {
    const qs = new URLSearchParams({ interval: params.interval, limit: String(params.limit) });
    const res = await get<SodexEnvelope<RawKline[]>>(
      `${this.base}/perps/markets/${encodeURIComponent(symbol)}/klines?${qs.toString()}`,
    );
    const raw = unwrapData(res);
    return Array.isArray(raw) ? raw.map(normalizeKline) : [];
  }

  // ── PERPS — Authenticated ────────────────────────────────────────────────────

  async getPerpsBalances(address: string): Promise<PerpsBalance> {
    const res = await get<SodexEnvelope<RawBalance>>(
      `${this.base}/perps/accounts/${address}/balances`,
      this.authHeaders,
    );
    const raw = unwrapData(res);
    const balances = (raw as RawBalance)?.balances ?? [];
    const usdc = balances.find((b) => b.coin?.includes('USDC') || b.id === 0);
    return {
      availableBalance: usdc?.total ?? '0',
      walletBalance: usdc?.total ?? '0',
    };
  }

  async getPerpsPositions(address: string): Promise<PerpsPosition[]> {
    const res = await get<SodexEnvelope<{ positions?: RawPosition[] }>>(
      `${this.base}/perps/accounts/${address}/positions`,
      this.authHeaders,
    );
    const raw = unwrapData(res) as { positions?: RawPosition[] } | null;
    const positions = raw?.positions ?? (Array.isArray(raw) ? raw as RawPosition[] : []);
    return (positions as RawPosition[]).map((p) => ({
      symbol: p.symbol ?? '',
      positionSide: p.side === 1 ? 'LONG' : p.side === 2 ? 'SHORT' : 'BOTH',
      quantity: p.quantity ?? '0',
      entryPrice: p.entryPrice ?? '0',
      markPrice: p.markPrice,
      unrealizedPnl: p.unrealizedPnl,
      leverage: p.leverage,
      liquidationPrice: p.liquidationPrice,
    } as PerpsPosition));
  }

  async getPerpsOrders(address: string): Promise<PerpsOrder[]> {
    const res = await get<SodexEnvelope<{ orders?: PerpsOrder[] }>>(
      `${this.base}/perps/accounts/${address}/orders`,
      this.authHeaders,
    );
    const raw = unwrapData(res) as { orders?: PerpsOrder[] } | null;
    return raw?.orders ?? (Array.isArray(raw) ? raw as PerpsOrder[] : []);
  }

  // ── SPOT — Public ────────────────────────────────────────────────────────────

  async getSpotSymbols(): Promise<SpotSymbol[]> {
    const res = await get<SodexEnvelope<RawSpotSymbol[]>>(`${this.base}/spot/markets/symbols`);
    const raw = unwrapData(res);
    return Array.isArray(raw) ? raw.map((s) => ({
      symbol: s.name ?? s.symbol ?? '',
      baseCurrency: s.baseCoin ?? '',
      quoteCurrency: s.quoteCoin ?? '',
      status: s.status,
      tickSize: s.tickSize,
      stepSize: s.stepSize,
      minOrderSize: s.minQuantity,
    })) : [];
  }

  async getSpotTickers(): Promise<SpotTicker[]> {
    const res = await get<SodexEnvelope<RawSpotTicker[]>>(`${this.base}/spot/markets/tickers`);
    const raw = unwrapData(res);
    return Array.isArray(raw) ? raw.map((t) => ({
      symbol: t.symbol,
      lastPrice: t.lastPx ?? t.lastPrice ?? '0',
      volume24h: t.quoteVolume ?? t.volume,
      priceChange24h: t.change,
      high24h: t.highPx,
      low24h: t.lowPx,
    })) : [];
  }

  async getSpotTicker(symbol: string): Promise<SpotTicker | null> {
    const tickers = await this.getSpotTickers();
    return tickers.find((t) => t.symbol === symbol) ?? null;
  }

  async getSpotOrderbook(symbol: string): Promise<Orderbook> {
    const res = await get<SodexEnvelope<RawOrderbook>>(
      `${this.base}/spot/markets/${encodeURIComponent(symbol)}/orderbook`,
    );
    const raw = unwrapData(res);
    return normalizeOrderbook(raw as RawOrderbook);
  }

  async getSpotBalances(address: string): Promise<SpotBalance[]> {
    const res = await get<SodexEnvelope<RawBalance>>(
      `${this.base}/spot/accounts/${address}/balances`,
      this.authHeaders,
    );
    const raw = unwrapData(res);
    const balances = (raw as RawBalance)?.balances ?? [];
    return balances.map((b) => ({
      asset: b.coin,
      free: b.total,
      locked: b.locked ?? '0',
    }));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Calculate total USD depth in top N levels */
  calcOrderbookDepthUsd(levels: { price: string; quantity: string }[], maxLevels = 5): number {
    return levels.slice(0, maxLevels).reduce((sum, level) => {
      const p = parseFloat(level.price);
      const q = parseFloat(level.quantity);
      return sum + (isNaN(p) || isNaN(q) ? 0 : p * q);
    }, 0);
  }

  /** Calculate ATR(14) from normalized klines */
  calcATR(klines: Kline[]): number {
    if (klines.length < 2) return 0;
    const trValues: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const prev = klines[i - 1];
      const curr = klines[i];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close),
      );
      trValues.push(tr);
    }
    const slice = trValues.slice(-14);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  }

  /** Return the BTC-USD symbol as it exists on this endpoint (active, exact match preferred) */
  async getBtcSymbol(): Promise<{ symbol: string; symbolId: number }> {
    const symbols = await this.getPerpsSymbols();
    // Prefer exact 'BTC-USD' that is TRADING; fallback to any active BTC pair
    const exact   = symbols.find((s) => s.symbol === 'BTC-USD' && s.status === 'TRADING');
    const anyBtc  = symbols.find((s) => s.symbol.toUpperCase().includes('BTC') && s.status === 'TRADING');
    const chosen  = exact ?? anyBtc ?? symbols.find((s) => s.symbol === 'BTC-USD');
    return { symbol: chosen?.symbol ?? 'BTC-USD', symbolId: chosen?.symbolId ?? 1 };
  }
}
