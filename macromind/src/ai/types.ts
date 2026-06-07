import type { Conviction, TradeAction, NoTradeReason } from '../store/decision-store.js';

export interface SurpriseResult {
  event: string;
  actual: number;
  forecast: number;
  previous: number | null;
  surpriseScore: number;       // (actual - forecast) / stddev; 0 if stddev unavailable
  surpriseDirection: 'above' | 'below' | 'inline';
  stddev: number;
  historicalCount: number;     // number of data points used
  historicalAvgMove: number;   // average BTC % move on similar surprises
  cryptoBias: 'bullish' | 'bearish' | 'neutral';
  impactMagnitude: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low'; // based on data availability
}

export interface MarketContext {
  btcPrice: number;
  btcChange1h: number;
  btcChange24h: number;
  btcVolume24h: number;
  atr14: number;
  etfFlowDirection: 'inflow' | 'outflow' | 'neutral' | 'unknown';
  etfFlowMagnitude: number;    // USD
  recentHeadlines: string[];
}

export interface AIDecisionRaw {
  conviction: string;
  confidence: number;
  reasoning: string;
  key_factors: string[];
  risk_flags: string[];
}

export interface TradeDecision {
  id: string;
  timestamp: number;

  // Trigger context
  trigger: {
    event: string;
    surpriseScore: number;
    surpriseDirection: string;
    actual: number;
    forecast: number;
  };

  // AI output
  conviction: Conviction;
  confidence: number;
  reasoning: string;
  keyFactors: string[];
  riskFlags: string[];

  // Supporting data at decision time
  newsHeadlines: string[];
  etfFlowDirection: string;
  currentPrice: number;
  recentVolatility: number;   // ATR14

  // Final decision
  action: TradeAction;
  noTradeReason?: NoTradeReason;
}

export { Conviction, TradeAction, NoTradeReason };
