# MARA OP-Central Dashboard

The real-time presentation layer for MARA (Macro-Aware Research Agent). This dashboard provides a Bloomberg-terminal style interface for monitoring autonomous macro trading.

## Features

- **Macro Calendar**: Live feed of upcoming and recent macro events.
- **Agent Reasoning**: Real-time stream of AI conviction decisions with full transparency.
- **Performance Monitor**: Equity curve, win-rate metrics, and sub-agent status.
- **Trade Stream**: 7-column execution table with live P&L and status badges.
- **Risk Engine**: Margin utilization meters and a global kill switch.
- **SSI Portfolio**: Smart Index holdings and rotation logs powered by SoSoValue.

## Tech Stack

- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS 4
- **Typography**: Geist Mono & Geist Sans
- **Charts**: Recharts
- **Icons**: Lucide React
- **Motion**: Framer Motion

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm run dev
   ```
   The dashboard runs on `http://localhost:3000` and proxies API requests to the MARA backend on port `3001`.

## Environment Variables

The dashboard usually does not require a `.env` file as it proxies all requests to the backend. However, you can configure the following in `.env.local` if needed:

```env
# Port to run the dashboard on (default: 3000)
VITE_PORT=3000
```
