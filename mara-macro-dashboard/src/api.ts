/**
 * MARA API client — bridges mara-macro-dashboard to the Hono backend on port 3001.
 *
 * All fetch calls use relative paths so Vite's proxy (/api → localhost:3001) handles routing.
 * Also provides type mappers: backend StoredDecision/StoredTrade/StoredEvent → frontend types.
 */

import type {
  MacroEvent, AiReasoning, SsiHolding, RotationLog, DirectionType, Trade,
} from './types';

// ── Raw backend shapes (minimal — only what we need) ────────────────────────

export interface BackendDecision {
  id: string;
  eventId: string | null;
  timestamp: number;
  conviction: DirectionType;
  confidence: number;
  reasoning: string;
  action: 'LONG' | 'SHORT' | 'NO_TRADE';
  noTradeReason: string | null;
  newsContext: string[] | null;
  marketContext: { btcPrice?: number; atr14?: number; surpriseScore?: number; [k: string]: unknown } | null;
  createdAt: number;
}

export interface BackendEvent {
  id: string;
  name: string;
  date: string;           // ISO date string e.g. "2026-05-28"
  status: 'UPCOMING' | 'WATCHING' | 'FIRED' | 'PROCESSED';
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surpriseScore: number | null;
  cryptoBias: 'bullish' | 'bearish' | 'neutral' | null;
  createdAt: number;
  updatedAt: number;
}

export interface BackendTrade {
  id: string;
  decisionId: string | null;
  sodexOrderId: string | null;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number | null;
  quantity: number | null;
  leverage: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  status: 'OPEN' | 'CLOSED' | 'STOPPED' | 'TAKEN_PROFIT' | 'CANCELLED';
  exitPrice: number | null;
  pnl: number | null;
  pnlPercent: number | null;
  openedAt: number | null;
  closedAt: number | null;
}

export interface BackendRisk {
  accountBalance: number;
  openPositions: number;
  totalExposure: number;
  unrealizedPnl: number;
  drawdownPercent: number;
  killSwitchActive: boolean;
  liveBalance: number | null;
  highWatermark: number;
  cumulativePnl: number;
  totalTrades: number;
  winRate: number;
  /** Real configured limits served by the backend — never hardcoded client-side */
  limits?: {
    maxOpenPositions: number;
    maxDailyTrades: number;
    maxDrawdownPct: number;
    maxLeverage: number;
    maxRiskPerTradePct: number;
  };
}

export interface BackendStatus {
  running: boolean;
  killSwitch: boolean;
  uptime: number;
}

export interface BackendNewsItem {
  id: string;
  title: string;
  releaseTime: number;
  publishTime: number;
  matchedCurrencies: string[];
  tags: string[];
  source?: string;
}

// ── Fetch helper ────────────────────────────────────────────────────────────

/**
 * Production base URL (Vercel → Render): set VITE_API_URL to the backend origin
 * (e.g. https://mara-backend.onrender.com). Locally it stays empty and the
 * Vite proxy handles /api + /ws.
 */
export const API_BASE: string = (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Session token for authenticated calls (accounts + credits + duels). */
const TOKEN_KEY = 'mara_session';
export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(15000),
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** POST helper — always goes through API_BASE (the bare-fetch version broke on Vercel). */
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return res.json() as Promise<T>;
}

// ── API calls ────────────────────────────────────────────────────────────────

export interface BackendMarkets {
  markets: Array<{ symbol: string; price: number; changePct: number | null; source: string }>;
  fetchedAt: number;
}

export interface BackendPerformanceSummary {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  sharpe: number | null;
  sortino: number | null;
  cumulativePnl: number;
  equity: Array<{ ts: number; value: number }>;
  note: string;
}

export interface BackendSsi {
  holdings: Array<{ symbol: string; balance: number; index: string; type: string }>;
  holdingsError: string | null;
  rotations: Array<{ id: string; decision_id: string | null; direction: string; plan_json: string; executed: number; result_json: string | null; created_at: number }>;
  fetchedAt: number;
}

export interface DiagCheck {
  name: string; label: string; ok: boolean;
  latencyMs: number | null; detail: string; lastValue?: unknown;
}

export interface BackendDiag {
  overall: 'green' | 'degraded' | 'red';
  checks: DiagCheck[];
  endpointRegistry: {
    total: number;
    byModule: Record<string, number>;
    probedLive: Array<{ path: string; ok: boolean; latencyMs: number }>;
  };
  circuitBreaker: { active: boolean; reason: string | null };
  corpus: { rows: number; byEvent?: Record<string, number> };
  generatedAt: number;
}

