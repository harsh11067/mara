# MARA (Macro-Aware Research & Execution Agent)
## Demo Showcase & Presentation Guide

Step-by-step blueprint for pitching MARA. Includes the pitch script, the live
end-to-end flow, the on-chain attestation walkthrough, the single-source-of-truth
identity proof, and the validation Q&A.

> **One identity to remember:** the operator wallet is
> `0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC`. It signs SoDEX trades, owns the
> `MARAAttestation` contract, and is what the dashboard shows. Execution,
> signing, ownership, and the audit trail all resolve to this one wallet. See
> `IDENTITY.md` for the full governance record.

---

## ⏱️ Video Script & Actions (3-5 Minute Pitch Blueprint)

### Part 1: The Problem & The Hook (0:00 - 0:45)
*   **Visual:** MARA OP-Central dashboard at `http://localhost:3000`. Highlight the
    pulsing **"ON-CHAIN LIVE"** badge, the **"OPERATOR IDENTITY VERIFIED"** green
    card in the on-chain panel, the WebSocket indicators, and the live ticker.
*   **Script:**
    > "In DeFi, macro volatility is the ultimate performance killer. When U.S. CPI
    > prints or the FOMC decides on rates, leverage gets liquidated in
    > milliseconds. Humans can't react in time, and most trading bots are blind to
    > macro context.
    >
    > MARA is the Macro-Aware Research & Execution Agent — a fully autonomous,
    > one-wallet on-chain hedge fund. It listens to global macro releases in real
    > time, measures the statistical surprise versus consensus, uses Gemini to form
    > directional conviction, and executes a dual-leg strategy — perp hedge plus
    > spot index rotation — in under 10 seconds. Every decision is hashed and
    > recorded on-chain by the same wallet that places the trades."

### Part 2: Architecture & Data Pipeline (0:45 - 1:45)
*   **Visual:** code editor — `sosovalue-client.ts`, `sodex-signer.ts`,
    `event-mappings.ts`, `surprise-calculator.ts`.
*   **Script:**
    > "MARA runs a dual-path detection pipeline:
    >
    > 1. **Fast news path** — a scanner polls SoSoValue news every 30s and uses
    >    regex to extract actual numbers straight from macro headlines (CPI, NFP,
    >    GDP, FOMC).
    > 2. **Reconciler calendar path** — a daemon polls the SoSoValue macro calendar
    >    and enriches alerts with consensus forecasts and historical tables.
    >
    > We integrate **11 SoSoValue endpoints** — calendar, event histories, news,
    > ETF net flows, currency snapshots, index constituents.
    >
    > The surprise score is calibrated on a **rolling 18-release window**, so it
    > reflects *current* consensus volatility instead of being diluted by old
    > regimes. The event-to-asset map is multi-asset: macro events (CPI/FOMC/NFP)
    > route to **BTC-USD**, Ethereum/DeFi events to **ETH-USD**, Solana events to
    > **SOL-USD** — the agent hedges with the most relevant perp, not just BTC.
    >
    > Execution uses hand-built **EIP-712 typed signing** in TypeScript for both
    > the **futures** and **spot** domains on SoDEX testnet — gas-free, signed
    > order placement. Position updates stream over the SoDEX **WebSocket** feed
    > for sub-second fills."

### Part 3: Live End-to-End Simulation (1:45 - 2:45)
*   **Visual:** dashboard → **Macro Release Simulator** in the AI Reasoning Feed.
*   **Actions:**
    1. Select **U.S. CPI**.
    2. Enter **Actual 5.5%**, **Consensus 3.0%** (a large surprise → STRONG_BEAR
       with high confidence, so it produces a *real trade*, not NO_TRADE).
    3. Click **Inject Target Macro**.
    4. Watch the reasoning card appear with an amber glow: `STRONG_BEAR`,
       confidence, and the reasoning text referencing the actual numbers.
    5. The **Trade Execution Stream** adds a short perp; the **Risk Engine**
       updates margin.
    6. Within ~5 seconds, the **ON-CHAIN ATTESTATION** panel's **DECISIONS**
       counter flashes green and ticks up.
*   **Script:**
    > "Let's inject a hot CPI print — 5.5% actual against 3.0% consensus. The
    > surprise calculator scores it in standard deviations off the rolling window.
    > Gemini packages that with ETF flows and news sentiment and returns
    > STRONG_BEAR. The risk engine pulls the live SoDEX balance, sizes the position
    > off 14-day ATR, attaches stop-loss and take-profit, and places a signed
    > EIP-712 short. A few seconds later you can see the decision land on-chain —
    > the audit counter just incremented, live."

