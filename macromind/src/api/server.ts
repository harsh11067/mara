/**
 * MARA REST API + WebSocket server (Hono + ws)
 * Port: config.port (default 3001)
 *
 * REST:
 *   GET  /api/status
 *   GET  /api/events
 *   GET  /api/decisions
 *   GET  /api/trades
 *   GET  /api/risk
 *   GET  /api/performance
 *   POST /api/trigger
 *   POST /api/kill-switch
 *   POST /api/kill-switch/reset
 *
 * WebSocket: ws://localhost:3001/ws
 *   Broadcasts: { type, data, ts }
 *   Types: init | decision | trade | risk | status | event_fired
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'fs';
import { join } from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { EventStore } from '../store/event-store.js';
import { DecisionStore } from '../store/decision-store.js';
import { TradeStore } from '../store/trade-store.js';
import { RiskStore } from '../store/risk-store.js';
import { appEvents } from '../utils/event-emitter.js';
import { isKillSwitchActive, activateKillSwitch, resetKillSwitch } from '../executor/kill-switch.js';
import { Analyzer } from '../ai/analyzer.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { SoSoValueClient } from '../services/sosovalue-client.js';
import { attestationService } from '../services/attestation-service.js';
import { runDiag } from './diag.js';
import { buildTrackRecord } from '../track/track-record.js';
import { runBacktest } from '../backtest/backtest.js';
import { seedCorpus, queryCorpus, corpusStats } from '../corpus/corpus.js';
import { classifyRegime } from '../risk/regime.js';
import { getCircuitBreakerState } from '../risk/circuit-breaker.js';
import { SSIManager } from '../services/ssi-manager.js';
import { getDb } from '../store/db.js';
import { globalCache } from '../utils/ttl-cache.js';
import { broadcastTrade, broadcastKillSwitch, broadcastDecision } from '../services/telegram.js';
import { BTC_CURRENCY_ID } from '../services/sosovalue-client.js';

const logger = createLogger('API');

// ── WebSocket client registry ──────────────────────────────────────────────────
const wsClients = new Set<WebSocket>();

export function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch { /* ignore broken pipes */ }
    }
  }
}

// Wire appEvents → WS broadcast (+ Telegram distribution)
function wireEvents(): void {
  appEvents.on('TRADE_DECISION', (e) => broadcast('decision', e));
  appEvents.on('TRADE_EXECUTED', (e) => {
    broadcast('trade', e);
    void broadcastTrade({ symbol: e.symbol, side: e.side, entryPrice: e.entryPrice, quantity: e.quantity });
  });
  appEvents.on('RISK_SNAPSHOT', (e) => broadcast('risk', e));
  appEvents.on('EVENT_FIRED', (e) => broadcast('event_fired', e));
  appEvents.on('AGENT_TRACE', (e) => broadcast('agent_trace', e));
  appEvents.on('KILL_SWITCH_ACTIVATED', (e) => {
    broadcast('status', { killSwitch: true, reason: e.reason });
    void broadcastKillSwitch(e.reason);
  });
}

// ── Hono app ───────────────────────────────────────────────────────────────────
const app = new Hono();
app.use('*', cors({ origin: '*' }));

// ── GET /api/status ────────────────────────────────────────────────────────────
app.get('/api/status', (c) =>
  c.json({
    running: true,
    killSwitch: isKillSwitchActive(),
    uptime: Math.round(process.uptime()),
    timestamp: Date.now(),
  }),
);

// ── GET /api/events ────────────────────────────────────────────────────────────
app.get('/api/events', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100);
  return c.json(EventStore.getRecent(limit));
});

// ── GET /api/decisions ─────────────────────────────────────────────────────────
app.get('/api/decisions', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100);
  return c.json(DecisionStore.getRecent(limit));
});

// ── GET /api/trades ────────────────────────────────────────────────────────────
app.get('/api/trades', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100);
  return c.json(TradeStore.getRecent(limit));
});

