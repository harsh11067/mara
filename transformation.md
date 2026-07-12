# MARA Wave 3 Transformation Plan: How to Win the SoSoValue Buildathon

## TL;DR
- **Deploy first, everything else second.** All 7 judges converged on one fatal flaw — no live public URL — so the single highest-leverage move is a free Vercel (frontend) + Render (backend) + Neon Postgres deployment, kept awake with a GitHub Actions cron ping. This alone lifts Functionality (43) and UX (46) more than any new feature.
- **Make the AI the visible decision-maker and prove an edge.** Convert MARA's one-shot Gemini call into a transparent agentic tool-use loop, and add a 90-day macro-surprise backtest vs a naive baseline (Sharpe / Sortino / max-drawdown / win-rate) plus a live HIT/STOP/DRIFT tracker — directly answering the "AI is supportive" and "no proof of edge" critiques.
- **Expand data + a judge-triggerable live testnet trade.** Grow from 11 to 30+ SoSoValue endpoints (all 9 modules), add a `/judges` script page and a live `/diag` integration-status page, and expose a rate-limited public "Run a live cycle" button that places a real EIP-712-signed SoDEX testnet order — the pattern the top projects (Mosaic, Sonar) used to score 81–84.

## Key Findings

**1. The Wave 2 scores tell a precise story.** MARA scored 58 / 43 / 57 / 47 / 46 (User Value / Functionality / Logic / Data / UX) while winners scored 81–84 across the board. The lowest scores were Functionality (43) and UX (46) — both are overwhelmingly explained by the absence of a live demo. The gap is not conceptual: MARA's architecture (dual-path macro scanner, statistical surprise model, Gemini conviction engine, ATR risk gates, dual-leg SoDEX execution, on-chain attestation) is already more ambitious than several winners. The problem is that none of it is verifiable because judges could only read the repo. "Deploying the product publicly should be the first priority for Wave 3" is a direct instruction; treat it as such.

**2. Free deployment is entirely achievable and reliable.** Render remains the only one of Render/Railway/Fly.io with a genuine no-credit-card permanent free tier. Railway removed its original free tier — CEO Jake Cooper announced the removal in a June 2, 2023 blog post, with existing users migrated on August 1, 2023, replaced by a 30-day/$5-credit trial and a paid minimum; Fly.io removed its free allowances in 2024. Render's one real downside is documented plainly: per Render's docs, "Render spins down a Free web service that goes 15 minutes without receiving any inbound traffic… A Free web service spins back up whenever it next receives an HTTP request… This process takes about one minute," with "750 free instance hours per workspace per calendar month." This is fully solvable for a demo. Recommended free stack: **Vercel** (React frontend, static, no sleep, edge CDN), **Render free web service** (Hono/Node backend), **Neon** serverless Postgres free tier.

**3. SoSoValue exposes far more than MARA uses.** The current API spans 9 modules and ~34 endpoints. MARA uses 11. Base URL `https://openapi.sosovalue.com/api/v1`, auth header `x-soso-api-key: <key>`, the Beta/Demo plan rate limit is 20 calls/min, and the Demo tier is free. Expanding to 30+ endpoints across all 9 modules is the fastest path to a top Data/API Integration score.

**4. SoDEX signing is fully documented and MARA already implements it.** Testnet chain ID 138565, gateway `https://testnet-gw.sodex.dev/api/v1` (spot `/spot`, perps `/perps`), EIP-712 domain name `spot`/`futures`, `verifyingContract` all-zeros, prepend byte `0x01` to the 65-byte signature. Critically, the testnet uses a central limit order book with thin/no market-maker liquidity, so market/IOC orders often expire unfilled — the plan must handle this gracefully in the demo.

**5. The winners' playbook is a checklist MARA can copy.** Live URL + `/judges` page + live `/diag` page + judge-triggerable live testnet cycle + verifiable track record + backtest with proper risk metrics + agentic AI + broader asset/regime coverage + SaaS vision. Every one of these is achievable on a free budget by a solo builder.

## Details

### Priority ranking by score-impact-per-effort