export const api = {
  status:      () => fetchJson<BackendStatus>('/api/status'),
  events:      () => fetchJson<BackendEvent[]>('/api/events?limit=20'),
  decisions:   () => fetchJson<BackendDecision[]>('/api/decisions?limit=20'),
  trades:      () => fetchJson<BackendTrade[]>('/api/trades?limit=20'),
  risk:        () => fetchJson<BackendRisk>('/api/risk'),
  performance: () => fetchJson<{ts:number;pnl:number}[]>('/api/performance'),
  news:        () => fetchJson<BackendNewsItem[]>('/api/news?limit=8'),
  // Wave 3 real-engine surfaces
  markets:     () => fetchJson<BackendMarkets>('/api/markets'),
  perfSummary: () => fetchJson<BackendPerformanceSummary>('/api/performance/summary'),
  ssi:         () => fetchJson<BackendSsi>('/api/ssi'),
  diag:        () => fetchJson<BackendDiag>('/api/diag'),
  track:       () => fetchJson<Record<string, unknown>>('/api/track'),
  backtest:    () => fetchJson<Record<string, unknown>>('/api/backtest'),
  regime:      () => fetchJson<BackendRegime>('/api/regime'),

  trigger: (params: { event: string; actual: number; forecast: number; previous?: number }) =>
    postJson<{ ok?: boolean; message?: string; error?: string }>('/api/trigger', params),

  killSwitch: () =>
    postJson<{ ok?: boolean; error?: string }>('/api/kill-switch'),

  resetKillSwitch: () =>
    postJson<{ ok?: boolean; error?: string }>('/api/kill-switch/reset'),
};

// ── Accounts / credits ───────────────────────────────────────────────────────

export interface SessionPayload {
  token: string;
  user: {
    id: string;
    provider: 'google' | 'wallet' | 'guest';
    name: string | null;
    email: string | null;
    avatar: string | null;
    walletAddress: string | null;
  };
  credits: number;
  error?: string;
}

export const authApi = {
  guest:  (name?: string) => postJson<SessionPayload>('/api/auth/guest', name ? { name } : {}),
  google: (credential: string) => postJson<SessionPayload>('/api/auth/google', { credential }),
  walletNonce:  (address: string) => postJson<{ address: string; nonce: string; message: string; error?: string }>('/api/auth/wallet/nonce', { address }),
  walletVerify: (address: string, signature: string) => postJson<SessionPayload>('/api/auth/wallet/verify', { address, signature }),
  me:     () => fetchJson<SessionPayload & { ledger: Array<{ delta: number; reason: string; ref: string | null; created_at: number }> }>('/api/auth/me'),
  logout: () => postJson<{ ok: boolean }>('/api/auth/logout'),
};

// ── Signal Duel ──────────────────────────────────────────────────────────────

export interface DuelRow {
  id: string; event_name: string; actual: number; forecast: number;
  prediction: 'BULL' | 'BEAR'; stake: number;
  mara_verdict: string | null; mara_confidence: number | null;
  outcome: 'PENDING' | 'WIN' | 'LOSS' | 'PUSH' | 'ERROR';
  payout: number; created_at: number; resolved_at: number | null;
}

export interface LeaderboardRow {
  rank: number; name: string; provider: string; credits: number;
  wins: number; losses: number; pushes: number; duels: number; accuracy: number | null;
}

export const duelApi = {
  start: (params: { event: string; actual: number; forecast: number; previous?: number; prediction: 'BULL' | 'BEAR'; stake: number }) =>
    postJson<{ ok?: boolean; duelId?: string; credits?: number; message?: string; error?: string }>('/api/duel/start', params),
  mine: () => fetchJson<{ duels: DuelRow[]; credits: number }>('/api/duel/mine'),
  leaderboard: () => fetchJson<{ leaderboard: LeaderboardRow[] }>('/api/duel/leaderboard'),
};

// ── Time Machine ─────────────────────────────────────────────────────────────

