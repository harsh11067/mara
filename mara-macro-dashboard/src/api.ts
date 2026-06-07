/**
 * MARA API client — bridges mara-macro-dashboard to the Hono backend on port 3001.
 *
 * All fetch calls use relative paths so Vite's proxy (/api → localhost:3001) handles routing.
 * Also provides type mappers: backend StoredDecision/StoredTrade/StoredEvent → frontend types.
 */

import type {
  MacroEvent, AiReasoning, Trade, SsiHolding, RotationLog, DirectionType
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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── API calls ────────────────────────────────────────────────────────────────

export const api = {
  status:      () => fetchJson<BackendStatus>('/api/status'),
  events:      () => fetchJson<BackendEvent[]>('/api/events?limit=20'),
  decisions:   () => fetchJson<BackendDecision[]>('/api/decisions?limit=20'),
  trades:      () => fetchJson<BackendTrade[]>('/api/trades?limit=20'),
  risk:        () => fetchJson<BackendRisk>('/api/risk'),
  performance: () => fetchJson<{ts:number;pnl:number}[]>('/api/performance'),
  news:        () => fetchJson<BackendNewsItem[]>('/api/news?limit=8'),

  trigger: (params: { event: string; actual: number; forecast: number; previous?: number }) =>
    fetch('/api/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).then((r) => r.json() as Promise<{ ok?: boolean; message?: string; error?: string }>),

  killSwitch: () =>
    fetch('/api/kill-switch', { method: 'POST' })
      .then((r) => r.json() as Promise<{ ok?: boolean; error?: string }>),

  resetKillSwitch: () =>
    fetch('/api/kill-switch/reset', { method: 'POST' })
      .then((r) => r.json() as Promise<{ ok?: boolean; error?: string }>),
};

// ── Type mappers ─────────────────────────────────────────────────────────────

export function mapDecision(d: BackendDecision): AiReasoning {
  return {
    id:             d.id,
    eventName:      d.eventId ?? d.marketContext?.eventName as string ?? 'Macro Event',
    timestamp:      d.timestamp,
    surpriseScore:  d.marketContext?.surpriseScore as number ?? 0,
    direction:      d.conviction,
    confidence:     d.confidence,
    actual:         String(d.marketContext?.actual ?? '—'),
    forecast:       String(d.marketContext?.forecast ?? '—'),
    reasoning:      d.reasoning,
    sourceNews:     d.newsContext ?? [],
  };
}

export function mapEvent(e: BackendEvent): MacroEvent {
  // Parse date string to timestamp: "2026-05-28" → midnight UTC
  const ts = new Date(e.date + 'T12:30:00Z').getTime();
  const state: MacroEvent['state'] =
    e.status === 'FIRED' || e.status === 'PROCESSED' ? 'fired' :
    e.status === 'WATCHING' ? 'watching' : 'upcoming';

  return {
    id:         e.id,
    name:       e.name,
    dateStr:    e.date + ' 12:30 UTC',
    timestamp:  ts,
    state,
    consensus:  e.forecast !== null ? String(e.forecast) : '—',
    actual:     e.actual !== null ? String(e.actual) : undefined,
    previous:   e.previous !== null ? String(e.previous) : '—',
    impact:     'high',
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

// Parse SSI holdings from live risk data — placeholder using mock structure
// In production these come from SoDEX spot balances via /api/risk
export function buildSsiHoldings(risk: BackendRisk): SsiHolding[] | null {
  // If balance is 0 (no testnet funds), return null to keep mock data
  if ((risk.liveBalance ?? 0) <= 0) return null;

  // Placeholder: return null to keep original mock data for demo
  // In production this would come from a dedicated /api/ssi endpoint
  return null;
}

// ── WebSocket hook ────────────────────────────────────────────────────────────

export type WsMessage =
  | { type: 'init';        data: { killSwitch: boolean; decisions: BackendDecision[]; trades: BackendTrade[] } }
  | { type: 'decision';    data: BackendDecision & { eventName?: string; btcPrice?: number } }
  | { type: 'trade';       data: BackendTrade }
  | { type: 'risk';        data: BackendRisk }
  | { type: 'event_fired'; data: BackendEvent }
  | { type: 'status';      data: { killSwitch: boolean; reason?: string } };

export function createWebSocket(onMessage: (msg: WsMessage) => void, onConnect?: () => void): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let unmounted = false;

  function connect() {
    if (unmounted) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = `${proto}://${window.location.host}/ws`;
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
