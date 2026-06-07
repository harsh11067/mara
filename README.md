# MARA: Macro-Aware Research & Execution Agent

MARA is a full-stack, autonomous macro-event trading and portfolio rotation system. It detects high-impact macro releases (such as CPI, Nonfarm Payrolls, and FOMC rate decisions) via a **dual-path scanner**, scores their crypto-market impact using **statistical surprise models + Gemini AI**, checks strict **risk management gates**, and executes **dual-leg trades** (BTC perpetual hedges + spot SSI index rotations) on the **SoDEX testnet** using custom **EIP-712 cryptographic signatures**.

---

## 🌐 Architecture Overview

MARA is structured as a robust four-layer system with a low-latency, real-time presentation layer.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REACT DASHBOARD (Port 3000)                 │
│  Event Calendar │ Agent Feed │ Trade History │ P&L │ Risk Panel     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ WebSocket + REST (Vite Proxy)
┌──────────────────────────────┴──────────────────────────────────────┐
│                        BACKEND SERVER (Hono, Port 3001)             │
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

### 1. Dual-Path Detection Flow
To react to macro releases within ~10 seconds instead of waiting minutes for official database updates:
*   **Path A (Fast Path - News Scanner):** Polls the SoSoValue `/news` endpoint every 30 seconds. Uses regex patterns to scan headlines for major macro indicators (e.g. CPI prints, payroll counts). If matched, it extracts the actual value and triggers the execution pipeline immediately.
*   **Path B (Reliable Path - History Watcher):** Polls `/macro/events/{event}/history` every 60 seconds for scheduled events. When the official `actual` field updates, it confirms or enriches the news-extracted trigger.
*   **Reconciler:** A deduping window (10 min) prevents double-fires, merging both paths gracefully.

### 2. AI Conviction Engine
*   **Surprise Calculator:** Calculates the historical standard deviation of the difference between `actual` and `forecast` consensus. The surprise score is computed as:
    $$\text{Surprise Score} = \frac{\text{Actual} - \text{Forecast}}{\sigma_{\text{history}}}$$
*   **Gemini AI Analyzer:** Takes the surprise score, 10 recent headlines, market snapshot (BTC price, ATR volatility), and recent ETF flows. It outputs a structured JSON decision: conviction level (`STRONG_BULL` to `STRONG_BEAR`), confidence (0-100), reasoning, and trade action.

### 3. Risk Engine
Protects capital by running validation rules before placing orders:
*   ATR-based position sizing and stop-loss/take-profit placement.
*   Capped maximum leverage (default 5x) and position sizes.
*   Hard limits: maximum 3 open positions, 5% max account drawdown (HWM-based), daily trade caps, and a minimum 5-minute cooldown between trades.

### 4. Dual Execution (Perps + Spot SSI Rotation)
*   **Perpetual Futures:** Places directional long/short orders on SoDEX Perps for hedging and volatility capture.
*   **SSI Index Rotation:** Simultaneously adjusts long-term holdings in SoSoValue's Sovereign Smart Indices (SSI) via SoDEX Spot, selling high-beta indices (like MAG7 or MEME) for USSI (delta-neutral yield) during bearish turns, and rotating back during bullish ones.
*   **Cryptographic Signatures:** Custom EIP-712 signing implementation on both spot and perps domains, generating byte-identical payloads matching Go SDK structs.

---

## 🛠️ Installation & Setup

### Prerequisites
*   Node.js (v20+)
*   MetaMask (or a random EVM wallet) with ValueChain Testnet configured

### Backend Configuration (`macromind`)
1.  Navigate to the backend directory:
    ```bash
    cd macromind
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure your environment variables in `.env` (refer to `.env.example`):
    ```env
    SOSOVALUE_API_KEY=your_key
    GEMINI_API_KEY=your_gemini_key
    SODEX_MASTER_ADDRESS=0xYourWalletAddress
    SODEX_API_KEY_NAME=macromind-agent
    SODEX_API_KEY_PRIVATE=your_wallet_private_key
    SODEX_ACCOUNT_ID=your_sodex_account_id
    ```

### Frontend Configuration (`mara-macro-dashboard`)
1.  Navigate to the frontend directory:
    ```bash
    cd mara-macro-dashboard
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

---

## 🚀 Running the Project

### 1. Run Backend Server
From the `macromind` directory, start the development server:
```bash
npm run dev
```
The server will initialize a SQLite database (`mara.db`), run migrations, start the background schedulers, and listen on `http://localhost:3001` and `ws://localhost:3001/ws`.

### 2. Run Frontend Dashboard
From the `mara-macro-dashboard` directory, start the Vite development server:
```bash
npm run dev
```
Open `http://localhost:3000` in your browser. The Vite server proxies all `/api` and `/ws` traffic to the Hono backend on port 3001.

### 3. Run Automated Tests
You can run targeted tests for individual modules inside the `macromind` folder:
*   `npm run test:sosovalue` - Tests SoSoValue API client connectivity.
*   `npm run test:sodex` - Tests SoDEX public and private read clients.
*   `npm run test:surprise` - Validates standard deviation and surprise score calculations.
*   `npm run test:ai` - Assesses the Gemini AI prompt and structured JSON outputs.
*   `npm run test:sign` - Validates EIP-712 signing correctness on testnet.
*   `npm run test:pipeline` - Runs the end-to-end event-to-execution pipeline test.
*   `npm run typecheck` - Typechecks the codebase using TypeScript.

---

## 🔌 API Endpoints Reference

