type Handler<T> = (data: T) => void | Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<Events extends Record<string, any>> {
  private handlers = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as Handler<unknown>);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  async emit<K extends keyof Events>(event: K, data: Events[K]): Promise<void> {
    const fns = this.handlers.get(event);
    if (!fns) return;
    await Promise.all([...fns].map((fn) => fn(data)));
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const wrapper: Handler<Events[K]> = async (data) => {
      this.off(event, wrapper);
      await handler(data);
    };
    this.on(event, wrapper);
  }
}

// ── Shared global emitter ──────────────────────────────────────────────────────

export interface AppEvents {
  EVENT_DETECTED_VIA_NEWS: {
    event: string;
    extractedActual: number | 'hold' | null;
    headline: string;
    newsId: string;
    timestamp: number;
  };
  EVENT_DETECTED_VIA_DATA: {
    event: string;
    actual: number;
    forecast: number;
    previous: number;
    date: string;
    timestamp: number;
  };
  EVENT_FIRED: {
    eventName: string;
    actual: number | null;
    forecast: number | null;
    previous: number | null;
    source: 'news' | 'data' | 'both';
    confidence: 'high' | 'medium' | 'low';
    timestamp: number;
    eventId: string;
  };
  TRADE_DECISION: {
    decisionId: string;
    eventName: string;
    conviction: string;
    confidence: number;
    action: string;
    timestamp: number;
  };
  TRADE_EXECUTED: {
    tradeId: string;
    decisionId: string;
    symbol: string;
    side: string;
    entryPrice: number;
    quantity: number;
    timestamp: number;
  };
  KILL_SWITCH_ACTIVATED: {
    reason: string;
    drawdown: number;
    timestamp: number;
  };
  RISK_SNAPSHOT: {
    balance: number;
    openPositions: number;
    totalExposure: number;
    unrealizedPnl: number;
    drawdownPercent: number;
    killSwitchActive: boolean;
    timestamp: number;
  };
  WS_POSITION_UPDATE: {
    symbol:           string;
    side:             'LONG' | 'SHORT';
    quantity:         number;
    entryPrice:       number;
    markPrice:        number;
    unrealizedPnl:    number;
    liquidationPrice: number;
    leverage:         number;
    marginUsed:       number;
    ts:               number;
  };
  WS_ORDER_UPDATE: {
    orderId:    string;
    clOrdId:    string;
    symbol:     string;
    side:       string;
    status:     string;
    filledQty:  number;
    avgPrice:   number;
    ts:         number;
  };
  WS_BALANCE_UPDATE: {
    totalEquity:      number;
    availableBalance: number;
    marginUsed:       number;
    unrealizedPnl:    number;
    ts:               number;
  };
  /** Live agentic tool-use trace — streamed to the dashboard reasoning card. */
  AGENT_TRACE: {
    runId:    string;
    step:     number;
    kind:     'thinking' | 'tool_call' | 'tool_result' | 'final' | 'error';
    tool?:    string;
    args?:    Record<string, unknown>;
    summary:  string;
    ts:       number;
  };
}

export const appEvents = new TypedEventEmitter<AppEvents>();