> **Demo note on NO_TRADE:** the risk gate requires >75% confidence for BEAR/BULL
> (>70% for STRONG). A borderline event (e.g. CPI 4.5 vs 3.2 → BEAR 65%) correctly
> resolves to `NO_TRADE (low_conviction)` and is *still attested on-chain* (the
> DECISIONS counter moves, TRADES does not). That's intended — the chain records
> what the agent decided, including when it stood down. Use the 5.5 vs 3.0 print
> if you want to show the TRADES counter move too.

### Part 4: On-Chain Audit Trail & Single Source of Truth (2:45 - 3:30)
*   **Visual:** **ON-CHAIN ATTESTATION** panel. Highlight the green
    **"OPERATOR IDENTITY VERIFIED — On-chain owner == SoDEX execution wallet"**
    card, the **CONTRACT ADDRESS** (links to the explorer), and the
    **OPERATOR WALLET** `0x2633…a8eC`. Then drop to a terminal and run
    `cd macromind && npm run verify:identity`.
*   **Script:**
    > "To keep strategy details private while staying fully auditable, every MARA
    > decision is hashed off-chain — keccak256 of decision ID, event, timestamp,
    > conviction, and confidence — and written to our `MARAAttestation.sol`
    > contract on ValueChain. The contract emits `DecisionAttested`,
    > `StrategyUpgraded`, and `KillSwitchActivated`.
    >
    > Crucially, there is exactly **one operator identity**. The wallet that signs
    > SoDEX trades is the same wallet that owns the contract and writes the audit
    > trail. This `verify:identity` check proves it: the SoDEX master, the EIP-712
    > signer, the attestation signer, and the on-chain `operator()` all resolve to
    > the same address. One trust anchor — nothing to spoof, nothing that
    > contradicts."
*   **Terminal output to show:**
    ```
    [✓] SODEX_MASTER_ADDRESS (execution wallet)    0x2633…a8eC
    [✓] EIP-712 trade signer (from API key)        0x2633…a8eC
    [✓] On-chain attestation signer                0x2633…a8eC
    [✓] Deployed contract.operator()               0x2633…a8eC
    ✓ PASS — all anchors resolve to 0x2633…a8eC
    ```

### Part 5: Wrap-up, Security & Rubric (3:30 - 4:00)
*   **Visual:** Risk Engine panel → click **Emergency Kill Switch** → card snaps to
    HALTED, further simulations blocked, and `KillSwitchActivated` is recorded
    on-chain.
*   **Script:**
    > "The kill switch cancels open perp orders and closes exposure on SoDEX, and
    > locks the on-chain attestation state. MARA delivers a complete
    > insight-to-action loop: 11 SoSoValue endpoints, real EIP-712 perp and spot
    > execution on SoDEX, ATR-based risk control, and a cryptographic audit trail
    > owned by a single operator identity. Thank you."

---

## 🖥️ Terminal Demo (the three commands that sell it)

A local ValueChain node is running and the contract is deployed **as the real
operator**. (`DEMO.md` has the full runbook.)

```bash
# 1) ONE identity across the whole system
cd ~/soso/macromind && npm run verify:identity        # → PASS, all anchors 0x2633…

# 2) Real on-chain round-trip (attest → read back → hash match)
cd ~/soso/mara-attestation && npm run attest:demo

# 3) Live path: a decision increments the on-chain counter
cd ~/soso/macromind && npm run test:attest            # → counter N → N+1
```

The guardrail can also be shown — the deploy script refuses the synthetic
Hardhat identity:

```bash
cd ~/soso/mara-attestation
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  npx hardhat run scripts/deploy.ts --network localhost
# → REFUSING TO DEPLOY: deployer is the Hardhat default account (0xf39F…).
```

---

## ⛓️ Smart Contract: Deployment, Verification & Events

Contract: `mara-attestation/contracts/MARAAttestation.sol` (Solidity 0.8.20, no
external deps). Deployed locally for the demo at
`0x8BF2520742CCb4101f28C216fF564A221bba1B29`, operator
`0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC`, deploy gas ~1.46M, per-attestation
gas ~50k–185k.

### Local demo deployment (already done)
```bash
cd mara-attestation
npm run node            # local node, funded AS the real operator 0x2633…
npm run deploy:local    # deploy.ts asserts deployer == operator before deploying
```
The deploy script **refuses** any deployer that isn't the real operator (and
rejects the Hardhat default account outright), then writes `deployment.json` and
`macromind/src/services/attestation-address.json`, tagged `environment: local-dev`.

### Production: ValueChain testnet (chainId 138565)
The testnet RPC `https://testnet.valuechain.xyz` is live. The only step pending is
gas — the operator wallet needs a faucet top-up, then:
```bash
cd mara-attestation
npm run deploy:testnet                                  # operator-gated deploy
npm run verify:testnet <ADDRESS> "1.0.0"               # explorer source verify
# macromind/.env → VALUECHAIN_RPC=https://testnet.valuechain.xyz
#                  MARA_CONTRACT_ADDRESS=<printed address>
```
Nothing else changes — same operator, same signer, same audit trail; only the
chain endpoint moves.

