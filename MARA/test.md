# MARA — Test & Acceptance Criteria

**(M**acro-**A**ware **R**esearch **A**gent**)**

Use this as your gate check before submission. Every item must pass. When working with AI assistants, paste the relevant section and ask them to verify your code against it.

---

## GATE 1: API Connectivity (Must pass before ANY other work)

### SoSoValue API
```
[ ] GET /macro/events returns a non-empty array
[ ] GET /macro/events/CPI/history returns actual/forecast/previous data
[ ] GET /news returns news items with titles and matched_currencies
[ ] GET /news/hot returns items
[ ] GET /currencies/{btc_id}/market-snapshot returns price > 0
[ ] GET /currencies/{btc_id}/klines?interval=1h returns OHLCV data
[ ] GET /etfs/summary-history returns ETF flow data
[ ] All responses have correct types (numbers are numbers, strings are strings)
[ ] Rate limiting doesn't break the client (back off on 429)
[ ] API key is passed correctly in x-soso-api-key header
```

**How to verify:**
```bash
# Run this script — every call should succeed
npx tsx scripts/test-sosovalue-api.ts
```

### SoDEX API (Read)
```
[ ] GET /perps/markets/symbols returns at least BTC-USD
[ ] GET /perps/markets/tickers returns price data for BTC-USD
[ ] GET /perps/markets/BTC-USD/orderbook returns bids and asks arrays
[ ] GET /perps/markets/BTC-USD/klines?interval=1h returns candle data
[ ] GET /perps/accounts/{your_address}/balances returns a balance object
[ ] GET /perps/accounts/{your_address}/positions returns (empty is fine if no positions)
[ ] GET /perps/accounts/{your_address}/orders returns (empty is fine)
[ ] Testnet perps endpoint responds: https://testnet-gw.sodex.dev/api/v1/perps/markets/symbols

SoDEX SPOT (for SSI token rotation):
[ ] GET /spot/markets/symbols returns available spot pairs
[ ] GET /spot/markets/tickers returns spot price data
[ ] GET /spot/accounts/{your_address}/balances returns spot balances
[ ] Testnet spot endpoint responds: https://testnet-gw.sodex.dev/api/v1/spot/markets/symbols
[ ] Note which SSI tokens (MAG7.ssi, DEFI.ssi, MEME.ssi, USSI) are available on testnet: _____
    If none → plan to demo spot signing with any available pair + document SSI intent
```

**How to verify:**
```bash
npx tsx scripts/test-sodex-read.ts
```

**STOP HERE if any fail. Fix before proceeding.**

---

## GATE 1.5: Dual-Path Event Detection (News Scanner)

### News Scanner Pattern Matching
```
[ ] Given headline: "CPI comes in at 3.4%, above 3.2% consensus"
    Extracted: event = "CPI", actual = 3.4
    
[ ] Given headline: "Nonfarm Payrolls prints 275K vs 250K expected"
    Extracted: event = "Nonfarm Payrolls", actual = 275
    
[ ] Given headline: "FOMC holds rate unchanged at 5.25-5.50%"
    Extracted: event = "FOMC", actual = "hold"
    
[ ] Given headline: "Bitcoin drops 2% on profit taking" (NOT a macro event)
    Result: no match (false positive avoided)
    
[ ] Given headline: "Analyst expects CPI to come in at 3.3%" (prediction, not release)
    Result: no match (future tense / expectation, not actual release)
```

### Event Reconciler Logic
```
[ ] News trigger fires first → pipeline starts immediately
[ ] History data arrives 2 min later → enriches with precise forecast/previous
[ ] Same event doesn't fire twice within 10 min window
[ ] If ONLY news fires (no history data after 5 min) → proceeds with lower confidence
[ ] If ONLY history fires (no matching news) → proceeds normally with history data
```

---

## GATE 2: Data Processing (Surprise Calculator)

### Historical Data Processing
```
[ ] Given CPI history with 20+ data points:
    - Standard deviation of (actual - forecast) is calculated correctly
    - Manual spot-check: pick 3 data points, calculate by hand, compare
[ ] Surprise score formula: (actual - forecast) / stddev
    - If forecast = 3.2, actual = 3.4, stddev = 0.15
    - Expected surprise_score ≈ 1.33
    - Your output: ______ (fill in and compare)
```

