# MARA — 7-Day Build Plan

**(M**acro-**A**ware **R**esearch **A**gent**)**

## Pre-Day-1 Setup Checklist (30 minutes, do this NOW)

- [ ] **Get SoSoValue API Key**: Go to sosovalue.com → sign up → get API key
- [ ] **Create EVM Wallet**: Use MetaMask or generate via `ethers.Wallet.createRandom()` — save private key securely
- [ ] **Get SoDEX Testnet Access**: Go to testnet.sodex.com → connect wallet → accept ToU → claim test tokens → add ValueChain to wallet → transfer test tokens to Spot account → enable gas-free trading
- [ ] **Get Anthropic API Key**: You already have this (via Claude)
- [ ] **Register SoDEX API Key**: On SoDEX UI, create an API key (name: `macromind-agent`). Save the name + the private key of the wallet you registered
- [ ] **Init Project**: `mkdir macromind && cd macromind && npm init -y && npx tsc --init`
- [ ] **Install core deps**: `npm i ethers@6 hono better-sqlite3 node-cron @anthropic-ai/sdk dotenv zod`
- [ ] **Install dev deps**: `npm i -D typescript @types/node @types/better-sqlite3 tsx`

**Verify you can hit both APIs before proceeding:**
```bash
# SoSoValue — should return event list
curl -H "x-soso-api-key: YOUR_KEY" https://openapi.sosovalue.com/openapi/v1/macro/events

# SoDEX Testnet — should return symbol list
curl https://testnet-gw.sodex.dev/api/v1/perps/markets/symbols
```

If either fails, stop and debug. Don't build on broken foundations.

---

## Day 1: Data Layer — Make Both APIs Talk

**Goal**: SoSoValue client + SoDEX read client working, returning real data, typed properly.

### Morning (3-4 hours)

**1. Project skeleton + config** (`src/config.ts`, `.env`)
```
Create .env with all keys
Create config.ts that reads + validates env vars using zod
Create src/index.ts entry point (just prints "MARA starting...")
Verify: `npx tsx src/index.ts` runs without errors
```

**2. SoSoValue Client** (`src/services/sosovalue-client.ts`)
```
Build typed client with these methods:
  - getUpcomingEvents() → GET /macro/events
  - getEventHistory(event) → GET /macro/events/{event}/history  
  - getLatestNews(params?) → GET /news
  - getHotNews() → GET /news/hot
  - searchNews(keyword) → GET /news/search
  - getCurrencySnapshot(id) → GET /currencies/{id}/market-snapshot
  - getCurrencyKlines(id, params) → GET /currencies/{id}/klines
  - getEtfSummaryHistory() → GET /etfs/summary-history
  - getIndices() → GET /indices
  - getIndexConstituents(ticker) → GET /indices/{ticker}/constituents
  - getIndexSnapshot(ticker) → GET /indices/{ticker}/market-snapshot

Each method: fetch → validate response → return typed data
Add retry logic (3 retries, exponential backoff)
Add rate limit awareness (don't exceed their limits)
```

**Verify**: Write a test script that calls each method and prints results.
```bash
npx tsx scripts/test-sosovalue-api.ts
# Should print: upcoming events, CPI history, latest news, BTC price, SSI index list
```

### Afternoon (3-4 hours)

**3. SoDEX Read Client** (`src/services/sodex-client.ts`)
```
Build typed client for unsigned (public) endpoints — BOTH perps AND spot:

PERPS:
  - getPerpsSymbols() → GET /perps/markets/symbols
  - getPerpsTickers() → GET /perps/markets/tickers
  - getPerpsOrderbook(symbol) → GET /perps/markets/{symbol}/orderbook
  - getPerpsKlines(symbol, interval) → GET /perps/markets/{symbol}/klines
  - getPerpsBalances(address) → GET /perps/accounts/{address}/balances
  - getPerpsPositions(address) → GET /perps/accounts/{address}/positions
  - getPerpsOrders(address) → GET /perps/accounts/{address}/orders

SPOT (for SSI token trading):
  - getSpotSymbols() → GET /spot/markets/symbols
  - getSpotTickers() → GET /spot/markets/tickers
  - getSpotOrderbook(symbol) → GET /spot/markets/{symbol}/orderbook
  - getSpotBalances(address) → GET /spot/accounts/{address}/balances
```

