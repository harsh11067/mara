/**
 * Onboarding — a five-step walkthrough for first-time operators.
 * Shows once (localStorage), re-openable from the header "?" button.
 */
import { useState } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

const STEPS: Array<{ k: string; title: string; body: string; hint: string }> = [
  {
    k: "01 · WHAT THIS IS",
    title: "An AI analyst that trades macro events",
    body: "When US economic data drops — CPI, jobs, Fed decisions — MARA measures how far the print missed the forecast, reasons over live market data with real tool calls, sizes a position under strict risk rules, and signs its verdict on-chain. Every number on this screen is live or absent. Nothing is simulated.",
    hint: "The status badge (top-right) tells you if the engine is live.",
  },
  {
    k: "02 · READ THE SCREEN",
    title: "Three columns, one pipeline",
    body: "Left: the macro calendar it watches and the risk engine that constrains it. Middle: the agent's live reasoning feed — you can watch each tool call as it happens. Right: performance, executed trades, and the on-chain attestation log.",
    hint: "Hover any panel — it wakes up. Everything scrolls independently.",
  },
  {
    k: "03 · FIRE A LIVE RUN",
    title: "Trigger the real pipeline yourself",
    body: "In the middle panel, enter an event (say CPI 4.1 vs forecast 3.4) and hit trigger. That's not a demo animation — a real Gemini agent runs live tool calls against live market data, decides, and attests the verdict on-chain. It takes 20–60 seconds because it's real.",
    hint: "One run at a time — the cooldown protects free API budgets.",
  },
  {
    k: "04 · GET CREDITS",
    title: "Sign in, get 1,000 MARA credits",
    body: "Use Google, any browser wallet (we detect them all), or a one-click guest pass. Credits are your stake for Signal Duel: call BULL or BEAR on an event before the agent speaks. Beat it and double your stake; it says NEUTRAL and you push.",
    hint: "Wallet sign-in is a real signature check — no transaction, no gas.",
  },
  {
    k: "05 · GO DEEPER",
    title: "Time Machine, track record, diagnostics",
    body: "REPLAY scrubs 100+ real historical macro prints through MARA's decision logic with zero lookahead — watch the equity curve build print by print. TRACK shows every past call graded HIT/STOP/DRIFT. DIAG proves every integration is live.",
    hint: "All of it is in the top navigation. Start with REPLAY — it's the fun one.",
  },
];

export default function Onboarding({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <div className="onboard-veil" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="onboard-card">
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <span className="mara-micro" style={{ color: "var(--phos)" }}>{step.k}</span>
          <button className="mc-btn mc-btn--ghost" style={{ padding: "6px 10px" }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "28px 28px 24px" }}>
          <h2 className="mara-serif" style={{ fontSize: 30, color: "var(--fg)", marginBottom: 14, lineHeight: 1.15 }}>
            {step.title}
          </h2>
          <p className="mara-body" style={{ color: "var(--fg-2)", marginBottom: 16 }}>{step.body}</p>
          <p className="mara-micro mara-amber" style={{ textTransform: "none", letterSpacing: 0 }}>
            ▸ {step.hint}
          </p>
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((_, j) => <span key={j} className={`onboard-step-dot${j <= i ? " on" : ""}`} />)}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {i > 0 && (
              <button className="mc-btn mc-btn--ghost" onClick={() => setI(i - 1)}>
                <ChevronLeft size={13} /> Back
              </button>
            )}
            <button
              className="mc-btn mc-btn--amber"
              onClick={() => (last ? onClose() : setI(i + 1))}
            >
              {last ? "Enter the terminal" : "Next"} <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
