import { getDb } from './db.js';

export interface RiskSnapshot {
  id?: number;
  timestamp: number;
  accountBalance: number;
  openPositions: number;
  totalExposure: number;
  unrealizedPnl: number;
  drawdownPercent: number;
  killSwitchActive: boolean;
}

interface DbRiskSnapshot {
  id: number;
  timestamp: number;
  account_balance: number;
  open_positions: number;
  total_exposure: number;
  unrealized_pnl: number;
  drawdown_percent: number;
  kill_switch_active: number;
}

function toStored(row: DbRiskSnapshot): RiskSnapshot {
  return {
    id: row.id,
    timestamp: row.timestamp,
    accountBalance: row.account_balance,
    openPositions: row.open_positions,
    totalExposure: row.total_exposure,
    unrealizedPnl: row.unrealized_pnl,
    drawdownPercent: row.drawdown_percent,
    killSwitchActive: row.kill_switch_active === 1,
  };
}

export const RiskStore = {
  insert(s: Omit<RiskSnapshot, 'id'>): void {
    getDb().prepare(`
      INSERT INTO risk_snapshots (timestamp, account_balance, open_positions, total_exposure, unrealized_pnl, drawdown_percent, kill_switch_active)
      VALUES (@timestamp, @account_balance, @open_positions, @total_exposure, @unrealized_pnl, @drawdown_percent, @kill_switch_active)
    `).run({
      timestamp: s.timestamp,
      account_balance: s.accountBalance,
      open_positions: s.openPositions,
      total_exposure: s.totalExposure,
      unrealized_pnl: s.unrealizedPnl,
      drawdown_percent: s.drawdownPercent,
      kill_switch_active: s.killSwitchActive ? 1 : 0,
    });
  },

  getLatest(): RiskSnapshot | null {
    const row = getDb().prepare('SELECT * FROM risk_snapshots ORDER BY timestamp DESC LIMIT 1').get() as DbRiskSnapshot | undefined;
    return row ? toStored(row) : null;
  },

  getRecent(limit = 100): RiskSnapshot[] {
    return (getDb().prepare('SELECT * FROM risk_snapshots ORDER BY timestamp DESC LIMIT ?').all(limit) as DbRiskSnapshot[]).map(toStored);
  },

  getHighWatermark(): number {
    const row = getDb().prepare('SELECT MAX(account_balance) as hwm FROM risk_snapshots').get() as { hwm: number | null };
    return row.hwm ?? 0;
  },
};