**Verify**: Test script prints BTC-USD perps ticker, orderbook depth, your testnet balance, AND available spot pairs (look for SSI tokens).

**4. Database Setup** (`src/store/db.ts`)
```
Create SQLite database with all tables from architecture.md
Create store classes: EventStore, DecisionStore, TradeStore, RiskStore
Each store: insert, getById, getAll, updateStatus
```

**Verify**: Insert a test event, query it back.

### Day 1 Deliverable
- [ ] Both API clients working with real data
- [ ] All TypeScript types defined
- [ ] Database created with all tables
- [ ] Store CRUD operations working

---

## Day 2: Brain — News Scanner + Surprise Calculator + AI Decision Engine

**Goal**: Dual-path event detection working. Given a macro event with actual/forecast data, produce a trade decision with full reasoning.

### Morning (3-4 hours)

**5. News Scanner for Event Detection** (`src/scheduler/news-scanner.ts`)
```
The fast path of dual-detection. This is what makes MARA react in ~10s not ~5min.

Build regex patterns for major macro events:
  /CPI\s+(?:comes?\s+in|at|prints?|released?)\s+(?:at\s+)?(\d+\.?\d*)%/i
  /Nonfarm\s+Payrolls?\s+(\d+)K/i
  /FOMC.*(?:rate|hike|cut|hold|unchanged)/i
  /Unemployment.*?(\d+\.?\d*)%/i
  /GDP.*?(\d+\.?\d*)%/i

Flow:
  1. On each news poll (every 30s), scan headlines against patterns
  2. On match → extract event name + actual value from headline
  3. Emit EVENT_DETECTED_VIA_NEWS
  4. Event Reconciler marks event as FIRED, starts pipeline

Test: feed these headlines and verify extraction:
  "CPI comes in at 3.4%, above 3.2% consensus" → event=CPI, actual=3.4
  "Nonfarm Payrolls prints 275K vs 250K expected" → event=NFP, actual=275
  "FOMC holds rate unchanged at 5.25-5.50%" → event=FOMC, actual=hold
```

**6. Surprise Calculator** (`src/ai/surprise-calculator.ts`)
```
Input: event name, actual, forecast, previous, historical data points
Output: SurpriseResult { surpriseScore, direction, cryptoBias }

Steps:
  1. Fetch history via sosovalue-client.getEventHistory()
  2. Calculate stddev of (actual - forecast) across history
  3. Compute surprise_score = (actual - forecast) / stddev
  4. Apply event-type mapping:
     - CPI: above_forecast → BEARISH, below → BULLISH
     - Nonfarm Payrolls: above → BEARISH, below → BULLISH
     - FOMC Rate: hike → BEARISH, cut → BULLISH, hold → NEUTRAL
     - Unemployment: above → BULLISH, below → BEARISH
     - GDP: above → BULLISH, below → BEARISH
  5. Return result
```

**Verify**: Feed it real CPI history data, check surprise scores are sensible.

**6. Macro-Crypto Mapping Table** (`src/ai/event-mappings.ts`)
```typescript
// This is the domain knowledge that makes the agent valuable
const EVENT_CRYPTO_MAP: Record<string, EventMapping> = {
  'CPI': {
    aboveForecast: 'bearish',   // Inflation hot → tighter policy → risk-off
    belowForecast: 'bullish',   // Inflation cool → looser policy → risk-on
    impactMagnitude: 'high',
    typicalBtcMove: 2.5,        // ~2.5% avg BTC move on CPI surprise
  },
  'Nonfarm Payrolls': {
    aboveForecast: 'bearish',   // Strong jobs → no rate cuts
    belowForecast: 'bullish',   // Weak jobs → rate cuts likely
    impactMagnitude: 'high',
    typicalBtcMove: 2.0,
  },
  // ... 10-15 more events
};
```