### Vital on-chain events
1. **`DecisionAttested(decisionHash, eventHash, conviction, confidence, action, totalDecisions, timestamp)`**
   — fires for every decision MARA reaches, including `NO_TRADE`.
2. **`StrategyUpgraded(fromVersion, toVersion, reason, upgradeNumber, timestamp)`**
   — on model/prompt/risk-parameter version changes.
3. **`KillSwitchActivated(reason, openPositions, timestamp)`**
   — on automated drawdown halt or manual kill switch.

---

## 🔄 How the live attestation is wired

```
Dashboard "Inject" ─► POST /api/trigger ─► Analyzer.analyze()
                                              │  (Gemini conviction, surprise, risk)
                                              ▼
                          attestationService.enqueueDecision(decision)
                                              │  (debounced ~3s, batches bursts)
                                              ▼
                       MARAAttestation.attestDecision(...) on ValueChain
                                              │
    Dashboard on-chain panel re-fetches /api/attestation ◄── counter increments
```

- Wired in `macromind/src/ai/analyzer.ts` — covers BOTH the live `EVENT_FIRED`
  pipeline and the manual `/api/trigger` demo path (both run through `analyze()`).
- Non-blocking: trade execution never waits on the chain.
- The on-chain panel reacts to each decision over WebSocket and re-checks the
  contract a few seconds later, so the counter ticks up on camera.
- SoDEX WebSocket feed (`sodex-ws-client.ts`) is started in `index.ts` and pushes
  position/order/balance updates to the dashboard.

---

## 🔒 Security: Unauthorized-Write Protection & Identity Coherence

The contract enforces operator authority with `onlyOperator`:
```solidity
modifier onlyOperator() { if (msg.sender != operator) revert NotOperator(); _; }
```
- **Immutable operator** — set to the deployer in the constructor; cannot be changed.
- **State locking** — `attestDecision` / `batchAttestDecisions` revert for non-operators.
- **Double-write prevention** — duplicate decision hashes revert `AlreadyAttested`.

Beyond the contract, divergence is prevented system-wide (see `IDENTITY.md`):
- `deploy.ts` aborts unless `deployer == operator`; rejects the Hardhat default key.
- `hardhat.config.ts` funds the **real operator** on the local net (no default account).
- `config.ts` derives the operator address and flags incoherence.
- `attestation-service.ts` refuses to attest on a synthetic key, a signer mismatch,
  or when the deployed `contract.operator()` ≠ the signer.
- `npm run verify:identity` is the pre-demo green-light gate.

---

## 🔍 Validation Q&A

### 1. Can the SSI manager execute a real spot trade?
Yes. On a trade decision, `SSIManager` reads spot balances via
`getSpotBalances(address)`. STRONG_BEAR → sell ≤20% of high-beta index tokens
(`vMAG7ssi`, `vDEFIssi`) into delta-neutral `vUSSI`. Orders are EIP-712 signed with
the `"spot"` domain and POSTed to the SoDEX spot router. If spot index balances are
0, rotation size is 0 and placement is skipped — seed a small `vUSSI`/`vMAG7ssi`
balance to show a non-zero spot fill on camera.

### 2. Does the dashboard show decisions, trades, and on-chain state in real time?
Yes, dual-channel. WebSocket (`ws://localhost:3001/ws`) pushes new
decisions/trades/risk/position updates instantly (amber glow on arrival). The REST
API (`/api/decisions`, `/api/trades`, `/api/risk`, `/api/attestation`) serves
persisted history from SQLite on load/reconnect, so nothing is lost across reloads.
The on-chain panel reads `/api/attestation`, which queries the live contract.

### 3. Is the on-chain audit trail real or mocked?
Real. Each decision's keccak256 hash is written by `attestDecision()`; anyone can
recompute it from `/api/decisions` and find it via `getAttestation()` /
`computeDecisionHash()` on the contract. Verified live: injecting a CPI event moved
the on-chain DECISIONS counter (e.g. 2 → 3) within seconds; a NO_TRADE decision
increments DECISIONS but not TRADES.

### 4. Does the demo satisfy the judging criteria?
- **Core (10/10):** 11 SoSoValue endpoints; clear use case (autonomous macro hedging
  + index rotation); complete insight-to-action loop.
- **Bonus (10/10):** EIP-712 SoDEX perps + spot; Gemini structured-JSON conviction;
  ATR risk sizing + kill switch; transparent reasoning logs; single-operator security
  with an immutable on-chain audit trail; multi-asset (BTC/ETH/SOL) routing.
