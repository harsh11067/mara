# MARA — Architecture Document

## System Overview

MARA is a four-layer system: **Dual-Path Detection → AI Decision Engine → Risk Gate → Dual Execution (Perps + SSI Spot)**, with a React dashboard as the user interface and a persistent store for audit trails.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REACT DASHBOARD                             │
│  Event Calendar │ Agent Feed │ Trade History │ P&L │ Risk Panel     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ WebSocket + REST
┌──────────────────────────────┴──────────────────────────────────────┐
│                        BACKEND SERVER (Node.js / Bun)               │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐ │
│  │  SCHEDULER   │  │  AI DECISION │  │   RISK     │  │  EXECUTOR │ │
│  │  (cron/poll) │→ │   ENGINE     │→ │   ENGINE   │→ │  (SoDEX)  │ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘ │
│         │                │                 │               │        │
│  ┌──────┴──────────────────────────────────┴───────────────┴─────┐  │
│  │                     DATA SERVICE LAYER                        │  │
│  │  SoSoValue Client  │  SoDEX Client  │  Price Cache            │  │
│  └───────┬──────────────────┬────────────────────────────────────┘  │
│          │                  │                                       │
│  ┌───────┴──────┐  ┌───────┴────────┐  ┌────────────────────────┐  │
│  │  EVENT STORE  │  │  TRADE STORE   │  │  REASONING LOG STORE   │  │
│  │  (SQLite)     │  │  (SQLite)      │  │  (SQLite)              │  │
│  └──────────────┘  └────────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
          │                       │
          ▼                       ▼
┌──────────────────┐   ┌──────────────────────┐
│  SoSoValue API   │   │  SoDEX API           │
│  (openapi.       │   │  (testnet-gw.        │
│   sosovalue.com) │   │   sodex.dev)         │
└──────────────────┘   └──────────────────────┘
```

---

## Technology Stack

| Layer | Technology | Why |
|---|---|---|
| **Runtime** | Node.js 20+ / Bun | Fast startup, native fetch, ethers.js compatibility |
| **Backend framework** | Hono or Fastify | Lightweight, fast, WebSocket support |
| **AI / LLM** | Claude API (claude-sonnet-4-20250514) | Structured JSON output, strong reasoning |
| **Crypto signing** | ethers.js v6 | EIP-712 typed data signing for SoDEX |
| **Database** | SQLite (via better-sqlite3) | Zero-config, single file, fast reads |
| **Frontend** | React + Vite + Tailwind | Fast dev, good DX |
| **Real-time** | WebSocket (native) | Dashboard live updates |
| **Scheduling** | node-cron | Polling intervals |
| **Deployment** | Single VPS / Railway / Render | Simple, cheap |

---

## Module Breakdown

### 1. Scheduler Module (`/src/scheduler/`)

Responsible for timing everything. Implements **dual-path event detection**.

```
scheduler/
├── macro-poller.ts      # Polls /macro/events every 60s for calendar
├── news-scanner.ts      # Polls /news every 30s, pattern-matches for macro headlines
├── history-watcher.ts   # Polls /macro/events/{event}/history for actual value updates
├── event-reconciler.ts  # Merges news-first and data-first triggers, prevents double-fire
└── cron-manager.ts      # Manages all polling intervals
```

**Dual-Path Detection Flow:**

**Path A — News Scanner (fast, ~10s post-release):**
1. `GET /news?page_size=20` every 30 seconds
2. Pattern-match headlines against macro keywords:
   - `/CPI\s+(?:comes?\s+in|at|prints?|released?)\s+(?:at\s+)?(\d+\.?\d*)%/i`
   - `/Nonfarm\s+Payrolls?\s+(\d+)K/i`
   - `/FOMC.*(?:rate|hike|cut|hold|unchanged)/i`
3. On match → extract actual value from headline text
4. Emit `EVENT_DETECTED_VIA_NEWS` with { event, extractedActual, headline, newsId }

**Path B — History Watcher (reliable, ~1-5 min post-release):**
1. For events scheduled today: poll `GET /macro/events/{event}/history?limit=1` every 60s
2. Cache the latest `actual` value
3. When `actual` changes from null/previous → new value: emit `EVENT_DETECTED_VIA_DATA`
4. This provides precise actual/forecast/previous numbers

**Event Reconciler:**
- First trigger (news OR data) starts the pipeline immediately
- Second trigger confirms and enriches with precise data
- Dedup window: 10 min (same event won't fire twice)
- If only news fires and no data within 5 min → proceed with news-extracted values (lower confidence)

**Macro Calendar Poller:**
1. `GET /macro/events` → list of upcoming events with dates
2. For each event within next 24h, fetch history for surprise model training
3. Store in event_store with status: `UPCOMING` | `WATCHING` | `FIRED` | `PROCESSED`

**News Poller (separate from scanner — for general sentiment):**
1. `GET /news?page_size=20` every 30s (shared call with scanner)
2. Deduplicate by news `id`
3. Store in news_cache with `matched_currencies` for cross-referencing
4. Tag with macro event if timing coincides (±15 min window)

### 2. Data Service Layer (`/src/services/`)

Thin wrappers around external APIs. All network calls go through here.

```
services/
├── sosovalue-client.ts   # All SoSoValue API calls
├── sodex-client.ts       # All SoDEX API calls (read-only, perps + spot)
├── sodex-trader.ts       # SoDEX signed trading operations (perps + spot)
├── sodex-signer.ts       # EIP-712 signing logic (shared by perps and spot)
├── ssi-manager.ts        # SSI portfolio tracking + rotation logic
├── price-cache.ts        # In-memory price cache (30s TTL)
└── types.ts              # Shared TypeScript types
```

**sosovalue-client.ts key methods:**
```typescript
class SoSoValueClient {
  constructor(apiKey: string)
  
