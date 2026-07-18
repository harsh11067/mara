# MARA — Product Launch Video Script

> Target length: **90 seconds** (a 60-second cut is marked inline).
> Format: screen-capture cinematic — near-black UI, amber phosphor glow, kinetic type.
> Music: low pulsing synth, 80 BPM, builds to a single drop at the EXECUTE beat.
> Voice: calm, measured, one notch above a whisper. No hype-voice.
>
> **2026-07-19 as-built revision:** captures now come from the MARA Next.js frontend
> (`mara-neon.vercel.app`) — routes `/`, `/terminal`, `/duel`, `/edge`, `/replay`, `/portfolio`.
> The old Vite `/track`, `/diag` and `/judges` pages are gone: track-record beats capture on
> **`/edge`**, diagnostics beats capture on the **`/portfolio` Data-Plane probes**, and triggers
> fire from the **`/portfolio` "Fire Live Run"** modal. This is the launch-film cut; the longer
> judge-facing walkthrough (with steps) is `demonstration.md`.

---

## COLD OPEN — 0:00–0:08

**VISUAL:** Black screen. A single cyan ECG blip crosses left to right. Then a real
CPI headline slams in as plain white text: `CPI (YoY) — actual 4.1 · forecast 3.4`.

**VO:**
> "Every few weeks, one number moves everything."

**SFX:** Single heartbeat thump on the blip.

---

## THE PROBLEM — 0:08–0:20

**VISUAL:** Rapid montage: a human trader's chaotic screen, tweets flying,
candles gapping. Everything desaturated, slightly blurred — the *only* color
on screen is the spectral pulse line running underneath.

**VO:**
> "CPI. Payrolls. The Fed. By the time a human reads the print, forms a view,
> and sizes a trade — the move is over. Bots are faster, but they don't reason.
> Humans reason, but they're slow. Nobody shows their work."

---

## REVEAL — 0:20–0:32

**VISUAL:** Hard cut to black. The MARA landing hero types itself on:
**THE MACRO HAS A PULSE.** with the blinking spectral caret. Orbit rings spin up.
The live ticker tape slides in underneath with real SoDEX prices.

**VO:**
> "MARA is a macro-native trading agent. It hears every print the moment it
> lands — and it never trades a number it can't cite."

**ON-SCREEN TEXT:** `MARA — Macro-Aware Research & Execution Agent`

---

## THE PIPELINE — 0:32–0:56  *(the core beat — one line per stage)*

**VISUAL:** Scroll down the landing page. The ECG pulse line draws itself through
the six stages; each ghost word (DETECT → ATTEST) lights as it's named.
Sync each VO line to its stage lighting up.

**VO:**
> "It detects the print through two independent paths.
> Measures the surprise as a z-score against eighteen releases of history.
> Debates it — a bull, a bear, and a synthesiser, armed with real tools and
> real historical analogs.
> Gates it through hard risk rules the AI cannot override.
> Executes with an EIP-712 signature on the SoDEX testnet book.
> And attests the decision hash on-chain — before the outcome is known."

**SFX:** Sub-bass hit on "Executes" — this is the drop.

---

## PROOF, NOT PROMISES — 0:56–1:10

**VISUAL:** Cut to **`/edge`** — the restraint headline ("+14.7% from standing down"),
then the four-column gauntlet scoreboard, then a slow scroll of the stand-down
ledger (green "dodged" rows and red "missed" rows both on screen). End on the
`/portfolio` Quant tab: `Sharpe (×0.5 disc.)` visible, and the Data-Plane probes
pulsing with live latencies.

**VO:**
> "Four strategies. The same two years of real prints. Zero lookahead.
> Buy-and-hold wins the bull market — MARA's own page says so.
> What MARA sells is restraint: every print it refused is in the ledger,
> and the backtest discounts its own Sharpe ratio, because honest math
> beats a good story."

*(⏱ 60-SECOND CUT: end here — jump to CTA.)*

---

## AGENT-CALLABLE — 1:10–1:20

**VISUAL:** Claude Desktop window. User types: *"Should we fade this CPI print?"*
Claude calls `query_macro_corpus` → `get_mara_conviction` — tool cards flip open
with live JSON. The answer cites 12 analogs and a hit rate.

**VO:**
> "And it's built for the agent era. Eight MCP tools — your AI can ask MARA's
> brain directly, or, behind an operator gate, let it trade."

**ON-SCREEN TEXT:** `npx -y mcp-mara`

---

## CTA — 1:20–1:30

**VISUAL:** Return to the hero. The pulse line settles into a steady heartbeat.
URL fades in, then the three chips: `SoSoValue · 36 endpoints` /
`SoDEX testnet · EIP-712` / `mcp-mara · 8 tools`.

**VO:**
> "MARA. The macro has a pulse. Now something is listening."

**ON-SCREEN TEXT:**
> **MARA** — built on SoSoValue + SoDEX
> `Enter the terminal →`

**END CARD (2s):** SoSoValue Buildathon · testnet · backtests ≠ future returns.

---

## Shot list (for capture day)

| # | Page / asset | Action to capture |
|---|---|---|
| 1 | `/` hero | initial load, monetary core spinning, regime-tinted ambient glow |
| 2 | `/` §02 meters | live regime numbers (trend / vol / size multiplier) |
| 3 | `/` §07 arena | the three play cards (Duel / Time Machine / Proof of Edge) |
| 4 | `/terminal` | Fire Live Run → agent trace streaming, verdict card landing |
| 5 | `/duel` | stake 100 CR pre-verdict → scanline thinking phase → result stamp |
| 6 | `/edge` | restraint headline → 4-way scoreboard → stand-down ledger scroll |
| 7 | `/replay` | Prophecy-mode guess, one print, graded |
| 8 | `/portfolio` | tab click-through: Exchange (venue reads) → ETF Flows → Quant; probes pulsing |
| 9 | Claude Desktop | live `mcp-mara` tool call round-trip |
| 10 | Telegram | broadcast arriving on a phone frame |
| 11 | Terminal (shell) | `curl -X POST .../api/trigger` + backend log scrolling |

## Production notes
- Capture at 1440p+, 60 fps; slow every UI scroll to 0.75× in the edit.
- Never fabricate a screen: every number in the video must be a real capture —
  same rule as the product ("nothing on this page is a promise, it's a reading").
- If Gemini rate-limits during capture, keep it in — the graceful-degradation
  log lines are a feature, not a blooper.