### Afternoon (3-4 hours)

**7. Conviction Engine** (`src/ai/conviction-engine.ts`)
```
Input: SurpriseResult + news headlines + market snapshot + ETF flows
Output: TradeDecision { conviction, confidence, reasoning, action }

Steps:
  1. Gather all context:
     - Surprise score from calculator
     - Last 10 news headlines from SoSoValue
     - BTC price, 1h change, 24h volume
     - ETF flow data (last 3 days)
  2. Build prompt (from prompts.ts)
  3. Call Claude API with structured output request
  4. Parse response → validate with zod schema
  5. Apply conviction → action mapping:
     - STRONG_BEAR/STRONG_BULL + confidence > 70 → trade
     - BEAR/BULL + confidence > 75 → trade  
     - NEUTRAL or low confidence → NO_TRADE
  6. Store decision in DecisionStore
  7. Return TradeDecision
```

**Verify**: Simulate a CPI event (actual=3.4, forecast=3.2) with real news data. Confirm the AI returns a coherent bearish decision with reasoning.

### Day 2 Deliverable
- [ ] Surprise calculator produces correct scores from real historical data
- [ ] Event mapping table covers major macro events
- [ ] AI conviction engine produces structured trade decisions
- [ ] Full reasoning chain captured and stored in database

---

## Day 3: Execution — SoDEX EIP-712 Signing + Order Placement

**Goal**: Place a real trade on SoDEX testnet, signed correctly. This is the hardest day.

### Morning (4-5 hours — budget extra time)

**8. EIP-712 Signer** (`src/services/sodex-signer.ts`)
```
THIS IS THE CRITICAL PATH. Study the Go SDK first:
  - github.com/sodex-tech/sodex-go-sdk-public/common/signer/
  - github.com/sodex-tech/sodex-go-sdk-public/perps/signer/

Key gotchas (from docs):
  1. JSON field order MUST match Go struct order
  2. DecimalString fields are JSON strings ("0.001" not 0.001)
  3. omitempty fields must be omitted when unset
  4. Nonce = timestamp in milliseconds (must be unique)
  5. Signature = 0x01 + raw 65-byte sig (NOT just the raw sig)
  6. Domain name = "futures" for perps (NOT "perps")
  7. X-API-Key header = the KEY NAME string, not the address

Build:
  - computePayloadHash(type, params) → keccak256(compact JSON)
  - signAction(payloadHash, nonce, domain, chainId, privateKey) → typed sig
  - Full field-order reference for newOrder, cancelOrder

Test strategy: compare your payloadHash output against the example in docs:
  Input: the exact example payload from docs
  Expected hash: 0x7521d1cadbcfa91eec65aa16715b94ffc1c9654ba57ea2ef1a2127bca1127a83
  If they don't match → your field order or serialization is wrong
```

### Afternoon (3-4 hours)

**9. Order Builder + Executor** (`src/executor/order-builder.ts`, `order-executor.ts`)
```
Order Builder:
  - Takes TradeDecision + risk parameters
  - Outputs SoDEX order payload with correct field order
  - Handles: clOrdID generation, side mapping, position side

Order Executor:
  - Signs payload via signer
  - Sends POST with X-API-Key, X-API-Sign, X-API-Nonce headers
  - Handles response: success → store trade, error → log and retry
  - After main order fills: place TP/SL orders

VERIFY WITH A REAL TESTNET TRADE:
  1. Place a small market buy of BTC-USD (0.001 BTC)
  2. Confirm it appears in your SoDEX testnet positions
  3. Place a limit sell to close it
  4. Confirm position closes

This is the make-or-break test. If signing works → you're ahead of 90% of competitors.
If it fails → debug until it works. Don't move to Day 4 until you can place and close a trade.
```

### Day 3 Deliverable
- [ ] EIP-712 signing produces correct signatures
- [ ] Payload hash matches reference example
- [ ] Successfully placed a trade on SoDEX testnet
- [ ] Successfully closed a trade on SoDEX testnet
- [ ] TP/SL order attachment working