  // Macro
  getUpcomingEvents(): Promise<MacroEvent[]>
  getEventHistory(event: string, limit?: number): Promise<EventDataPoint[]>
  
  // News (dual role: sentiment + event detection)
  getLatestNews(params?: NewsParams): Promise<NewsItem[]>
  getHotNews(): Promise<NewsItem[]>
  searchNews(keyword: string): Promise<NewsItem[]>
  
  // Market data
  getCurrencySnapshot(currencyId: string): Promise<MarketSnapshot>
  getCurrencyKlines(currencyId: string, params: KlineParams): Promise<Kline[]>
  
  // ETF
  getEtfSummaryHistory(): Promise<EtfHistory[]>
  
  // SSI Indices
  getIndices(): Promise<Index[]>
  getIndexConstituents(ticker: string): Promise<IndexConstituent[]>
  getIndexSnapshot(ticker: string): Promise<IndexSnapshot>
}
```

**ssi-manager.ts — the SSI portfolio rotation brain:**
```typescript
class SSIManager {
  constructor(sodexSpotTrader: SoDEXTrader, sosoClient: SoSoValueClient)

  // Current SSI holdings via SoDEX spot balances
  getHoldings(): Promise<SSIHolding[]>
  // → [{ token: 'MAG7.ssi', balance: 100, valueUsd: 5000 }, ...]

  // Compute target rotation based on conviction
  computeRotation(conviction: Conviction): SSIRotationPlan
  // BEARISH → sell 20% MAG7.ssi → buy USSI (delta-neutral safe haven)
  // BULLISH → sell 20% USSI → buy MAG7.ssi + DEFI.ssi (risk-on)
  // Cap: max 20% portfolio shift per event (no all-in rotations)

  // Execute via SoDEX spot API (EIP-712 signed, domain="spot")
  executeRotation(plan: SSIRotationPlan): Promise<RotationResult>

  // History for dashboard
  getRotationHistory(): Promise<RotationEntry[]>
}
```

**sodex-trader.ts key methods:**
```typescript
class SoDEXTrader {
  constructor(config: {
    endpoint: string        // testnet or mainnet
    masterAddress: string   
    apiKeyName: string      
    apiKeyPrivate: string   // EVM private key for this API key
    accountId: number
    chainId: number         // 138565 for testnet, 286623 for mainnet
  })
  
  // Read (unsigned)
  getSymbols(): Promise<PerpsSymbol[]>
  getTickers(): Promise<PerpsTicker[]>
  getOrderbook(symbol: string): Promise<Orderbook>
  getBalances(): Promise<PerpsBalance>
  getOpenOrders(): Promise<Order[]>
  getPositions(): Promise<Position[]>
  