// ── GET /api/risk ──────────────────────────────────────────────────────────────
app.get('/api/risk', async (c) => {
  const snapshot = RiskStore.getLatest();
  const hwm = RiskStore.getHighWatermark();
  const openCount = TradeStore.countOpen();
  const allTrades = TradeStore.getRecent(1000);
  const closed = allTrades.filter((t) => t.status !== 'OPEN' && t.status !== 'CANCELLED');
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;

  // Live balance from SoDEX (best-effort)
  let liveBalance: number | null = snapshot?.accountBalance ?? null;
  try {
    const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    const bal = await client.getPerpsBalances(config.sodex.masterAddress);
    liveBalance = parseFloat(bal.availableBalance);
  } catch { /* non-fatal */ }

  return c.json({
    ...snapshot,
    liveBalance,
    highWatermark: hwm,
    killSwitchActive: isKillSwitchActive(),
    cumulativePnl: TradeStore.getCumulativePnl(),
    openPositions: openCount,
    totalTrades: allTrades.length,
    winRate,
  });
});

// ── GET /api/news ──────────────────────────────────────────────────────────────
let _newsCache: { data: unknown[]; ts: number } | null = null;
app.get('/api/news', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '8'), 20);
  if (_newsCache && Date.now() - _newsCache.ts < 60_000) {
    return c.json(_newsCache.data.slice(0, limit));
  }
  try {
    const client = new SoSoValueClient(config.sosovalue.apiKey);
    const news = await client.getLatestNews({ pageSize: limit });
    _newsCache = { data: news, ts: Date.now() };
    return c.json(news.slice(0, limit));
  } catch {
    return c.json((_newsCache?.data ?? []).slice(0, limit));
  }
});

// ── GET /api/performance ───────────────────────────────────────────────────────
app.get('/api/performance', (c) => {
  const trades = TradeStore.getRecent(1000).reverse();
  let cumPnl = 0;
  const series = trades.map((t) => {
    cumPnl += t.pnl ?? 0;
    return {
      ts: t.openedAt ?? 0,
      pnl: parseFloat(cumPnl.toFixed(2)),
      tradeId: t.id.slice(0, 8),
      side: t.side,
    };
  });
  return c.json(series);
});

// ── POST /api/trigger — judge-triggerable live cycle (rate-limited) ────────────
let _lastTriggerAt = 0;
const TRIGGER_COOLDOWN_MS = 20_000; // fixture.md §5: server-side cooldown, keys stay server-side
app.post('/api/trigger', async (c) => {
  type TriggerBody = { event?: string; actual?: number; forecast?: number; previous?: number };
  let body: TriggerBody;
  try {
    body = await c.req.json() as TriggerBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.event || body.actual === undefined || body.forecast === undefined) {
    return c.json({ error: 'event, actual, and forecast are required' }, 400);
  }

  if (isKillSwitchActive()) {
    return c.json({ error: 'Kill switch is active — reset before triggering' }, 403);
  }

  const sinceLast = Date.now() - _lastTriggerAt;
  if (sinceLast < TRIGGER_COOLDOWN_MS) {
    return c.json({
      error: `Live cycle already running — retry in ${Math.ceil((TRIGGER_COOLDOWN_MS - sinceLast) / 1000)}s (global cooldown protects API budgets)`,
    }, 429);
  }
  _lastTriggerAt = Date.now();

  // Fire async — don't await so we return immediately
  const analyzer = new Analyzer();
  analyzer
    .analyze({
      eventName: body.event,
      actual: body.actual,
      forecast: body.forecast,
      previous: body.previous ?? null,
    })
    .then(({ decision, market, surprise }) => {
      broadcast('decision', {
        decisionId: decision.id,
        eventName: body.event,
        conviction: decision.conviction,
        confidence: decision.confidence,
        action: decision.action,
        reasoning: decision.reasoning,
        btcPrice: market.btcPrice,
        timestamp: Date.now(),
      });
      void broadcastDecision({
        eventName: body.event as string,
        conviction: decision.conviction,
        confidence: decision.confidence,
        action: decision.action,
        reasoning: decision.reasoning,
        surpriseScore: surprise.surpriseScore,
        signalId: decision.id,
      });
      logger.info(`Manual trigger complete: ${decision.conviction} (${decision.confidence}%)`);
    })
    .catch((err) => logger.error('Manual trigger error', { error: String(err) }));

  return c.json({
    ok: true,
    message: `Analysis started for ${body.event} — result will appear in Agent Feed`,
  });
});