---

## Day 4: Risk Engine + SSI Manager + Full Pipeline Integration

**Goal**: Connect everything end-to-end. Feed fake event data in one end, get real trades out the other — BOTH perps AND SSI spot rotation.

### Morning (4 hours)

**10. Risk Engine** (`src/risk/`)
```
Position Sizer:
  - Fetch balance from SoDEX
  - Calculate ATR from klines
  - Apply formula: size = (balance * maxRisk) / (ATR * 1.5)
  - Cap leverage at maxLeverage
  - Return: { quantity, leverage, stopLoss, takeProfit }

Risk Limits Check:
  - Count open positions (< maxOpenPositions?)
  - Check drawdown (< maxDrawdown?)
  - Check cooldown timer (> minTimeBetweenTrades?)
  - Check daily trade count (< maxDailyTrades?)
  - All must pass → proceed to execution
  - Any fail → return NO_TRADE with reason

Portfolio Tracker:
  - Poll positions every 10 seconds
  - Calculate unrealized P&L
  - Calculate drawdown from high-water mark
  - If drawdown > threshold → emit KILL_SWITCH event
```

**11. SSI Manager** (`src/services/ssi-manager.ts`)
```
This is what separates MARA from a generic trading bot.

Build:
  - getHoldings() → query SoDEX spot balances for SSI tokens
    (MAG7.ssi, DEFI.ssi, MEME.ssi, USSI)
  - computeRotation(conviction) → based on direction:
    BEARISH: sell 20% risk-on SSI (MAG7, MEME) → buy USSI
    BULLISH: sell 20% USSI → buy MAG7/DEFI
    NEUTRAL: no rotation
    Cap: max 20% shift per event (gradual, never all-in)
  - executeRotation(plan) → place spot orders on SoDEX
    Uses same EIP-712 signer but with domain.name = "spot"
    Handles partial fills gracefully

IMPORTANT: The spot signing uses domain name "spot" not "futures".
           chainId is the same as perps.
           Field order for spot orders may differ from perps — check Go SDK.

Verify: Buy a small amount of any available spot token on testnet.
If SSI tokens aren't on testnet, use any available spot pair to prove
spot signing works, and document that SSI rotation would use same code path.
```

### Afternoon (3 hours)

**12. Full Pipeline Integration** (`src/index.ts`)
```
Wire everything together:
  1. News Scanner + History Watcher → dual-path detection
  2. Event Reconciler → deduplicates, emits single trigger
  3. Event fires → surprise calculator runs
  4. Surprise + context → conviction engine (AI)
  5. Decision → risk engine validates
  6. If approved → DUAL EXECUTION:
     a. Executor places perps trade on SoDEX
     b. SSI Manager executes portfolio rotation on SoDEX spot
  7. Position monitor starts tracking both
  8. Everything logged to SQLite

INTEGRATION TEST:
  - Manually trigger the pipeline with simulated event data
  - But ALL API calls are real (real news, real prices, real SoDEX trades)
  - Only the "event fired" trigger is simulated
  - Confirm: event → decision → perps trade + SSI rotation → monitoring
```

**13. Kill Switch** (`src/executor/kill-switch.ts`)
```
  - On KILL_SWITCH event: cancel all open orders, close all perps positions
  - Halt SSI rotations (but don't sell SSI holdings — they're spot, not leveraged)
  - Log the kill switch activation with full state snapshot
  - Prevent any new trades until manual reset
```

### Day 4 Deliverable
- [ ] Risk engine correctly sizes positions
- [ ] Risk limits block trades when they should
- [ ] SSI Manager can read holdings and compute rotation plan
- [ ] SSI spot trade executes on SoDEX testnet (or proves signing works with available pair)
- [ ] Full pipeline works end-to-end (simulated trigger → real perps trade + SSI rotation)
- [ ] Kill switch tested and working
- [ ] All decisions + trades logged with full reasoning

---

## Day 5: Dashboard — The Presentation Layer

**Goal**: Build the React dashboard that makes the agent's intelligence visible.