  // Write (EIP-712 signed)
  placeOrder(order: OrderParams): Promise<OrderResult>
  cancelOrder(orderId: string): Promise<void>
  updateLeverage(symbol: string, leverage: number): Promise<void>
}
```

**EIP-712 Signing Implementation (the hard part):**
```typescript
// This is the core signing logic that most competitors will skip
async function signSoDEXAction(
  actionType: string,
  params: Record<string, any>,
  apiKeyPrivateKey: string,
  nonce: bigint,
  domain: 'spot' | 'futures',
  chainId: number
): Promise<{ signature: string; nonce: string }> {
  
  // 1. Build payload: { type: actionType, params }
  const payload = JSON.stringify({ type: actionType, params });
  
  // 2. Compute payloadHash = keccak256(payload)
  //    CRITICAL: field order must match Go struct order
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(payload));
  
  // 3. EIP-712 sign
  const domainData = {
    name: domain === 'spot' ? 'spot' : 'futures',
    version: '1',
    chainId: chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000'
  };
  
  const types = {
    ExchangeAction: [
      { name: 'payloadHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint64' }
    ]
  };
  
  const value = { payloadHash, nonce };
  
  const wallet = new ethers.Wallet(apiKeyPrivateKey);
  const rawSig = await wallet.signTypedData(domainData, types, value);
  
  // 4. Prepend 0x01 (typed signature prefix)
  const typedSig = '0x01' + rawSig.slice(2);
  
  return { signature: typedSig, nonce: nonce.toString() };
}
```

### 3. AI Decision Engine (`/src/ai/`)

The brain. Takes structured data, outputs a trade decision.

```
ai/
├── analyzer.ts           # Orchestrates the analysis pipeline
├── surprise-calculator.ts # Computes macro surprise score
├── sentiment-scorer.ts   # Scores news sentiment via LLM
├── conviction-engine.ts  # Combines signals → final conviction
├── prompts.ts            # All LLM prompt templates
└── types.ts              # Decision types
```

**Surprise Calculator:**
```typescript
interface SurpriseResult {
  event: string;
  actual: number;
  forecast: number;
  previous: number;
  surpriseScore: number;      // (actual - forecast) / stddev
  surpriseDirection: 'above' | 'below' | 'inline';
  historicalAvgMove: number;  // avg BTC % move on similar surprises
  cryptoBias: 'bullish' | 'bearish' | 'neutral';
}

// Event-specific mappings (the domain knowledge):
// CPI above forecast    → bearish crypto (tighter money)
// CPI below forecast    → bullish crypto (easier money)
// NFP above forecast    → bearish crypto (strong economy = no cuts)
// NFP below forecast    → bullish crypto (weak economy = rate cuts)
// FOMC rate unchanged   → depends on statement tone (LLM analyzes)
// Unemployment up       → bullish crypto (dovish Fed likely)
```

**Conviction Engine Output:**
```typescript
interface TradeDecision {
  id: string;                 // UUID
  timestamp: number;
  
  // What triggered it
  trigger: {
    event: string;
    surpriseScore: number;
    direction: string;
  };
  
  // What the AI thinks
  conviction: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
  confidence: number;         // 0-100
  reasoning: string;          // Full LLM reasoning text
  
  // Supporting data
  newsHeadlines: string[];    // Top 5 relevant headlines
  etfFlowDirection: string;   // Confirms or contradicts
  currentPrice: number;
  recentVolatility: number;
  
  // The decision
  action: 'LONG' | 'SHORT' | 'NO_TRADE';
  
  // Why NO_TRADE (if applicable)
  noTradeReason?: string;     // 'low_conviction' | 'high_volatility' | 'max_positions' | 'low_liquidity'
}
```

**LLM Prompt (structured output):**
```
You are a macro-crypto trading analyst. Analyze this macro event and market context.

EVENT:
- Name: {event_name}
- Actual: {actual} | Forecast: {forecast} | Previous: {previous}
- Surprise Score: {surprise_score} (stddevs from consensus)

MARKET CONTEXT:
- BTC Price: ${price} | 1h Change: {change_1h}% | 24h Volume: ${volume}
- ETF Flows (last 3 days): {etf_flow_summary}
- BTC Treasury Activity: {treasury_summary}

RECENT NEWS (last 30 min):
{news_headlines}