export interface ReplayPrint {
  id: string; date: string;
  actual: number | null; forecast: number | null; previous: number | null;
  surpriseZ: number | null; direction: string | null; regime: string | null;
  btcRet: { d1: number | null; d3: number | null; d7: number | null; d30: number | null };
  ethRet: { d1: number | null; d3: number | null; d7: number | null; d30: number | null };
  replay: {
    verdict: 'BULL' | 'BEAR' | 'NEUTRAL';
    confidence: number;
    analogCount: number;
    analogMedianRet1d: number | null;
    analogHitRate: number | null;
    explanation: string;
    hypotheticalPnlPct1d: number | null;
    hypotheticalPnlPct7d: number | null;
    sizeMultiplier: number;
  };
  cumulativePnlPct: number;
}

export interface ReplayTimeline {
  eventType: string;
  prints: ReplayPrint[];
  summary?: { totalPrints: number; traded: number; stoodDown: number; winRate: number | null; cumulativePnlPct: number };
  method?: string;
  note?: string;
}

export const replayApi = {
  families: () => fetchJson<{ families: Array<{ event_type: string; n: number; first: string; last: string }> }>('/api/replay/events'),
  timeline: (eventType: string) => fetchJson<ReplayTimeline>(`/api/replay?event_type=${encodeURIComponent(eventType)}`),
};

// ── Regime (typed — Risk Engine renders this for real) ──────────────────────

export interface BackendRegime {
  regime: 'BULL_QUIET' | 'BULL_VOLATILE' | 'RANGING' | 'BEAR_VOLATILE' | 'CRASH';
  trendPct: number;
  realizedVolAnnual: number;
  lookbackDays: number;
  risk: { sizeMultiplier: number; stopMultiplier: number; convictionFloor: number };
  explanation: string;
  circuitBreaker: { active: boolean; reason: string | null; sizeMultiplier?: number };
  error?: string;
}

// ── Type mappers ─────────────────────────────────────────────────────────────

export function mapDecision(d: BackendDecision): AiReasoning {
  const mc = (d.marketContext ?? {}) as Record<string, unknown>;
  return {
    id:             d.id,
    eventName:      (mc.eventName as string) ?? d.eventId ?? 'Macro Event',
    timestamp:      d.timestamp,
    surpriseScore:  (mc.surpriseScore as number) ?? 0,
    direction:      d.conviction,
    confidence:     d.confidence,
    actual:         String(mc.actual ?? '—'),
    forecast:       String(mc.forecast ?? '—'),
    reasoning:      d.reasoning,
    sourceNews:     d.newsContext ?? [],
    engine:         mc.engine as string | undefined,
    debate:         (mc.debate as AiReasoning['debate']) ?? null,
  };
}

/** High-impact release families (mirrors the backend circuit-breaker patterns). */
const HIGH_IMPACT = /\b(CPI|FOMC|Nonfarm|Payroll|NFP|PCE|PPI|Rate Decision|Unemployment|GDP)\b/i;
const MEDIUM_IMPACT = /\b(Retail|Claims|ISM|PMI|Confidence|Housing|Durable)\b/i;

export function mapEvent(e: BackendEvent): MacroEvent {
  // SoSoValue macro events are date-granular; we show the date without
  // inventing a release time (mocks.md A8).
  const ts = new Date(e.date + 'T12:30:00Z').getTime(); // countdown estimate: standard US release hour
  const state: MacroEvent['state'] =
    e.status === 'FIRED' || e.status === 'PROCESSED' ? 'fired' :
    e.status === 'WATCHING' ? 'watching' : 'upcoming';

  return {
    id:         e.id,
    name:       e.name,
    dateStr:    e.date,
    timestamp:  ts,
    state,
    consensus:  e.forecast !== null ? String(e.forecast) : '—',
    actual:     e.actual !== null ? String(e.actual) : undefined,
    previous:   e.previous !== null ? String(e.previous) : '—',
    impact:     HIGH_IMPACT.test(e.name) ? 'high' : MEDIUM_IMPACT.test(e.name) ? 'medium' : 'low',
    unit:       '',
  };
}

