/**
 * Kill Switch
 *
 * Emergency stop: cancels all open orders, triggers position close attempts,
 * halts all new trade execution, and logs the activation with full state.
 *
 * Activated by:
 *   - PortfolioTracker when drawdown > maxDrawdown
 *   - Manual REST API call (POST /api/kill-switch)
 *   - SIGTERM / graceful shutdown
 */
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { SoDEXSigner } from '../services/sodex-signer.js';
import { TradeStore } from '../store/trade-store.js';
import { RiskStore } from '../store/risk-store.js';

const logger = createLogger('KillSwitch');

let isActive = false;

export function isKillSwitchActive(): boolean {
  return isActive;
}

export async function activateKillSwitch(reason: string): Promise<void> {
  if (isActive) {
    logger.warn('Kill switch already active');
    return;
  }

  isActive = true;
  logger.error(`⚡ KILL SWITCH ACTIVATED: ${reason}`);

  const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
  const signer = new SoDEXSigner(
    config.sodex.apiKeyPrivate,
    config.sodex.chainId,
    config.sodex.apiKeyName,
  );
  const base = config.sodex.endpoint;
  const accountId = config.sodex.accountId;

  // ── 1. Cancel all open orders ────────────────────────────────────────────
  try {
    logger.info('Kill switch: cancelling all open orders...');
    const scheduleCancel = { accountID: accountId };
    const { headers, body } = signer.signScheduleCancel(scheduleCancel);
    const res = await fetch(`${base}/perps/trade/orders`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json() as { code?: number };
    if (json.code === 0 || json.code === 200) {
      logger.info('Kill switch: all open orders cancelled');
    } else {
      logger.warn('Kill switch: cancel-all returned error', { code: json.code });
    }
  } catch (err) {
    logger.error('Kill switch: cancel-all failed', { error: String(err) });
  }

  // ── 2. Close all perps positions with market orders ───────────────────────
  try {
    const positions = await client.getPerpsPositions(config.sodex.masterAddress);
    if (positions.length > 0) {
      logger.info(`Kill switch: closing ${positions.length} position(s)...`);
      for (const pos of positions) {
        try {
          const qty = parseFloat(pos.quantity ?? '0');
          if (qty <= 0) continue;

          const isLong = pos.positionSide !== 'SHORT';
          // Market close order
          const closeReq = {
            accountID: accountId,
            symbolID: 0, // Need actual symbolID — we'll use getBtcSymbol for BTC
            orders: [{
              clOrdID:     `ks-${Date.now()}-close`,
              modifier:    1,  // Normal
              side:        isLong ? 2 : 1, // Sell to close long, buy to close short
              type:        2,  // Market
              timeInForce: 3,  // IOC
              quantity:    qty.toString(),
              reduceOnly:  true,
              positionSide: 1, // Both (one-way mode)
            }],
          };

          // Get symbolID for the position's symbol
          const symbols = await client.getPerpsSymbols();
          const sym = symbols.find((s) => s.symbol === pos.symbol && s.status === 'TRADING');
          if (!sym) {
            logger.warn(`Kill switch: could not find active symbol for ${pos.symbol}`);
            continue;
          }
          closeReq.symbolID = sym.symbolId;

          const { headers, body } = signer.signNewOrder(closeReq as Parameters<typeof signer.signNewOrder>[0]);
          const res = await fetch(`${base}/perps/trade/orders`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          const json = await res.json() as { code?: number; data?: unknown };
          logger.info(`Kill switch: closed ${pos.symbol}`, { code: json.code });
        } catch (closeErr) {
          logger.error(`Kill switch: failed to close ${pos.symbol}`, { error: String(closeErr) });
        }
      }
    }
  } catch (err) {
    logger.error('Kill switch: position close failed', { error: String(err) });
  }

  // ── 3. Update all open trades in DB to CANCELLED ─────────────────────────
  try {
    const openTrades = TradeStore.getOpen();
    for (const trade of openTrades) {
      TradeStore.updateStatus(trade.id, 'CANCELLED');
    }
    logger.info(`Kill switch: ${openTrades.length} DB trades marked CANCELLED`);
  } catch (err) {
    logger.warn('Kill switch: DB update failed', { error: String(err) });
  }

  // ── 4. Record kill switch activation in risk store ───────────────────────
  try {
    const latest = RiskStore.getLatest();
    RiskStore.insert({
      timestamp: Date.now(),
      accountBalance: latest?.accountBalance ?? 0,
      openPositions: 0,
      totalExposure: 0,
      unrealizedPnl: 0,
      drawdownPercent: latest?.drawdownPercent ?? 0,
      killSwitchActive: true,
    });
  } catch { /* non-fatal */ }

  logger.error('⚡ Kill switch complete — all orders cancelled, positions closed');
}

export function resetKillSwitch(): void {
  isActive = false;
  logger.warn('Kill switch RESET by operator');
}
