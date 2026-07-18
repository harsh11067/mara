# MARA — Macro-Aware Research & Execution Agent

**(M**acro-**A**ware **R**esearch **A**gent**)**

## The One-Liner

An autonomous AI agent that detects macro events from SoSoValue's news + data feeds, scores the crypto impact using AI, and executes both perpetual futures hedges on SoDEX **and** SSI index rotations — closing the full research-to-execution loop with zero human intervention.

---

## The Problem (Why This Matters)

Every month, the U.S. government releases numbers: CPI (inflation), Nonfarm Payrolls (jobs), FOMC rate decisions. When these numbers drop, crypto moves — violently — in seconds.

The problem:

1. **A human trader** sees CPI come out at 3.4% vs expected 3.2%. They need to understand: is that bullish or bearish for BTC? How much? They Google, they think, they hesitate. By the time they open their exchange and click "sell," the move already happened.

2. **Existing bots** can trade fast, but they don't understand *why* a number matters. They're dumb pipes.

3. **The gap**: Nobody has connected structured macro data → AI interpretation → on-chain execution into a single autonomous loop.

MacroMind fills that gap.

---

## The Simplest Explanation

```
TWO DETECTION PATHS (whichever fires first):

PATH A — News-first (fast, ~10s after release):
  SoSoValue /news endpoint returns headline:
    "CPI comes in hot at 3.4%, above 3.2% consensus"
  → Agent extracts: event=CPI, actual=3.4, forecast=3.2
  → Trigger fires

PATH B — Data-first (reliable, ~1-5 min after release):
  SoSoValue /macro/events/CPI/history updates:
    actual=3.4, forecast=3.2, previous=3.1
  → Trigger fires (confirms Path A or acts as primary)

        ↓ (whichever fires first, other confirms)

AI analyzes:
  - "CPI higher than expected = inflation sticky"
  - "Fed less likely to cut rates"
  - "Risk-off for crypto"
  - Conviction: STRONG BEARISH (confidence: 82)
        ↓
Risk engine calculates:
  - Position size: 2% of account
  - Leverage: 3x
  - Stop-loss: 1.5 * ATR above entry
  - Take-profit: 3.0 * ATR below entry
        ↓
DUAL EXECUTION on SoDEX:

  1. PERPS (hedge/directional):
     SHORT BTC-USD perps on SoDEX
     TP/SL orders attached

  2. SSI ROTATION (portfolio rebalance):
     Reduce MAG7.ssi exposure (risk-off)
     Increase USSI allocation (delta-neutral safe haven)
        ↓
Dashboard shows:
  - The event, the analysis, both trades, the P&L
  - Full audit trail of agent reasoning
  - SSI portfolio allocation shift
```

---

## What Makes This Different From "ChatGPT + A Dashboard"

Most hackathon submissions will:
- Call the SoSoValue news API
- Pipe it through GPT
- Show a pretty UI

MARA is structurally different because:

1. **It acts, not just informs.** The output is real trades on SoDEX (perps + SSI spot rotations), not a text summary. This is the "insight-to-action" loop the judges explicitly want.

2. **Dual-path event detection.** The `/macro/events/{event}/history` endpoint updates with delay. The `/news` endpoint catches headlines faster. MARA uses both — news-first as the fast trigger, history as data confirmation. This is how real trading systems work, and it shows architectural maturity judges will recognize.

3. **SSI-native portfolio management.** When macro turns bearish, MARA doesn't just short BTC — it rotates SSI index allocations (reduce MAG7.ssi, increase USSI for delta-neutral safety). This shows you understand SoSoValue's *core product*, not just their API. SSI is their $15M baby. Building on it signals alignment with their business.

4. **It integrates SoDEX perps with EIP-712 signing.** This is the hardest integration in the buildathon. Most teams will skip it because the signing is complex. That's exactly why it's defensible — the judges will notice.

5. **It has a built-in risk management layer.** Position sizing, stop-losses, maximum drawdown limits, kill switch. The rubric explicitly calls out "risk control, confirmation mechanisms, and security awareness" as a bonus.

---

## How It Uses SoSoValue's Stack (Genuine Integration)

### SoSoValue Terminal API — The Data Brain

