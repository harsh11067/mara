/**
 * Order Builder
 *
 * Translates a TradeDecision + risk parameters into a valid SoDEX order payload.
 * Does NOT sign or send — that's the executor's job.
 */
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import {
  OrderSide, OrderType, TimeInForce, PositionSide, OrderModifier,
  stripTrailingZeros,
  type NewOrderRequest, type RawOrder, type CancelOrderRequest,
} from '../services/sodex-signer.js';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface OrderSizingParams {
  /** USDC balance to risk */
  balance: number;
  /** ATR(14) value for position sizing */
  atr14: number;
  /** Current BTC mark price */
  markPrice: number;
  /** symbolID from SoDEX (from getPerpsSymbols) */
  symbolId: number;
  /** Tick size string (e.g. "0.5") */
  tickSize?: string;
  /** Step size string (e.g. "0.001") */
  stepSize?: string;
}

export interface OrderSpec {
  symbolId: number;
  clOrdID: string;
  side: 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  leverage: number;
}

export interface BuiltOrders {
  /** Main entry order */
  entry: NewOrderRequest;
  /** Stop-loss order */
  stopLoss: NewOrderRequest;
  /** Take-profit order */
  takeProfit: NewOrderRequest;
  /** Human-readable spec for logging */
  spec: OrderSpec;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a number to string, stripping trailing zeros, respecting tick/step size precision */
function formatDecimal(n: number, stepSize?: string): string {
  const precision = stepSize ? stepSize.includes('.') ? stepSize.split('.')[1].length : 0 : 6;
  const fixed = n.toFixed(precision);
  return stripTrailingZeros(fixed);
}

/** Round price to nearest tick */
function roundToTick(price: number, tickSize: string): number {
  const tick = parseFloat(tickSize);
  if (tick <= 0) return price;
  return Math.round(price / tick) * tick;
}

/** Round quantity to step size (round DOWN to avoid exceeding balance) */
function floorToStep(qty: number, stepSize: string): number {
  const step = parseFloat(stepSize);
  if (step <= 0) return qty;
  return Math.floor(qty / step) * step;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Calculate position size using ATR-based risk management:
 *   quantity = (balance * maxRiskPerTrade) / (atr * stopLossAtrMultiplier)
 */
export function calcPositionSize(params: OrderSizingParams): {
  quantity: number;
  leverage: number;
  stopLossDistance: number;
} {
  const { balance, atr14, markPrice, stepSize } = params;
  const riskAmount = balance * config.risk.maxRiskPerTrade;
  const stopLossDist = atr14 * config.risk.stopLossAtrMultiplier;

  // Size in contracts (BTC)
  let quantity = riskAmount / stopLossDist;

  // Apply step size
  const step = stepSize ?? '0.001';
  quantity = floorToStep(quantity, step);
  if (quantity <= 0) quantity = parseFloat(step); // minimum 1 step

  // Calculate required leverage
  const notionalValue = quantity * markPrice;
  const leverage = Math.ceil(notionalValue / balance);
  const cappedLeverage = Math.min(leverage, config.risk.maxLeverage);

  return { quantity, leverage: cappedLeverage, stopLossDistance: stopLossDist };
}

/**
 * Build a market entry order + TP + SL for a given direction.
 * All three are returned as NewOrderRequests ready to sign and send sequentially.
 */
export function buildEntryOrders(
  accountId: number,
  action: 'LONG' | 'SHORT',
  sizing: OrderSizingParams,
): BuiltOrders {
  const { quantity, stopLossDistance } = calcPositionSize(sizing);
  const { symbolId, markPrice, tickSize = '0.1', stepSize = '0.001' } = sizing;

  const isLong = action === 'LONG';
  const side = isLong ? OrderSide.Buy : OrderSide.Sell;
  // SoDEX testnet uses one-way (netted) mode — positionSide must always be BOTH (1)
  const positionSide = PositionSide.Both;
  const exitSide = isLong ? OrderSide.Sell : OrderSide.Buy;

  // Stop loss: below entry for long, above for short
  const stopLossPrice = roundToTick(
    isLong ? markPrice - stopLossDistance : markPrice + stopLossDistance,
    tickSize,
  );

  // Take profit: 2x the stop distance in the other direction
  const tpDistance = stopLossDistance * config.risk.takeProfitAtrMultiplier;
  const takeProfitPrice = roundToTick(
    isLong ? markPrice + tpDistance : markPrice - tpDistance,
    tickSize,
  );

  const baseId = uuidv4().slice(0, 12);
  const entryClOrdID = `e-${baseId}`;
  const slClOrdID    = `sl-${baseId}`;
  const tpClOrdID    = `tp-${baseId}`;

  const qtyStr = formatDecimal(quantity, stepSize);
  const entryPxStr = formatDecimal(markPrice, tickSize);
  const slPxStr    = formatDecimal(stopLossPrice, tickSize);
  const tpPxStr    = formatDecimal(takeProfitPrice, tickSize);

  // ── Entry order (limit at mark price, GTC) ───────────────────────────────
  const entryOrder: RawOrder = {
    clOrdID:      entryClOrdID,
    modifier:     OrderModifier.Normal,
    side,
    type:         OrderType.Limit,
    timeInForce:  TimeInForce.GTC,
    price:        entryPxStr,
    quantity:     qtyStr,
    reduceOnly:   false,
    positionSide,
  };

  // ── Stop-loss order (limit reduce-only) ──────────────────────────────────
  const slOrder: RawOrder = {
    clOrdID:      slClOrdID,
    modifier:     OrderModifier.Normal,
    side:         exitSide,
    type:         OrderType.Limit,
    timeInForce:  TimeInForce.GTC,
    price:        slPxStr,
    quantity:     qtyStr,
    reduceOnly:   true,
    positionSide,
  };

  // ── Take-profit order (limit reduce-only) ────────────────────────────────
  const tpOrder: RawOrder = {
    clOrdID:      tpClOrdID,
    modifier:     OrderModifier.Normal,
    side:         exitSide,
    type:         OrderType.Limit,
    timeInForce:  TimeInForce.GTC,
    price:        tpPxStr,
    quantity:     qtyStr,
    reduceOnly:   true,
    positionSide,
  };

  const wrapOrder = (order: RawOrder): NewOrderRequest => ({
    accountID: accountId,
    symbolID:  symbolId,
    orders:    [order],
  });

  const spec: OrderSpec = {
    symbolId,
    clOrdID: entryClOrdID,
    side: action,
    price: markPrice,
    quantity,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    leverage: calcPositionSize(sizing).leverage,
  };

  return {
    entry:      wrapOrder(entryOrder),
    stopLoss:   wrapOrder(slOrder),
    takeProfit: wrapOrder(tpOrder),
    spec,
  };
}

/**
 * Build a cancel-all request for an account.
 */
export function buildCancelAll(accountId: number, symbolId: number, orderIds: number[]): CancelOrderRequest {
  return {
    accountID: accountId,
    cancels: orderIds.map((id) => ({ symbolID: symbolId, orderID: id })),
  };
}
