export type MacroEventState = 'upcoming' | 'watching' | 'fired';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type TradeSide = 'LONG' | 'SHORT' | 'ROTATION';
export type TradeStatus = 'OPEN' | 'CLOSED' | 'PENDING';
export type DirectionType = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';

export interface MacroEvent {
  id: string;
  name: string;
  dateStr: string;
  timestamp: number;
  state: MacroEventState;
  consensus: string;
  actual?: string;
  previous: string;
  impact: ImpactLevel;
  unit: string;
}

export interface AiReasoning {
  id: string;
  eventName: string;
  timestamp: number;
  surpriseScore: number; // e.g., +1.33 (in standard deviations)
  direction: DirectionType;
  confidence: number; // 0-100
  actual: string;
  forecast: string;
  reasoning: string;
  sourceNews: string[];
  /** which engine produced this (agentic_tool_use | single_call) */
  engine?: string;
  /** bull/bear/synthesiser debate, when available */
  debate?: {
    bull_case: string;
    bear_case: string;
    synthesis: string;
    dissent: string;
    citations: string[];
  } | null;
}

export interface AgentTraceStep {
  runId: string;
  step: number;
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'final' | 'error';
  tool?: string;
  args?: Record<string, unknown>;
  summary: string;
  ts: number;
}

export interface Trade {
  id: string;
  timeStr: string;
  timestamp: number;
  event: string;
  instrument: string;
  side: TradeSide;
  sizeUsd: number;
  quantity: number;
  priceEntry: number;
  priceExit?: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  pnlPercent: number;
  status: TradeStatus;
}

export interface SsiHolding {
  id: string;
  name: string;
  ticker: string;
  allocationPercent: number;
  currentPrice: number;
  balance: number;
  valueUsd: number;
  dailyChange: number;
}

export interface RotationLog {
  id: string;
  timeStr: string;
  fromTicker: string;
  toTicker: string;
  percentage: number;
  reason: string;
}

// NOTE (mocks.md A1): the INITIAL_* fabricated datasets that used to live here
// are gone. The dashboard renders backend truth only — empty states are honest.
