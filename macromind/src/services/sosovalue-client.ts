import { createLogger } from '../utils/logger.js';
import type {
  MacroEvent, EventDataPoint, NewsItem, NewsParams,
  MarketSnapshot, Kline, KlineParams,
  EtfHistory, Index, IndexConstituent, IndexSnapshot,
} from './types.js';

const logger = createLogger('SoSoValueClient');

// BTC's numeric currency_id in SoSoValue (discovered via /currencies endpoint)
export const BTC_CURRENCY_ID = '1673723677362319866';

// Klines: SoSoValue only allows '1d' on free-tier keys
export const KLINE_INTERVAL = '1d';

const RETRY_DELAYS = [1500, 3000, 6000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers });

      if (res.status === 429) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        logger.warn(`Rate limited, waiting ${delay}ms...`, { url: url.split('?')[0] });
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json() as Record<string, unknown>;
      // SoSoValue error codes embedded in 200 responses
      if (json.code && json.code !== 0 && json.code !== 200) {
        throw new Error(`API error ${json.code}: ${json.message ?? json.msg ?? 'unknown'}`);
      }
      return json;

    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) {
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        logger.warn(`Request failed (attempt ${attempt + 1}/4), retrying in ${delay}ms`,
          { url: url.split('?')[0], error: lastError.message });
        await sleep(delay);
      }
    }
  }
  throw lastError ?? new Error('Request failed after retries');
}

// ── Raw SoSoValue API shapes ────────────────────────────────────────────────────

interface RawEventsDay {
  date: string;
  events: string[];  // Array of event name strings, e.g. ["CPI (YoY)", "GDP (QoQ)"]
}

interface RawEventHistory {
  date: string;
  actual: string | null;     // "3.8%" or "275K" — may have % or K suffix
  forecast: string | null;
  previous: string | null;
  revised?: string | null;
}

interface RawNewsItem {
  id: string;
  title: string | null;
  content?: string;
  category?: number;
  release_time?: string;   // string timestamp ms
  publish_time?: string;
  matched_currencies?: Array<{ currency_id: string; symbol: string; name: string }>;
  tags?: string[];
  source_link?: string;
  original_link?: string;
  author?: string;
}

interface RawSnapshot {
  price: number;
  change_pct_24h: number;
  turnover_24h: number;
  high_24h: number;
  low_24h: number;
  marketcap?: number;
  circulating_supply?: string;
}

interface RawKline {
  timestamp: string;   // ms string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
}

// ── Parsers ─────────────────────────────────────────────────────────────────────

