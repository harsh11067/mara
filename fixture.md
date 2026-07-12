# MARA Wave 3 Superiority Build Package — SoSoValue Buildathon (AKINDO)

## TL;DR
- **The single fix that unlocks every score is a live, judge-accessible deployment** — all 7 Wave 2 judges penalized MARA for having no live demo, so Wave 3 must ship a stable public URL (Vercel frontend + Render backend + Neon Postgres) with a `/judges` 60-second script page and a `/diag` live-integration page *before* adding any feature.
- **MARA's defensible moat is being the only "macro-native, agent-callable" project**: a 4-tool+ `mcp-mara` MCP server, a macro-catalyst corpus (CPI/FOMC/NFP/PCE surprises tagged with BTC/ETH forward returns), a bull/bear/synthesiser macro-debate engine, and a cited, verifiable HIT/STOP/DRIFT track record — combining Sonar's receipts, Helix's corpus+debate, and SoSoMind's MCP surface into one product no competitor has whole.
- MARA is a **TypeScript/Node codebase** (Hono backend, React+Vite dashboard, SQLite, Solidity attestation) — so build the MCP server in the official **TypeScript MCP SDK** (native to the repo), keep all keys server-side, and expose a judge-triggerable real testnet trade to win Functionality (25%) and Data/API (15%).

## Key Findings

### 1. Root cause and the scoring math
Wave 2 scores were User Value 58, Functionality 43, Logic 57, Data/API 47, UX 46, and 0 USDC. Functionality (25% weight) was the lowest at 43 because there was no live demo — only `localhost` URLs. Because Functionality and Data/API integration are both partly *verified live*, a dead demo caps five criteria at once. The highest-leverage move is therefore deployment, not new features. After deployment, the weighted priority order is: User Value (30%) → Functionality (25%) → Logic/Product (20%) → Data/API (15%) → UX (10%).

### 2. What MARA actually is today (verified from repo)
The repo `harsh11067/mara` is **93.8% TypeScript, 3.2% Solidity, 2.9% CSS**, one commit, three sub-projects:
- `macromind/` — backend: **Hono** framework (port 3001), **SQLite** (`mara.db`) with migrations, WebSocket + REST, cron/poll schedulers, Node 20+. Four-layer architecture (Scheduler → AI Decision Engine → Risk Engine → Executor) plus a data layer (SoSoValue client, SoDEX client, price cache) and SQLite stores (Event / Trade / Reasoning Log). Claims **11 SoSoValue endpoints**.
- `mara-macro-dashboard/` — **React + Vite** "Bloomberg-terminal" 6-panel real-time WebSocket grid.
- `mara-attestation/` — Solidity attestation contract (stores keccak256 hash of each decision + conviction + action; operator verification; strategy versioning; kill-switch mirroring). README names deploy target "ValueChain testnet"; the task references a Sepolia address `0xdCa0…A844`.
- Existing test scripts: `test:sosovalue`, `test:sodex`, `test:surprise`, `test:ai`, `test:sign`, `test:pipeline`, `typecheck`.
- REST endpoints already present: `/api/status`, `/api/events`, `/api/decisions`, `/api/trades`, `/api/risk`, `/api/news`, `POST /api/trigger`, `POST /api/kill-switch`, `POST /api/kill-switch/reset`.
- **No MCP server and no live deployment URL exist yet** — both are greenfield opportunities.

Implication: build the MCP server in TypeScript (`@modelcontextprotocol/sdk`) to match the codebase rather than Python FastMCP, and reuse the existing service-layer functions as MCP tool handlers.

