/**
 * Portfolio Tracker
 *
 * Polls open positions every 10s, tracks unrealised P&L,
 * computes drawdown from high-water mark, and emits KILL_SWITCH_ACTIVATED
 * if drawdown exceeds the configured limit.
 */
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { RiskStore } from '../store/risk-store.js';
import { TradeStore } from '../store/trade-store.js';
import { appEvents } from '../utils/event-emitter.js';
import { SoDEXClient } from '../services/sodex-client.js';

const logger = createLogger('PortfolioTracker');

export class PortfolioTracker {
  private readonly client: SoDEXClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private highWaterMarkUsd = 0;
  private killSwitchActive = false;

  constructor() {
    this.client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
  }

  start(): void {
    if (this.timer) return;
    logger.info('Portfolio tracker started');
    // Initial snapshot immediately
    void this.snapshot();
    this.timer = setInterval(
      () => void this.snapshot(),
      config.polling.positionMonitorIntervalMs,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Portfolio tracker stopped');
  }

  async snapshot(): Promise<void> {
    try {
      const [balance, positions] = await Promise.all([
        this.client.getPerpsBalances(config.sodex.masterAddress),
        this.client.getPerpsPositions(config.sodex.masterAddress),
      ]);

      const walletBalance = parseFloat(balance.walletBalance ?? balance.availableBalance ?? '0');
      const openPositions = positions.length;

      // Calculate unrealised PnL from positions
      let unrealizedPnl = 0;
      let totalExposure = 0;
      for (const pos of positions) {
        const qty = parseFloat(pos.quantity ?? '0');
        const entry = parseFloat(pos.entryPrice ?? '0');
        const mark = parseFloat(pos.markPrice ?? pos.entryPrice ?? '0');
        if (qty > 0 && mark > 0) {
          const pnl = (mark - entry) * qty * (pos.positionSide === 'SHORT' ? -1 : 1);
          unrealizedPnl += pnl;
          totalExposure += qty * mark;
        }
      }

      // Also count open trades in our DB
      const openTrades = TradeStore.countOpen();
      const cumulativePnl = TradeStore.getCumulativePnl();

      // High-water mark (equity = wallet balance + unrealized)
      const equity = walletBalance + unrealizedPnl;
      if (equity > this.highWaterMarkUsd) {
        this.highWaterMarkUsd = equity;
      }

      // Drawdown from HWM
      const drawdownPct = this.highWaterMarkUsd > 0
        ? ((this.highWaterMarkUsd - equity) / this.highWaterMarkUsd) * 100
        : 0;

      // Check kill switch
      const shouldKill = !this.killSwitchActive
        && drawdownPct >= config.risk.maxDrawdown * 100;

      if (shouldKill) {
        this.killSwitchActive = true;
        logger.error(`KILL SWITCH: drawdown ${drawdownPct.toFixed(1)}% >= ${config.risk.maxDrawdown * 100}%`);
        await appEvents.emit('KILL_SWITCH_ACTIVATED', {
          reason: `drawdown_limit (${drawdownPct.toFixed(1)}%)`,
          drawdown: drawdownPct,
          timestamp: Date.now(),
        });
      }

      // Persist snapshot
      RiskStore.insert({
        timestamp: Date.now(),
        accountBalance: walletBalance,
        openPositions: Math.max(openPositions, openTrades),
        totalExposure,
        unrealizedPnl,
        drawdownPercent: drawdownPct,
        killSwitchActive: this.killSwitchActive,
      });

      // Emit risk snapshot for dashboard
      await appEvents.emit('RISK_SNAPSHOT', {
        balance: walletBalance,
        openPositions: Math.max(openPositions, openTrades),
        totalExposure,
        unrealizedPnl,
        drawdownPercent: drawdownPct,
        killSwitchActive: this.killSwitchActive,
        timestamp: Date.now(),
      });

    } catch (err) {
      logger.warn('Portfolio snapshot failed', { error: String(err) });
    }
  }

  /** Manual reset of kill switch (requires operator action) */
  resetKillSwitch(): void {
    this.killSwitchActive = false;
    logger.warn('Kill switch RESET by operator');
  }

  get isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }
}