// ── GET /api/attestation ───────────────────────────────────────────────────────
app.get('/api/attestation', async (c) => {
  const summary = await attestationService.getOnChainSummary();
  return c.json(summary);
});

// ── POST /api/kill-switch ──────────────────────────────────────────────────────
app.post('/api/kill-switch', async (c) => {
  await activateKillSwitch('Manual via dashboard API');
  broadcast('status', { killSwitch: true, reason: 'manual' });
  // Mirror on-chain asynchronously
  void attestationService.attestKillSwitch('manual_dashboard', TradeStore.countOpen());
  return c.json({ ok: true, message: 'Kill switch activated' });
});

// ── POST /api/kill-switch/reset ────────────────────────────────────────────────
app.post('/api/kill-switch/reset', (c) => {
  resetKillSwitch();
  broadcast('status', { killSwitch: false });
  void attestationService.attestKillSwitchReset();
  return c.json({ ok: true, message: 'Kill switch reset' });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  WAVE 3 SURFACES — /healthz, /api/diag, /api/markets, /api/ssi,
//  /api/performance/summary, /api/track, /api/corpus, /api/backtest, /api/regime
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /healthz — keep-alive target (UptimeRobot / GitHub Actions cron) ──────
app.get('/healthz', (c) =>
  c.json({ ok: true, uptime: Math.round(process.uptime()), ts: Date.now() }),
);

// ── GET /api/diag — live integration status (proves nothing is mocked) ────────
app.get('/api/diag', async (c) => {
  const report = await runDiag();
  return c.json(report);
});

// ── GET /api/markets — REAL BTC/ETH/SOL tickers (replaces the random-walk mock)
app.get('/api/markets', async (c) => {
  try {
    const data = await globalCache.wrap('markets:tickers', 10_000, async () => {
      const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
      const tickers = await client.getPerpsTickers();
      const pick = (sym: string) => {
        const t = tickers.find((x) => x.symbol === sym) ?? tickers.find((x) => x.symbol.startsWith(sym.split('-')[0]));
        if (!t) return null;
        return {
          symbol: sym,
          price: parseFloat(t.lastPrice),
          changePct: t.priceChange24h != null ? parseFloat(t.priceChange24h) : null,
          source: 'sodex_testnet_live',
        };
      };
      return {
        markets: [pick('BTC-USD'), pick('ETH-USD'), pick('SOL-USD')].filter(Boolean),
        fetchedAt: Date.now(),
      };
    });
    return c.json(data);
  } catch (err) {
    return c.json({ markets: [], error: String(err).slice(0, 120), fetchedAt: Date.now() }, 503);
  }
});

// ── GET /api/ssi — REAL SSI holdings + rotation history (replaces mock panel) ─
app.get('/api/ssi', async (c) => {
  const data = await globalCache.wrap('ssi:state', 30_000, async () => {
    let holdings: Array<{ symbol: string; balance: number; index: string; type: string }> = [];
    let holdingsError: string | null = null;
    try {
      const mgr = new SSIManager();
      holdings = await mgr.getHoldings();
    } catch (err) {
      holdingsError = String(err).slice(0, 120);
    }
    let rotations: unknown[] = [];
    try {
      rotations = getDb().prepare(
        'SELECT id, decision_id, direction, plan_json, executed, result_json, created_at FROM ssi_rotations ORDER BY created_at DESC LIMIT 20',
      ).all();
    } catch { /* table exists via migrations */ }
    return { holdings, holdingsError, rotations, fetchedAt: Date.now() };
  });
  return c.json(data);
});

// ── GET /api/performance/summary — REAL stats from the trades table ───────────
app.get('/api/performance/summary', (c) => {
  const trades = TradeStore.getRecent(1000);
  const closed = trades.filter((t) => t.status !== 'OPEN' && t.status !== 'CANCELLED' && t.pnl != null);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) < 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

  // per-trade returns for Sharpe/Sortino (pnlPercent when available)
  const rets = closed.map((t) => (t.pnlPercent ?? 0) / 100).filter((r) => Number.isFinite(r));
  const meanRet = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (rets.length - 1)) : 0;
  const downside = rets.filter((r) => r < 0);
  const dsd = downside.length > 1 ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length) : 0;

  // equity series from realized pnl
  let cum = 0;
  const equity = [...closed].reverse().map((t) => {
    cum += t.pnl ?? 0;
    return { ts: t.closedAt ?? t.openedAt ?? 0, value: Math.round(cum * 100) / 100 };
  });

  return c.json({
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: TradeStore.countOpen(),
    winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : null,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    sharpe: sd > 0 ? Math.round((meanRet / sd) * Math.sqrt(52) * 100) / 100 : null,
    sortino: dsd > 0 ? Math.round((meanRet / dsd) * Math.sqrt(52) * 100) / 100 : null,
    cumulativePnl: Math.round(TradeStore.getCumulativePnl() * 100) / 100,
    equity,
    note: 'Computed from real executed trades only. Empty portfolio reports zeros — never fabricated.',
    generatedAt: Date.now(),
  });
});