| Rank | Change | Effort | Primarily lifts | Why |
|------|--------|--------|-----------------|-----|
| 1 | **Live public deploy** (Vercel + Render + Neon + keep-alive) | Low–Med | Functionality, UX, all | Removes the single blocker every judge cited |
| 2 | **`/judges` + `/diag` pages, one-click sample demo** | Low | Functionality, UX | Makes the working system trivial to evaluate in 60s |
| 3 | **AI as core: agentic tool-use loop** | Med | Logic, User Value | Answers "AI is supportive not core" |
| 4 | **Proof-of-edge: backtest + HIT/STOP/DRIFT tracker** | Med | User Value, Logic, Data | Answers "no proof of trading edge" |
| 5 | **Expand to 30+ SoSoValue endpoints (9 modules)** | Med | Data/API Integration | Directly targets lowest non-demo score (47) |
| 6 | **Judge-triggerable live SoDEX testnet trade** | Med | Functionality, Data | Highest "wow", proves real integration |
| 7 | **Consumer UX reframe (onboarding, plain-English)** | Med | User Value, UX | Answers "research engine not a product" |
| 8 | **Beyond BTC/ETH/SOL + adaptive regime risk** | Med | User Value, Logic | The explicit BlessinSum suggestion |
| 9 | **SaaS future vision framing** | Low | User Value, vision | Judges reward long-term potential |

### 1. Free-tier deployment (the highest-leverage change)

**Recommended architecture:**
- **Frontend → Vercel free tier.** React/Vite static build, deployed from GitHub. No sleep, global CDN, production-ready free tier for a hobby/demo app. Set `VITE_API_URL` env var to the Render backend URL.
- **Backend → Render free web service.** The Hono/Node backend. 750 instance-hours/month per workspace (enough for one always-on service). Set root directory to `macromind`, build `npm install && npm run build`, start command as configured.
- **Database → Neon free Postgres.** Migrate from SQLite. This is not optional: Render's docs state verbatim that "Like all Render services, Free web services have an ephemeral filesystem. This means that any changes to your web service's filesystem (uploaded images, local SQLite databases, etc.) are lost every time the service redeploys, restarts, or spins down." A SQLite file would be wiped on every redeploy and on spin-down/restart, destroying MARA's event/trade/reasoning stores. Neon's free tier gives 100 projects, 0.5 GB storage per project, 5 GB egress, and compute that scales to zero after 5 minutes of inactivity — and it is standard Postgres, so migrating MARA's SQLite schema is straightforward. (Supabase is the alternative if bundled auth/storage is wanted, but Supabase Free pauses projects after 7 days of inactivity and limits you to two active free projects — worse for an always-available demo than Neon.)
- **CORS:** whitelist the exact Vercel domain(s) including `*.vercel.app` preview domains in the Hono CORS middleware.

**Solving the "backend sleeps" problem (critical for demo reliability):**
- Add a lightweight `GET /health` route (also doubles as the `/diag` data source).
- Create a **GitHub Actions scheduled workflow** (`.github/workflows/keepalive.yml`) running `cron: '*/10 * * * *'` that `curl`s `/health`. Free, version-controlled, always-on.
- Backup: cron-job.org (external, zero-maintenance) or UptimeRobot (free, 5-min pings, plus uptime reporting you can show judges).
- Even with keep-alive, put a friendly "waking up…" loading state in the frontend so a cold start never looks broken.

**Why not Railway/Fly.io:** both effectively require payment now (Railway ~$5/mo minimum, Fly.io ~$2–5/mo minimum, no permanent free tier). For a broke solo builder, Render free + Vercel + Neon is the only genuinely $0 path that yields a stable public URL.

### 2. The `/judges` and `/diag` pages (copy Mosaic)

**`/judges` page** — a zero-friction evaluation script:
- A 60-second test script: numbered steps a judge follows ("1. Click 'Load sample CPI surprise' → 2. Watch the agent reason → 3. See the risk gate → 4. Trigger a live testnet order").
- One-click **sample-thesis cards** that pre-load a realistic macro scenario (e.g. "CPI comes in +0.4% vs +0.2% expected") so the demo works instantly with zero setup even if no live macro event is happening.
- Links: live app, `/diag`, GitHub, demo video, ValueChain/Sepolia attestation contract, the backtest report.
- A short plain-English "what MARA does and why it's different" paragraph.