### Event-Crypto Mapping
```
[ ] CPI actual > forecast → cryptoBias = "bearish"
[ ] CPI actual < forecast → cryptoBias = "bullish"
[ ] CPI actual ≈ forecast (within 0.5 stddev) → cryptoBias = "neutral"
[ ] Nonfarm Payrolls actual > forecast → cryptoBias = "bearish"
[ ] Nonfarm Payrolls actual < forecast → cryptoBias = "bullish"
[ ] At least 8 event types mapped with correct directional logic
[ ] Mapping table has impactMagnitude (high/medium/low) for each event
```

### Edge Cases
```
[ ] Forecast = 0 doesn't cause division by zero
[ ] Negative values handled (some macro indicators can be negative)
[ ] Missing historical data (< 5 points) → returns low confidence
[ ] Event name not in mapping table → falls back to LLM-only analysis
```

---

## GATE 3: AI Decision Engine

### LLM Integration
```
[ ] Claude API call succeeds with your prompt
[ ] Response is valid JSON (not markdown-wrapped)
[ ] Response contains all required fields:
    - conviction: one of STRONG_BULL|BULL|NEUTRAL|BEAR|STRONG_BEAR
    - confidence: number 0-100
    - reasoning: non-empty string
    - key_factors: array with 1-5 items
    - risk_flags: array (can be empty)
[ ] Malformed response triggers retry (up to 3 attempts)
[ ] After 3 failed attempts → decision = NO_TRADE with reason "ai_failure"
```

### Decision Quality Checks
Run these scenarios and verify the AI produces sensible output:

```
[ ] SCENARIO A: CPI +2σ surprise, bearish news, ETF outflows
    Expected: STRONG_BEAR or BEAR, confidence > 65
    Your result: conviction=______ confidence=______

[ ] SCENARIO B: CPI inline (0σ), mixed news, neutral ETF flows  
    Expected: NEUTRAL, confidence 40-60
    Your result: conviction=______ confidence=______

[ ] SCENARIO C: NFP miss (-1.5σ), bullish news, ETF inflows
    Expected: STRONG_BULL or BULL, confidence > 65
    Your result: conviction=______ confidence=______

[ ] SCENARIO D: Contradictory signals (bearish macro, bullish news)
    Expected: Lower confidence (< 65), may be NEUTRAL or NO_TRADE
    Your result: conviction=______ confidence=______
```

### Reasoning Transparency
```
[ ] Every decision has a non-empty reasoning string
[ ] Reasoning references the actual macro data (not generic)
[ ] Reasoning mentions at least one news headline
[ ] Reasoning is stored in SQLite decisions table
[ ] Reasoning is retrievable via GET /api/decisions
```

---

## GATE 4: SoDEX Signing & Execution (THE CRITICAL GATE)

### EIP-712 Signing Correctness
```
[ ] Payload hash test:
    Input: exact example from SoDEX docs (the newOrder JSON)
    Expected hash: 0x7521d1cadbcfa91eec65aa16715b94ffc1c9654ba57ea2ef1a2127bca1127a83
    Your hash: ________________________________
    MATCH: [ ] YES  [ ] NO — if NO, stop and fix before continuing

[ ] JSON field order matches Go struct order:
    PerpsOrderItem: clOrdID, modifier, side, type, timeInForce, 
    price, quantity, funds, stopPrice, stopType, triggerType, 
    reduceOnly, positionSide
    → Verified by comparing with Go SDK source

[ ] DecimalString fields serialized as strings:
    price: "108500.0" (NOT 108500.0)
    quantity: "0.001" (NOT 0.001)

[ ] omitempty fields omitted when not set:
    price absent for market orders (NOT price: null, NOT price: "")

[ ] Nonce is millisecond timestamp and unique per request
    Two consecutive calls have different nonces

[ ] Signature has 0x01 prefix:
    Length = 2 (0x) + 2 (01) + 130 (65 bytes hex) = 134 characters
    Starts with 0x01

[ ] Domain name = "futures" (NOT "perps")
[ ] ChainId = 138565 for testnet (NOT 286623 — that's mainnet)
[ ] VerifyingContract = 0x0000000000000000000000000000000000000000
```