RESPOND IN JSON ONLY:
{
  "conviction": "STRONG_BULL|BULL|NEUTRAL|BEAR|STRONG_BEAR",
  "confidence": 0-100,
  "reasoning": "2-3 sentence explanation",
  "key_factors": ["factor1", "factor2", "factor3"],
  "risk_flags": ["any concerns"]
}
```

### 4. Risk Engine (`/src/risk/`)

Never trust the AI blindly. This module constrains it.

```
risk/
├── position-sizer.ts    # Calculates position size
├── risk-limits.ts       # Hard limits and kill switches
├── portfolio-tracker.ts # Tracks open exposure
└── types.ts
```

**Hard Limits (non-negotiable, not AI-adjustable):**
```typescript
const RISK_LIMITS = {
  maxRiskPerTrade: 0.02,       // 2% of account per trade
  maxOpenPositions: 3,          // Never more than 3 simultaneous
  maxLeverage: 5,               // Cap at 5x regardless of conviction
  maxDrawdown: 0.05,            // 5% drawdown → kill switch
  minConviction: 60,            // Below 60 confidence → no trade
  minOrderbookDepth: 1000,      // Min $1000 in top 5 levels
  minTimeBetweenTrades: 300,    // 5 min cooldown between trades
  maxDailyTrades: 10,           // Prevent runaway agent
};
```

**Position Sizing Formula:**
```
ATR = Average True Range from last 14 klines (1h)
risk_amount = account_balance * maxRiskPerTrade
stop_distance = ATR * 1.5
position_size = risk_amount / stop_distance
leverage = min(desired_leverage, maxLeverage)
actual_margin = position_size / leverage
```

### 5. Execution Module (`/src/executor/`)

Translates decisions into SoDEX trades.

```
executor/
├── order-builder.ts     # Builds SoDEX order payloads
├── order-executor.ts    # Signs and sends orders
├── position-monitor.ts  # Monitors open positions
└── kill-switch.ts       # Emergency close all
```

**Order Flow:**
```
TradeDecision received
  → Check risk limits (position count, drawdown, cooldown)
  → Fetch current orderbook (liquidity check)
  → Build order payload (field order matching Go struct!)
  → Sign with EIP-712
  → POST to SoDEX /trade/orders
  → Confirm order accepted
  → Attach TP/SL orders
  → Log to trade_store with full reasoning
  → Emit to dashboard via WebSocket
```

### 6. Dashboard (`/src/dashboard/`)

React SPA with 5 panels.

```
dashboard/
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── EventCalendar.tsx      # Upcoming macro events with countdowns
│   │   ├── AgentFeed.tsx          # Live stream of agent decisions
│   │   ├── TradeHistory.tsx       # All trades with reasoning cards
│   │   ├── PerformanceChart.tsx   # Cumulative P&L over time
│   │   ├── RiskPanel.tsx          # Current exposure, drawdown, limits
│   │   ├── NewsStream.tsx         # SoSoValue news that influenced decisions
│   │   └── ReasoningCard.tsx      # Expandable card showing full decision chain
│   ├── hooks/
│   │   ├── useWebSocket.ts        # Live connection to backend
│   │   └── useAgentState.ts       # Agent state management
│   └── lib/
│       └── api.ts                 # REST calls to backend
├── index.html
└── vite.config.ts
```

---

## Data Flow: Complete Walk-Through of a Single Trade

```
T-24h: Scheduler polls /macro/events
       → Discovers "CPI" scheduled for tomorrow 8:30 AM ET
       → Stores event, sets status = UPCOMING

T-5min: Event Watcher transitions event to WATCHING
        → Fetches /macro/events/CPI/history (last 24 data points)
        → Calculates: mean surprise = 0.1, stddev = 0.15
        → Fetches /currencies/{btc_id}/klines (1h, last 14 bars)
        → Calculates: ATR = $450
        → Fetches /currencies/{btc_id}/market-snapshot
        → Caches: BTC = $108,500, 24h vol = $32B

T-0:    News Scanner picks up headline FIRST (fast path):
        → "CPI comes in hot at 3.4%, above 3.2% consensus"
        → Regex match extracts: event=CPI, actual=3.4
        → Emits EVENT_DETECTED_VIA_NEWS
        → Pipeline starts immediately

T+2s:   More news arrives:
        → "Rate cut expectations pushed back to Q4"
        → "Bitcoin drops 1.2% in immediate reaction"
        → All stored for AI context

T+3s:   History Watcher confirms (data path catches up):
        → /macro/events/CPI/history now shows actual=3.4, forecast=3.2
        → Event Reconciler: confirms news-extracted value, enriches with precise data
        → Surprise Calculator: score = (3.4 - 3.2) / 0.15 = +1.33 stddevs
        → CPI above forecast → crypto_bias = BEARISH

