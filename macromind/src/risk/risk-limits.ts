/**
 * Risk Limits
 *
 * Gate-check before any trade is executed.
 * All checks must pass; the first failure returns the reason.
 */
import { config } from '../config.js';
import { DecisionStore } from '../store/decision-store.js';
import { TradeStore } from '../store/trade-store.js';
import { RiskStore } from '../store/risk-store.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RiskLimits');

export interface RiskCheckInput {
  /** Current available balance in USDC */
  availableBalance: number;
  /** USD value of orderbook depth (liquidity check) */
  orderbookDepthUsd?: number;
  /** Current ATR for reasonableness check */
  atr14?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export async function checkRiskLimits(input: RiskCheckInput): Promise<RiskCheckResult> {
  const { availableBalance, orderbookDepthUsd, atr14 } = input;

  // ── 1. Kill switch ─────────────────────────────────────────────────────────
  const latest = RiskStore.getLatest();
  if (latest?.killSwitchActive) {
    logger.warn('BLOCKED: kill switch is active');
    return { allowed: false, reason: 'kill_switch_active' };
  }

  // ── 2. Balance check ───────────────────────────────────────────────────────
  if (availableBalance <= 0) {
    return { allowed: false, reason: 'insufficient_balance' };
  }

  // ── 3. Open positions count ────────────────────────────────────────────────
  const openCount = TradeStore.countOpen();
  if (openCount >= config.risk.maxOpenPositions) {
    logger.warn(`BLOCKED: ${openCount}/${config.risk.maxOpenPositions} positions open`);
    return { allowed: false, reason: `max_positions_reached (${openCount})` };
  }

  // ── 4. Drawdown limit ──────────────────────────────────────────────────────
  if (latest) {
    if (latest.drawdownPercent >= config.risk.maxDrawdown * 100) {
      logger.warn(`BLOCKED: drawdown ${latest.drawdownPercent.toFixed(1)}% >= ${config.risk.maxDrawdown * 100}%`);
      return { allowed: false, reason: `max_drawdown_reached (${latest.drawdownPercent.toFixed(1)}%)` };
    }
  }

  // ── 5. Cooldown timer ──────────────────────────────────────────────────────
  const lastTradeTime = DecisionStore.getLastTradeTime();
  if (lastTradeTime) {
    const elapsed = Date.now() - lastTradeTime;
    if (elapsed < config.risk.minTimeBetweenTradesMs) {
      const waitSec = Math.ceil((config.risk.minTimeBetweenTradesMs - elapsed) / 1000);
      logger.info(`BLOCKED: cooldown — wait ${waitSec}s`);
      return { allowed: false, reason: `cooldown (${waitSec}s remaining)` };
    }
  }

  // ── 6. Daily trade count ───────────────────────────────────────────────────
  const todayTrades = DecisionStore.countTodayTrades();
  if (todayTrades >= config.risk.maxDailyTrades) {
    logger.warn(`BLOCKED: ${todayTrades}/${config.risk.maxDailyTrades} daily trades used`);
    return { allowed: false, reason: `daily_limit_reached (${todayTrades})` };
  }

  // ── 7. Minimum orderbook liquidity ─────────────────────────────────────────
  if (orderbookDepthUsd !== undefined && orderbookDepthUsd < config.risk.minOrderbookDepthUsd) {
    logger.warn(`BLOCKED: low liquidity $${orderbookDepthUsd.toFixed(0)} < $${config.risk.minOrderbookDepthUsd}`);
    return { allowed: false, reason: `low_liquidity ($${orderbookDepthUsd.toFixed(0)})` };
  }

  // ── 8. ATR sanity check ────────────────────────────────────────────────────
  if (atr14 !== undefined && atr14 <= 0) {
    return { allowed: false, reason: 'atr_unavailable' };
  }

  logger.info(`Risk check PASSED (open=${openCount}, today=${todayTrades})`);
  return { allowed: true };
}
