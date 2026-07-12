# mcp-mara

MARA's Model Context Protocol server — lets any AI client (Claude Desktop, Cursor, VS Code) call the macro-native trading agent directly.

## Tools

| # | Tool | Access | What it returns |
|---|------|--------|-----------------|
| 1 | `get_macro_calendar` | read | Upcoming/recent macro events + circuit-breaker state |
| 2 | `get_macro_surprise` | read | Surprise profile for an event type (z-scores, forward returns) |
| 3 | `query_macro_corpus` | read | Historical analogs with real BTC/ETH forward returns + hit rate |
| 4 | `get_mara_conviction` | read | Recent AI verdicts with debate, dissent, and tool-call trace |
| 5 | `get_risk_state` | read | Live risk gates, regime, drawdown, kill switch |
| 6 | `get_track_record` | read | Dated theses, HIT/STOP/DRIFT, counterfactual curve |
| 7 | `simulate_trade` | read | The exact SoDEX order MARA would sign — without sending |
| 8 | `execute_macro_trade` | **gated** | Real analysis cycle → (if conviction clears) real testnet order. Requires `MCP_EXEC_ENABLED=true` + `confirm:true` |

## Setup

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mara": {
      "command": "npx",
      "args": ["-y", "mcp-mara"],
      "env": { "MARA_API_URL": "https://<your-backend>.onrender.com" }
    }
  }
}
```

> VS Code uses the `"servers"` key instead of `"mcpServers"`.

Local development against a local backend:

```bash
cd mcp-mara && npm install
MARA_API_URL=http://localhost:3001 npm start
```

All tool responses come live from the MARA backend REST API — the same state the dashboard renders, so MCP answers always match the UI.
