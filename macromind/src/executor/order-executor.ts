/**
 * Order Executor
 *
 * Signs and sends orders to SoDEX. Handles:
 * - Entry order placement
 * - TP/SL attachment
 * - Position monitoring queries
 * - Cancel-all (kill switch)
 *
 * Uses SoDEXSigner for EIP-712 signing and SoDEXClient for market data reads.
 */
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { SoDEXSigner, type SignedHeaders, type UpdateLeverageRequest } from '../services/sodex-signer.js';
import { SoDEXClient } from '../services/sodex-client.js';
import {
  buildEntryOrders,
  calcPositionSize,
  type OrderSizingParams,
  type OrderSpec,
} from './order-builder.js';
import { TradeStore } from '../store/trade-store.js';
import type { TradeDecision } from '../ai/types.js';

const logger = createLogger('OrderExecutor');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  orderId?: number;
  clOrdID?: string;
  spec?: OrderSpec;
  error?: string;
}

interface PlaceOrderResult {
  orderID?: number;
  clOrdID?: string;
  status?: string;
  message?: string;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function signedPost(
  url: string,
  headers: SignedHeaders,
  body: Record<string, unknown>,
): Promise<{ data?: unknown; code?: number; message?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { data?: unknown; code?: number; message?: string; msg?: string };

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${json.message ?? json.msg ?? JSON.stringify(json)}`);
  }
  if (json.code && json.code !== 0 && json.code !== 200) {
    throw new Error(`API error ${json.code}: ${json.message ?? json.msg ?? 'unknown'}`);
  }

  return json;
}

async function signedDelete(
  url: string,
  headers: SignedHeaders,
  body: Record<string, unknown>,
): Promise<{ data?: unknown; code?: number; message?: string }> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { data?: unknown; code?: number; message?: string; msg?: string };

  if (!res.ok && res.status !== 200) {
    throw new Error(`HTTP ${res.status}: ${json.message ?? json.msg ?? JSON.stringify(json)}`);
  }
  if (json.code && json.code !== 0 && json.code !== 200) {
    throw new Error(`API error ${json.code}: ${json.message ?? json.msg ?? 'unknown'}`);
  }

  return json;
}

// ── Main executor class ───────────────────────────────────────────────────────

export class OrderExecutor {
  private readonly signer: SoDEXSigner;
  private readonly client: SoDEXClient;
  private readonly base: string;
  private readonly accountId: number;
  private readonly masterAddress: string;

  constructor() {
    // If apiKeyPrivate derives to the same address as masterAddress, use master-key auth.
    // Master-key auth: sign with master private key, omit X-API-Key header.
    // Sub-key auth:    sign with API key private key, include X-API-Key header.
    this.signer = new SoDEXSigner(
      config.sodex.apiKeyPrivate,
      config.sodex.chainId,
      config.sodex.apiKeyName,
    );
    this.client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    this.base = config.sodex.endpoint;
    this.accountId = config.sodex.accountId;
    this.masterAddress = config.sodex.masterAddress;
  }

  /** Strip X-API-Key from headers when in master-key mode */
  private prepHeaders(headers: SignedHeaders): SignedHeaders {
    return headers;  // SoDEXSigner already omits X-API-Key when apiKeyName is empty
  }

  /**
   * Execute a trade decision end-to-end:
   * 1. Fetch current market state (price, balance, symbolID)
   * 2. Calculate position size
   * 3. Set leverage
   * 4. Place entry order
   * 5. Attach TP/SL orders
   * 6. Log to TradeStore
   */
  async execute(decision: TradeDecision, symbol = 'BTC-USD'): Promise<ExecutionResult> {
    if (decision.action === 'NO_TRADE') {
      return { success: false, error: 'Decision is NO_TRADE' };
    }

    const action = decision.action; // 'LONG' | 'SHORT'

    try {
      // ── Fetch market data ──────────────────────────────────────────────────
      logger.info(`Executing ${action} trade for ${decision.trigger.event} on ${symbol}`);

      const [symbols, ticker] = await Promise.all([
        this.client.getPerpsSymbols(),
        this.client.getPerpsTicker(symbol),
      ]);

      // Match the requested symbol; fall back to BTC-USD if the venue lacks it.
      let tradeSymbol = symbols.find((s) => s.symbol === symbol);
      if (!tradeSymbol) {
        logger.warn(`${symbol} not listed on SoDEX — falling back to BTC-USD`);
        tradeSymbol = symbols.find((s) => s.symbol === 'BTC-USD' || s.symbol.includes('BTC'));
        symbol = tradeSymbol?.symbol ?? 'BTC-USD';
      }
      if (!tradeSymbol) throw new Error(`No tradable symbol found on SoDEX (wanted ${symbol})`);
      if (!ticker) throw new Error(`${symbol} ticker not found`);

      const markPrice = parseFloat(ticker.lastPrice);
      if (!markPrice || markPrice <= 0) throw new Error(`Invalid mark price: ${ticker.lastPrice}`);

      // ── Fetch balance ──────────────────────────────────────────────────────
      const balance = await this.client.getPerpsBalances(this.masterAddress);
      const availableUsdc = parseFloat(balance.availableBalance);
      if (availableUsdc <= 0) {
        return { success: false, error: `Insufficient balance: ${availableUsdc} USDC` };
      }

      // ── Fetch klines for ATR ───────────────────────────────────────────────
      const klines = await this.client.getPerpsKlines(symbol);
      const atr14 = this.client.calcATR(klines);

      const sizing: OrderSizingParams = {
        balance:   availableUsdc,
        atr14:     atr14 > 0 ? atr14 : markPrice * 0.015, // fallback: 1.5% of price
        markPrice,
        symbolId:  tradeSymbol.symbolId,
        tickSize:  tradeSymbol.tickSize,
        stepSize:  tradeSymbol.stepSize,
      };

      // ── Set leverage ───────────────────────────────────────────────────────
      const { leverage } = calcPositionSize(sizing);
      await this.setLeverage(tradeSymbol.symbolId, leverage);

      // ── Build orders ───────────────────────────────────────────────────────
      const { entry, stopLoss, takeProfit, spec } = buildEntryOrders(
        this.accountId,
        action,
        sizing,
      );

      logger.info(`Order spec: ${action} ${spec.quantity} ${symbol} @ ${spec.price}`, {
        sl: spec.stopLoss,
        tp: spec.takeProfit,
        leverage: spec.leverage,
      });

      // ── Place entry order ──────────────────────────────────────────────────
      const { headers: entryHeaders, body: entryBody } = this.signer.signNewOrder(entry);
      const entryRes = await signedPost(
        `${this.base}/perps/trade/orders`,
        entryHeaders,
        entryBody,
      );

      const entryResults = (Array.isArray(entryRes.data) ? entryRes.data : [entryRes.data]) as PlaceOrderResult[];
      const entryOrder = entryResults[0];
      if (!entryOrder?.orderID) {
        throw new Error(`Entry order placement failed: ${JSON.stringify(entryResults)}`);
      }

      logger.info(`Entry order placed: orderID=${entryOrder.orderID} status=${entryOrder.status}`);

      // ── Attach SL order ────────────────────────────────────────────────────
      try {
        const { headers: slHeaders, body: slBody } = this.signer.signNewOrder(stopLoss);
        await signedPost(`${this.base}/perps/trade/orders`, slHeaders, slBody);
        logger.info(`Stop-loss order placed @ ${spec.stopLoss}`);
      } catch (err) {
        logger.warn('Failed to place SL order (continuing)', { error: String(err) });
      }

      // ── Attach TP order ────────────────────────────────────────────────────
      try {
        const { headers: tpHeaders, body: tpBody } = this.signer.signNewOrder(takeProfit);
        await signedPost(`${this.base}/perps/trade/orders`, tpHeaders, tpBody);
        logger.info(`Take-profit order placed @ ${spec.takeProfit}`);
      } catch (err) {
        logger.warn('Failed to place TP order (continuing)', { error: String(err) });
      }

      // ── Persist to TradeStore ──────────────────────────────────────────────
      TradeStore.insert({
        id:           spec.clOrdID,
        decisionId:   decision.id,
        sodexOrderId: entryOrder.orderID?.toString() ?? null,
        symbol,
        side:         action,
        entryPrice:   spec.price,
        quantity:     spec.quantity,
        leverage:     spec.leverage,
        stopLoss:     spec.stopLoss,
        takeProfit:   spec.takeProfit,
        status:       'OPEN',
        exitPrice:    null,
        pnl:          null,
        pnlPercent:   null,
        openedAt:     Date.now(),
        closedAt:     null,
      });

      return {
        success: true,
        tradeId: spec.clOrdID,
        orderId: entryOrder.orderID,
        clOrdID: entryOrder.clOrdID,
        spec,
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Trade execution failed: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Set leverage for a symbol.
   * marginMode 0 = cross margin (default).
   */
  async setLeverage(symbolId: number, leverage: number): Promise<void> {
    try {
      const req: UpdateLeverageRequest = {
        accountID:  this.accountId,
        symbolID:   symbolId,
        leverage:   Math.max(1, Math.min(leverage, config.risk.maxLeverage)),
        marginMode: 0,
      };
      const { headers, body } = this.signer.signUpdateLeverage(req);
      await signedPost(`${this.base}/perps/trade/leverage`, headers, body);
      logger.debug(`Leverage set to ${leverage}x for symbolID=${symbolId}`);
    } catch (err) {
      // Non-fatal: log and continue
      logger.warn(`setLeverage failed (non-fatal)`, { error: String(err) });
    }
  }

  /**
   * Cancel all open orders for a symbol.
   */
  async cancelAll(symbolId: number, orderIds: number[]): Promise<void> {
    if (orderIds.length === 0) {
      // Schedule cancel all
      const req = { accountID: this.accountId };
      const { headers, body } = this.signer.signScheduleCancel(req);
      await signedDelete(`${this.base}/perps/trade/orders`, headers, body);
      logger.info('Cancel-all issued');
    } else {
      const req = {
        accountID: this.accountId,
        cancels: orderIds.map((id) => ({ symbolID: symbolId, orderID: id })),
      };
      const { headers, body } = this.signer.signCancelOrder(req);
      await signedDelete(`${this.base}/perps/trade/orders`, headers, body);
      logger.info(`Cancelled ${orderIds.length} orders`);
    }
  }

  /**
   * Get current open positions for the master address.
   */
  async getPositions() {
    return this.client.getPerpsPositions(this.masterAddress);
  }

  /**
   * Get current open orders.
   */
  async getOpenOrders() {
    return this.client.getPerpsOrders(this.masterAddress);
  }
}