// ── GET /api/track — verifiable track record (HIT/STOP/DRIFT + counterfactual)
app.get('/api/track', async (c) => {
  const report = await globalCache.wrap('track:report', 30_000, () => buildTrackRecord());
  return c.json(report);
});

// ── Corpus: query + stats + seed ───────────────────────────────────────────────
app.get('/api/corpus', (c) => {
  const q = c.req.query();
  try {
    const answer = queryCorpus({
      eventType: q.event_type || undefined,
      direction: (q.direction as 'above' | 'below' | 'inline') || undefined,
      regime: q.regime || undefined,
      minAbsZ: q.min_abs_z ? parseFloat(q.min_abs_z) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
    });
    return c.json({ ...answer, stats: corpusStats() });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 160) }, 500);
  }
});

let _lastSeedAt = 0;
app.post('/api/corpus/seed', async (c) => {
  if (Date.now() - _lastSeedAt < 5 * 60_000) {
    return c.json({ error: 'Corpus was seeded recently — try again in a few minutes (20 req/min API budget)' }, 429);
  }
  _lastSeedAt = Date.now();
  try {
    const result = await seedCorpus();
    globalCache.set('diag:full', undefined as never, 0); // bust diag cache
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err).slice(0, 200) }, 500);
  }
});

// ── GET /api/backtest — macro-surprise strategy vs buy-and-hold ────────────────
app.get('/api/backtest', (c) => {
  const report = globalCache.get<ReturnType<typeof runBacktest>>('backtest:report')
    ?? globalCache.set('backtest:report', runBacktest(), 60_000);
  return c.json(report);
});

// ── GET /api/regime — current regime + circuit breaker ────────────────────────
app.get('/api/regime', async (c) => {
  try {
    const data = await globalCache.wrap('regime:current', 5 * 60_000, async () => {
      const soso = new SoSoValueClient(config.sosovalue.apiKey);
      const klines = await soso.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 30 });
      return classifyRegime(klines);
    });
    return c.json({ ...data, circuitBreaker: getCircuitBreakerState() });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 120), circuitBreaker: getCircuitBreakerState() }, 503);
  }
});