| Endpoint | What We Use It For |
|---|---|
| `GET /macro/events` | Calendar of upcoming events — the agent's schedule |
| `GET /macro/events/{event}/history` | Historical actual/forecast/previous — trains surprise model + confirms actual values |
| `GET /news` | **PRIMARY fast trigger** — headlines break before history updates; agent extracts actual values from headline text |
| `GET /news/hot` | High-engagement news — sentiment amplifier |
| `GET /news/search` | Targeted search for event-specific coverage post-trigger |
| `GET /currencies/{id}/market-snapshot` | Current price, volume, momentum — pre-trade check |
| `GET /currencies/{id}/klines` | Price history — volatility (ATR) for position sizing |
| `GET /etfs/summary-history` | ETF flows — institutional sentiment confirmation |
| `GET /indices` | SSI index list — for portfolio rotation decisions |
| `GET /indices/{ticker}/constituents` | SSI index composition — understanding what you're rotating into |
| `GET /indices/{ticker}/market-snapshot` | SSI index price — for execution |

That's **11 endpoints** — not decorative. Every one feeds a specific pipeline stage.

### SoDEX API — The Execution Arm

| Endpoint | Type | What We Use It For |
|---|---|---|
| `GET /perps/markets/symbols` | Perps | Available perps pairs |
| `GET /perps/markets/tickers` | Perps | Pre-trade price + spread check |
| `GET /perps/markets/{symbol}/orderbook` | Perps | Liquidity check before order |
| `POST /perps/trade/orders` | Perps | **Place perps trade** (EIP-712 signed) |
| `GET /perps/accounts/{addr}/positions` | Perps | Track position P&L |
| `GET /perps/accounts/{addr}/balances` | Perps | Risk calculation (% of portfolio) |
| `GET /spot/markets/symbols` | Spot | Available spot pairs (SSI tokens) |
| `GET /spot/markets/tickers` | Spot | SSI token prices |
| `POST /spot/trade/orders` | Spot | **Execute SSI rotation** (buy/sell MAG7.ssi, USSI etc.) |
| `GET /spot/accounts/{addr}/balances` | Spot | SSI token holdings |

Both spot AND perps — both sides of SoDEX.

### The Connection Between Them

SoSoValue provides the *why* (macro data + news + market context + SSI index intelligence).
SoDEX provides the *how* (perps for directional trades + spot for SSI portfolio rotation).
The AI agent is the *bridge* — it turns information into conviction, and conviction into a coordinated multi-instrument trade.

---

## The Agent's Decision Framework

### Step 1: Event Detection (Dual-Path)
**Path A — News-first (fast, ~10s post-release):**
Poll `GET /news?page_size=20` every 30 seconds. Pattern-match headlines against known macro event keywords (regex: `/CPI.*\d+\.\d%/`, `/Nonfarm.*\d+K/`, `/FOMC.*rate/`). When a match hits, extract the actual value from the headline text. This fires the trigger.

**Path B — Data-first (reliable, ~1-5 min post-release):**
Poll `GET /macro/events/{event}/history?limit=1` every 60 seconds for events that are "due today." When the latest entry's date matches today AND has a non-null `actual` value that wasn't there before, the trigger fires.

**Reconciliation:** Whichever fires first starts the pipeline. The other confirms. If news triggers first, the history data is used for precise surprise calculation once available. If history triggers first, the news is used for sentiment context.

### Step 2: Pre-Event Positioning
When an event is T-minus 5 minutes:
- Fetch historical data: `GET /macro/events/{event}/history`
- Calculate: what's the average BTC move when this event surprises to the upside vs downside?
- Fetch current market state: price, volume, open interest
- Fetch recent news sentiment: `GET /news?category=1`

### Step 3: Event Fires → Surprise Calculation
When the event data is released (detected via the API updating `actual` value):
```
surprise_score = (actual - forecast) / stddev(historical_surprises)
```
- Positive surprise on CPI → bearish crypto (tighter money)
- Negative surprise on Nonfarm Payrolls → bullish crypto (dovish Fed)
- Each event type has a pre-mapped directional bias

### Step 4: AI Confirmation
Feed the LLM:
- The raw surprise score
- The last 10 news headlines from SoSoValue
- Current BTC price action (klines from last 1h)
- ETF flow direction (last 3 days)

Ask: "Given this macro surprise and market context, what is your directional conviction (STRONG_BULL / BULL / NEUTRAL / BEAR / STRONG_BEAR) and why?"

The LLM response is structured JSON — not free text.

### Step 5: Risk Engine
```
max_risk_per_trade = 2% of account balance
volatility = ATR(14) from klines
position_size = max_risk_per_trade / (volatility * leverage)
stop_loss = entry ± (1.5 * ATR)
take_profit = entry ± (3.0 * ATR)
```