export function mapTrade(t: BackendTrade): Trade {
  const elapsed = t.openedAt ? Date.now() - t.openedAt : 0;
  const hours = Math.floor(elapsed / 3_600_000);
  const mins  = Math.floor((elapsed % 3_600_000) / 60_000);
  const timeStr = hours > 24 ? `${Math.floor(hours / 24)}d ago`
                : hours > 0 ? `${hours}h ago`
                : `${mins}m ago`;

  const status: Trade['status'] =
    t.status === 'OPEN' ? 'OPEN' :
    t.status === 'CANCELLED' ? 'CLOSED' : 'CLOSED';

  return {
    id:         t.id,
    timeStr,
    timestamp:  t.openedAt ?? Date.now(),
    event:      t.decisionId ? `Decision ${t.decisionId.slice(0, 8)}` : 'Manual',
    instrument: `${t.symbol}.PERP (SoDEX)`,
    side:       t.side,
    sizeUsd:    (t.entryPrice ?? 0) * (t.quantity ?? 0),
    quantity:   t.quantity ?? 0,
    priceEntry: t.entryPrice ?? 0,
    priceExit:  t.exitPrice ?? undefined,
    leverage:   t.leverage ?? 1,
    stopLoss:   t.stopLoss ?? 0,
    takeProfit: t.takeProfit ?? 0,
    pnl:        t.pnl ?? 0,
    pnlPercent: t.pnlPercent ?? 0,
    status,
  };
}

/** Map REAL SoDEX spot balances (via /api/ssi) into display holdings (mocks.md A5). */
const SSI_DISPLAY: Record<string, { name: string; ticker: string }> = {
  mag7: { name: 'Magnificent 7 Tech Index', ticker: 'MAG7.ssi' },
  defi: { name: 'Decentralized Finance Index', ticker: 'DEFI.ssi' },
  meme: { name: 'Meme Capital Token Index', ticker: 'MEME.ssi' },
  ussi: { name: 'Broad US Market (Safe Haven)', ticker: 'USSI' },
};

export function mapSsiHoldings(ssi: BackendSsi): SsiHolding[] {
  const total = ssi.holdings.reduce((s, h) => s + h.balance, 0);
  return ssi.holdings.map((h, i) => {
    const meta = SSI_DISPLAY[h.index] ?? { name: h.symbol, ticker: h.symbol };
    return {
      id: `ssi-${i}-${h.index}`,
      name: meta.name,
      ticker: meta.ticker,
      allocationPercent: total > 0 ? Math.round((h.balance / total) * 100) : 0,
      currentPrice: 0,
      balance: h.balance,
      valueUsd: h.balance, // testnet SSI ≈ USDC-denominated; live pricing via indices module
      dailyChange: 0,
    };
  });
}

export function mapRotations(ssi: BackendSsi): RotationLog[] {
  return ssi.rotations.map((r) => {
    let from = '—', to = '—', pct = 0;
    try {
      const plan = JSON.parse(r.plan_json) as { orders?: Array<{ symbol: string; side: string }>; maxRotationPct?: number };
      const sell = plan.orders?.find((o) => o.side === 'SELL');
      const buy = plan.orders?.find((o) => o.side === 'BUY');
      from = sell?.symbol.replace('v', '').replace('_vUSDC', '') ?? '—';
      to = buy?.symbol.replace('v', '').replace('_vUSDC', '') ?? '—';
      pct = Math.round((plan.maxRotationPct ?? 0) * 100);
    } catch { /* keep defaults */ }
    return {
      id: r.id,
      timeStr: new Date(r.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      fromTicker: from,
      toTicker: to,
      percentage: pct,
      reason: `${r.direction} rotation ${r.executed ? 'executed' : 'planned'} · decision ${r.decision_id?.slice(0, 8) ?? 'manual'}`,
    };
  });
}

// ── WebSocket hook ────────────────────────────────────────────────────────────

export type WsMessage =
  | { type: 'init';        data: { killSwitch: boolean; decisions: BackendDecision[]; trades: BackendTrade[] } }
  | { type: 'decision';    data: BackendDecision & { eventName?: string; btcPrice?: number; decisionId?: string } }
  | { type: 'trade';       data: BackendTrade }
  | { type: 'risk';        data: BackendRisk }
  | { type: 'event_fired'; data: BackendEvent }
  | { type: 'agent_trace'; data: import('./types').AgentTraceStep }
  | { type: 'status';      data: { killSwitch: boolean; reason?: string } };

export function createWebSocket(onMessage: (msg: WsMessage) => void, onConnect?: () => void): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let unmounted = false;

  function connect() {
    if (unmounted) return;
    let url: string;
    if (API_BASE) {
      url = API_BASE.replace(/^http/, 'ws') + '/ws';
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      url = `${proto}://${window.location.host}/ws`;
    }
    ws = new WebSocket(url);

    ws.onopen = () => { onConnect?.(); };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        onMessage(msg);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      ws = null;
      if (!unmounted) reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => { ws?.close(); };
  }

  connect();

  return () => {
    unmounted = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) { ws.onclose = null; ws.close(); }
  };
}