### Full Day (6-8 hours)

**13. Backend API** (`src/api/`)
```
REST endpoints:
  GET /api/events          → upcoming + recent events
  GET /api/decisions       → all decisions with reasoning
  GET /api/trades          → trade history with P&L
  GET /api/performance     → cumulative stats
  GET /api/risk            → current risk state
  GET /api/news            → cached news that influenced decisions
  POST /api/trigger        → manually trigger analysis (for demo)
  POST /api/kill-switch    → emergency stop

WebSocket:
  /ws → streams live updates: new events, decisions, trades, risk changes
```

**14. React Dashboard** (`dashboard/`)
```
5 panels, keep it functional not flashy:

1. EVENT CALENDAR (left sidebar)
   - List of upcoming macro events with dates
   - Color-coded: gray=upcoming, yellow=watching, red/green=fired
   - Countdown timers for next 3 events
   - Click event → shows history + typical impact

2. AGENT FEED (center, main panel)
   - Reverse-chronological stream of agent actions
   - Each entry is a "reasoning card":
     ┌─────────────────────────────────────┐
     │ 🔴 CPI Release — STRONG BEAR (82%) │
     │ Actual: 3.4% | Forecast: 3.2%      │
     │ Surprise: +1.33σ                    │
     │                                     │
     │ "CPI surprise significantly reduces │
     │  probability of near-term cuts..."  │
     │                                     │
     │ → SHORT 0.27 BTC @ $108,500        │
     │   SL: $109,175 | TP: $107,150      │
     │                                     │
     │ News: "CPI hot at 3.4%..." +2 more │
     └─────────────────────────────────────┘

3. TRADE HISTORY (tab within center)
   - Table: time, event, side, entry, exit, P&L, status
   - Click row → expands full reasoning card

4. PERFORMANCE (right panel, top)
   - Line chart: cumulative P&L over time
   - Stats: win rate, avg R, total trades, Sharpe estimate

5. RISK PANEL (right panel, bottom)
   - Current account balance
   - Open positions count / max
   - Current drawdown / max allowed
   - Kill switch button (big red)
   - Agent status: ACTIVE / PAUSED / KILLED

Tech: React + Vite + Tailwind + Recharts for charts
Keep it clean, dark-theme, monospace for numbers.
```

### Day 5 Deliverable
- [ ] Backend API serves all data
- [ ] WebSocket streams live updates
- [ ] All 5 dashboard panels rendering with real data
- [ ] Manual trigger button works (place test trade from UI)
- [ ] Kill switch button works

---

## Day 6: Polish, Edge Cases, Demo Recording Prep

**Goal**: Make it demo-ready. Fix bugs. Record a dry run.

### Morning (3-4 hours)

**15. Edge Cases + Hardening**
```
Handle:
  - SoSoValue API returns empty events → graceful "no events today"
  - SoDEX order rejected → log reason, don't crash
  - AI returns malformed JSON → retry with stricter prompt
  - Network timeout → retry logic already in place
  - Testnet out of funds → display clear error
  - Multiple events on same day → process sequentially with cooldown
  - News API returns no relevant news → proceed with macro data only
  - WebSocket disconnect → auto-reconnect

Add:
  - Startup self-test: verify all API connections before going live
  - Graceful shutdown: close positions prompt on Ctrl+C
  - Better logging: structured JSON logs with timestamps
```

**16. Loading Historical Performance**
```
  - Pre-populate database with 5-10 simulated historical decisions
  - Use REAL historical macro data from SoSoValue API
  - This way the dashboard isn't empty during demo
  - These are clearly marked as "backtest" not "live"
```

### Afternoon (3-4 hours)

**17. Demo Script + Dry Run**
```
Write exact demo script:

1. Show dashboard — explain panels (30s)
2. Show upcoming events on calendar (15s)
3. Hit manual trigger with a simulated CPI event (or wait for a real one)
4. Watch agent feed populate in real-time:
   - Surprise calculation appears
   - AI reasoning appears
   - Trade execution appears
5. Show trade in SoDEX testnet UI (proof it's real)
6. Show risk panel (position sizing, stop-loss)
7. Show performance chart with backtest data
8. Hit kill switch — show positions close
9. Show code: SoSoValue integration, SoDEX signing, AI prompt

Record a dry run. Note what breaks. Fix it.
```