### 3. The SoSoValue API surface (for a top Data/API score)
Base URL `https://openapi.sosovalue.com/api/v1`, auth header `x-soso-api-key: <KEY>`, free "Beta/Demo" plan rate-limited to **20 calls/min** (Sonar references a higher 100 req/min "High Frequency" tier). The API spans **9 modules** documented at `sosovalue.gitbook.io/soso-value-api-doc` (mirrored inside SoDEX docs at `sodex.com/documentation/market-data-api`). Endpoint map:
- **Currency & Pairs (9):** `/currencies`, `/currencies/{id}`, `/currencies/{id}/market-snapshot`, `/token-economics`, `/klines`, `/supply`, `/pairs`, `/currencies/sector-spotlight`, `/currencies/{id}/fundraising`
- **ETF (4):** `/etfs/summary-history`, `/etfs`, `/etfs/{ticker}/market-snapshot`, `/etfs/{ticker}/history`
- **SoSoValue Index (4):** `/indices`, `/indices/{ticker}/constituents`, `/indices/{ticker}/market-snapshot`, `/indices/{ticker}/klines`
- **Crypto Stocks (6):** `/crypto-stocks`, `/{ticker}/market-snapshot`, `/{ticker}/market-cap`, `/{ticker}/klines`, `/crypto-stocks/sector`, `/crypto-stocks/sector/{name}/index`
- **BTC Treasuries (2):** `/btc-treasuries`, `/{ticker}/purchase-history`
- **Feeds/News (4):** `/news`, `/news/hot`, `/news/featured`, `/news/featured/currency` (news categories: 1 news, 2 research, 3 institution, 4 insights, 5 macro news, 6 macro research, 7 official tweets, 9 price alert, 10 on-chain)
- **Fundraising (2):** `/fundraising/projects`, `/fundraising/projects/{id}`
- **Macro (2):** `/macro/events` (events by date), `/macro/events/{event}/history` (historical actual vs forecast) — this is the core of MARA's dual-path detection and surprise engine
- **Analysis Charts (2):** `/analyses`, `/analyses/{chart_name}`

That is ~35 endpoints; wiring 30+ (MARA has 11 today) directly lifts the Data/API score. Standard response envelope: `{code, msg, traceId, data}`.

### 4. SoDEX testnet / ValueChain signing (verified from SoDEX docs)
- **Testnet REST:** spot `https://testnet-gw.sodex.dev/api/v1/spot`, perps `https://testnet-gw.sodex.dev/api/v1/perps`. **Testnet WS:** `wss://testnet-gw.sodex.dev/ws/spot` and `/ws/perps`. (Mainnet uses `mainnet-gw.sodex.dev`.)
- **Chain IDs:** testnet `138565`, mainnet `286623`.
- **EIP-712 envelope:** domain `{name:"spot"|"futures", version:"1", chainId:138565, verifyingContract:0x000…000}`; primaryType `ExchangeAction` with fields `payloadHash: bytes32`, `nonce: uint64`.
- **payloadHash** = `keccak256(compactJSON({type, params}))`. Compact JSON, **no whitespace**, keys **in Go struct field order** (server re-marshals to verify; wrong order = signature failure). `DecimalString` fields (`price`, `quantity`, `funds`, `stopPrice`) must be **quoted strings**. `omitempty` optional fields omitted when unset; non-optional fields (`modifier`, `reduceOnly`, `positionSide`) always present.
- **Typed signature:** sign the struct, then **prepend byte `0x01`** to the 65-byte signature → value of `X-API-Sign`.
- **Auth model:** master wallet signs only `addAPIKey`/`revokeAPIKey`; a registered **API key** (max 5 per account) signs all trading actions. HTTP headers: `X-API-Key` = the key **name** (not address), `X-API-Sign` = `0x01`+sig, `X-API-Nonce`. Nonces tracked per signing address (100 highest kept, Hyperliquid-style), must be within `(T-2d, T+1d)`.
- Order field order for perps: `clOrdID, modifier, side, type, timeInForce, price, quantity, funds, stopPrice, stopType, triggerType, reduceOnly, positionSide`. Authoritative structs in `github.com/sodex-tech/sodex-go-sdk-public`.
- **Faucet:** `testnet.sodex.com/faucet` (1,000 USDC/day + SOSO). Onboarding: connect whitelisted wallet → accept ToU → claim tokens → add ValueChain to wallet → transfer from EVM-funding to spot account → enable gas-free trading → place order.
- **IOC / no-market-maker quirk:** on a thin testnet order book, an IOC/market order often finds no counterparty and fills nothing. To make a trade **verifiably land on-chain**, place a **resting limit order** (`type` limit, `timeInForce` GTC) at or near the book — it posts on-chain and is viewable in the ValueChain explorer even if unfilled, which is exactly the "real on-chain" proof judges want.

