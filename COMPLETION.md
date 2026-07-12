# MARA Wave 3 — Completion Audit (`fixture.md` × `transformation.md`)

> Generated 2026-07-12. Status keys: ✅ built & verified · 🟨 built, partially verified · ⬜ not done · 🔒 blocked on external dependency.

## A. fixture.md audit

### Stage 0 — Deploy-readiness (fixture Recommendations)
| Item | Status | Evidence |
|---|---|---|
| `/healthz` keep-alive endpoint | ✅ | `GET /healthz` → `{"ok":true,uptime,ts}` (tested live) |
| GitHub Actions keep-alive cron | ✅ | `.github/workflows/keepalive.yml` (`*/10`, needs repo var `BACKEND_HEALTHZ_URL` after deploy) |
| SQLite → Neon persistence | ✅ | `store/db-replicator.ts`: restore-before-open + 60s dirty snapshots to `mara_snapshots` (bytea); boot log “Neon snapshot replication ON” |
| `/diag` live-integration page | ✅ | Backend `api/diag.ts` (8 checks w/ latency + value snippets) + frontend `/diag` page |
| `/judges` 60-second script page | ✅ | Frontend `/judges`: numbered script + 3 one-click sample theses firing the REAL pipeline |
| Judge-triggerable rate-limited cycle | ✅ | `POST /api/trigger` with 20 s global cooldown, keys server-side |
| CORS / env-driven URLs | ✅ | CORS `*`; `VITE_API_URL` base for API+WS; `vercel.json` SPA rewrite |
| Actual Vercel/Render/Neon deployment | ⬜ | Not executed this session — see “Deploy runbook” below. All code paths are deploy-ready. |

### fixture §A — mcp-mara (8 tools)
| Tool | Status |
|---|---|
| get_macro_calendar / get_macro_surprise / query_macro_corpus / get_mara_conviction / get_risk_state / get_track_record / simulate_trade | ✅ built (read-only, live backend data) |
| execute_macro_trade | ✅ built, double-gated (`MCP_EXEC_ENABLED=true` + `confirm:true`) |
| Publish to npm as `mcp-mara` | ⬜ | package prepared (`bin`, README); publish is an external action |

### fixture §B — Superiority features
| # | Feature | Status |
|---|---|---|
| 1 | Live deploy + judges/diag + judge trigger | 🟨 code ✅, hosting ⬜ |
| 2 | mcp-mara MCP server | ✅ |
| 3 | Macro-catalyst corpus + track record | ✅ `corpus.ts` (7 event families, z, regime labels, BTC/ETH +1/3/7/30d returns) + `/track` |
| 4 | Bull/bear/synthesiser debate | ✅ `debate-engine.ts` (single structured call, corpus-cited, dissent) |
| 5 | NL explain layer, tool-grounded numbers | ✅ agentic trace visible in UI; every verdict number sourced from a tool call |
| 6 | Regime-adaptive risk | ✅ `regime.ts` (5 regimes → size/stop/conviction-floor multipliers, wired into executor) |
| 7 | Telegram broadcast | ✅ `telegram.ts` (decisions incl. NO_TRADE, trades, kill-switch) |
| 8 | Counterfactual equity curve | ✅ `/track` (MARA vs buy-and-hold vs did-nothing) |

### fixture §H — real-vs-mock checklist
- SoSoValue connectivity ✅ (calendar synced live at boot: 8 events)
- 30+ endpoints wired ✅ (35 in `SOSOVALUE_ENDPOINTS`, `/diag` counts + live-probes rotating pairs)
- SoDEX public read ✅ (live tickers; symbolID resolved dynamically — spot symbolID:0 stub fixed)
- SoDEX signing 🟨 (`npm run test:sign` existing suite; account unfunded on testnet → real order landing 🔒 faucet)
- Real order on-chain 🔒 (needs faucet USDC for 0x2633… — resting-limit-order path implemented)
- Idempotency 🟨 (trigger cooldown yes; deterministic clOrdID per event ⬜)
- Risk gates fire ✅ (circuit breaker + regime floor + drawdown/kill-switch logic)
- Attestation ✅ (local chain: contract `0x8BF2…`, operator verified at boot; ValueChain testnet 🔒 faucet gas)
- AI genuineness ✅ design (agentic loop rejects verdicts with zero tool calls; ai_failure → NO_TRADE)
- Backtest correctness ✅ code (corpus-driven, per-trade table exposed for hand-checks)
- MCP tools ✅ built; external-client call test pending
- Deploy health / persistence 🟨 (replicator live locally; hosted URL pending)

## B. transformation.md audit

| Rank | Change | Status |
|---|---|---|
| 1 | Live public deploy | 🟨 all code ready; hosting action pending |
| 2 | `/judges` + `/diag` + one-click demo | ✅ |
| 3 | Agentic tool-use loop (AI as core) | ✅ `agentic-analyzer.ts` — 7 tools, live WS trace, single-call fallback |
| 4 | Backtest + HIT/STOP/DRIFT tracker | ✅ `/api/backtest` (Sharpe + H&L-discounted, Sortino, maxDD, win rate, Calmar, 1000-path MC VaR/CVaR) + `/api/track` |
| 5 | 30+ SoSoValue endpoints | ✅ 35 across 9 modules, TTL-cached |
| 6 | Judge-triggerable live testnet trade | 🟨 pipeline complete; on-chain fill 🔒 faucet funding |
| 7 | Consumer UX reframe | ✅ landing narrative, plain-English debate/dissent, honest empty states, offline banner |
| 8 | Beyond BTC/ETH/SOL + adaptive regime risk | ✅ multi-asset perp routing existed; regime layer added; asset breadth partial (BTC/ETH/SOL + SSI) |
| 9 | SaaS vision framing | ✅ landing + README (free signals → pro auto-execution → vault model) |

