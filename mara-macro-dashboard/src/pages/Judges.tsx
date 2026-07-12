/**
 * /judges — the zero-friction 60-second evaluation script (Mosaic pattern).
 * Numbered steps, one-click sample-thesis cards that fire the REAL pipeline,
 * and every artifact linked. Nothing here requires setup or keys.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, Play, CheckCircle2, ExternalLink, TerminalSquare, Radar, ScrollText, ArrowLeft, RefreshCw } from "lucide-react";
import { api } from "../api";

const SAMPLE_THESES = [
  {
    label: "Hot CPI shock",
    event: "CPI (YoY)", actual: 4.1, forecast: 3.4,
    blurb: "Inflation prints 0.7pp above consensus — a strong hawkish surprise. Expect a bearish verdict and a de-risk rotation.",
  },
  {
    label: "Soft payrolls",
    event: "Nonfarm Payrolls", actual: 140, forecast: 185,
    blurb: "Jobs miss by 45K — dovish, rate-cut odds rise. Expect a bullish lean with regime-scaled sizing.",
  },
  {
    label: "Inline FOMC",
    event: "FOMC Rate Decision", actual: 5.5, forecast: 5.5,
    blurb: "No surprise at all. Expect NEUTRAL / NO_TRADE with an honest low-conviction reason — MARA logs its passes.",
  },
];

const SCRIPT = [
  { t: "Open the terminal", d: "OP-CENTRAL loads live SoDEX marks, the macro calendar, and the system-module health table. Nothing is seeded." },
  { t: "Fire a sample thesis below", d: "One click runs the REAL pipeline server-side: surprise σ → agentic Gemini tool-use loop → debate → risk gates. Keys never touch your browser." },
  { t: "Watch the agent think", d: "The tool-call trace streams live into the reasoning feed: get_macro_surprise → query_macro_corpus → get_etf_flows → verdict, every number tool-grounded." },
  { t: "Check /diag", d: "Every integration pinged live with latency — SoSoValue, SoDEX public + signed, Gemini, DB, Neon persistence, the attestation chain, Telegram." },
  { t: "Check /track", d: "Dated theses with HIT/STOP/DRIFT outcomes, the backtest vs buy-and-hold, and the counterfactual curve. Losses and rejections included." },
];

export default function Judges() {
  const [firing, setFiring] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const fire = async (s: typeof SAMPLE_THESES[number]) => {
    if (firing) return;
    setFiring(s.label);
    try {
      const res = await api.trigger({ event: s.event, actual: s.actual, forecast: s.forecast });
      setResult((r) => ({ ...r, [s.label]: res.error ?? res.message ?? "Cycle started — open the terminal to watch it." }));
    } catch {
      setResult((r) => ({ ...r, [s.label]: "Backend unreachable — is the demo URL awake? (Free tier cold-starts take ~1 min.)" }));
    }
    setFiring(null);
  };

  return (
    <div className="landing-root landing-grain" style={{ minHeight: "100vh", padding: "90px 24px 60px" }}>
      <div className="landing-orb" style={{ top: "-20%", right: "-15%", opacity: .6 }} />

      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 16, padding: "18px 34px", background: "linear-gradient(180deg, rgba(3,3,4,.9), transparent)" }}>
        <Link to="/" style={{ color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 6, fontSize: 12, textDecoration: "none", letterSpacing: ".08em" }}><ArrowLeft size={14} /> MARA</Link>
      </nav>

      <div style={{ maxWidth: 900, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <span className="landing-kicker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FlaskConical size={14} color="var(--spectral-a)" /> For judges — evaluate MARA in 60 seconds
        </span>
        <h1 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(30px,5vw,50px)", color: "var(--fg)", margin: "14px 0 10px", letterSpacing: "-0.02em" }}>
          Run the whole thing.<br /><span className="mara-spectral-text">Right now. No setup.</span>
        </h1>
        <p className="landing-sub" style={{ marginBottom: 40 }}>
          MARA is an autonomous macro-event trading agent: it detects CPI/FOMC/NFP prints from SoSoValue,
          scores the surprise statistically, lets an agentic AI debate it against a hand-built catalyst corpus,
          gates it through regime-conditional risk rules, executes EIP-712-signed orders on SoDEX testnet,
          and attests every decision hash on-chain.
        </p>

        {/* script */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 48 }}>
          {SCRIPT.map((s, i) => (
            <div key={i} className="landing-stage" style={{ padding: "18px 22px", display: "flex", gap: 18, alignItems: "flex-start" }}>
              <span className="mara-spectral-text" style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 22, lineHeight: 1 }}>{i + 1}</span>
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 15, color: "var(--fg)" }}>{s.t}</div>
                <div style={{ fontFamily: "var(--font-sans)", fontWeight: 300, fontSize: 13.5, color: "var(--fg-2)", marginTop: 4, lineHeight: 1.55 }}>{s.d}</div>
              </div>
            </div>
          ))}
        </div>

        {/* sample thesis cards */}
        <span className="landing-kicker">One-click sample theses (fires the real pipeline)</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14, margin: "18px 0 48px" }}>
          {SAMPLE_THESES.map((s) => (
            <div key={s.label} className="landing-stage landing-stage--lit" style={{ padding: "20px 22px" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>{s.label}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--spectral-a)", margin: "6px 0 8px" }}>
                {s.event} · {s.actual} vs {s.forecast} est.
              </div>
              <p style={{ fontFamily: "var(--font-sans)", fontWeight: 300, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5, minHeight: 60 }}>{s.blurb}</p>
              <button
                onClick={() => void fire(s)}
                disabled={firing !== null}
                className="landing-cta landing-cta--primary"
                style={{ padding: "10px 18px", fontSize: 12, marginTop: 10, border: "none", cursor: "pointer" }}
              >
                {firing === s.label ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={13} />}
                Run live cycle
              </button>
              {result[s.label] && (
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 10 }}>
                  <CheckCircle2 size={12} color="var(--spectral-c)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-2)" }}>{result[s.label]}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* artifacts */}
        <span className="landing-kicker">Artifacts</span>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <Link to="/terminal" className="landing-cta landing-cta--ghost" style={{ fontSize: 12, padding: "11px 18px" }}><TerminalSquare size={14} /> OP-CENTRAL terminal</Link>
          <Link to="/diag" className="landing-cta landing-cta--ghost" style={{ fontSize: 12, padding: "11px 18px" }}><Radar size={14} /> /diag — live integrations</Link>
          <Link to="/track" className="landing-cta landing-cta--ghost" style={{ fontSize: 12, padding: "11px 18px" }}><ScrollText size={14} /> /track — record + backtest</Link>
          <a href="https://github.com/harsh11067/mara" target="_blank" rel="noreferrer" className="landing-cta landing-cta--ghost" style={{ fontSize: 12, padding: "11px 18px" }}><ExternalLink size={14} /> GitHub repo</a>
        </div>

        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 36, lineHeight: 1.7, letterSpacing: ".04em" }}>
          HONESTY NOTES: SoSoValue ETF-flow data is end-of-day, not intraday. The SoDEX testnet order book is thin, so
          MARA posts resting limit orders (verifiable on-chain) rather than faking market fills. Backtest Sharpe is
          reported alongside its 50%-discounted figure per Harvey &amp; Liu. All fallbacks are documented in mocks.md.
        </p>
      </div>
    </div>
  );
}
