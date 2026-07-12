#!/usr/bin/env node
/**
 * mcp-mara — MARA's Model Context Protocol server (fixture.md §A, all 8 tools)
 *
 * Makes MARA usable BY other agents — the strongest expression of the
 * "agent-friendly" buildathon theme. Tools 1–7 are read-only and safe to
 * expose broadly; tool 8 (execute_macro_trade) is opt-in via
 * MCP_EXEC_ENABLED=true and requires confirm:true in the call.
 *
 * Transport: stdio (Claude Desktop / Cursor / VS Code).
 * Config (Claude Desktop claude_desktop_config.json):
 *   { "mcpServers": { "mara": {
 *       "command": "npx", "args": ["-y", "mcp-mara"],
 *       "env": { "MARA_API_URL": "https://<your-backend>.onrender.com" } } } }
 * (VS Code uses the "servers" key instead of "mcpServers".)
 *
 * All data comes live from the MARA backend REST API — the same state the
 * dashboard renders, so MCP answers always match the UI (no separate mock).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = (process.env.MARA_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const EXEC_ENABLED = process.env.MCP_EXEC_ENABLED === 'true';

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`MARA API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return res.json() as Promise<T>;
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errResult(err: unknown) {
  return {
    content: [{ type: 'text' as const, text: `MARA error: ${String(err).slice(0, 300)}` }],
    isError: true,
  };
}

const server = new McpServer({ name: 'mcp-mara', version: '1.0.0' });

// ── 1. get_macro_calendar ──────────────────────────────────────────────────────
server.registerTool(
  'get_macro_calendar',
  {
    description:
      'Upcoming and recent macro events (CPI, FOMC, NFP, PCE, PPI…) that MARA tracks from the SoSoValue calendar, with forecast/actual values, surprise scores once fired, and processing status. Also reports whether MARA\'s macro circuit breaker is currently de-risking (a high-impact release is imminent).',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('max events to return (default 15)'),
    },
  },
  async ({ limit }) => {
    try {
      const [events, regime] = await Promise.all([
        get<unknown[]>(`/api/events?limit=${limit ?? 15}`),
        get<{ circuitBreaker?: unknown }>('/api/regime').catch(() => ({ circuitBreaker: null })),
      ]);
      return jsonResult({ events, circuitBreaker: regime.circuitBreaker });
    } catch (e) { return errResult(e); }
  },
);

// ── 2. get_macro_surprise ──────────────────────────────────────────────────────
server.registerTool(
  'get_macro_surprise',
  {
    description:
      'The surprise profile for a macro event type from MARA\'s catalyst corpus: each print\'s actual vs forecast, rolling-window z-score, direction, market regime at the print, and REAL BTC/ETH forward returns (+1d/+3d/+7d/+30d, daily close-to-close). Use event_type one of: CPI, Core CPI, NFP, PCE, PPI, FOMC, Unemployment.',
    inputSchema: {
      event_type: z.string().describe('event type, e.g. "CPI"'),
      date: z.string().optional().describe('specific print date YYYY-MM-DD (optional — else the most recent prints)'),
    },
  },
  async ({ event_type, date }) => {
    try {
      const answer = await get<{ analogs: Array<{ date: string }> }>(
        `/api/corpus?event_type=${encodeURIComponent(event_type)}&limit=30`,
      );
      const analogs = date ? answer.analogs.filter((a) => a.date === date) : answer.analogs.slice(0, 6);
      return jsonResult({ eventType: event_type, prints: analogs });
    } catch (e) { return errResult(e); }
  },
);

// ── 3. query_macro_corpus ──────────────────────────────────────────────────────
server.registerTool(
  'query_macro_corpus',
  {
    description:
      'Query MARA\'s hand-built macro-catalyst corpus for historical analogs: "what did BTC do after similar surprises?" Returns matching prints with forward returns, median moves, and the directional hit-rate at +3d. This is real seeded data from SoSoValue macro history + klines — cite analog dates when you use it.',
    inputSchema: {
      event_type: z.string().optional().describe('CPI | Core CPI | NFP | PCE | PPI | FOMC | Unemployment'),
      direction: z.enum(['above', 'below', 'inline']).optional().describe('surprise direction vs forecast'),
      regime: z.string().optional().describe('BULL_QUIET | BULL_VOLATILE | RANGING | BEAR_VOLATILE | CRASH'),
      min_abs_z: z.number().optional().describe('minimum |surprise z| (e.g. 1.0 for meaningful surprises)'),
      limit: z.number().int().max(50).optional(),
    },
  },
  async (q) => {
    try {
      const qs = new URLSearchParams();
      if (q.event_type) qs.set('event_type', q.event_type);
      if (q.direction) qs.set('direction', q.direction);
      if (q.regime) qs.set('regime', q.regime);
      if (q.min_abs_z !== undefined) qs.set('min_abs_z', String(q.min_abs_z));
      if (q.limit) qs.set('limit', String(q.limit));
      return jsonResult(await get(`/api/corpus?${qs.toString()}`));
    } catch (e) { return errResult(e); }
  },
);

// ── 4. get_mara_conviction ─────────────────────────────────────────────────────
server.registerTool(
  'get_mara_conviction',
  {
    description:
      'MARA\'s most recent AI decisions: conviction (STRONG_BULL…STRONG_BEAR), confidence, full reasoning, the bull/bear/synthesiser debate (with dissent), the agentic tool-call trace that grounded every number, and the resulting action. Includes NO_TRADE decisions with reasons — MARA logs passes as well as trades.',
    inputSchema: {
      limit: z.number().int().min(1).max(20).optional().describe('how many recent decisions (default 3)'),
    },
  },
  async ({ limit }) => {
    try {
      return jsonResult(await get(`/api/decisions?limit=${limit ?? 3}`));
    } catch (e) { return errResult(e); }
  },
);

// ── 5. get_risk_state ──────────────────────────────────────────────────────────
server.registerTool(
  'get_risk_state',
  {
    description:
      'MARA\'s live risk gates: account balance, open positions, drawdown vs high-water mark, kill-switch status, current market regime with regime-conditional sizing multipliers, and the macro circuit breaker (pre-event de-risk window). These hard rules bind regardless of AI conviction.',
    inputSchema: {},
  },
  async () => {
    try {
      const [risk, regime] = await Promise.all([get('/api/risk'), get('/api/regime').catch(() => null)]);
      return jsonResult({ risk, regime });
    } catch (e) { return errResult(e); }
  },
);

// ── 6. get_track_record ────────────────────────────────────────────────────────
server.registerTool(
  'get_track_record',
  {
    description:
      'MARA\'s verifiable track record: every dated thesis with signal ID, HIT/STOP/DRIFT outcome resolution, win rate, cumulative P&L, and the counterfactual equity curve (MARA vs BTC buy-and-hold vs did-nothing). Losses and rejected theses are included — nothing cherry-picked.',
    inputSchema: {
      summary_only: z.boolean().optional().describe('true = stats + counterfactual only, skip individual theses'),
    },
  },
  async ({ summary_only }) => {
    try {
      const report = await get<{ theses: unknown[]; stats: unknown; counterfactual: unknown }>('/api/track');
      return jsonResult(summary_only
        ? { stats: report.stats, counterfactual: report.counterfactual }
        : report);
    } catch (e) { return errResult(e); }
  },
);

// ── 7. simulate_trade (read-only) ──────────────────────────────────────────────
server.registerTool(
  'simulate_trade',
  {
    description:
      'The EXACT SoDEX testnet order MARA would sign right now — symbol, numeric symbolID, quantity from ATR risk sizing × regime multiplier, limit price, stop-loss, take-profit, leverage, and the EIP-712 signing envelope — WITHOUT sending anything. Read-only and safe for any agent to call.',
    inputSchema: {
      side: z.enum(['LONG', 'SHORT']).describe('trade direction to simulate'),
      symbol: z.string().optional().describe('perp symbol (default BTC-USD; also ETH-USD, SOL-USD)'),
    },
  },
  async ({ side, symbol }) => {
    try {
      return jsonResult(await get(`/api/simulate-order?side=${side}&symbol=${encodeURIComponent(symbol ?? 'BTC-USD')}`));
    } catch (e) { return errResult(e); }
  },
);

// ── 8. execute_macro_trade (guarded, opt-in) ───────────────────────────────────
server.registerTool(
  'execute_macro_trade',
  {
    description:
      'GUARDED: triggers a REAL MARA analysis cycle on the live backend — surprise math → agentic AI verdict → risk gates → (if conviction clears the floor) an actual EIP-712-signed order on SoDEX testnet, attested on-chain. Requires the operator to have set MCP_EXEC_ENABLED=true AND confirm:true in this call. Rate-limited server-side.',
    inputSchema: {
      event: z.string().describe('macro event name, e.g. "CPI (YoY)"'),
      actual: z.number().describe('the released actual value'),
      forecast: z.number().describe('the consensus forecast'),
      previous: z.number().optional(),
      confirm: z.literal(true).describe('must be true — human-confirm gate'),
    },
  },
  async ({ event, actual, forecast, previous, confirm }) => {
    if (!EXEC_ENABLED) {
      return errResult('execute_macro_trade is disabled. The MARA operator must set MCP_EXEC_ENABLED=true to allow agent-initiated execution.');
    }
    if (confirm !== true) return errResult('confirm:true is required.');
    try {
      const result = await post('/api/trigger', { event, actual, forecast, previous });
      return jsonResult({
        triggered: true,
        backend: result,
        note: 'The cycle runs asynchronously. Call get_mara_conviction in ~20s for the verdict, and get_track_record for the resulting thesis.',
      });
    } catch (e) { return errResult(e); }
  },
);

// ── boot ───────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`mcp-mara connected (backend: ${API}, exec ${EXEC_ENABLED ? 'ENABLED' : 'disabled'})`);