T+5s:   AI Decision Engine fires:
        → Inputs: surprise_score=1.33, bias=BEARISH, headlines, ETF flows
        → LLM returns: conviction=STRONG_BEAR, confidence=82
        → reasoning: "CPI surprise of +1.33σ significantly reduces 
           probability of near-term rate cuts. Combined with 3 days of
           ETF outflows, short-term bearish setup for BTC."

T+6s:   Risk Engine validates:
        → Account balance: 10,000 USDC (testnet)
        → Open positions: 0 ✓
        → Drawdown: 0% ✓
        → Confidence 82 > 60 minimum ✓
        → Position size: (10000 * 0.02) / (450 * 1.5) = 0.296 BTC
        → Leverage: 3x
        → Margin required: ~$10,700 → scales down to 0.27 BTC

T+7s:   Executor builds order:
        → Checks /markets/BTC-USD/orderbook → depth sufficient
        → Builds payload: {accountID, symbolID, orders: [{
            clOrdID: "mm-cpi-20260523-001",
            modifier: 1, side: 2 (sell), type: 2 (market),
            timeInForce: 3 (IOC), quantity: "0.27",
            reduceOnly: false, positionSide: 2 (short)
          }]}
        → Signs via EIP-712
        → POST to SoDEX testnet

T+8s:   Order fills → Executor places TP/SL:
        → Stop-loss: entry + (450 * 1.5) = entry + $675
        → Take-profit: entry - (450 * 3.0) = entry - $1350

T+9s:   SSI Manager executes rotation (SoDEX spot, domain="spot"):
        → BEARISH conviction → rotate toward safety
        → Sell 20% MAG7.ssi holdings → buy USSI (delta-neutral)
        → Signed via EIP-712 with domain.name = "spot"
        → Both trades logged as part of same event response

T+10s:  Dashboard receives WebSocket update:
        → EventCalendar: CPI row turns red, shows "FIRED - BEARISH"
        → AgentFeed: New entry with full reasoning card
        → TradeHistory: New trade row with "SHORT 0.27 BTC @ $108,500"
        → RiskPanel: Open exposure updates

T+ongoing: Position Monitor tracks P&L every 10s
           → If TP hit: log win, update P&L chart
           → If SL hit: log loss, update P&L chart
           → If drawdown > 5%: KILL SWITCH → close all positions
```

---

## Database Schema (SQLite)

```sql
-- Macro events the agent is tracking
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- "CPI", "Nonfarm Payrolls"
  date TEXT NOT NULL,                    -- "2026-05-23"
  status TEXT DEFAULT 'UPCOMING',        -- UPCOMING|WATCHING|FIRED|PROCESSED
  forecast REAL,
  actual REAL,
  previous REAL,
  surprise_score REAL,
  crypto_bias TEXT,                      -- bullish|bearish|neutral
  created_at INTEGER,
  updated_at INTEGER
);

-- Every trade decision (including NO_TRADE decisions)
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id),
  timestamp INTEGER NOT NULL,
  conviction TEXT NOT NULL,              -- STRONG_BULL|BULL|NEUTRAL|BEAR|STRONG_BEAR
  confidence INTEGER NOT NULL,
  reasoning TEXT NOT NULL,               -- Full LLM output
  action TEXT NOT NULL,                  -- LONG|SHORT|NO_TRADE
  no_trade_reason TEXT,
  news_context TEXT,                     -- JSON array of headlines
  market_context TEXT,                   -- JSON of price/vol/etf data
  created_at INTEGER
);

-- Actual trades executed on SoDEX
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  decision_id TEXT REFERENCES decisions(id),
  sodex_order_id TEXT,
  symbol TEXT NOT NULL,                  -- "BTC-USD"
  side TEXT NOT NULL,                    -- "LONG"|"SHORT"
  entry_price REAL,
  quantity REAL,
  leverage INTEGER,
  stop_loss REAL,
  take_profit REAL,
  status TEXT DEFAULT 'OPEN',           -- OPEN|CLOSED|STOPPED|TAKEN_PROFIT
  exit_price REAL,
  pnl REAL,
  pnl_percent REAL,
  opened_at INTEGER,
  closed_at INTEGER
);