### Day 6 Deliverable
- [ ] All edge cases handled gracefully
- [ ] Historical backtest data populated
- [ ] Demo script written and rehearsed
- [ ] One complete dry run recorded (even if rough)
- [ ] All critical bugs fixed

---

## Day 7: Demo Recording + Submission

**Goal**: Record final demo, write documentation, submit.

### Morning (3 hours)

**18. Final Demo Recording**
```
Format: 3-5 minute screen recording
Tools: OBS or Loom

Structure:
  0:00 - 0:30  "MacroMind is a macro-triggered autonomous trading agent"
               Show dashboard overview
  0:30 - 1:00  Show SoSoValue data flowing in (events, news, prices)
  1:00 - 2:00  Trigger an event → watch full pipeline execute
               Emphasize: "This is a REAL trade on SoDEX testnet"
  2:00 - 2:30  Show the reasoning card — full transparency
  2:30 - 3:00  Show risk controls — position sizing, kill switch
  3:00 - 3:30  Show code: SoSoValue API integration, SoDEX signing
  3:30 - 4:00  "MacroMind hits every bonus category..." 
               Flash the rubric mapping on screen
  4:00 - 4:30  Future vision: mainnet, more events, portfolio mode
```

**19. Documentation for Submission**
```
README.md:
  - What it is (2 sentences)
  - How it works (the pipeline diagram)
  - Setup instructions (env vars, npm install, npm start)
  - Demo video link
  - Architecture overview
  - API integration details (which endpoints, why)
  - Screenshots of dashboard
  - Rubric mapping table (show you know what they're grading)

Make sure repo is clean:
  - .env.example (no real keys!)
  - No node_modules committed
  - Clear folder structure
  - Comments in critical code (especially signer)
```

### Afternoon (2-3 hours)

**20. Submit on AKINDO**
```
  - Upload to GitHub
  - Fill out AKINDO submission form
  - Attach demo video
  - Link documentation
  - Double-check all required fields
  - Submit

Then: join the SoSoValue Discord/Telegram, share your submission,
ask for feedback. Community engagement matters in buildathons.
```

### Day 7 Deliverable
- [ ] Demo video recorded (3-5 min)
- [ ] README.md complete
- [ ] GitHub repo clean and public
- [ ] Submitted on AKINDO
- [ ] Shared in community channels

---

## Daily Time Estimates

| Day | Focus | Estimated Hours |
|---|---|---|
| 0 | Setup + verify APIs | 0.5h |
| 1 | Data layer (both API clients + DB) | 6-8h |
| 2 | AI engine (surprise calc + conviction) | 6-8h |
| 3 | SoDEX signing + execution | 7-9h |
| 4 | Risk engine + full integration | 6-8h |
| 5 | Dashboard | 6-8h |
| 6 | Polish + demo prep | 6-8h |
| 7 | Demo + docs + submit | 5-6h |
| **Total** | | **~43-55h** |

Day 3 is the highest-risk day. If EIP-712 signing takes longer, steal time from Day 5 (simplify dashboard) or Day 6 (skip historical backtest data).

---

## What To Do If You're Behind

**Behind by 1 day**: Cut the dashboard to 3 panels (Agent Feed, Trade History, Risk Panel). Drop Event Calendar and Performance Chart.

**Behind by 2 days**: Skip the dashboard entirely. Build a CLI-only agent that logs to console + SQLite. Record the demo as terminal output. A working CLI agent with real SoDEX trades beats a pretty dashboard with mock data every time.

**SoDEX signing won't work**: Fall back to SoDEX read-only (orderbook + prices) and generate trade *recommendations* instead of executing them. You lose the SoDEX bonus but keep everything else. This is a last resort — exhaust debugging options first (check: field order, string vs number, omitempty, nonce range, signature prefix).