### 5. Free-tier deployment stack (broke solo builder)
- **Frontend:** Vercel free (React+Vite static/SPA) — stable custom `*.vercel.app` URL, instant deploys from GitHub.
- **Backend:** Render free web service (Node/Hono). Caveat, per Render's own docs: **free web services spin down after 15 minutes of inactivity and restart on the next request, with spin-up taking about one minute**, and Render grants **750 free instance-hours per workspace per calendar month**. Defeat the sleep with an external pinger (**UptimeRobot** or **cron-job.org**, 5–14 min interval) hitting a `/healthz` endpoint; a GitHub Actions cron (`*/14 * * * *`) also works.
- **Database — use Neon, not Supabase, for this demo.** Per Neon's docs FAQ, the Neon Free plan costs $0/month and includes **100 projects, 10 branches per project, 100 CU-hours of compute per project per month, 0.5 GB of storage per project**, with **computes scaling to zero after 5 minutes of inactivity** (resuming in ~500 ms–2 s on the next query). Critically, Neon has **no calendar-based idle pause** — a free project is only suspended when it hits the 100 CU-hour or 0.5 GB cap. Supabase is the wrong choice for a judged demo because, per Supabase's docs, **Supabase pauses Free Plan projects that show low activity over a 7-day period** (90-day restore window; paid projects cannot be paused) — that would silently kill the demo the week before judging. Migrate SQLite → Neon Postgres for a persistent, shared track record.
- **Gemini:** the free tier is credential-per-project. Per Google's rate-limits docs as reported (July 2026), **Gemini 3 Flash on the free tier runs 10 requests/minute, 250,000 tokens/minute, and 1,500 requests/day**, and **Flash-Lite runs 15 RPM**. Note that Google **cut free quotas 50–80% in December 2025 and removed Pro's free tier outright in April 2026**, and **the moment you enable billing on a project the free tier disappears entirely** — so keep the demo project unbilled, **use Flash/Flash-Lite only**, add exponential backoff, and cache AI verdicts in the DB.
- **`/judges` page:** a static route with a numbered 60-second test script ("1. Click *Run Live Cycle*. 2. Watch the event stream. 3. See the signed order hash. 4. Open it in the explorer."), links to repo/contract/demo video, and a status badge.
- **`/diag` page:** calls every integration live (SoSoValue ping, SoDEX public read, SoDEX private signed read, Gemini, DB, contract RPC) and prints green/red + latency + last-value, proving nothing is mocked.
- **Judge-triggerable trade:** a rate-limited `POST /api/trigger` (already exists) behind a per-IP limiter that runs one real testnet cycle server-side with keys never exposed to the browser; deterministic `clOrdID` (idempotent) so repeated clicks don't double-trade.