/** Parse "3.8%" → 3.8, "275K" → 275, "2.5" → 2.5 */
function parseNumericString(s: string | null | undefined): number | null {
  if (s == null) return null;
  const clean = s.replace('%', '').replace('K', '').replace(',', '').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function normalizeNewsItem(r: RawNewsItem): NewsItem {
  return {
    id: r.id,
    title: r.title ?? r.content?.replace(/<[^>]+>/g, '').slice(0, 120) ?? '(no title)',
    content: r.content,
    category: r.category,
    releaseTime: parseInt(r.release_time ?? r.publish_time ?? '0', 10),
    publishTime: parseInt(r.publish_time ?? r.release_time ?? '0', 10),
    matchedCurrencies: r.matched_currencies?.map((c) => c.symbol) ?? [],
    tags: r.tags ?? [],
    source: r.source_link ?? r.original_link,
  };
}

// ── Client ──────────────────────────────────────────────────────────────────────

export class SoSoValueClient {
  private readonly headers: Record<string, string>;
  private readonly base: string;

  constructor(apiKey: string, baseUrl = 'https://openapi.sosovalue.com/openapi/v1') {
    this.base = baseUrl;
    this.headers = {
      'x-soso-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  // ── Macro Events ─────────────────────────────────────────────────────────────

  /**
   * GET /macro/events
   * Returns events grouped by date. We flatten them to MacroEvent[].
   * Actual shape: [{date: "2026-05-27", events: ["CPI (YoY)", "GDP (QoQ)"]}]
   */
  async getUpcomingEvents(): Promise<MacroEvent[]> {
    const res = await fetchWithRetry(`${this.base}/macro/events`, this.headers) as Record<string, unknown>;
    const days = (res.data ?? res.list ?? res) as RawEventsDay[];
    if (!Array.isArray(days)) return [];

    const result: MacroEvent[] = [];
    for (const day of days) {
      if (!day.events) continue;
      for (const eventName of day.events) {
        result.push({
          id: `${day.date}_${eventName}`,
          name: eventName,
          date: day.date,
        });
      }
    }
    return result;
  }

  /**
   * GET /macro/events/{event}/history
   * Event name must match exactly as returned by getUpcomingEvents().
   * E.g. "CPI (YoY)", "Core PCE Price Index (MoM)"
   */
  async getEventHistory(event: string, limit = 24): Promise<EventDataPoint[]> {
    const encoded = encodeURIComponent(event);
    const res = await fetchWithRetry(
      `${this.base}/macro/events/${encoded}/history?limit=${limit}`,
      this.headers,
    ) as Record<string, unknown>;

    const raw = (res.data ?? res.list ?? []) as RawEventHistory[];
    if (!Array.isArray(raw)) return [];

    return raw.map((r) => ({
      date: r.date,
      actual: parseNumericString(r.actual),
      forecast: parseNumericString(r.forecast),
      previous: parseNumericString(r.previous),
      revised: parseNumericString(r.revised),
    }));
  }

  // ── News ────────────────────────────────────────────────────────────────────

  async getLatestNews(params: NewsParams = {}): Promise<NewsItem[]> {
    const qs = new URLSearchParams();
    if (params.pageSize) qs.set('page_size', String(params.pageSize));
    if (params.page) qs.set('page', String(params.page));
    if (params.category !== undefined) qs.set('category', String(params.category));

    const url = `${this.base}/news${qs.toString() ? '?' + qs.toString() : ''}`;
    const res = await fetchWithRetry(url, this.headers) as Record<string, unknown>;
    const raw = this.extractList<RawNewsItem>(res, 'news');
    return raw.map(normalizeNewsItem);
  }

  async getHotNews(): Promise<NewsItem[]> {
    const res = await fetchWithRetry(`${this.base}/news/hot`, this.headers) as Record<string, unknown>;
    const raw = this.extractList<RawNewsItem>(res, 'hot news');
    return raw.map(normalizeNewsItem);
  }

  async searchNews(keyword: string, limit = 10): Promise<NewsItem[]> {
    const url = `${this.base}/news/search?keyword=${encodeURIComponent(keyword)}&page_size=${limit}`;
    const res = await fetchWithRetry(url, this.headers) as Record<string, unknown>;
    const raw = this.extractList<RawNewsItem>(res, 'news search');
    return raw.map(normalizeNewsItem);
  }

  // ── Market Data ──────────────────────────────────────────────────────────────

  /**
   * GET /currencies/{id}/market-snapshot
   * currency_id must be numeric string (e.g. BTC_CURRENCY_ID).
   */
  async getCurrencySnapshot(currencyId: string): Promise<MarketSnapshot> {
    const res = await fetchWithRetry(
      `${this.base}/currencies/${encodeURIComponent(currencyId)}/market-snapshot`,
      this.headers,
    ) as Record<string, unknown>;
    const raw = (res.data ?? res) as RawSnapshot;
    return {
      id: currencyId,
      symbol: currencyId === BTC_CURRENCY_ID ? 'BTC' : currencyId,
      price: raw.price ?? 0,
      priceChange24h: 0,
      priceChangePercent24h: raw.change_pct_24h ?? 0,
      volume24h: raw.turnover_24h ?? 0,
      marketCap: raw.marketcap,
      high24h: raw.high_24h,
      low24h: raw.low_24h,
    };
  }

  /**
   * GET /currencies/{id}/klines
   * NOTE: Only '1d' interval available on free-tier API keys.
   */
  async getCurrencyKlines(currencyId: string, params: KlineParams): Promise<Kline[]> {
    // Force 1d if requested interval is restricted
    const interval = '1d';
    const qs = new URLSearchParams({ interval });
    if (params.limit) qs.set('limit', String(params.limit));

    const url = `${this.base}/currencies/${encodeURIComponent(currencyId)}/klines?${qs.toString()}`;
    const res = await fetchWithRetry(url, this.headers) as Record<string, unknown>;
    const raw = this.extractList<RawKline>(res, 'klines');
    return raw.map((k) => ({
      openTime: parseInt(k.timestamp, 10),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: parseFloat(k.volume),
    }));
  }

  // ── ETF ──────────────────────────────────────────────────────────────────────

  /**
   * GET /etfs/summary-history?country_code=US&symbol=BTC
   * symbol must be crypto ticker: BTC, ETH, SOL, etc. (not ETF ticker like IBIT)
   */
  async getEtfSummaryHistory(symbol = 'BTC', limit = 7): Promise<EtfHistory[]> {
    const res = await fetchWithRetry(
      `${this.base}/etfs/summary-history?country_code=US&symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      this.headers,
    ) as Record<string, unknown>;
    const raw = this.extractList<Record<string, unknown>>(res, 'ETF history');
    return raw.map((e) => ({
      date: (e.date ?? e.trade_date ?? '') as string,
      totalNetAssets: e.total_net_assets as number | undefined,
      // API field is total_net_inflow (positive = inflow, negative = outflow)
      totalNetFlow: (e.total_net_inflow ?? e.total_net_flow ?? e.net_flow) as number | undefined,
      dailyNetFlow: (e.total_net_inflow ?? e.daily_net_flow) as number | undefined,
      btcHoldings: e.btc_holdings as number | undefined,
      fundCount: e.fund_count as number | undefined,
    }));
  }

  // ── SSI Indices ───────────────────────────────────────────────────────────────

  /**
   * GET /indices — returns array of ticker strings: ["ssiMAG7", "ssiDeFi", ...]
   */
  async getIndices(): Promise<Index[]> {
    const res = await fetchWithRetry(`${this.base}/indices`, this.headers) as Record<string, unknown>;
    const raw = res.data ?? res;
    if (Array.isArray(raw)) {
      // Handle both string array and object array
      return (raw as unknown[]).map((item) => {
        if (typeof item === 'string') return { id: item, ticker: item, name: item };
        const obj = item as Record<string, unknown>;
        return {
          id: (obj.id ?? obj.ticker ?? '') as string,
          ticker: (obj.ticker ?? obj.id ?? '') as string,
          name: (obj.name ?? obj.ticker ?? '') as string,
        };
      });
    }
    return [];
  }

  async getIndexConstituents(ticker: string): Promise<IndexConstituent[]> {
    const res = await fetchWithRetry(
      `${this.base}/indices/${encodeURIComponent(ticker)}/constituents`,
      this.headers,
    ) as Record<string, unknown>;
    const raw = this.extractList<Record<string, unknown>>(res, 'index constituents');
    return raw.map((c) => ({
      symbol: (c.symbol ?? c.currency_id ?? '') as string,
      weight: (c.weight ?? 0) as number,
      name: c.name as string | undefined,
    }));
  }

  async getIndexSnapshot(ticker: string): Promise<IndexSnapshot> {
    const res = await fetchWithRetry(
      `${this.base}/indices/${encodeURIComponent(ticker)}/market-snapshot`,
      this.headers,
    ) as Record<string, unknown>;
    const raw = (res.data ?? res) as IndexSnapshot;
    return raw;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private extractList<T>(data: unknown, label: string): T[] {
    if (Array.isArray(data)) return data as T[];
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj['data'])) return obj['data'] as T[];
      if (Array.isArray(obj['list'])) return obj['list'] as T[];
      if (Array.isArray(obj['items'])) return obj['items'] as T[];
      if (Array.isArray(obj['result'])) return obj['result'] as T[];
      if (obj['data'] && typeof obj['data'] === 'object') {
        const inner = obj['data'] as Record<string, unknown>;
        if (Array.isArray(inner['list'])) return inner['list'] as T[];
        if (Array.isArray(inner['data'])) return inner['data'] as T[];
      }
    }
    logger.debug(`Could not extract list for "${label}", returning []`);
    return [];
  }
}
