// ── SoSoValue API Types ────────────────────────────────────────────────────────

export interface MacroEvent {
  id: string;
  name: string;
  date: string;           // "2026-05-23"
  time?: string;          // "08:30"
  country?: string;
  currency?: string;
  impact?: 'high' | 'medium' | 'low';
  forecast?: number | null;
  previous?: number | null;
  actual?: number | null;
  unit?: string;
  description?: string;
}

export interface EventDataPoint {
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  revised?: number | null;
}

export interface NewsItem {
  id: string;
  title: string;
  content?: string;
  summary?: string;
  category?: number;
  releaseTime: number;        // Unix ms
  publishTime?: number;
  matchedCurrencies?: string[];
  tags?: string[];
  source?: string;
  url?: string;
}

export interface MarketSnapshot {
  id: string;
  symbol: string;
  price: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volume24h: number;
  marketCap?: number;
  circulatingSupply?: number;
  high24h?: number;
  low24h?: number;
  updatedAt?: number;
}

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime?: number;
}

export interface EtfHistory {
  date: string;
  totalNetAssets?: number;
  totalNetFlow?: number;
  dailyNetFlow?: number;
  btcHoldings?: number;
  fundCount?: number;
}

export interface Index {
  id: string;
  ticker: string;
  name: string;
  description?: string;
  price?: number;
  change24h?: number;
  changePercent24h?: number;
}

export interface IndexConstituent {
  symbol: string;
  name?: string;
  weight: number;
  price?: number;
}

export interface IndexSnapshot {
  ticker: string;
  price: number;
  change24h?: number;
  changePercent24h?: number;
  volume24h?: number;
  updatedAt?: number;
}

export interface KlineParams {
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  limit?: number;
  startTime?: number;
  endTime?: number;
}

export interface NewsParams {
  page?: number;
  pageSize?: number;
  category?: number;
  startTime?: number;
  endTime?: number;
}

// ── SoDEX API Types ────────────────────────────────────────────────────────────

export interface PerpsSymbol {
  symbolId: number;  // numeric ID required for order placement
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  status?: string;
  tickSize?: string;
  stepSize?: string;
  minOrderSize?: string;
  maxLeverage?: number;
}

export interface PerpsTicker {
  symbol: string;
  lastPrice: string;
  markPrice: string;
  indexPrice?: string;
  openInterest?: string;
  fundingRate?: string;
  volume24h?: string;
  priceChange24h?: string;
  high24h?: string;
  low24h?: string;
}

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

export interface Orderbook {
  symbol: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp?: number;
}

export interface PerpsBalance {
  accountId?: number;
  asset?: string;
  availableBalance: string;
  walletBalance?: string;
  unrealizedPnl?: string;
  marginBalance?: string;
}

export interface PerpsPosition {
  symbol: string;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  quantity: string;
  entryPrice: string;
  markPrice?: string;
  liquidationPrice?: string;
  unrealizedPnl?: string;
  leverage?: number;
  marginType?: string;
}

export interface PerpsOrder {
  orderId: string;
  clOrdId?: string;
  symbol: string;
  side: number;       // 1=buy, 2=sell
  type: number;       // 1=limit, 2=market
  status?: string;
  price?: string;
  quantity: string;
  filledQuantity?: string;
  stopPrice?: string;
  reduceOnly?: boolean;
  positionSide?: number;
  createdAt?: number;
}

export interface SpotSymbol {
  symbol: string;
  baseCurrency: string;
  quoteCurrency: string;
  status?: string;
  tickSize?: string;
  stepSize?: string;
  minOrderSize?: string;
}

export interface SpotTicker {
  symbol: string;
  lastPrice: string;
  volume24h?: string;
  priceChange24h?: string;
  high24h?: string;
  low24h?: string;
}

export interface SpotBalance {
  asset: string;
  free: string;
  locked?: string;
}

// ── Internal Types ─────────────────────────────────────────────────────────────

export interface SSIHolding {
  token: string;      // 'MAG7.ssi', 'DEFI.ssi', 'MEME.ssi', 'USSI'
  balance: number;
  valueUsd: number;
  symbol?: string;    // trading pair symbol e.g. 'MAG7-USDC'
}

export interface SSIRotationPlan {
  convictionDirection: 'BEARISH' | 'BULLISH' | 'NEUTRAL';
  sells: { token: string; symbol: string; quantity: string }[];
  buys: { token: string; symbol: string; quantity: string }[];
  totalValueRotated: number;
  reason: string;
}
