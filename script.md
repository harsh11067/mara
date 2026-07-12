# MARA — Product Launch Video Script

> Target length: **90 seconds** (a 60-second cut is marked inline).
> Format: screen-capture cinematic — near-black UI, spectral glow, kinetic type.
> Music: low pulsing synth, 80 BPM, builds to a single drop at the EXECUTE beat.
> Voice: calm, measured, one notch above a whisper. No hype-voice.

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

**VISUAL:** Cut to the /track page: HIT / STOP / DRIFT chips, the counterfactual
equity curve animating. Then the /diag page: 8/8 checks flipping green, latencies
visible. Then the proof strip counting up: `35 endpoints · 118 catalysts · 8/8 green`.

**VO:**
> "Every thesis is dated. Every outcome is resolved — hit, stop, or drift —
> losses included, next to what buy-and-hold would have paid.
> The backtest even discounts its own Sharpe ratio, because honest math
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
URL fades in, then the three chips: `SoSoValue · 35 endpoints` /
`SoDEX testnet · EIP-712` / `mcp-mara · 8 tools`.

**VO:**
> "MARA. The macro has a pulse. Now something is listening."

**ON-SCREEN TEXT:**
> **MARA** — built on SoSoValue + SoDEX
> `Enter the terminal →`

**END CARD (2s):** SoSoValue Buildathon Wave 3 · testnet · backtests ≠ future returns.

---

## Shot list (for capture day)

| # | Page / asset | Action to capture |
|---|---|---|
| 1 | `/` hero | initial load animation, caret blink, rings orbiting |
| 2 | `/` tape | live prices scrolling (hover-pause once) |
| 3 | `/` pipeline | slow scroll — ECG draws, ghost words light |
| 4 | `/terminal` | trigger a sample thesis from `/judges`, capture agent trace streaming |
| 5 | `/track` | equity curve + HIT/STOP/DRIFT chips |
| 6 | `/diag` | checks flipping green on refresh |
| 7 | Claude Desktop | live `mcp-mara` tool call round-trip |
| 8 | Terminal (shell) | `curl -X POST .../api/trigger` + backend log scrolling |

## Production notes
- Capture at 1440p+, 60 fps; slow every UI scroll to 0.75× in the edit.
- Never fabricate a screen: every number in the video must be a real capture —
  same rule as the product ("nothing on this page is a promise, it's a reading").
- If Gemini rate-limits during capture, keep it in — the graceful-degradation
  log lines are a feature, not a blooper.
