/**
 * MARA API client — bridges the Next.js frontend to the macromind engine
 * (Hono backend :3001 locally, Render in production).
 *
 * Every number rendered by the app flows through here; nothing is invented
 * client-side. All consumers are 'use client' components.
 */

// ── Base URL ─────────────────────────────────────────────────────────────────

export const API_BASE: string =
  (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

// ── Session token ────────────────────────────────────────────────────────────

const TOKEN_KEY = 'mara_session';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null): void {
  if (typeof window === 'undefined') return;
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

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return res.json() as Promise<T>;
}

// ── Backend shapes ───────────────────────────────────────────────────────────

export type Conviction = 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';

export interface BackendDecision {
  id: string;
  eventId: string | null;
  timestamp: number;
  conviction: Conviction;
  confidence: number;
  reasoning: string;
  action: 'LONG' | 'SHORT' | 'NO_TRADE';
  noTradeReason: string | null;
  newsContext: string[] | null;
  marketContext: {
    btcPrice?: number; atr14?: number; surpriseScore?: number;
    eventName?: string; actual?: number | string; forecast?: number | string;
    engine?: string; [k: string]: unknown;
  } | null;
  createdAt: number;
}

export interface BackendEvent {
  id: string;
  name: string;
  date: string;
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

export interface AgentTraceStep {
  runId: string; step: number; ts: number;
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'final' | 'error';
  tool?: string; args?: Record<string, unknown>; summary: string;
}

// ── Core API ─────────────────────────────────────────────────────────────────

export const api = {
  status:      () => fetchJson<BackendStatus>('/api/status'),
  events:      () => fetchJson<BackendEvent[]>('/api/events?limit=20'),
  decisions:   () => fetchJson<BackendDecision[]>('/api/decisions?limit=20'),
  trades:      () => fetchJson<BackendTrade[]>('/api/trades?limit=20'),
  risk:        () => fetchJson<BackendRisk>('/api/risk'),
  news:        () => fetchJson<BackendNewsItem[]>('/api/news?limit=8'),
  markets:     () => fetchJson<BackendMarkets>('/api/markets'),
  perfSummary: () => fetchJson<BackendPerformanceSummary>('/api/performance/summary'),
  ssi:         () => fetchJson<BackendSsi>('/api/ssi'),
  diag:        () => fetchJson<BackendDiag>('/api/diag'),
  regime:      () => fetchJson<BackendRegime>('/api/regime'),

  trigger: (params: { event: string; actual: number; forecast: number; previous?: number }) =>
    postJson<{ ok?: boolean; message?: string; error?: string }>('/api/trigger', params),

  killSwitch:      () => postJson<{ ok?: boolean; error?: string }>('/api/kill-switch'),
  resetKillSwitch: () => postJson<{ ok?: boolean; error?: string }>('/api/kill-switch/reset'),
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

// ── Proof of Edge (the Gauntlet) ─────────────────────────────────────────────

export interface EdgeStrategyMetrics {
  label: string;
  totalReturnPct: number;
  sharpe: number | null;
  sharpeDiscounted: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  winRate: number | null;
  tradesTaken: number;
  stoodDown: number;
}

export interface EdgeReport {
  n: number;
  window: { from: string | null; to: string | null };
  strategies: {
    mara: EdgeStrategyMetrics;
    maraNoStandDown: EdgeStrategyMetrics;
    naive: EdgeStrategyMetrics;
    buyHold: EdgeStrategyMetrics;
  };
  restraintValuePct: number;
  equity: Array<{ date: string; mara: number; noStandDown: number; naive: number; buyHold: number }>;
  standDowns: Array<{
    date: string; eventType: string; z: number | null; regime: string | null;
    reason: string; dodgedRetPct: number | null;
  }>;
  perRegime: Array<{ regime: string; prints: number; maraRetPct: number; buyHoldRetPct: number; maraWins: boolean }>;
  monteCarlo: { paths: number; var95Pct: number | null; cvar95Pct: number | null };
  method: string;
  caveats: string[];
  generatedAt: number;
}

export const edgeApi = {
  report: () => fetchJson<EdgeReport>('/api/edge'),
};

// ── Portfolio data plane: live account + ETF flows + backtest ────────────────

export interface BackendAccount {
  operator: string;
  venue: string;
  perps: {
    availableBalance: number | null;
    positions: Array<{ symbol: string; positionSide?: string; quantity?: string; entryPrice?: string; markPrice?: string; unrealizedPnl?: string; [k: string]: unknown }>;
    orders: Array<{ orderId?: string | number; clOrdID?: string; symbol?: string; side?: string | number; type?: string | number; price?: string; quantity?: string; status?: string | number; createdAt?: number; [k: string]: unknown }>;
  };
  spot: Array<{ asset?: string; symbol?: string; currency?: string; free?: string; available?: string; balance?: string; locked?: string; [k: string]: unknown }>;
  fetchedAt: number;
  error?: string;
}

export interface EtfFlowDay {
  date: string;
  totalNetAssets?: number;
  totalNetFlow?: number;
  dailyNetFlow?: number;
  btcHoldings?: number;
  fundCount?: number;
}

export interface BackendEtfFlows {
  symbol: 'BTC' | 'ETH';
  history: EtfFlowDay[];
  note: string;
  fetchedAt: number;
  error?: string;
}

export interface BackendBacktest {
  n: number;
  window: { from: string | null; to: string | null };
  strategy: {
    totalReturnPct: number; sharpe: number | null; sharpeDiscounted: number | null;
    sortino: number | null; maxDrawdownPct: number; winRate: number | null;
    calmar: number | null; equity: Array<{ date: string; value: number }>;
  };
  buyHold: { totalReturnPct: number; sharpe: number | null; maxDrawdownPct: number; correlationToStrategy: number | null };
  monteCarlo: { paths: number; var95Pct: number | null; cvar95Pct: number | null };
  caveats: string[];
  generatedAt: number;
}

export const portfolioApi = {
  account: () => fetchJson<BackendAccount>('/api/account'),
  etf: (symbol: 'BTC' | 'ETH') => fetchJson<BackendEtfFlows>(`/api/etf?symbol=${symbol}`),
  backtest: () => fetchJson<BackendBacktest>('/api/backtest'),
};

// ── WebSocket ────────────────────────────────────────────────────────────────

export type WsMessage =
  | { type: 'init';        data: { killSwitch: boolean; decisions: BackendDecision[]; trades: BackendTrade[] } }
  | { type: 'decision';    data: BackendDecision & { eventName?: string; btcPrice?: number; decisionId?: string } }
  | { type: 'trade';       data: BackendTrade }
  | { type: 'risk';        data: BackendRisk }
  | { type: 'event_fired'; data: BackendEvent }
  | { type: 'agent_trace'; data: AgentTraceStep }
  | { type: 'duel_result'; data: { duelId: string; outcome: string; payout: number; verdict: string | null; confidence: number | null; credits: number; userId: string } }
  | { type: 'status';      data: { killSwitch: boolean; reason?: string } };

export function createWebSocket(onMessage: (msg: WsMessage) => void, onConnect?: () => void, onClose?: () => void): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let unmounted = false;

  function connect() {
    if (unmounted || typeof window === 'undefined') return;
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
      onClose?.();
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

// ── Small display helpers ────────────────────────────────────────────────────

export function convictionTone(c: Conviction | string | null | undefined): 'bull' | 'bear' | 'flat' {
  if (c === 'STRONG_BULL' || c === 'BULL') return 'bull';
  if (c === 'STRONG_BEAR' || c === 'BEAR') return 'bear';
  return 'flat';
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