### Actual Trade Execution
```
[ ] TEST TRADE 1: Market buy 0.001 BTC-USD
    - Order accepted (no signature error)
    - Position appears in GET /accounts/{addr}/positions
    - Position shows correct side and quantity

[ ] TEST TRADE 2: Market sell to close position
    - Order accepted
    - Position closed (positions list empty or reduced)

[ ] TEST TRADE 3: Limit order
    - Placed below market (buy) or above market (sell)
    - Appears in open orders: GET /accounts/{addr}/orders
    - Cancel order works
    - Order disappears from open orders

[ ] TEST TRADE 4: Order with TP/SL
    - Place market order
    - Attach stop-loss order (stopType, stopPrice, triggerType fields)
    - Attach take-profit order
    - Both appear in open orders
    - Close position manually → TP/SL orders cancel

[ ] ERROR HANDLING:
    - Insufficient balance → error logged, no crash
    - Invalid symbol → error logged, no crash
    - Nonce reuse → error caught, retried with new nonce
    - Network timeout → retry with backoff
```

---

## GATE 5: Risk Engine

### Position Sizing
```
[ ] Given:
    - Account balance: 10,000 USDC
    - ATR(14): 450
    - maxRiskPerTrade: 0.02
    - Leverage: 3x
    
    Expected risk_amount = 10000 * 0.02 = 200
    Expected stop_distance = 450 * 1.5 = 675
    Expected raw_position = 200 / 675 = 0.296 BTC
    Expected margin = 0.296 * price / 3 = varies
    
    Your output: quantity=______ margin=______
    Within 5% of expected: [ ] YES  [ ] NO

[ ] Position size never exceeds account balance / leverage
[ ] Leverage capped at maxLeverage (5x default)
[ ] Stop-loss set at entry ± (ATR * 1.5)
[ ] Take-profit set at entry ± (ATR * 3.0)
```

### Risk Limits
```
[ ] Block trade when open positions >= 3 → returns NO_TRADE
[ ] Block trade when drawdown >= 5% → returns NO_TRADE
[ ] Block trade when confidence < 60 → returns NO_TRADE
[ ] Block trade when last trade was < 5 min ago → returns NO_TRADE
[ ] Block trade when daily trade count >= 10 → returns NO_TRADE
[ ] Block trade when orderbook depth < $1000 → returns NO_TRADE
[ ] Allow trade when ALL limits pass
```

### Kill Switch
```
[ ] When drawdown exceeds threshold:
    - All open orders cancelled
    - All positions closed (market orders)
    - Agent status set to KILLED
    - No new trades accepted
    - Kill switch event logged with full state snapshot
    
[ ] Manual kill switch (API call):
    - POST /api/kill-switch → same behavior as above
    - Response confirms kill switch activated
```

---

## GATE 5.5: SSI Portfolio Rotation

### SSI Holdings Detection
```
[ ] SSI Manager can query SoDEX spot balances
[ ] Correctly identifies SSI tokens (MAG7.ssi, DEFI.ssi, MEME.ssi, USSI)
[ ] If no SSI tokens on testnet → uses available spot pair as proxy (documented)
[ ] Holdings returned with token name + balance + estimated USD value
```

### Rotation Logic
```
[ ] STRONG_BEAR conviction → plan: sell 20% MAG7.ssi, buy 20% USSI
[ ] STRONG_BULL conviction → plan: sell 20% USSI, buy 15% MAG7.ssi + 5% DEFI.ssi
[ ] NEUTRAL conviction → plan: no rotation (empty plan)
[ ] Rotation capped at 20% of portfolio per event (never all-in)
[ ] Zero holdings of a token → skip sell for that token (no error)
[ ] Rotation plan serializable to JSON for audit log
```

### Spot Execution
```
[ ] Spot signing uses domain.name = "spot" (NOT "futures")
[ ] Spot order placement succeeds on SoDEX testnet
[ ] Spot order appears in spot account history
[ ] Rotation results logged in database with decision_id linkage
```

---