### 6. Competitor synthesis — what MARA must absorb
| Competitor | Signature strength | What MARA takes |
|---|---|---|
| Sonar | Real EIP-712 testnet orders, judge-triggerable live cycle, `/track` NAV vs buy-and-hold with every number citing a dated thesis, macro circuit breaker near CPI/FOMC/NFP, idempotent clOrdID, Langfuse traces | Judge-triggerable cycle + cited verifiable track record + macro circuit breaker (MARA's native domain) |
| Helix | 613-event hand-curated catalyst corpus w/ forward returns + regime labels, tool-using research agent (9 tools), separate verification agent, 3-agent bull/bear/synthesiser debate, 508 tests, trace audit pages | Macro-catalyst corpus + multi-agent debate applied to macro surprises + agent trace pages |
| Edgework | Every number backed by a tool call (no hallucinations), peer benchmarking, smart-money watch, counterfactual equity curve, bookmarkable URL state, bilingual | Tool-call-grounded numbers, counterfactual "what if we didn't trade" curve, shareable URL state |
| Mosaic | `/judges` + `/diag` pages, 90-day backtest (Sharpe/Sortino/maxDD/beta/win-rate), 1000-path Monte Carlo (VaR/CVaR), regime stress tests (COVID/FTX/ETF), human-confirm loop, per-wallet persistence | `/judges`+`/diag`, backtest metrics, regime stress tests, human-confirm loop |
| SoSoMind | 5 agents, 35 SoSoValue endpoints, mcp-sosovalue (35 tools) + mcp-sodex (19 tools), Telegram bot 17+ commands, Kelly sizing, HIT/STOP/DRIFT | MCP server surface + Telegram broadcast + HIT/STOP/DRIFT outcome tracking |
| SoSoVault | EIP-712 in Python, risk gatekeeper (daily cap/concentration/confidence floor/drawdown halt/circuit breaker), 51 routes | Layered risk gatekeeper spec |

**Conclusion:** No competitor combines a *macro-specialized* corpus + macro debate + agent-callable MCP + cited live track record. That intersection is MARA's white space.

## Details

### A. The 4+ MCP features (differentiator, serves "agent-friendly" theme)
Build `mcp-mara` with the **TypeScript MCP SDK** (`npm i @modelcontextprotocol/sdk`), stdio transport for local (Claude Desktop/Cursor/VS Code) plus an HTTP/SSE transport for remote. Config uses the standard `mcpServers` object (note: VS Code uses the `"servers"` key instead — a copy-paste from a Claude Desktop config silently fails otherwise). Publish to npm as `mcp-mara` so anyone runs `npx -y mcp-mara`. Tool schemas (name / input / output):

1. **`get_macro_calendar`** — input `{from, to, importance?}` → upcoming CPI/FOMC/NFP/PCE events with consensus/forecast and MARA's pre-event risk posture. (Wraps `/macro/events`.)
2. **`get_macro_surprise`** — input `{event, date}` → `{actual, forecast, zscore, percentile, historical_analog_ids}` from the rolling-window surprise engine. (Wraps `/macro/events/{event}/history` + surprise engine.)
3. **`query_macro_corpus`** — input `{event_type, direction, regime?, horizon?}` → historical analog catalysts with BTC/ETH forward returns at +1d/+3d/+7d/+30d and hit-rate. (MARA's macro corpus — see feature C.)
4. **`get_mara_conviction`** — input `{event_id}` → the bull/bear/synthesiser debate output: `{stance, conviction 0-1, rationale, dissent, citations[]}`.
5. **`get_risk_state`** — input `{}` → live risk gates: ATR, position size, drawdown, kill-switch status, circuit-breaker (near-event) flag.
6. **`get_track_record`** — input `{since?}` → NAV vs BTC buy-and-hold, win rate, HIT/STOP/DRIFT counts, per-thesis P&L with signal IDs and dated theses (Sonar-style receipts).
7. **`simulate_trade`** (read-only) — input `{event_id}` → the exact SoDEX order MARA *would* sign (symbolID, side, qty, limit price) without sending — safe for any agent to call.
8. **`execute_macro_trade`** (guarded/opt-in) — input `{event_id, confirm:true}` → places the real testnet resting limit order server-side, returns clOrdID + on-chain hash. Gated by an allow-list + human-confirm flag so it's safe to expose.

Tools 1–7 are read-only and safe to publish broadly; tool 8 is the "agentic finance" showpiece. Design each with typed input schemas and rich docstrings (the docstring is what the calling LLM reads). This makes MARA usable *by other agents* — the strongest possible expression of the buildathon theme, and something only SoSoMind approaches.

### B. Superiority features ranked by score-impact × defensibility
1. **Live deploy + `/judges` + `/diag` + judge-triggerable real trade** — *Impact: highest (fixes the 43 Functionality, lifts 5 criteria). Defensibility: table-stakes but currently absent.* Do first.
2. **`mcp-mara` MCP server (feature A)** — *Impact: high on Data/API + Logic + User Value. Defensibility: high — macro-native agent tooling is unique.*
3. **Macro-catalyst corpus + proof-of-edge track record (feature C)** — *Impact: high on User Value + Logic. Defensibility: very high — hand-built data is a real moat, mirrors Helix's 613 corpus and Sonar's receipts.*
4. **Bull/bear/synthesiser macro-debate engine** — *Impact: high on Logic + UX (explainability). Defensibility: high — Helix does debate for signals, nobody does it for macro surprises.* Use 3 Gemini calls (or 1 structured multi-role call to save quota) producing `{bull_case, bear_case, synthesis, conviction, dissent}`.
5. **Natural-language "explain this event & what MARA is doing" layer** — *Impact: high on UX + User Value. Defensibility: medium.* Every number links to a tool call (Edgework's no-hallucination rule).
6. **Regime-adaptive risk** — *Impact: medium-high on Logic. Defensibility: medium.* Tag BTC regime (bull/bear/chop via realized vol + trend) and scale ATR gates/position size per regime.
7. **Telegram signal broadcast + copy-trading** — *Impact: medium on User Value (traction signal). Defensibility: medium.* Free tier gets signals; posts wins *and* losses for transparency (best-practice from top signal channels).
8. **Counterfactual equity curve** — *Impact: medium on UX. Defensibility: medium.* "MARA vs buy-and-hold vs did-nothing."

**Best combination for max score + moat:** #1 (deploy) + #2 (MCP) + #3 (corpus/track record) + #4 (macro debate). These four hit all five criteria, are mutually reinforcing (debate feeds corpus feeds track record feeds MCP), and none exists complete in any competitor.

### C. The macro-catalyst corpus (proof of edge)
Build a table `macro_catalysts` seeded from `/macro/events/{event}/history` for CPI, Core CPI, FOMC rate decision, NFP, PCE, PPI, unemployment — each row: `{event_type, date, actual, forecast, surprise_z, regime_label, btc_ret_1d, btc_ret_3d, btc_ret_7d, btc_ret_30d, eth_ret_*}`. Compute forward returns from `/currencies/{id}/klines`. This is grounded in real event-study literature (e.g., the NY Fed staff report SR 1052 "The Bitcoin–Macro Disconnect"; Pyo & Lee 2020 found ~+0.96% day-before and −1% on FOMC-day; one study finds a one-SD FOMC surprise raises pre-announcement Bitcoin volatility ~0.31%). The corpus (a) powers `query_macro_corpus`, (b) lets MARA cite "in the last N similar CPI upside surprises in a bull regime, BTC returned X% median over 3d," and (c) becomes the backtest ground truth. Honesty note for judges: SoSoValue ETF-flow data is **end-of-day, not intraday** (Sonar flags this) — state latency openly rather than implying intraday edge.

### D. Verifiable track record (Sonar-style)
Every cycle writes a dated thesis (event → surprise → debate → decision → order) with a signal ID. `/track` shows NAV-weighted return vs BTC buy-and-hold, win rate, and per-thesis P&L where every number links to its thesis and on-chain attestation hash. Outcome labels: **HIT** (target reached), **STOP** (stopped out), **DRIFT** (expired/neither) — computed from klines vs the recorded entry/target/stop. Rejected theses stay logged next to accepted ones (transparency = trust).

### E. Full technical pipeline (every utensil + why)
1. **Ingestion — SoSoValue client** (Hono service, `x-soso-api-key`): pulls macro events, ETF flows, news, indices, klines. *Why:* the buildathon's mandated institutional data source; 30+ endpoints for Data/API score. Cache in Neon + in-memory price cache to respect 20 req/min.
2. **Dual-path detection** (news scanner + macro history): news categories 5/6 (macro) trigger the event path; `/macro/events` calendar triggers the scheduled path. *Why:* catches both scheduled (CPI) and surprise (unscheduled headline) macro.
3. **Surprise engine** (rolling-window z-score, existing `test:surprise`): `(actual − forecast)/rolling_std`. *Why:* converts raw prints to a comparable, backtestable surprise metric.
4. **Multi-agent AI — Gemini 3 Flash** (`@google/genai` SDK): bull/bear/synthesiser debate → structured JSON conviction. *Why:* explainability + no-hallucination grounding; Flash for free quota + backoff.
5. **Risk gate** (ATR position sizing, kill switch, drawdown halt, concentration cap, confidence floor, **macro circuit breaker** that de-risks near CPI/FOMC/NFP): *Why:* the risk gatekeeper is a top-scoring Logic feature (SoSoVault/Sonar parity) and the circuit breaker is macro-native.
6. **Execution — SoDEX client** (EIP-712, ethers.js/viem signing, `0x01` prefix, testnet gateway): dual-leg BTC perp hedge + SSI spot rotation via **resting limit order** for verifiable on-chain landing; deterministic `clOrdID`. *Why:* real on-chain execution is the Functionality showpiece.
7. **On-chain attestation** (`mara-attestation` Solidity, keccak256 of decision + conviction + action; kill-switch mirror): *Why:* public audit trail = defensible trust layer.
8. **Persistence — Neon Postgres** (migrated from SQLite): events, trades, reasoning log, macro corpus, track record. *Why:* shared, non-pausing, survives redeploys.
9. **Surfaces:** React+Vite dashboard (WS live grid, `/judges`, `/diag`, `/track`, counterfactual curve), **`mcp-mara`** (agent-callable), **Telegram bot** (broadcast + `/status`, `/track`, `/explain`). *Why:* three distribution channels = User Value + UX + agent-friendliness.

**Goals per component:** ingestion → 30+ endpoints live & cached; detection → 0 missed scheduled events; surprise → backtested against corpus; AI → 100% structured-JSON parse, cited; risk → no trade breaches a gate; execution → ≥1 verifiable on-chain order per demo; attestation → every decision hashed; DB → persistent across restarts; surfaces → all green on `/diag`.

### F. SaaS productization & go-to-market
- **Target users:** (1) crypto-native active traders who can't watch the macro calendar 24/7; (2) smaller funds/DAOs wanting systematic macro de-risking; (3) *other AI agents* (via MCP) needing a macro-execution tool.
- **Tiers:** **Free** — macro calendar, surprise alerts, read-only signals via Telegram + public `/track`. **Pro (~$30–70/mo,** the observed market band for credible signal services — e.g., Fat Pig Signals at $50–70/mo, Learn2Trade at $35/mo, CryptoNinjas at $99/mo) — auto-execution on testnet/mainnet, private MCP access, full corpus queries, custom risk profile. **Vault/performance model (mainnet)** — non-custodial (keep-your-keys, SoDEX API-key model), performance fee on NAV above a BTC benchmark.
- **Onboarding:** connect wallet (SIWE identity), pick risk profile, one-click Telegram link, optional MCP token.
- **Traction/moat signals judges believe:** a *public cited track record with losses shown* (not cherry-picked — the transparency practice of top channels like CoinCodeCap, which logs 269 signals/179 wins/87 losses publicly), a *hand-built macro corpus* (data moat), *agent-callable MCP distribution* (network effect as other agents adopt it), on-chain attestation (verifiable history), and open honesty about data latency. Defensibility = data (corpus) + distribution (MCP/Telegram) + verifiable performance, not the model itself.

### G. Complete `.env` template
```
# ─── SoSoValue Market Data API ───
SOSOVALUE_API_KEY=            # x-soso-api-key value from sosovalue.com/developer (free Beta = 20 calls/min)
SOSOVALUE_BASE_URL=https://openapi.sosovalue.com/api/v1

# ─── SoDEX / ValueChain Trading API (TESTNET) ───
SODEX_SPOT_REST=https://testnet-gw.sodex.dev/api/v1/spot
SODEX_PERPS_REST=https://testnet-gw.sodex.dev/api/v1/perps
SODEX_SPOT_WS=wss://testnet-gw.sodex.dev/ws/spot
SODEX_PERPS_WS=wss://testnet-gw.sodex.dev/ws/perps
SODEX_CHAIN_ID=138565                 # testnet (mainnet=286623)
SODEX_MASTER_ADDRESS=                 # EVM master wallet address (owns the account)
SODEX_MASTER_PRIVATE_KEY=             # ONLY for addAPIKey/revokeAPIKey; keep offline
SODEX_API_KEY_NAME=                   # the X-API-Key NAME (not an address), e.g. mara-key-01
SODEX_API_KEY_PRIVATE=                # private key that signs trading actions (X-API-Sign)
SODEX_ACCOUNT_ID=                     # numeric accountID from /accounts state
SODEX_VERIFYING_CONTRACT=0x0000000000000000000000000000000000000000

# ─── AI (Gemini) ───
GEMINI_API_KEY=                       # Google AI Studio key (use Flash/Flash-Lite for free tier)
GEMINI_MODEL=gemini-3-flash           # free tier: 10 RPM / 250k TPM / 1,500 RPD

# ─── Database ───
DATABASE_URL=                         # Neon Postgres pooled connection string (postgresql://...)

# ─── On-chain Attestation ───
MARA_CONTRACT_ADDRESS=0xdCa096179BCd9c728e73cCE2B191f0bBD86aA844
ATTESTATION_RPC_URL=                  # ValueChain/Sepolia RPC endpoint
ATTESTATION_PRIVATE_KEY=              # wallet that signs attestation txs

# ─── Telegram Broadcast ───
TELEGRAM_BOT_TOKEN=                   # from @BotFather
TELEGRAM_CHANNEL_ID=                  # signal broadcast channel

# ─── MCP Server ───
MCP_TRANSPORT=stdio                   # stdio (local) or http
MCP_HTTP_PORT=8080
MCP_EXEC_ENABLED=false                # gate for execute_macro_trade tool

# ─── Deploy / Ops ───
PORT=3001
HEALTHZ_PING_URL=                     # UptimeRobot/cron-job.org target to defeat Render 15-min sleep
NODE_ENV=production
```

### H. End-to-end verification checklist (`check.md`) — real vs mock
For each item, the pass criterion explicitly distinguishes **genuine live integration** from **mock/fallback** (which judges penalize):
- **SoSoValue connectivity** — `npm run test:sosovalue` returns HTTP 200 with a non-empty `data` and a real `traceId`; `/diag` shows a live value that changes between refreshes. *Mock red flag:* identical/static response, or values that never update → fallback data.
- **30+ endpoints wired** — a count on `/diag` of distinct SoSoValue endpoints returning live data ≥30. *Mock red flag:* endpoints that return hard-coded fixtures.
- **SoDEX public read** — fetch live order book / symbol list; `symbolID` resolves dynamically (not hard-coded). *Mock red flag:* fixed symbolID constant.
- **SoDEX signing correctness** — `npm run test:sign`: reconstruct `payloadHash` = keccak256 of compact JSON in Go struct order, EIP-712 sign under `chainId 138565`, prepend `0x01`, and confirm the gateway accepts it (no signature-verification error). *Mock red flag:* a stubbed signer that returns a canned signature.
- **Real order lands on-chain** — trigger a cycle; capture the returned `clOrdID` and locate the resulting transaction in the ValueChain explorer. *Mock red flag:* a fake tx hash not resolvable in the explorer.
- **Idempotency** — click the judge trigger twice; the deterministic `clOrdID` prevents a duplicate order.
- **Risk gates fire** — force a near-CPI window and confirm the circuit breaker de-risks; force drawdown > halt threshold and confirm kill switch. *Mock red flag:* trades that ignore gate state.
- **Attestation** — each decision writes a keccak256 hash on-chain; verify the hash on the contract matches the locally recomputed hash of the decision payload.
- **AI genuineness** — `npm run test:ai`: Gemini returns parseable structured JSON with a rationale that references the actual event numbers (not a template). *Mock red flag:* constant conviction regardless of input.
- **Backtest correctness** — recompute a sample of corpus forward returns by hand from klines and confirm they match stored values.
- **MCP tools** — from Claude Desktop/Cursor, list `mcp-mara` tools and call ≥3; confirm outputs match the dashboard's live values (proves the MCP layer reads real state, not a separate mock).
- **Deploy health** — public URL responds; `/diag` all-green; `/healthz` pinged every ≤14 min so no cold start during judging.
- **Persistence** — restart the backend; `/track` and event history survive (proves Neon, not ephemeral SQLite).

## Recommendations (staged)
**Stage 0 — Deploy (Days 1–2, do before anything else).** Migrate SQLite→Neon; deploy Hono to Render + React to Vercel; add `/healthz` + UptimeRobot 5-min ping; ship `/judges` and `/diag`. *Benchmark to advance:* public URL green on `/diag` for all integrations, judge can trigger a cycle. This alone should move Functionality from 43 toward 80+.
**Stage 1 — Real trade + track record (Days 3–5).** Make `/api/trigger` place a verifiable resting limit order (deterministic clOrdID) and write an attestation hash; build `/track` with HIT/STOP/DRIFT and cited theses. *Benchmark:* ≥1 explorer-verifiable order + a populated `/track`.
**Stage 2 — MCP server (Days 5–7).** Ship `mcp-mara` (TS SDK) with tools 1–7 read-only + tool 8 gated; publish `npx mcp-mara`; add a demo GIF of Claude Desktop calling it. *Benchmark:* another AI client lists and calls ≥3 MARA tools.
**Stage 3 — Corpus + macro debate (Days 7–10).** Seed `macro_catalysts`, wire `query_macro_corpus`, add bull/bear/synthesiser Gemini debate + NL explain layer. *Benchmark:* every dashboard number links to a tool call/citation; corpus returns analogs for a live CPI event.
**Stage 4 — Polish/GTM (Days 10–12).** Expand to 30+ SoSoValue endpoints, regime-adaptive risk, Telegram broadcast, counterfactual curve, bilingual + bookmarkable URL state, demo video. *Benchmark:* all five scoring criteria have a concrete artifact.
**Thresholds that change the plan:** if Gemini free quota throttles (429s), collapse the 3-call debate into 1 structured multi-role call and cache; if Render cold-starts still hurt during judging, pre-warm via a 1-min ping window around the demo or move the backend to a second free service (Fly.io/Koyeb); if SoDEX testnet order book is too thin to land even a resting order, fall back to posting a far-from-mid limit order purely to demonstrate on-chain signing + settlement.

## Caveats
- **Contract unverified in research:** the Sepolia address `0xdCa0…A844` could not be independently confirmed (Etherscan bot-blocked; not indexed). The repo README names the deploy target "ValueChain testnet," not Sepolia — reconcile this before claiming a Sepolia audit trail to judges.
- **Codebase is TypeScript, not Python** — some competitor patterns (SoSoVault/Python FastMCP) don't port directly; use the TS MCP SDK.
- **Gemini free tier is volatile** (Dec 2025 cuts of 50–80%; Pro free tier removed April 2026; enabling billing deletes the free tier). Treat quotas as unstable and cache aggressively.
- **SoSoValue free plan is 20 calls/min** — 30+ endpoints must be scheduled/cached, not polled hot.
- **Macro→BTC effect is contested** in the literature (some studies find FOMC/CPI effects small or state-dependent). Present MARA's edge honestly as regime-conditional and end-of-day-latent, not as a guaranteed intraday alpha — over-claiming is a credibility risk with sophisticated judges.
- **Testnet IOC/no-market-maker quirk** means market orders may not fill; rely on resting limit orders for on-chain proof.
- Figures like the 613-event corpus, 508 tests, and endpoint counts for competitors are as described in the task brief and their public sites; verify against their live demos before benchmarking against them.

## Documentation URLs
- **SoSoValue API:** `https://sosovalue.gitbook.io/soso-value-api-doc` (sitemap `/sitemap.md`, full corpus `/llms-full.txt`); developer signup `https://sosovalue.com/developer`; mirror inside SoDEX docs `https://sodex.com/documentation/market-data-api/endpoint-overview`
- **SoDEX Trading API + signing:** `https://sodex.com/documentation/trading-api/trading-api` (Go SDK signing guide `/go-sdk-signing-guide`, REST v1 `/rest-v1`, WS v1 `/websocket-v1`); Go SDK repo `https://github.com/sodex-tech/sodex-go-sdk-public`; testnet onboarding `https://sodex.com/documentation/resources/testnet-onboarding-steps`; faucet `https://testnet.sodex.com/faucet`
- **MCP SDK / clients:** FastMCP (Python) `https://gofastmcp.com`; official SDK + client config patterns via `https://modelcontextprotocol.io/quickstart/server`; FastMCP client install `https://gofastmcp.com/integrations/mcp-json-configuration`
- **Deployment:** Render free tier + keep-alive `https://render.com`; UptimeRobot `https://uptimerobot.com`; cron-job.org `https://cron-job.org`; Neon pricing/limits `https://neon.com/faqs/free-plan-limits-and-quotas`; Supabase pausing `https://supabase.com/docs/guides/platform/free-project-pausing`; Gemini rate limits `https://ai.google.dev/gemini-api/docs/rate-limits`; Vercel `https://vercel.com`