-- Cached news for audit trail
CREATE TABLE news_cache (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  category INTEGER,
  release_time INTEGER,
  matched_currencies TEXT,               -- JSON
  tags TEXT,                             -- JSON
  fetched_at INTEGER
);

-- Risk snapshots (every trade + every 5 min)
CREATE TABLE risk_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER,
  account_balance REAL,
  open_positions INTEGER,
  total_exposure REAL,
  unrealized_pnl REAL,
  drawdown_percent REAL,
  kill_switch_active BOOLEAN DEFAULT FALSE
);
```

---

## Directory Structure

```
macromind/
├── package.json
├── tsconfig.json
├── .env.example               # API keys template
├── .env                       # (gitignored) actual keys
│
├── src/
│   ├── index.ts               # Entry point, starts all modules
│   ├── config.ts              # Environment config + risk limits
│   │
│   ├── scheduler/
│   │   ├── macro-poller.ts
│   │   ├── news-poller.ts
│   │   ├── event-watcher.ts
│   │   └── cron-manager.ts
│   │
│   ├── services/
│   │   ├── sosovalue-client.ts
│   │   ├── sodex-client.ts
│   │   ├── sodex-trader.ts
│   │   ├── sodex-signer.ts    # EIP-712 signing logic
│   │   ├── price-cache.ts
│   │   └── types.ts
│   │
│   ├── ai/
│   │   ├── analyzer.ts
│   │   ├── surprise-calculator.ts
│   │   ├── sentiment-scorer.ts
│   │   ├── conviction-engine.ts
│   │   └── prompts.ts
│   │
│   ├── risk/
│   │   ├── position-sizer.ts
│   │   ├── risk-limits.ts
│   │   └── portfolio-tracker.ts
│   │
│   ├── executor/
│   │   ├── order-builder.ts
│   │   ├── order-executor.ts
│   │   ├── position-monitor.ts
│   │   └── kill-switch.ts
│   │
│   ├── store/
│   │   ├── db.ts              # SQLite connection + migrations
│   │   ├── event-store.ts
│   │   ├── decision-store.ts
│   │   ├── trade-store.ts
│   │   └── risk-store.ts
│   │
│   ├── api/                   # Backend REST + WebSocket for dashboard
│   │   ├── server.ts
│   │   ├── routes.ts
│   │   └── ws-handler.ts
│   │
│   └── utils/
│       ├── logger.ts
│       ├── event-emitter.ts
│       └── helpers.ts
│
├── dashboard/                 # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── scripts/
│   ├── setup-sodex-testnet.ts  # Wallet setup helper
│   └── test-sosovalue-api.ts   # API connectivity check
│
└── docs/
    ├── idea.md
    ├── architecture.md
    ├── plan.md
    └── test.md
```

---

## Environment Variables

```env
# SoSoValue
SOSOVALUE_API_KEY=your_api_key_here

# SoDEX (Testnet)
SODEX_ENDPOINT=https://testnet-gw.sodex.dev/api/v1
SODEX_WS_ENDPOINT=wss://testnet-gw.sodex.dev/ws
SODEX_CHAIN_ID=138565
SODEX_MASTER_ADDRESS=0xYourWalletAddress
SODEX_API_KEY_NAME=macromind-agent
SODEX_API_KEY_PRIVATE=0xYourAPIKeyPrivateKey
SODEX_ACCOUNT_ID=12345

# AI
ANTHROPIC_API_KEY=your_claude_api_key

# App
PORT=3001
DASHBOARD_PORT=5173
NODE_ENV=development
LOG_LEVEL=info

# Risk (can override defaults)
MAX_RISK_PER_TRADE=0.02
MAX_LEVERAGE=5
MAX_DRAWDOWN=0.05
```

---

## Cost Analysis

| Item | Cost | Notes |
|---|---|---|
| SoSoValue API | **Free** | API key from dashboard |
| SoDEX Testnet | **Free** | Test tokens provided via faucet |
| SoDEX Mainnet | **~$5-10 gas** | Optional for demo, not required |
| Claude API | **~$2-5 total** | ~50 decisions during dev/demo at Sonnet pricing |
| Hosting (dev) | **Free** | Local / Railway free tier |
| EVM Wallet | **Free** | Generate with ethers.js |
| **Total** | **$2-5** | Claude API is the only real cost |

The testnet path means you need exactly **$0 in crypto** to build and demo this. The Claude API cost is the cost of ~50 LLM calls during development and demo recording — that's it.