### End-to-End Flow
```
Trigger a simulated event and verify the COMPLETE chain:

[ ] Step 1: Event detected → stored in events table with status WATCHING
[ ] Step 2: Event fires (actual value set) → status changes to FIRED
[ ] Step 3: Surprise calculator runs → surprise_score stored in events table
[ ] Step 4: News fetched → relevant headlines stored in news_cache
[ ] Step 5: AI decision made → decision stored in decisions table
[ ] Step 6: Risk check passes → (or blocks with reason)
[ ] Step 7: Order placed on SoDEX testnet → trade stored in trades table
[ ] Step 8: Position monitored → risk_snapshots table updated
[ ] Step 9: Event status → PROCESSED

Verify in database:
  SELECT * FROM events WHERE id = '{test_event}';    → has actual, surprise_score
  SELECT * FROM decisions WHERE event_id = '{...}';  → has conviction, reasoning
  SELECT * FROM trades WHERE decision_id = '{...}';  → has entry_price, sodex_order_id
  SELECT * FROM risk_snapshots ORDER BY timestamp DESC LIMIT 1;  → current state
```

### NO_TRADE Path
```
[ ] Low conviction event → decision stored with action=NO_TRADE
[ ] no_trade_reason is specific: "low_conviction" / "max_positions" / etc
[ ] No SoDEX order is placed
[ ] Dashboard shows the NO_TRADE decision with reasoning
```

### Multiple Events
```
[ ] Two events in same day → processed sequentially
[ ] Cooldown timer prevents back-to-back trades
[ ] Second event respects max positions from first trade
```

---

## GATE 7: Dashboard (Visual Verification)

### Panels Load with Real Data
```
[ ] Event Calendar shows upcoming events from SoSoValue API
    - At least 1 event visible (if events exist this week)
    - Countdown timer updates every second
    
[ ] Agent Feed shows decision history
    - Each card has: event name, conviction, confidence, reasoning
    - Cards are reverse-chronological
    - New decisions appear without page refresh (WebSocket)
    
[ ] Trade History table shows trades
    - Columns: time, event, side, entry, exit, P&L, status
    - Click/expand shows full reasoning card
    - Real SoDEX order IDs visible
    
[ ] Performance section shows stats
    - Cumulative P&L chart renders (even if flat)
    - Win rate calculated correctly
    - Total trades count matches database
    
[ ] Risk Panel shows current state
    - Balance matches SoDEX testnet balance
    - Open positions count is accurate
    - Drawdown percentage calculated
    - Kill switch button is visible and clickable
```

### Interactive Elements
```
[ ] Manual trigger button → fires analysis pipeline → result appears in Agent Feed
[ ] Kill switch button → confirmation dialog → positions close → status changes to KILLED
[ ] Clicking a trade row → expands to show full reasoning
[ ] Dashboard doesn't crash on empty data (first load)
[ ] WebSocket reconnects after disconnect
```

---

## GATE 8: Demo Readiness

### Demo Script Test Run
```
[ ] Can explain what MARA does in < 15 seconds
    ("MARA is an autonomous AI agent that detects macro events from SoSoValue,
     scores their crypto impact, and executes both perps hedges and SSI index
     rotations on SoDEX — full research-to-execution, zero human in the loop.")
[ ] Dashboard loads without errors on screen share
[ ] Manual trigger produces visible result within 10 seconds
[ ] Real SoDEX testnet perps trade visible in both dashboard and SoDEX UI
[ ] SSI rotation trade visible (or spot trade proving signing works)
[ ] Reasoning card is readable and makes sense
[ ] Risk panel shows accurate data
[ ] Kill switch works on camera
[ ] Can show code (SoSoValue integration — 11 endpoints) quickly
[ ] Can show code (SoDEX signing — both perps AND spot domains) quickly
[ ] Can show code (news scanner regex patterns) quickly
[ ] Video recording is 3-5 minutes
[ ] Audio is clear (if narrating)
```

