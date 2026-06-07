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

// Wire appEvents → WS broadcast
function wireEvents(): void {
  appEvents.on('TRADE_DECISION', (e) => broadcast('decision', e));
  appEvents.on('TRADE_EXECUTED', (e) => broadcast('trade', e));
  appEvents.on('RISK_SNAPSHOT', (e) => broadcast('risk', e));
  appEvents.on('EVENT_FIRED', (e) => broadcast('event_fired', e));
  appEvents.on('KILL_SWITCH_ACTIVATED', (e) =>
    broadcast('status', { killSwitch: true, reason: e.reason }),
  );
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

// ── POST /api/trigger ──────────────────────────────────────────────────────────
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

  // Fire async — don't await so we return immediately
  const analyzer = new Analyzer();
  analyzer
    .analyze({
      eventName: body.event,
      actual: body.actual,
      forecast: body.forecast,
      previous: body.previous ?? null,
    })
    .then(({ decision, market }) => {
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