// ── GET /api/simulate-order — the EXACT order MARA would sign, without sending
//    (read-only MCP tool surface; safe for any agent to call)
app.get('/api/simulate-order', async (c) => {
  const side = (c.req.query('side') ?? 'LONG').toUpperCase() as 'LONG' | 'SHORT';
  const symbol = c.req.query('symbol') ?? 'BTC-USD';
  if (side !== 'LONG' && side !== 'SHORT') return c.json({ error: 'side must be LONG or SHORT' }, 400);
  try {
    const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    const [symbols, ticker, klines, balance] = await Promise.all([
      client.getPerpsSymbols(),
      client.getPerpsTicker(symbol),
      client.getPerpsKlines(symbol),
      client.getPerpsBalances(config.sodex.masterAddress).catch(() => null),
    ]);
    const sym = symbols.find((s) => s.symbol === symbol);
    if (!sym || !ticker) return c.json({ error: `${symbol} not tradable on SoDEX testnet` }, 404);
    const markPrice = parseFloat(ticker.lastPrice);
    const atr14 = client.calcATR(klines);
    const regime = classifyRegime(klines);
    const breaker = getCircuitBreakerState();
    const availableUsdc = balance ? parseFloat(balance.availableBalance) : 0;

    const { calcPositionSize } = await import('../executor/order-builder.js');
    const sizing = calcPositionSize({
      balance: availableUsdc > 0 ? availableUsdc : 1000, // simulate with $1k if unfunded
      atr14: atr14 > 0 ? atr14 : markPrice * 0.015,
      markPrice,
      symbolId: sym.symbolId,
      tickSize: sym.tickSize,
      stepSize: sym.stepSize,
      sizeMultiplier: regime.risk.sizeMultiplier * (breaker.active ? breaker.sizeMultiplier : 1),
      stopMultiplier: regime.risk.stopMultiplier,
    });
    const isLong = side === 'LONG';
    return c.json({
      simulated: true,
      wouldSign: {
        venue: 'SoDEX perps (testnet, chainId 138565)',
        symbol, symbolId: sym.symbolId, side,
        type: 'LIMIT (resting GTC — lands on-chain even on a thin book)',
        quantity: sizing.quantity,
        limitPrice: markPrice,
        stopLoss: isLong ? markPrice - sizing.stopLossDistance : markPrice + sizing.stopLossDistance,
        takeProfit: isLong
          ? markPrice + sizing.stopLossDistance * config.risk.takeProfitAtrMultiplier / config.risk.stopLossAtrMultiplier
          : markPrice - sizing.stopLossDistance * config.risk.takeProfitAtrMultiplier / config.risk.stopLossAtrMultiplier,
        leverage: sizing.leverage,
        signing: 'EIP-712 ExchangeAction{payloadHash,nonce}, domain "futures", 0x01-prefixed signature',
      },
      inputs: {
        balanceUsdc: availableUsdc, balanceSimulated: availableUsdc <= 0,
        atr14, markPrice, regime: regime.regime,
        sizeMultiplier: regime.risk.sizeMultiplier,
        circuitBreaker: breaker.active ? breaker.reason : 'inactive',
      },
      generatedAt: Date.now(),
    });
  } catch (err) {
    return c.json({ error: String(err).slice(0, 160) }, 503);
  }
});

// ── Static dashboard hosting (single-origin deploy) ───────────────────────────
// When the dashboard build exists (Render buildCommand builds it), serve it from
// this same server: no CORS, same-origin WS, one public URL. Registered after all
// /api routes so the API always wins. Local dev (Vite on :3000) is unaffected.
const DASHBOARD_DIST = '../mara-macro-dashboard/dist';
if (existsSync(join(process.cwd(), DASHBOARD_DIST, 'index.html'))) {
  app.use('/*', serveStatic({ root: DASHBOARD_DIST }));
  // SPA fallback: any non-API, non-asset route → index.html (react-router)
  app.get('*', serveStatic({ path: join(DASHBOARD_DIST, 'index.html') }));
  logger.info(`Serving dashboard from ${DASHBOARD_DIST} (single-origin mode)`);
}

// ── Start server ───────────────────────────────────────────────────────────────
export function startApiServer(): void {
  const httpServer = serve(
    { fetch: app.fetch, port: config.port },
    (info) => logger.info(`🌐 API server → http://localhost:${info.port}`),
  ) as Server;

  // Attach WebSocket server to same HTTP port
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    // Only accept /ws path
    if (req.url && !req.url.startsWith('/ws')) {
      ws.close(1008, 'Wrong path');
      return;
    }

    wsClients.add(ws);
    logger.debug(`WS client connected (total=${wsClients.size})`);

    // Send initial state snapshot
    try {
      ws.send(
        JSON.stringify({
          type: 'init',
          data: {
            killSwitch: isKillSwitchActive(),
            decisions: DecisionStore.getRecent(5),
            trades: TradeStore.getRecent(5),
            risk: RiskStore.getLatest(),
          },
          ts: Date.now(),
        }),
      );
    } catch { /* ignore */ }

    ws.on('close', () => {
      wsClients.delete(ws);
      logger.debug(`WS client disconnected (total=${wsClients.size})`);
    });

    ws.on('error', (err) => logger.warn('WS error', { error: String(err) }));

    // Heartbeat pong
    ws.on('ping', () => ws.pong());
  });

  wireEvents();
  logger.info(`🔌 WebSocket ready → ws://localhost:${config.port}/ws`);
}