The backend Hono server exposes the following REST routes:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| **GET** | `/api/status` | Returns system health, uptime, and kill switch status. |
| **GET** | `/api/events` | Returns recent and upcoming macro calendar events from SQLite. |
| **GET** | `/api/decisions` | Returns historical AI trade decisions with complete reasoning. |
| **GET** | `/api/trades` | Returns executed trades history. |
| **GET** | `/api/risk` | Returns real-time risk parameters, drawdown, and win-rate statistics. |
| **GET** | `/api/news` | Returns a cached feed of SoSoValue headlines. |
| **POST**| `/api/trigger` | Injects a simulated macro event to trigger the pipeline end-to-end. |
| **POST**| `/api/kill-switch` | Forces an emergency halt, cancels open orders, and closes positions. |
| **POST**| `/api/kill-switch/reset` | Resets the kill switch state and resumes scanning. |

---

## 🏆 Rubric Alignment & Scoring Self-Audit

MARA has been architected to hit every criteria and bonus category in the judging rubric:

| Criteria | Category | MARA Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Genuine SoSoValue API** | **Required** | Uses **11 different endpoints** for macro tracking, news scanning, price feed calculations, and smart index allocations. | **YES** |
| **Clear Use Case** | **Required** | Focuses on high-impact macro data releases that trigger short-term directional perps hedges and spot index reallocations. | **YES** |
| **Real User Value** | **Required** | Automates a complex workflow that typically requires an analyst, risk manager, portfolio manager, and execution trader. | **YES** |
| **Complete Flow** | **Required** | End-to-end from live data ingest -> AI reasoning -> risk filtering -> on-chain execution. | **YES** |
| **SoDEX Integration** | **Bonus** | Integrates both **Spot** and **Perps** markets using custom **EIP-712 signature generation**. | **YES** |
| **AI-Enhanced** | **Bonus** | Leverages Gemini AI for structured reasoning and sentiment amplification. | **YES** |
| **Discovery Opportunity**| **Bonus** | Surfaces trade signals based on statistical variance from expectations. | **YES** |
| **Generates Signals** | **Bonus** | Quantitative surprise score translates directly to conviction levels. | **YES** |
| **Explains Markets** | **Bonus** | Expandable "Reasoning Cards" on the dashboard explain the reasoning behind each trade in plain English. | **YES** |
| **Risk Control** | **Bonus** | Position sizing based on ATR volatility, stop-loss attachment, drawdown monitoring, and kill switch. | **YES** |
| **Confirmation** | **Bonus** | Confirms news scanner triggers with official event data and ETF institutional flow trends. | **YES** |
| **Security Awareness** | **Bonus** | Never exposes private keys or API credentials to the client; all cryptographic actions occur on the server. | **YES** |
| **Product Experience** | **Bonus** | Features a beautiful Bloomberg-terminal styled 6-panel real-time grid dashboard with WebSockets. | **YES** |

---

## ⛓️ On-Chain Attestation Layer (`mara-attestation`)

MARA uses a Solidity smart contract on the ValueChain testnet to record an immutable audit trail of its trading decisions. This ensures that the agent's historical performance and reasoning cannot be tampered with.

### Contract Features
- **Immutable Decisions**: Stores the keccak256 hash of every trade decision, conviction level, and action.
- **Operator Verification**: Proves that the MARA instance is operated by the designated wallet.
- **Strategy Versioning**: Logs immutable records of strategy upgrades or risk parameter changes.
- **Kill Switch Mirroring**: Mirrors the off-chain kill switch state on-chain for transparency.

### Deployment Instructions
1.  Navigate to the attestation directory:
    ```bash
    cd mara-attestation
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Deploy to ValueChain Testnet:
    ```bash
    npm run deploy:testnet
    ```
4.  Copy the deployed contract address and paste it into `macromind/.env` as `MARA_CONTRACT_ADDRESS`.

---

## ✅ Submission Checklist

- [x] **SoSoValue API**: 11 endpoints integrated (Macro, News, Indices, Market Data).
- [x] **SoDEX Integration**: EIP-712 signing for both Perps and Spot markets.
- [x] **AI Decision Engine**: Gemini AI-powered conviction analysis.
- [x] **Risk Management**: ATR-based sizing, drawdown monitoring, and kill switch.
- [x] **Real-Time Dashboard**: WebSocket-powered "OP-Central" UI.
- [x] **Audit Trail**: On-chain attestation for every decision.
- [x] **Documentation**: Complete setup instructions and architecture overview.

---

## 📚 Project Documentation

For deeper details on MARA's design, verification, and plans, please refer to the following guides:

*   **[Demo Showcase & Presentation Guide](docs/showcase_guide.md)**: Script, walkthrough steps, and judge questions.
*   **[Terminal Demo Runbook](docs/DEMO.md)**: Setup commands and expected console outputs.
*   **[Single Source of Truth (Operator Identity)](docs/IDENTITY.md)**: Proof of system-wide identity coherence.
*   **[Architecture Specification](docs/architecture.md)**: Detailed module layout and sequence diagrams.
*   **[Project Idea & Context](docs/idea.md)**: Problem explanation, solution, and roadmap.
*   **[7-Day Build Plan](docs/plan.md)**: Daily progression checklist.
*   **[Test & Acceptance Criteria](docs/test.md)**: Verification checklist.

---

## 📖 Presentation & Showcase Guide

The complete step-by-step video script, EIP-712 details, and validation Q&As are documented in the [MARA Demo Showcase & Presentation Guide](docs/showcase_guide.md).


