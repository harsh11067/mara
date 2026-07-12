/**
 * MARA — Macro-Aware Research & Execution Agent
 * Entry point — full pipeline wired up through Day 4
 */
import 'dotenv/config';
import { config } from './config.js';
import { createLogger } from './utils/logger.js';
import { appEvents } from './utils/event-emitter.js';
import { getDb } from './store/db.js';
import { SoSoValueClient } from './services/sosovalue-client.js';
import { CronManager } from './scheduler/cron-manager.js';
import { EventReconciler } from './scheduler/event-reconciler.js';
import { Analyzer } from './ai/analyzer.js';
import { EventStore } from './store/event-store.js';
import { OrderExecutor } from './executor/order-executor.js';
import { SoDEXClient } from './services/sodex-client.js';
import { checkRiskLimits } from './risk/risk-limits.js';
import { PortfolioTracker } from './risk/portfolio-tracker.js';
import { SSIManager } from './services/ssi-manager.js';
import { activateKillSwitch, isKillSwitchActive } from './executor/kill-switch.js';
import { startApiServer, broadcast } from './api/server.js';
import { sodexWsClient } from './services/sodex-ws-client.js';
import { attestationService } from './services/attestation-service.js';
import { restoreFromNeon, startReplicator, stopReplicator } from './store/db-replicator.js';

