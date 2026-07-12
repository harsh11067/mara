/**
 * SSI Manager
 *
 * Manages SSI portfolio rotation on SoDEX spot market.
 * On a BEARISH event: rotates risk-on SSI tokens (MAG7, MEME) → USSI (safe haven)
 * On a BULLISH event: rotates USSI → MAG7/DEFI (risk-on)
 * NEUTRAL: no rotation
 *
 * SSI tokens on SoDEX testnet (confirmed):
 *   vMAG7ssi_vUSDC  — MAG7 SSI index (US tech)
 *   vUSSI_vUSDC     — USSI = broad US market index (safe-haven SSI)
 *   vMEMEssi_vUSDC  — MEME SSI index
 *   vDEFIssi_vUSDC  — DeFi SSI index
 */
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { SoDEXClient } from './sodex-client.js';
import { SoDEXSigner, OrderSide, OrderType, TimeInForce, stripTrailingZeros } from './sodex-signer.js';
import type { SpotBalance } from './types.js';

const logger = createLogger('SSIManager');

// ── SSI token mappings ────────────────────────────────────────────────────────

interface SsiToken {
  symbol: string;    // spot pair e.g. "vMAG7ssi_vUSDC"
  type: 'risk_on' | 'safe_haven';
  index: 'mag7' | 'ussi' | 'meme' | 'defi';
}