### Submission Completeness
```
[ ] GitHub repo is public
[ ] README.md contains:
    - What it is (2 sentences)
    - Architecture diagram
    - Setup instructions
    - Environment variables (with .env.example)
    - Demo video link
    - API integration details
    - Screenshots
    
[ ] .env.example exists (no real keys)
[ ] .gitignore includes: .env, node_modules/, *.db
[ ] package.json has start script: "start": "npx tsx src/index.ts"
[ ] Code compiles without errors: npx tsc --noEmit
[ ] No hardcoded API keys anywhere in code
[ ] AKINDO submission form filled completely
[ ] Demo video uploaded and accessible
```

---

## GATE 9: Judging Criteria Mapping (Self-Audit)

Before submitting, verify you can answer YES to each:

### Required (all must be YES)
```
[ ] Does it genuinely integrate SoSoValue API?
    Evidence: 11 endpoints used (macro events, event history, news, hot news,
    search news, currency snapshot, klines, ETF history, indices, index
    constituents, index snapshot) — each serving a specific pipeline stage
    Not just: calling one endpoint and displaying raw JSON

[ ] Does it have a clear use case?
    One sentence: "Autonomous macro-event trading + SSI index rotation agent"
    
[ ] Does it have real user value?
    Value: replaces a 5-person fund team (researcher, analyst, trader,
    risk manager, portfolio allocator) with one autonomous agent

[ ] Does it complete a flow from data input to output?
    Flow: macro event (dual-detection via news + history) → surprise analysis
    → AI conviction → risk check → dual execution (perps + SSI spot) → P&L
```

### Bonus (count how many YES)
```
[ ] SoDEX API integration
    Evidence: EIP-712 signed trading on BOTH perps AND spot (dual domain signing)
    This alone puts you ahead of most submissions
    
[ ] AI-enhanced functionality  
    Evidence: Claude-powered conviction engine with structured JSON reasoning
    
[ ] Helps users discover opportunities
    Evidence: macro surprise detection via dual-path (news + data) = opportunity signals
    
[ ] Generates signals
    Evidence: surprise score → conviction score → trade signal, fully quantified
    
[ ] Explains markets
    Evidence: reasoning cards explain WHY each trade was made, in plain English
    
[ ] Risk control
    Evidence: position sizing, TP/SL, drawdown limits, kill switch, max position caps,
    SSI rotation caps (20% max per event)
    
[ ] Confirmation mechanisms
    Evidence: multi-signal confirmation (macro data + news sentiment + ETF flows 
    + price action + dual-path event detection agreement)
    
[ ] Security awareness
    Evidence: API keys never exposed, private keys in .env only,
    leverage caps, max exposure limits, no key exposure in frontend
    
[ ] Complete insight-to-action flow
    Evidence: the entire pipeline is insight-to-action by definition,
    with DUAL execution paths (perps + SSI rotation)
    
[ ] Product experience (panels, bots, workflows)
    Evidence: 6-panel dashboard with live updates, reasoning transparency, 
    SSI portfolio view, kill switch
```

**Bonus count: ____ / 10**

Target: 10/10. MARA is designed to hit every single one.

---

## Quick Regression Test (Run Before Every Demo)

```bash
# 1. APIs alive
curl -s -H "x-soso-api-key: $SOSOVALUE_API_KEY" \
  https://openapi.sosovalue.com/openapi/v1/macro/events | head -c 100
# Expected: JSON array

curl -s https://testnet-gw.sodex.dev/api/v1/perps/markets/symbols | head -c 100
# Expected: JSON with symbols

# 2. App starts
npm start &
sleep 5

# 3. Backend health
curl http://localhost:3001/api/events
# Expected: JSON array of events

curl http://localhost:3001/api/risk
# Expected: JSON with balance, positions, drawdown

# 4. Dashboard loads
# Open http://localhost:5173 in browser
# Expected: all 5 panels render without errors

# 5. Manual trigger
curl -X POST http://localhost:3001/api/trigger \
  -H "Content-Type: application/json" \
  -d '{"event": "CPI", "actual": 3.4, "forecast": 3.2, "previous": 3.1}'
# Expected: decision appears in Agent Feed within 10s

# 6. Kill switch
curl -X POST http://localhost:3001/api/kill-switch
# Expected: 200 OK, agent status = KILLED
```

If all 6 pass → you're demo-ready. Record it.