If conviction is NEUTRAL → no trade.
If orderbook liquidity < minimum threshold → no trade.
If existing open positions > 2 → no trade.

### Step 6: Dual Execution on SoDEX

**6a — Perps (directional hedge):**
Place a market order on SoDEX perps with:
- TP/SL orders attached
- Position side based on conviction direction
- Leverage capped at 5x (conservative for an autonomous agent)

**6b — SSI Rotation (portfolio rebalance):**
Based on conviction direction, adjust SSI index holdings via SoDEX spot:
- **BEARISH conviction**: Sell MAG7.ssi / MEME.ssi → Buy USSI (delta-neutral, earns funding rate)
- **BULLISH conviction**: Sell USSI → Buy MAG7.ssi / DEFI.ssi (risk-on exposure)
- **NEUTRAL**: No rotation
- Rotation size: capped at 20% of SSI portfolio per event (gradual, not all-in)

This dual execution is the "one-person fund manager" in action: hedging with derivatives while rotating index allocations — exactly what a $10M crypto fund does with a team of 5.

### Step 7: Monitoring & Logging
- Track perps P&L in real-time
- Track SSI portfolio NAV changes
- Log every decision with full reasoning chain
- If combined drawdown exceeds 5% → kill switch, close all perps, halt SSI rotations

---

## User-Facing Product

The agent runs as a backend service. The user interacts via a dashboard that shows:

1. **Event Calendar** — upcoming macro events with countdown timers
2. **Live Agent Feed** — real-time log of what the agent is thinking, seeing, deciding
3. **Trade History** — every trade with the full reasoning chain attached
4. **Performance** — cumulative P&L, win rate, average R-multiple
5. **Risk Controls** — current exposure, drawdown, kill switch status
6. **News Stream** — the SoSoValue news that informed each decision

The key UX principle: **transparency**. This isn't a black box. Every trade has an attached "reasoning card" showing exactly what data the agent saw and why it made the decision it made.

---

## Why This Wins (Mapped to Judging Criteria)

| Criteria | How MARA Delivers |
|---|---|
| **✅ Genuine SoSoValue API integration** | **11 endpoints** across macro, news, currencies, ETFs, and SSI indices — each feeding a specific pipeline stage |
| **✅ Clear use case** | Autonomous macro-event trading + SSI portfolio rotation |
| **✅ Real user value** | Replaces a 5-person fund team: researcher + analyst + trader + risk manager + portfolio allocator |
| **✅ Complete data→output flow** | Event → Surprise Analysis → AI Conviction → Risk Check → Dual Trade (perps + SSI) → P&L |
| **⭐ SoDEX API integration** | **Both perps AND spot** — perps for directional trades, spot for SSI token rotation. Full EIP-712 signing. |
| **⭐ AI-enhanced** | LLM conviction scoring with structured reasoning, not just API relay |
| **⭐ Opportunity discovery** | Macro surprise detection = opportunity signal generation |
| **⭐ Generates signals** | Surprise score → conviction score → trade signal, fully quantified |
| **⭐ Explains markets** | Every trade has a reasoning card explaining WHY in plain English |
| **⭐ Risk control** | Position sizing, TP/SL, drawdown limits, kill switch, max position caps |
| **⭐ Confirmation mechanisms** | Multi-signal: macro data + news sentiment + ETF flows + price action, all must align |
| **⭐ Security awareness** | Private keys in .env only, leverage caps, max exposure limits, no key exposure in frontend |
| **⭐ Insight-to-action flow** | The defining feature — research to dual execution in one autonomous loop |
| **⭐ Product experience** | 6-panel dashboard with live updates, reasoning transparency, kill switch |

It stacks every single bonus category. That's not an accident — it's architected to maximize the rubric.

---

## What This Is NOT

- It's not a chatbot that answers questions about crypto
- It's not a dashboard that shows charts
- It's not a research tool that requires human action
- It's not a paper-trading simulator

It's an **autonomous agent** that reads the macro calendar, understands what the numbers mean, decides whether to trade, executes both derivatives and index rotations on-chain, and manages risk — end to end, no human in the loop.

That's the "one-person business empire" vision that SoSoValue is pitching. MARA is a one-person hedge fund that uses every layer of SoSoValue's stack: Terminal for intelligence, SSI for index exposure, SoDEX for execution, all orchestrated by AI.
