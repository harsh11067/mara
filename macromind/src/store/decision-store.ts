import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';

export type Conviction = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
export type TradeAction = 'LONG' | 'SHORT' | 'NO_TRADE';
export type NoTradeReason =
  | 'low_conviction'
  | 'max_positions'
  | 'max_drawdown'
  | 'cooldown'
  | 'max_daily_trades'
  | 'low_liquidity'
  | 'ai_failure'
  | 'manual_kill_switch';

export interface StoredDecision {
  id: string;
  eventId: string | null;
  timestamp: number;
  conviction: Conviction;
  confidence: number;
  reasoning: string;
  action: TradeAction;
  noTradeReason: NoTradeReason | null;
  newsContext: string[] | null;
  marketContext: Record<string, unknown> | null;
  createdAt: number;
}

interface DbDecision {
  id: string;
  event_id: string | null;
  timestamp: number;
  conviction: string;
  confidence: number;
  reasoning: string;
  action: string;
  no_trade_reason: string | null;
  news_context: string | null;
  market_context: string | null;
  created_at: number;
}

function toStored(row: DbDecision): StoredDecision {
  return {
    id: row.id,
    eventId: row.event_id,
    timestamp: row.timestamp,
    conviction: row.conviction as Conviction,
    confidence: row.confidence,
    reasoning: row.reasoning,
    action: row.action as TradeAction,
    noTradeReason: row.no_trade_reason as NoTradeReason | null,
    newsContext: row.news_context ? JSON.parse(row.news_context) as string[] : null,
    marketContext: row.market_context ? JSON.parse(row.market_context) as Record<string, unknown> : null,
    createdAt: row.created_at,
  };
}

export const DecisionStore = {
  insert(d: Omit<StoredDecision, 'id' | 'createdAt'> & { id?: string }): StoredDecision {
    const id = d.id ?? uuidv4();
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO decisions (id, event_id, timestamp, conviction, confidence, reasoning, action, no_trade_reason, news_context, market_context, created_at)
      VALUES (@id, @event_id, @timestamp, @conviction, @confidence, @reasoning, @action, @no_trade_reason, @news_context, @market_context, @created_at)
    `).run({
      id,
      event_id: d.eventId,
      timestamp: d.timestamp,
      conviction: d.conviction,
      confidence: d.confidence,
      reasoning: d.reasoning,
      action: d.action,
      no_trade_reason: d.noTradeReason,
      news_context: d.newsContext ? JSON.stringify(d.newsContext) : null,
      market_context: d.marketContext ? JSON.stringify(d.marketContext) : null,
      created_at: now,
    });
    return this.getById(id)!;
  },

  getById(id: string): StoredDecision | null {
    const row = getDb().prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DbDecision | undefined;
    return row ? toStored(row) : null;
  },

  getByEventId(eventId: string): StoredDecision[] {
    return (getDb().prepare('SELECT * FROM decisions WHERE event_id = ? ORDER BY created_at DESC').all(eventId) as DbDecision[]).map(toStored);
  },

  getRecent(limit = 20): StoredDecision[] {
    return (getDb().prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?').all(limit) as DbDecision[]).map(toStored);
  },

  getLastTradeTime(): number | null {
    const row = getDb().prepare(
      "SELECT timestamp FROM decisions WHERE action != 'NO_TRADE' ORDER BY timestamp DESC LIMIT 1"
    ).get() as { timestamp: number } | undefined;
    return row?.timestamp ?? null;
  },

  countTodayTrades(): number {
    const midnight = new Date().setHours(0, 0, 0, 0);
    const row = getDb().prepare(
      "SELECT COUNT(*) as cnt FROM decisions WHERE action != 'NO_TRADE' AND timestamp >= ?"
    ).get(midnight) as { cnt: number };
    return row.cnt;
  },
};
