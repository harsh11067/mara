/**
 * Position Sizer
 *
 * Calculates position size using ATR-based risk management.
 * Formula: quantity = (balance × maxRiskPerTrade) / (ATR × stopLossMultiplier)
 */
import { config } from '../config.js';

export interface SizingInput {
  /** Available USDC balance */
  availableBalance: number;
  /** ATR(14) in USD */
  atr14: number;
  /** Current mark price in USD */
  markPrice: number;
  /** Step size string from symbol info (e.g. "0.00001") */
  stepSize?: string;
  /** Max leverage cap from symbol (optional override) */
  symbolMaxLeverage?: number;
}

export interface SizingResult {
  /** Position size in contracts (BTC) */
  quantity: number;
  /** Leverage needed to hold this position */
  leverage: number;
  /** Stop-loss distance in USD */
  stopLossDistance: number;
  /** Stop-loss price (for long entry) */
  stopLossPrice: (entryPrice: number, isLong: boolean) => number;
  /** Take-profit price (for long entry) */
  takeProfitPrice: (entryPrice: number, isLong: boolean) => number;
  /** Notional value in USD */
  notionalUsd: number;
  /** Risk amount in USD */
  riskAmountUsd: number;
}

function floorToStep(value: number, step: string): number {
  const stepNum = parseFloat(step);
  if (!stepNum || stepNum <= 0) return value;
  return Math.floor(value / stepNum) * stepNum;
}

export function calcPositionSize(input: SizingInput): SizingResult {
  const { availableBalance, atr14, markPrice, stepSize = '0.00001', symbolMaxLeverage } = input;

  // Risk amount: how much USDC we're willing to lose per trade
  const riskAmountUsd = availableBalance * config.risk.maxRiskPerTrade;

  // Stop-loss distance = ATR × multiplier
  const stopLossDistance = atr14 * config.risk.stopLossAtrMultiplier;

  // Position size in contracts
  let quantity = riskAmountUsd / stopLossDistance;

  // Round down to step size
  quantity = floorToStep(quantity, stepSize);

  // Enforce minimum (at least 1 step)
  const minQty = parseFloat(stepSize);
  if (quantity < minQty) quantity = minQty;

  // Leverage required
  const notionalUsd = quantity * markPrice;
  const rawLeverage = Math.ceil(notionalUsd / availableBalance);
  const maxLev = Math.min(
    config.risk.maxLeverage,
    symbolMaxLeverage ?? config.risk.maxLeverage,
  );
  const leverage = Math.max(1, Math.min(rawLeverage, maxLev));

  return {
    quantity,
    leverage,
    stopLossDistance,
    notionalUsd,
    riskAmountUsd,
    stopLossPrice: (entryPrice: number, isLong: boolean) =>
      isLong
        ? entryPrice - stopLossDistance
        : entryPrice + stopLossDistance,
    takeProfitPrice: (entryPrice: number, isLong: boolean) => {
      const tpDist = stopLossDistance * config.risk.takeProfitAtrMultiplier;
      return isLong ? entryPrice + tpDist : entryPrice - tpDist;
    },
  };
}
