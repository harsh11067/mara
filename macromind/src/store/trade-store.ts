import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';

export type TradeStatus = 'OPEN' | 'CLOSED' | 'STOPPED' | 'TAKEN_PROFIT' | 'CANCELLED';

export interface StoredTrade {
  id: string;
  decisionId: string | null;
  sodexOrderId: string | null;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number | null;
  quantity: number | null;
  leverage: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: TradeStatus;
  exitPrice: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  openedAt: number | null;
  closedAt: number | null;
}

interface DbTrade {
  id: string;
  decision_id: string | null;
  sodex_order_id: string | null;
  symbol: string;
  side: string;
  entry_price: number | null;
  quantity: number | null;
  leverage: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  status: string;
  exit_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  opened_at: number | null;
  closed_at: number | null;
}

function toStored(row: DbTrade): StoredTrade {
  return {
    id: row.id,
    decisionId: row.decision_id,
    sodexOrderId: row.sodex_order_id,
    symbol: row.symbol,
    side: row.side as 'LONG' | 'SHORT',
    entryPrice: row.entry_price,
    quantity: row.quantity,
    leverage: row.leverage,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    status: row.status as TradeStatus,
    exitPrice: row.exit_price,
    pnl: row.pnl,
    pnlPercent: row.pnl_percent,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
  };
}

export const TradeStore = {
  insert(t: Omit<StoredTrade, 'id'> & { id?: string }): StoredTrade {
    const id = t.id ?? uuidv4();
    getDb().prepare(`
      INSERT INTO trades (id, decision_id, sodex_order_id, symbol, side, entry_price, quantity, leverage, stop_loss, take_profit, status, exit_price, pnl, pnl_percent, opened_at, closed_at)
      VALUES (@id, @decision_id, @sodex_order_id, @symbol, @side, @entry_price, @quantity, @leverage, @stop_loss, @take_profit, @status, @exit_price, @pnl, @pnl_percent, @opened_at, @closed_at)
    `).run({
      id,
      decision_id: t.decisionId,
      sodex_order_id: t.sodexOrderId,
      symbol: t.symbol,
      side: t.side,
      entry_price: t.entryPrice,
      quantity: t.quantity,
      leverage: t.leverage,
      stop_loss: t.stopLoss,
      take_profit: t.takeProfit,
      status: t.status,
      exit_price: t.exitPrice,
      pnl: t.pnl,
      pnl_percent: t.pnlPercent,
      opened_at: t.openedAt,
      closed_at: t.closedAt,
    });
    return this.getById(id)!;
  },

  updateStatus(id: string, status: TradeStatus, extra?: { exitPrice?: number; pnl?: number; pnlPercent?: number; closedAt?: number }): void {
    const db = getDb();
    const sets = ['status = @status'];
    const params: Record<string, unknown> = { id, status };

    if (extra?.exitPrice !== undefined) { sets.push('exit_price = @exit_price'); params.exit_price = extra.exitPrice; }
    if (extra?.pnl !== undefined) { sets.push('pnl = @pnl'); params.pnl = extra.pnl; }
    if (extra?.pnlPercent !== undefined) { sets.push('pnl_percent = @pnl_percent'); params.pnl_percent = extra.pnlPercent; }
    if (extra?.closedAt !== undefined) { sets.push('closed_at = @closed_at'); params.closed_at = extra.closedAt; }

    db.prepare(`UPDATE trades SET ${sets.join(', ')} WHERE id = @id`).run(params);
  },

  getById(id: string): StoredTrade | null {
    const row = getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id) as DbTrade | undefined;
    return row ? toStored(row) : null;
  },

  getOpen(): StoredTrade[] {
    return (getDb().prepare("SELECT * FROM trades WHERE status = 'OPEN' ORDER BY opened_at DESC").all() as DbTrade[]).map(toStored);
  },

  getRecent(limit = 20): StoredTrade[] {
    return (getDb().prepare('SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?').all(limit) as DbTrade[]).map(toStored);
  },

  countOpen(): number {
    const row = getDb().prepare("SELECT COUNT(*) as cnt FROM trades WHERE status = 'OPEN'").get() as { cnt: number };
    return row.cnt;
  },

  getCumulativePnl(): number {
    const row = getDb().prepare("SELECT COALESCE(SUM(pnl), 0) as total FROM trades WHERE status != 'OPEN'").get() as { total: number };
    return row.total;
  },
};