const logger = createLogger('MARA');

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  MARA — Macro-Aware Research & Execution Agent   ');
  logger.info('  Powered by SoSoValue + SoDEX + Gemini AI         ');
  logger.info('═══════════════════════════════════════════════════');
  logger.info(`  Mode:     ${config.nodeEnv}`);
  logger.info(`  ChainID:  ${config.sodex.chainId} (${config.sodex.chainId === 138565 ? 'TESTNET' : 'MAINNET'})`);
  logger.info(`  Endpoint: ${config.sodex.endpoint}\n`);

  // ── 1. Initialize database ─────────────────────────────────────────────────
  // Restore the newest Neon snapshot BEFORE the DB is first opened — this is
  // what makes the track record survive Render's ephemeral filesystem.
  await restoreFromNeon();
  getDb(); // triggers schema migrations
  startReplicator();

  // ── 2. Init services ───────────────────────────────────────────────────────
  const sosoClient = new SoSoValueClient(config.sosovalue.apiKey, config.sosovalue.baseUrl);
  const sodexClient = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
  const analyzer = new Analyzer();
  const executor = new OrderExecutor();
  const ssiManager = new SSIManager();
  const portfolioTracker = new PortfolioTracker();
  const cronManager = new CronManager(sosoClient);

  // ── 3. Init event reconciler ───────────────────────────────────────────────
  const reconciler = new EventReconciler();

  // ── 4. Kill switch listener ────────────────────────────────────────────────
  appEvents.on('KILL_SWITCH_ACTIVATED', async (e) => {
    logger.error(`\n⚡ KILL SWITCH: ${e.reason} (drawdown=${e.drawdown.toFixed(1)}%)`);
    await activateKillSwitch(e.reason);
    cronManager.stop();  // halt new event detection
    portfolioTracker.stop();
  });

  // ── 5. Full analysis + execution pipeline ─────────────────────────────────
  appEvents.on('EVENT_FIRED', async (e) => {
    logger.info(`\n${'─'.repeat(62)}`);
    logger.info(`🚨 EVENT FIRED: ${e.eventName}`, {
      actual: e.actual,
      forecast: e.forecast,
      source: e.source,
      confidence: e.confidence,
    });

    if (e.actual === null || e.forecast === null) {
      logger.warn(`Missing actual/forecast for ${e.eventName} — skipping`);
      return;
    }

    if (isKillSwitchActive()) {
      logger.warn('Kill switch active — skipping trade execution');
      return;
    }

    try {
      // ── Analysis ──────────────────────────────────────────────────────────
      const { surprise, market, decision, perpAsset } = await analyzer.analyze({
        eventName: e.eventName,
        actual: e.actual,
        forecast: e.forecast,
        previous: e.previous,
        eventId: e.eventId,
      });

      EventStore.updateStatus(e.eventId, 'PROCESSED', {
        actual: e.actual,
        surpriseScore: surprise.surpriseScore,
        cryptoBias: surprise.cryptoBias,
      });

      logger.info(`📊 ANALYSIS: ${decision.conviction} (${decision.confidence}%) → ${decision.action}`, {
        surprise: surprise.surpriseScore.toFixed(2) + 'σ',
        direction: surprise.surpriseDirection,
        cryptoBias: surprise.cryptoBias,
        reasoning: decision.reasoning.slice(0, 100),
      });

      // Emit decision event for dashboard
      await appEvents.emit('TRADE_DECISION', {
        decisionId:  decision.id,
        eventName:   e.eventName,
        conviction:  decision.conviction,
        confidence:  decision.confidence,
        action:      decision.action,
        timestamp:   Date.now(),
      });

      if (decision.action === 'NO_TRADE') {
        logger.info(`⏭️  NO TRADE: ${decision.noTradeReason}`);
        return;
      }

      // ── Risk check ────────────────────────────────────────────────────────
      const balance = await sodexClient.getPerpsBalances(config.sodex.masterAddress);
      const avail   = parseFloat(balance.availableBalance);

      // Quick orderbook liquidity check (on the matched perp asset)
      const ob = await sodexClient.getPerpsOrderbook(perpAsset).catch(() => null);
      const depthUsd = ob
        ? sodexClient.calcOrderbookDepthUsd(ob.bids, 5)
          + sodexClient.calcOrderbookDepthUsd(ob.asks, 5)
        : undefined;

      const riskCheck = await checkRiskLimits({
        availableBalance: avail,
        orderbookDepthUsd: depthUsd,
        atr14: market.atr14,
      });

      if (!riskCheck.allowed) {
        logger.warn(`🚫 RISK BLOCKED: ${riskCheck.reason}`);
        return;
      }

      // ── Execute perps trade (dynamically matched asset) ───────────────────
      logger.info(`🔄 Executing ${decision.action} trade on ${perpAsset}...`);
      const result = await executor.execute(decision, perpAsset);

      if (result.success) {
        logger.info(`✅ TRADE EXECUTED: orderID=${result.orderId} clOrdID=${result.clOrdID}`, {
          side:       decision.action,
          price:      result.spec?.price,
          quantity:   result.spec?.quantity,
          stopLoss:   result.spec?.stopLoss,
          takeProfit: result.spec?.takeProfit,
        });

        await appEvents.emit('TRADE_EXECUTED', {
          tradeId:    result.tradeId ?? '',
          decisionId: decision.id,
          symbol:     perpAsset,
          side:       decision.action,
          entryPrice: result.spec?.price ?? 0,
          quantity:   result.spec?.quantity ?? 0,
          timestamp:  Date.now(),
        });

        // ── SSI Portfolio Rotation ─────────────────────────────────────────
        logger.info('🔄 Computing SSI portfolio rotation...');
        const conviction = decision.conviction as
          'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';

        const ssiResult = await ssiManager.rotatePortfolio(conviction).catch((err) => {
          logger.warn('SSI rotation failed (non-fatal)', { error: String(err) });
          return { success: false, executed: 0, failed: 0, details: ['error'] };
        });

        if (ssiResult.executed > 0) {
          logger.info(`✅ SSI rotation: ${ssiResult.executed} orders executed`);
        } else {
          logger.info(`ℹ️  SSI rotation: ${ssiResult.details.join(', ')}`);
        }

      } else {
        logger.error(`❌ TRADE FAILED: ${result.error}`);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Pipeline error for ${e.eventName}: ${msg}`);
    }
  });

  // ── 5b. Live position/order/balance feed (SoDEX WebSocket) ─────────────────
  // Sub-second push updates replace REST polling for position changes. Forward
  // them straight to the dashboard so the Risk panel reflects fills instantly.
  appEvents.on('WS_POSITION_UPDATE', (p) => {
    logger.debug('WS position', { symbol: p.symbol, pnl: p.unrealizedPnl });
    broadcast('position', p);
  });
  appEvents.on('WS_ORDER_UPDATE', (o) => {
    if (o.status === 'FILLED') logger.info(`WS order FILLED: ${o.orderId} @ ${o.avgPrice}`);
    broadcast('order', o);
  });
  appEvents.on('WS_BALANCE_UPDATE', (b) => {
    broadcast('balance', b);
  });

  // ── 6. Start all services ──────────────────────────────────────────────────
  startApiServer();          // REST API + WebSocket on config.port (3001)
  portfolioTracker.start();
  cronManager.start();
  sodexWsClient.start();     // live SoDEX position/order/balance feed

  // Log the on-chain attestation status so it's obvious at boot.
  if (config.attestation.contractAddress && config.attestation.identityCoherent) {
    logger.info(`⛓  Attestation ON — contract ${config.attestation.contractAddress} operated by ${config.attestation.expectedOperator}`);
  } else if (config.attestation.usingSyntheticIdentity) {
    logger.error('⛓  Attestation OFF — operator key is the Hardhat default. Fix the operator identity (see IDENTITY.md).');
  } else {
    logger.warn('⛓  Attestation OFF — set MARA_CONTRACT_ADDRESS + VALUECHAIN_RPC to enable the on-chain audit trail.');
  }

  logger.info('🟢 MARA is live. Watching the macro calendar...');
  logger.info(`   Risk limits: max ${config.risk.maxRiskPerTrade * 100}% per trade,`
    + ` max ${config.risk.maxOpenPositions} positions,`
    + ` max ${config.risk.maxDrawdown * 100}% drawdown\n`);

  // ── 7. Graceful shutdown ───────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`\n${signal} received — shutting down MARA...`);
    cronManager.stop();
    portfolioTracker.stop();
    sodexWsClient.stop();
    attestationService.stop();  // flushes any pending attestations
    await stopReplicator();     // final Neon snapshot push
    logger.info('MARA stopped.');
    process.exit(0);
  };

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // ── 8. Expose globals for REST API (Day 5) ────────────────────────────────
  const g = globalThis as Record<string, unknown>;
  g.__reconciler      = reconciler;
  g.__portfolioTracker = portfolioTracker;
  g.__executor        = executor;
  g.__ssiManager      = ssiManager;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