const SSI_TOKENS: SsiToken[] = [
  { symbol: 'vMAG7ssi_vUSDC',  type: 'risk_on',    index: 'mag7'  },
  { symbol: 'vUSSI_vUSDC',     type: 'safe_haven', index: 'ussi'  },
  { symbol: 'vMEMEssi_vUSDC',  type: 'risk_on',    index: 'meme'  },
  { symbol: 'vDEFIssi_vUSDC',  type: 'risk_on',    index: 'defi'  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SsiHolding {
  symbol: string;
  balance: number;
  index: string;
  type: 'risk_on' | 'safe_haven';
}

export interface RotationOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  reason: string;
}

export interface RotationPlan {
  conviction: string;
  orders: RotationOrder[];
  estimatedUsdValue: number;
  maxRotationPct: number;
}

export interface RotationResult {
  success: boolean;
  executed: number;
  failed: number;
  details: string[];
}

// ── SSIManager class ──────────────────────────────────────────────────────────

export class SSIManager {
  private readonly client: SoDEXClient;
  private readonly signer: SoDEXSigner;
  private readonly base: string;
  private readonly accountId: number;

  constructor() {
    this.client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    this.signer = new SoDEXSigner(
      config.sodex.apiKeyPrivate,
      config.sodex.chainId,
      config.sodex.apiKeyName,
    );
    this.base = config.sodex.endpoint;
    this.accountId = config.sodex.accountId;
  }

  /**
   * Get current SSI holdings from spot balances.
   */
  async getHoldings(): Promise<SsiHolding[]> {
    try {
      const balances = await this.client.getSpotBalances(config.sodex.masterAddress);
      const holdings: SsiHolding[] = [];

      for (const token of SSI_TOKENS) {
        // Match by base currency (e.g. "vMAG7ssi" from "vMAG7ssi_vUSDC")
        const baseCoin = token.symbol.split('_')[0];
        const bal = balances.find(
          (b: SpotBalance) => b.asset === baseCoin || b.asset === token.symbol,
        );
        if (bal) {
          const amount = parseFloat(bal.free ?? '0') + parseFloat(bal.locked ?? '0');
          if (amount > 0) {
            holdings.push({
              symbol: token.symbol,
              balance: amount,
              index: token.index,
              type: token.type,
            });
          }
        }
      }

      logger.debug(`SSI holdings: ${holdings.map((h) => `${h.index}=${h.balance.toFixed(4)}`).join(', ')}`);
      return holdings;

    } catch (err) {
      logger.warn('Could not fetch SSI holdings', { error: String(err) });
      return [];
    }
  }

  /**
   * Get available SSI spot pairs from the exchange.
   * Used to discover symbolIDs for order placement.
   */
  async getAvailableSsiPairs(): Promise<Map<string, { symbolId: number; tickSize: string; stepSize: string }>> {
    try {
      const symbols = await this.client.getSpotSymbols();
      const ssiMap = new Map<string, { symbolId: number; tickSize: string; stepSize: string }>();

      for (const sym of symbols) {
        const isSSI = SSI_TOKENS.some((t) => t.symbol === sym.symbol)
          || sym.symbol.toLowerCase().includes('ssi');
        if (isSSI) {
          ssiMap.set(sym.symbol, {
            symbolId: sym.symbolId, // live numeric ID from /spot/markets/symbols
            tickSize: sym.tickSize ?? '0.0001',
            stepSize: sym.stepSize ?? '0.01',
          });
        }
      }

      return ssiMap;
    } catch {
      return new Map();
    }
  }

  /**
   * Compute the rotation plan based on conviction.
   * Max rotation = config.risk.ssiMaxRotationPercent (20%) of holdings.
   */
  computeRotation(
    conviction: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR',
    holdings: SsiHolding[],
  ): RotationPlan {
    const maxPct = config.risk.ssiMaxRotationPercent;
    const orders: RotationOrder[] = [];
    let estimatedUsdValue = 0;

    if (conviction === 'NEUTRAL') {
      return { conviction, orders: [], estimatedUsdValue: 0, maxRotationPct: maxPct };
    }

    const isBullish = conviction === 'BULL' || conviction === 'STRONG_BULL';
    const isBearish = conviction === 'BEAR' || conviction === 'STRONG_BEAR';

    if (isBearish) {
      // Sell risk-on SSI tokens, buy USSI (safe haven)
      const riskOn = holdings.filter((h) => h.type === 'risk_on');
      for (const holding of riskOn) {
        const sellQty = holding.balance * maxPct;
        if (sellQty > 0.001) {
          orders.push({
            symbol: holding.symbol,
            side: 'SELL',
            quantity: sellQty,
            reason: `${conviction}: rotate to safe-haven USSI`,
          });
          estimatedUsdValue += sellQty; // approximate 1:1 USDC
        }
      }
      // Buy USSI with proceeds
      if (orders.length > 0) {
        orders.push({
          symbol: 'vUSSI_vUSDC',
          side: 'BUY',
          quantity: estimatedUsdValue * 0.98, // 2% slippage buffer
          reason: `${conviction}: safe-haven allocation`,
        });
      }
    } else if (isBullish) {
      // Sell USSI, buy risk-on SSI (MAG7 + DEFI)
      const ussi = holdings.find((h) => h.index === 'ussi');
      if (ussi && ussi.balance > 0.001) {
        const sellQty = ussi.balance * maxPct;
        orders.push({
          symbol: 'vUSSI_vUSDC',
          side: 'SELL',
          quantity: sellQty,
          reason: `${conviction}: rotate to risk-on`,
        });
        estimatedUsdValue = sellQty;

        // Split proceeds 50/50 between MAG7 and DEFI
        const buyEach = (estimatedUsdValue * 0.98) / 2;
        if (buyEach > 0.001) {
          orders.push({
            symbol: 'vMAG7ssi_vUSDC',
            side: 'BUY',
            quantity: buyEach,
            reason: `${conviction}: MAG7 risk-on allocation`,
          });
          orders.push({
            symbol: 'vDEFIssi_vUSDC',
            side: 'BUY',
            quantity: buyEach,
            reason: `${conviction}: DeFi risk-on allocation`,
          });
        }
      }
    }

    return { conviction, orders, estimatedUsdValue, maxRotationPct: maxPct };
  }

  /**
   * Execute spot orders for SSI rotation.
   * Uses SoDEX spot engine with batchNewOrder.
   */
  async executeRotation(plan: RotationPlan): Promise<RotationResult> {
    if (plan.orders.length === 0) {
      logger.info('SSI rotation: no orders to execute (NEUTRAL or no holdings)');
      return { success: true, executed: 0, failed: 0, details: [] };
    }

    logger.info(`SSI rotation: ${plan.orders.length} orders for ${plan.conviction}`);

    // Get spot symbols to find symbolIDs
    const symbols = await this.client.getSpotSymbols();
    const symbolMap = new Map(symbols.map((s) => [s.symbol, s]));

    const results: string[] = [];
    let executed = 0;
    let failed = 0;

    for (const order of plan.orders) {
      const sym = symbolMap.get(order.symbol);
      if (!sym) {
        logger.warn(`SSI rotation: symbol ${order.symbol} not found on exchange`);
        results.push(`SKIP ${order.symbol}: not found`);
        failed++;
        continue;
      }

      // Real numeric symbolID resolved live from /spot/markets/symbols
      // (mocks.md B5 — the old symbolID:0 stub could never execute)
      if (!sym.symbolId || sym.symbolId <= 0) {
        logger.warn(`SSI rotation: ${order.symbol} has no numeric symbolID — skipping`);
        results.push(`SKIP ${order.symbol}: no symbolID`);
        failed++;
        continue;
      }
      const qty = stripTrailingZeros(order.quantity.toFixed(6));
      const batchReq = {
        accountID: this.accountId,
        orders: [{
          symbolID: sym.symbolId,
          clOrdID:  `ssi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          side:     order.side === 'BUY' ? OrderSide.Buy : OrderSide.Sell,
          type:     OrderType.Market,
          timeInForce: TimeInForce.IOC,
          quantity: qty,
        }],
      };

      try {
        const { headers, body } = this.signer.signSpotBatchNewOrder(batchReq);
        const res = await fetch(`${this.base}/spot/trade/orders/batch`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const json = await res.json() as { code?: number; data?: unknown; message?: string };

        if (json.code === 0 || json.code === 200) {
          executed++;
          results.push(`OK ${order.side} ${qty} ${order.symbol}`);
          logger.info(`SSI rotation executed: ${order.side} ${qty} ${order.symbol}`);
        } else {
          failed++;
          results.push(`FAIL ${order.symbol}: ${json.message ?? json.code}`);
          logger.warn(`SSI rotation failed: ${order.symbol}`, { code: json.code, msg: json.message });
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        results.push(`ERROR ${order.symbol}: ${msg}`);
        logger.warn(`SSI rotation error: ${order.symbol}`, { error: msg });
      }

      // Small delay between orders
      await new Promise((r) => setTimeout(r, 200));
    }

    return { success: failed === 0, executed, failed, details: results };
  }

  /**
   * Full rotation workflow: get holdings → compute plan → execute.
   */
  async rotatePortfolio(
    conviction: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR',
  ): Promise<RotationResult> {
    const holdings = await this.getHoldings();

    if (holdings.length === 0) {
      logger.info('SSI rotation: no SSI holdings to rotate');
      return { success: true, executed: 0, failed: 0, details: ['no_holdings'] };
    }

    const plan = this.computeRotation(conviction, holdings);

    if (plan.orders.length === 0) {
      logger.info(`SSI rotation: ${conviction} → no rotation needed`);
      return { success: true, executed: 0, failed: 0, details: ['no_action_needed'] };
    }

    return this.executeRotation(plan);
  }
}