## C. Mock-purge verification (see mocks.md)
All 🔴 items resolved: INITIAL_* seeds deleted, random-walk ticker → `/api/markets`, client-side fake AI deleted, hardcoded stats → `/api/performance/summary`, SSI placeholder → `/api/ssi`, fake sub-agents → live `/api/diag` registry, invented event metadata fixed, SSI symbolID stub fixed, ephemeral SQLite → Neon replicator. Remaining 🟡 fallbacks are surfaced (dataQuality flags, atrSource, honest chain labeling).

## D. Verified live this session — FULL SMOKE PASSED ✅
- Backend + frontend typecheck: **0 errors**; Vite build: **success**.
- Boot: attestation operator verified on local chain (contract `0x8BF2…`); SoDEX WS connected (`/ws/perps`); macro calendar synced (8 real events); Neon replication ON.
- `POST /api/corpus/seed` → **118 real catalyst rows** (CPI 24, Core CPI 23, NFP 24, PCE 24, PPI 23) + 90 BTC/ETH kline bars; FOMC/Unemployment honestly report "no history" on free tier.
- `GET /api/diag` → **overall green, 8/8 checks OK** — sosovalue (8 events), sodex_public (15 tickers), **sodex_signed (100.00 USDC real balance — account IS funded)**, gemini, database, replication, attestation, telegram (@your_knighthood_bot).
- `GET /api/markets` → real marks, changePct fixed (BTC −0.43%, not the old raw-USD 657).
- `GET /api/regime` → RANGING, −0.8% trend, 30.5% ann. vol, size×0.75, floor 65.
- `GET /api/backtest` → n=60 prints (2024-10 → 2026-07): Sharpe 1.36 (H&L-discounted 0.68), Sortino 2.16, maxDD 1.9%, win rate 60%, Calmar 3.22, MC VaR95 −0.74% / CVaR95 −2.13%, correlation to buy-hold −0.04, caveats included.
- `GET /api/simulate-order?side=SHORT` → exact EIP-712 order, **`balanceSimulated:false`** (real 100 USDC), regime multiplier applied.
- **Organic event fired live during the test**: HistoryWatcher detected CPI (YoY) 4.2 vs 4.2 → agentic loop ran with **5 real Gemini tool calls** → NEUTRAL 70% → NO_TRADE → **attested on-chain (tx 0x42ff4d…)**.
- Manual `POST /api/trigger` (CPI 4.1 vs 3.4, z=6.26σ): Gemini free-tier 429 → graceful degradation chain worked exactly as designed (agentic → debate → single-call retry w/ 39s backoff) → BEAR 65% → NO_TRADE (below RANGING floor) → **second on-chain attestation (tx 0xbc7e3d…)**.
- `mcp-mara` built (`tsc` clean) + stdio smoke: `tools/list` returns all 8 tools; live `tools/call get_risk_state` returned real backend state (balance 100, RANGING regime).

## E. Smoke sequence (re-runnable)
```bash
cd macromind && npm start &
curl -X POST localhost:3001/api/corpus/seed          # seed catalyst corpus (~9 API calls)
curl localhost:3001/api/diag                          # all checks + endpoint registry
curl localhost:3001/api/backtest                      # corpus backtest metrics
curl localhost:3001/api/track                         # theses + counterfactual
curl "localhost:3001/api/simulate-order?side=SHORT"   # exact order MARA would sign
curl -X POST localhost:3001/api/trigger -H 'Content-Type: application/json' \
  -d '{"event":"CPI (YoY)","actual":4.1,"forecast":3.4}'   # full agentic cycle
cd ../mara-macro-dashboard && npm run dev             # open /, /terminal, /judges, /diag, /track
```

## F. Deploy status (2026-07-12, post-deploy)
0. ✅ **Render backend LIVE** — `https://mara-backend-28va.onrender.com` — `/healthz` OK, `/api/diag` **7/8 green** (only attestation ✗, expected: 🔒 faucet). Neon replication proved itself: the hosted instance restored the local session's DB snapshot (50 decisions). Keep-alive repo variable `BACKEND_HEALTHZ_URL` is set and the workflow is live.
   **Frontend**: Vercel is blocked at the account level (token AND OAuth both 403 on project-create; account `limited: true` — verify the Vercel account to unblock). Workaround shipped in commit `7a6abc2`: the backend serves the built dashboard itself (single-origin). To activate, change the Render build command to `npm install && cd ../mara-macro-dashboard && npm install && npm run build` — then ONE public URL serves landing + terminal + API + WS.
1. ✅ **GitHub pushed** — `github.com/harsh11067/mara` @ main (commit `31a014b`), secrets verified out of the tree (`.env`/`*.db`/`deploy-all.sh` gitignored, secret scan clean).
2. 🟨 **Render + Vercel + keepalive var — one command left**: run `bash deploy-all.sh` from the repo root (creates the Render web service `mara-backend` with all env vars, sets the `BACKEND_HEALTHZ_URL` repo variable, deploys the frontend to Vercel with `VITE_API_URL` baked in, waits for `/healthz`). The script embeds the chat-pasted tokens — **rotate them and delete the script afterwards**.
3. 🔒 SoDEX faucet → fund `0x2633…` gas → `npm run deploy:testnet` in `mara-attestation` → set `VALUECHAIN_RPC=https://testnet.valuechain.xyz` + new `MARA_CONTRACT_ADDRESS` on Render.
   (Note: `/diag` showed the SoDEX **USDC** balance is already 100.00 — only attestation gas remains external.)