**`/diag` page** — a live integration-status dashboard:
- Calls **every** integration live on page load and shows real-time pass/fail with latency: SoSoValue API (per-module ping), SoDEX public read, SoDEX signed read (account state), Gemini API, database, WebSocket, on-chain attestation contract.
- Green/red status chips + last-checked timestamp + the actual response snippet. This single page is the strongest possible evidence for "Functionality & Working Demo" because it proves, live, that the 30+ endpoints and the signing pipeline actually work — not just that they're claimed in a README.

### 3. Judge-triggerable live SoDEX testnet trade (the "wow")

Architecture for a safe public demo trigger (Sonar's pattern):
- **All keys stay server-side.** The master wallet private key and API-key private key live only in Render env vars. The browser never sees them. MARA's README already claims this; the deploy makes it demonstrable.
- **Public rate-limited endpoint:** `POST /api/demo/live-cycle` protected by (a) a short server-side cooldown (e.g. 1 trade / 60s globally), (b) a hard cap on quantity (dust-sized testnet order), (c) reduce-only or tiny-notional safety, (d) an on/off kill switch. MARA already has `/api/trigger` and a kill switch — extend, don't rebuild.
- **The flow the judge sees:** click "Run live testnet cycle" → backend fetches live SoSoValue macro/market data → runs the agentic AI loop → passes risk gates → signs an EIP-712 order → submits to `testnet-gw.sodex.dev` → streams each step over WebSocket to the dashboard → shows the resulting order ID / on-chain record.

**Exact SoDEX order mechanics (from the trading-api docs, confirmed):**
- **Perps place order:** `POST /api/v1/perps/trade/orders`, body `PerpsNewOrderRequest = { accountID (uint64), symbolID (uint64), orders: [PerpsOrderItem] }`.
- **Spot place order:** `POST /api/v1/spot/trade/orders/batch` (note the `/batch` suffix — spot differs from perps), body `BatchNewOrderRequest` with `symbolID` per order item.
- **Order item fields, in the exact struct order the server re-marshals for signature verification:** `clOrdID`, `modifier`, `side`, `type`, `timeInForce`, `price`, `quantity`, `funds`, `stopPrice`, `stopType`, `triggerType`, `reduceOnly`, `positionSide`. `price`/`quantity`/`funds` are `DecimalString` (quoted strings, e.g. `"0.001"`, no exponential/trailing zeros); enums are sent as integers.
- **Enum integers:** `OrderType` LIMIT=1, MARKET=2. `OrderSide` BUY=1, SELL=2. `TimeInForce` GTC=1, FOK=2 (unsupported), IOC=3, GTX/PostOnly=4. `PositionSide` BOTH=1 (only BOTH supported in placement).
- **Signing:** compact JSON `payloadHash = keccak256(JSON.stringify({type, params}))`; EIP-712 `ExchangeAction{payloadHash, nonce}` signed with the API-key private key under domain `{name:"spot"|"futures", version:"1", chainId:138565, verifyingContract:0x00..00}`; prepend `0x01`; send headers `X-API-Key` (the key *name* string, not the address), `X-API-Sign`, `X-API-Nonce` (ms timestamp, tracked per signing address).
- **Resolve `symbolID` dynamically, never hardcode:** `GET /api/v1/perps/markets/symbols` (e.g. `BTC-USD`) and `GET /api/v1/spot/markets/symbols` (e.g. `vBTC_vUSDC`) each return objects with a numeric `id` used as `symbolID`, plus `tickSize`/`stepSize`/`minQuantity`/`minNotional` filters that will reject malformed orders. These are the same fixes ETFSignal AI documented.
- **Rate limits:** IP budget 1200 weight/min (place/cancel batch = `1 + floor(N/40)` weight); order-placement cap 600 orders/min and 20 orders/sec per account with an API key. Comfortably within a demo's needs.

**Handle the testnet liquidity quirk explicitly.** SoDEX testnet is a CLOB with thin/no market-maker liquidity, and market orders must be IOC — so a market/IOC order frequently finds no counterparty and is cancelled/expired (the schema's `EXPIRED` status explicitly covers "LIMIT IOC or MARKET orders that partially fill"). Two mitigations, both worth showing:
1. Place a **resting limit GTC order** (which sits on the book and is a valid, verifiable on-chain action) instead of a market order for the live demo, and/or
2. Show the order lifecycle honestly ("order placed → no counterparty on testnet book → expired per IOC rules"), which demonstrates real integration and real understanding rather than a faked fill.

**Testnet funding note:** faucet grants free USDC + SOSO daily (the amount is stated inconsistently — 100 USDC/day on the live faucet page vs 1,000 USDC/day in marketing; verify before relying on it). Onboarding requires a whitelisted wallet, then transferring faucet tokens from the EVM/funding account to the Spot account before trading; SOSO is the ValueChain gas token and must not be moved to spot.

### 4. SoSoValue API expansion — from 11 to 30+ endpoints across 9 modules

Base URL `https://openapi.sosovalue.com/api/v1`; header `x-soso-api-key`; 20 calls/min on the free Beta/Demo plan (so cache aggressively — MARA already has a price cache; extend it to a general TTL cache per module). The 9 modules and their endpoints MARA should integrate:

- **Currency & Pairs:** `/currencies`, `/currencies/{id}`, `/currencies/{id}/market-snapshot`, `/currencies/{id}/token-economics`, `/currencies/{id}/klines`, `/currencies/{id}/supply`, `/currencies/{id}/pairs`, `/currencies/sector-spotlight`, `/currencies/{id}/fundraising` (9)
- **ETF:** `/etfs/summary-history`, `/etfs`, `/etfs/{ticker}/market-snapshot`, `/etfs/{ticker}/history` (4) — ETF flows are a strong institutional-confirmation signal for the AI.
- **SoSoValue Index:** `/indices`, `/indices/{ticker}/constituents`, `/indices/{ticker}/market-snapshot`, `/indices/{ticker}/klines` (4) — powers the SSI rotation leg.
- **Crypto Stocks:** `/crypto-stocks`, `/crypto-stocks/{ticker}/market-snapshot`, `/crypto-stocks/{ticker}/market-cap`, `/crypto-stocks/{ticker}/klines`, `/crypto-stocks/sector`, `/crypto-stocks/sector/{name}/index` (6)
- **BTC Treasuries:** `/btc-treasuries`, `/btc-treasuries/{ticker}/purchase-history` (2)
- **Feeds/News:** `/news`, `/news/hot`, `/news/featured` (3) — MARA's fast-path scanner.
- **Fundraising:** `/fundraising/projects`, `/fundraising/projects/{id}` (2)
- **Macro:** `/macro/events`, `/macro/events/{event}/history` (2) — MARA's core trigger + the circuit-breaker source.
- **Analysis Charts:** `/analyses`, `/analyses/{chart_name}` (2)

That is ~34 endpoints. Even integrating 30 meaningfully (each surfaced somewhere in the UI or feeding the AI/risk logic) moves Data/API Integration from 47 toward the low-80s. A **macro circuit breaker** (like Sonar's) that reads `/macro/events` and auto-de-risks near CPI/FOMC/NFP is a high-value, low-effort addition that uses the macro module as a safety feature, not just a signal.

### 5. Making the AI the core decision-maker (answering jzddd)

Replace the single structured Gemini call with a **transparent agentic tool-use loop** (the Edgework pattern that scored 82):
- Define tools the LLM can call: `get_macro_surprise(event)`, `get_market_snapshot(asset)`, `get_etf_flows(ticker)`, `get_recent_news(n)`, `get_risk_state()`, `get_regime()`, `propose_trade(...)`. Gemini supports native function calling: declare tool schemas → model emits `functionCall` objects → backend executes → results fed back → model reasons again → loop until it emits a final decision.
- **Every number the AI cites is backed by a tool call** (Edgework's anti-hallucination guarantee). Display the tool-call trace in the UI: "AI called get_macro_surprise → got +2.1σ → called get_etf_flows → saw $230M outflow → concluded STRONG_BEAR." This makes the LLM visibly the orchestrator, not a rubber stamp on a statistical score.
- Show **how conviction evolves** (MuhammadBa's critique): log each intermediate reasoning step and let conviction update as tools return data, rendered as a timeline in the reasoning card.
- Keep the deterministic surprise math and risk gates as *tools the AI must consult*, so the AI is the decision-maker but is still constrained by hard risk rules — the best of both.

### 6. Proof-of-edge: backtest + track record (answering MuhammadBa)

**Backtest module** (a `/proof` or `/backtest` page):
- Strategy: MARA's macro-surprise signal (position sized in proportion to the normalized surprise, capped at ~3 standard deviations — the standard naive-PnL convention) vs a **naive baseline** (buy-and-hold BTC, and/or a simpler always-long macro rule).
- Metrics, computed and displayed: **Sharpe, Sortino, max drawdown, win rate, Calmar, and correlation to buy-and-hold.** For an honest reference point, Macrosynergy's published economic-surprise study finds that a naive strategy taking a position "in proportion to the global economic surprise indicators… up to a maximum of 3 standard deviations" had a "long-term Sharpe ratio… around 0.7 and the Sortino ratio 1.0-1.1," while noting "PnL generation has been extremely seasonal, focusing on periods of economic recession and recovery." MARA should report its own numbers against the baseline in that spirit.
- Robustness: a short **Monte Carlo** (e.g. 1000 paths) for VaR/CVaR and a couple of **historical regime stress tests** (a CPI shock, an FOMC surprise) — the Mosaic pattern. Even a modest version signals rigor.
- Be transparent it's a backtest on historical macro prints, not a claim of guaranteed returns.

**Live track record** (a `/track` page, Sonar/SoSoVault pattern):
- Every AI decision gets logged, then outcome-tracked as **HIT / STOP / DRIFT** (target hit / stopped out / expired-or-drifted). MARA already writes decisions to a reasoning store and on-chain attestation — add outcome resolution.
- Show **NAV-weighted return vs a buy-and-hold baseline**, per-thesis P&L attribution, and running win rate. This converts the on-chain attestation layer from a static claim into a living, verifiable performance page.

### 7. Consumer UX reframe (answering jzddd's "research engine not a product")

- **Onboarding:** a first-run overlay explaining in 3 steps what MARA does and one "Show me an example" button.
- **One-click demo:** the sample-thesis cards from the `/judges` page, surfaced on the main dashboard so a non-expert gets value in one click with no wallet/API setup.
- **Plain-English everywhere:** every conviction/score has a hover or caption translating it ("STRONG_BEAR = the data suggests prices likely fall; MARA is hedging"). MARA already has "Reasoning Cards" — make them the hero, not a side panel.
- **Progressive disclosure:** default to a simple "what's MARA doing right now and why" view; tuck the Bloomberg-terminal 6-panel grid behind an "Advanced/Pro" toggle. This keeps the depth (which judges liked) while fixing the "feels like an engine, not a product" perception.

### 8. Beyond BTC/ETH/SOL + adaptive regime risk (answering BlessinSum)

- **Expand the asset universe** using the Currencies, Indices, and Crypto-Stocks modules: add majors beyond BTC/ETH/SOL and SoSoValue's sector indices (Layer1, DeFi, MEME, MAG7.ssi, USSI). The SSI rotation leg already exists; widen it.
- **Adaptive regime model:** classify the current market into regimes (e.g. Bull-Quiet, Bull-Volatile, Ranging, Bear-Volatile, Crash) using ATR/realized-vol + trend strength (ADX) + a VIX-like threshold — the standard, well-documented approach. Then make risk parameters **regime-conditional**: in quiet regimes use a normal ATR multiplier and full size; in volatile/crash regimes automatically cut position size (commonly 25–50%), widen stops, or de-risk to USSI. Expose the current regime prominently in the UI and as a tool the AI must consult. This is exactly the "adaptive risk models responding to changing market regimes" that BlessinSum asked for, and it composes cleanly with the macro circuit breaker.

### 9. SaaS / real-product future vision (judges reward this)

Frame MARA's roadmap explicitly on a `/vision` section or in the README + demo:
- **Product:** an AI macro co-pilot for crypto that watches high-impact releases, explains them in plain English, and either auto-executes (pro tier) or sends signals (free tier).
- **Target users:** (1) active crypto traders who can't watch every CPI/FOMC print, (2) SSI/index investors wanting regime-aware rotation, (3) eventually funds wanting an auditable, on-chain-attested macro-execution agent.
- **Monetization:** free tier (signals, Telegram alerts) → Pro subscription (auto-execution, more assets, backtests) → potential performance-based/vault model on SoDEX mainnet. A **Telegram bot** with signal commands (the ETFSignal/SoSoMind pattern) is a cheap, high-signal addition that broadens reach and demonstrates a distribution channel.
- **Ecosystem fit:** MARA is a native SoSoValue+SoDEX consumer — it drives API usage and testnet volume, exactly what the buildathon sponsor wants to see scale.

## Recommendations

**Stage 1 — Ship the demo (do this first, non-negotiable).**
1. Migrate SQLite → Neon Postgres.
2. Deploy backend to Render free, frontend to Vercel free, wire `VITE_API_URL` and CORS.
3. Add `/health` + GitHub Actions cron keep-alive.
4. Confirm the public URL works cold and warm; add a "waking up" loading state.
Benchmark to advance: a judge can open the URL and see live data within 60 seconds without you present.

**Stage 2 — Make it trivially evaluable.**
5. Build `/judges` (60s script + one-click sample-thesis cards) and `/diag` (live status of all integrations).
6. Ensure the sample demo works with zero setup.
Benchmark: `/diag` shows all-green live; the sample card produces a full reason→risk→(mock or live) execution in one click.

**Stage 3 — Answer the specific critiques.**
7. Convert Gemini to an agentic tool-use loop with a visible tool-call trace.
8. Ship the backtest (`/proof`) and HIT/STOP/DRIFT track record (`/track`).
9. Expand to 30+ SoSoValue endpoints and add the macro circuit breaker.
Benchmark: Data/API count ≥30 shown on `/diag`; backtest reports Sharpe/Sortino/drawdown/win-rate vs baseline.

**Stage 4 — Differentiate and signal scale.**
10. Add the judge-triggerable live testnet trade (rate-limited, keys server-side, handle the IOC/liquidity quirk).
11. Add regime-adaptive risk + broader assets.
12. Add consumer onboarding/plain-English polish, the Telegram bot, and the SaaS vision framing.
Benchmark: a judge can trigger a real signed testnet order from the browser and see it on-chain.

**What would change this plan:** If Render's free tier proves too unreliable even with keep-alive during judging, spend the one unavoidable cost (~$7/mo Render Starter, one month only) — but only after exhausting the free keep-alive path. If time is short, protect Stages 1–2 above all: a live, evaluable, honest demo of the *existing* system beats a half-finished new feature that can't be run.

## Caveats
- **Free-tier limits are real.** SoSoValue's 20 calls/min free limit means MARA must cache; hammering 30+ endpoints live on every page load will rate-limit. Batch and cache per module with sensible TTLs.
- **Testnet liquidity.** Because SoDEX testnet has thin/no market-maker liquidity and market orders are forced IOC, live market orders will often expire unfilled. Demo with resting limit orders and/or show the lifecycle honestly rather than faking a fill.
- **Faucet amounts conflict across SoDEX pages** (100 USDC/day on the faucet page vs 1,000 USDC/day in marketing) — verify the live faucet before relying on a specific amount; SOSO is the gas token and must not be moved to spot.
- **Backtest ≠ live performance.** Report metrics honestly. As Man Group's Harvey & Liu note in "Backtesting," "A common practice in evaluating backtests of trading strategies is to discount the reported Sharpe ratios by 50%… The discount is a result of data mining." Single-signal macro strategies are also highly seasonal (most PnL concentrated in a few months). State this explicitly to build credibility rather than overclaiming an "edge."
- **GitHub Actions scheduling** can be delayed under load and, per GitHub's docs, "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" (only new commits to the default branch reset the timer). Biweekly Wave submissions plus a keepalive action mitigate this.
- **Whitelist/onboarding.** SoDEX testnet trading requires a whitelisted wallet and moving faucet tokens from the funding account to the spot account before trading — budget time for this before demoing the live trade.