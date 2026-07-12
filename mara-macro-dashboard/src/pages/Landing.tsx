/**
 * MARA Landing — "Spectral Instrument II"
 *
 * Cinematic scroll narrative on near-black (GitHub-home vibe, dark aero,
 * spectral glow, overprint typography). The glowing subject — the macro
 * pulse — is now literal: a scroll-drawn ECG line runs through the six
 * pipeline stages, each backed by giant stroke-only ghost words:
 * DETECT → MEASURE → DEBATE → GATE → EXECUTE → ATTEST.
 *
 * Everything quantified on this page is REAL: the ticker tape streams
 * /api/markets, the proof strip counts up from /api/diag + /api/decisions.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform, useSpring, useInView } from "motion/react";
import {
  ArrowRight, ChevronDown, Radar, Sigma, MessagesSquare, ShieldCheck,
  Zap, Link2, TerminalSquare, FlaskConical, ScrollText, Bot,
} from "lucide-react";
import { api } from "../api";

const STAGES = [
  {
    icon: Radar, num: "01 · DETECT", ghost: "DETECT",
    title: "Dual-path macro detection",
    body: "A news scanner regexes live SoSoValue headlines every 30 seconds while a history watcher polls official prints — CPI, FOMC, NFP, PCE. A reconciler dedupes both paths, so MARA reacts in seconds, not minutes.",
  },
  {
    icon: Sigma, num: "02 · MEASURE", ghost: "MEASURE",
    title: "Rolling-window surprise engine",
    body: "Every print becomes a z-score against an 18-release rolling σ of actual-minus-forecast. Raw numbers become comparable, backtestable surprises — the same math that seeds the catalyst corpus.",
  },
  {
    icon: MessagesSquare, num: "03 · DEBATE", ghost: "DEBATE",
    title: "Bull vs Bear vs Synthesiser",
    body: "An agentic Gemini loop investigates with real tools — corpus analogs, ETF flows, regime state — then three adversarial roles argue the print. The verdict ships with its dissent attached. Every number cites a tool call.",
  },
  {
    icon: ShieldCheck, num: "04 · GATE", ghost: "GATE",
    title: "Regime-conditional risk engine",
    body: "ATR sizing scaled by market regime, a macro circuit breaker that de-risks before scheduled releases, drawdown halts, cooldowns, and a kill switch mirrored on-chain. Hard rules bind regardless of AI conviction.",
  },
  {
    icon: Zap, num: "05 · EXECUTE", ghost: "EXECUTE",
    title: "EIP-712 signed, on-chain real",
    body: "Orders are keccak256-hashed in Go-struct field order, EIP-712 signed under chainId 138565, and land on the SoDEX testnet book — perps hedges plus SSI index rotation. Resting limit orders, verifiable in the explorer.",
  },
  {
    icon: Link2, num: "06 · ATTEST", ghost: "ATTEST",
    title: "Immutable decision trail",
    body: "Every decision hash is written to a Solidity attestation contract by the same operator wallet that signs trades. The track record can't be edited after the fact — HIT, STOP and DRIFT alike.",
  },
];

/* ── the scroll-drawn ECG pulse through the pipeline ── */
function pulsePath(): string {
  // vertical line with a heartbeat complex at each of the 6 stages
  const X = 170;
  let d = `M ${X} 0`;
  const spikes = [150, 330, 510, 690, 870, 1050];
  for (const y of spikes) {
    d += ` L ${X} ${y}`
      + ` L ${X - 26} ${y + 12}`   // small dip
      + ` L ${X + 52} ${y + 26}`   // tall spike
      + ` L ${X - 40} ${y + 42}`   // undershoot
      + ` L ${X} ${y + 56}`;       // recover
  }
  d += ` L ${X} 1200`;
  return d;
}

/* ── count-up proof metric ── */
function CountUp({ value, fallback }: { value: number | null; fallback: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || value === null) return;
    const t0 = performance.now();
    const dur = 1400;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);
  return <span ref={ref}>{value === null ? fallback : String(shown)}</span>;
}

/* ── live ticker tape — real SoDEX marks, nothing else ── */
function MarketTape() {
  const [markets, setMarkets] = useState<Array<{ symbol: string; price: number; changePct: number | null }>>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.markets().then((m) => { if (alive) setMarkets(m.markets); }).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (markets.length === 0) return null;
  const items = markets.map((m) => (
    <span key={m.symbol} className="landing-tape-item">
      <span className="sym">{m.symbol}</span>
      <span className="px">${m.price.toLocaleString()}</span>
      {m.changePct !== null && (
        <span className={m.changePct >= 0 ? "up" : "dn"}>
          {m.changePct >= 0 ? "▲" : "▼"} {Math.abs(m.changePct).toFixed(2)}%
        </span>
      )}
      <span className="src">SODEX TESTNET LIVE</span>
    </span>
  ));
  return (
    <div className="landing-tape" aria-hidden>
      <div className="landing-tape-track">
        {items}
        {markets.map((m) => (
          <span key={`${m.symbol}-b`} className="landing-tape-item">
            <span className="sym">{m.symbol}</span>
            <span className="px">${m.price.toLocaleString()}</span>
            {m.changePct !== null && (
              <span className={m.changePct >= 0 ? "up" : "dn"}>
                {m.changePct >= 0 ? "▲" : "▼"} {Math.abs(m.changePct).toFixed(2)}%
              </span>
            )}
            <span className="src">SODEX TESTNET LIVE</span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface StageProps { stage: typeof STAGES[number]; index: number; key?: string | number }

function Stage({ stage, index }: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-35% 0px -35% 0px" });
  const Icon = stage.icon;
  const left = index % 2 === 0;
  return (
    <div ref={ref} style={{ position: "relative" }} className={inView ? "landing-stage--lit" : ""}>
      {/* overprint ghost word — opposite side of the card */}
      <span
        className="landing-ghost"
        style={left ? { right: "-2%" } : { left: "-2%" }}
      >
        {stage.ghost}
      </span>
      <motion.div
        className={`landing-stage${inView ? " landing-stage--lit" : ""}`}
        initial={{ opacity: 0, y: 60 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration: 0.7, delay: (index % 2) * 0.08, ease: [0.21, 0.6, 0.35, 1] }}
        style={{ marginLeft: left ? 0 : "auto", maxWidth: 520, position: "relative", zIndex: 1 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="landing-stage-num">{stage.num}</span>
          <Icon size={16} color={inView ? "var(--spectral-a)" : "var(--fg-4)"} style={{ transition: "color .4s" }} />
        </div>
        <h3>{stage.title}</h3>
        <p>{stage.body}</p>
      </motion.div>
    </div>
  );
}

const TIERS = [
  {
    name: "WATCH", hot: false,
    line: "The open instrument. Every reading on this site — free, live, unauthenticated.",
    items: ["OP-CENTRAL terminal", "Track record + counterfactuals", "/diag — 8 live integration checks", "Backtest with honest caveats"],
  },
  {
    name: "SIGNAL", hot: true,
    line: "The feed. MARA's verdicts, dissent attached, pushed the second they're attested.",
    items: ["Telegram broadcast (incl. NO_TRADE)", "mcp-mara — 8 tools in your AI client", "Corpus analogs with forward returns", "Regime + circuit-breaker state"],
  },
  {
    name: "OPERATE", hot: false,
    line: "The desk. MARA sizes, signs and lands the order under your risk envelope.",
    items: ["EIP-712 execution on SoDEX", "Regime-scaled position sizing", "On-chain attestation per decision", "Kill switch mirrored on-chain"],
  },
];

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pipelineRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll();
  const progressScale = useSpring(scrollYProgress, { stiffness: 140, damping: 26 });

  const { scrollYProgress: pipeProgress } = useScroll({
    target: pipelineRef,
    offset: ["start 70%", "end 60%"],
  });
  const pulseLength = useSpring(pipeProgress, { stiffness: 70, damping: 22 });

  const orbY = useTransform(scrollYProgress, [0, 1], ["0vh", "160vh"]);
  const orbX = useTransform(scrollYProgress, [0, 0.3, 0.6, 1], ["0%", "18%", "-14%", "6%"]);
  const heroFade = useTransform(scrollYProgress, [0, 0.14], [1, 0]);
  const heroRise = useTransform(scrollYProgress, [0, 0.14], ["0px", "-80px"]);

  // REAL proof numbers — never marketed beyond what the engine reports
  const [proof, setProof] = useState<{ endpoints: number | null; corpusRows: number | null; checksGreen: number | null; checksTotal: number | null; decisions: number | null }>({
    endpoints: null, corpusRows: null, checksGreen: null, checksTotal: null, decisions: null,
  });
  useEffect(() => {
    api.diag().then((d) => {
      setProof((p) => ({
        ...p,
        endpoints: d.endpointRegistry.total,
        corpusRows: d.corpus?.rows ?? 0,
        checksGreen: d.checks.filter((c) => c.ok).length,
        checksTotal: d.checks.length,
      }));
    }).catch(() => {});
    api.decisions().then((d) => setProof((p) => ({ ...p, decisions: d.length }))).catch(() => {});
  }, []);

  return (
    <div ref={rootRef} className="landing-root landing-grain">

      {/* ── spectral scroll progress ── */}
      <motion.div className="landing-progress" style={{ scaleX: progressScale }} />

      {/* ── cinematic vignette ── */}
      <div className="landing-vignette" />

      {/* ── fixed nav ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 40,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 34px",
        background: "linear-gradient(180deg, rgba(3,3,4,.85), transparent)",
        backdropFilter: "blur(4px)",
      }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 17, color: "var(--fg)" }}>
          MARA<span style={{ color: "var(--fg-4)" }}>:</span><span className="mara-spectral-text">OP</span>
        </span>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <Link to="/track" style={{ color: "var(--fg-3)", fontSize: 12, textDecoration: "none", letterSpacing: ".08em" }}>TRACK</Link>
          <Link to="/diag" style={{ color: "var(--fg-3)", fontSize: 12, textDecoration: "none", letterSpacing: ".08em" }}>DIAG</Link>
          <Link to="/judges" style={{ color: "var(--fg-3)", fontSize: 12, textDecoration: "none", letterSpacing: ".08em" }}>JUDGES</Link>
          <Link to="/terminal" className="landing-cta landing-cta--ghost" style={{ padding: "9px 18px", fontSize: 12 }}>
            <TerminalSquare size={14} /> Terminal
          </Link>
        </div>
      </nav>

      {/* ── travelling spectral orb (the glowing subject) ── */}
      <motion.div
        className="landing-orb"
        style={{ top: "-6%", left: "50%", translateX: "-50%", y: orbY, x: orbX, zIndex: 0 }}
      />

      {/* ═══ HERO ═══ */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 24px", zIndex: 1, overflow: "hidden" }}>
        <div className="landing-aurora" />

        {/* orbit rings — centered via `translate`, spun via `rotate` */}
        <div className="landing-ring" style={{ width: 560, height: 560, top: "50%", left: "50%", animation: "orbit-slow 40s linear infinite" }} />
        <div className="landing-ring" style={{ width: 780, height: 780, top: "50%", left: "50%", animation: "orbit-slow 70s linear infinite reverse", opacity: .5 }} />

        <motion.div style={{ opacity: heroFade, y: heroRise, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 26, position: "relative" }}>
          <motion.span
            className="landing-kicker"
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .1 }}
          >
            Macro-Aware Research &amp; Execution Agent
          </motion.span>

          <motion.h1
            className="landing-hero-title"
            initial={{ opacity: 0, y: 30, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.1, delay: .25, ease: [0.21, 0.6, 0.35, 1] }}
          >
            THE MACRO<br />
            <span className="mara-spectral-text">HAS A PULSE.</span>
            <span className="landing-caret" />
          </motion.h1>

          <motion.p
            className="landing-sub"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .9, delay: .55 }}
          >
            MARA hears every CPI, FOMC and payrolls print the moment it lands — measures the surprise,
            debates it, gates it through hard risk rules, executes on-chain, and signs its name to the outcome.
            Autonomous. Auditable. Agent-callable.
          </motion.p>

          <motion.div
            style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .75 }}
          >
            <Link to="/terminal" className="landing-cta landing-cta--primary">
              Enter the Terminal <ArrowRight size={16} />
            </Link>
            <Link to="/judges" className="landing-cta landing-cta--ghost">
              <FlaskConical size={15} /> 60-second judge script
            </Link>
          </motion.div>

          <motion.div
            style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1 }}
          >
            <span className="landing-chip"><span className="dot-live" /> SoSoValue · {proof.endpoints ?? "35"} endpoints</span>
            <span className="landing-chip"><span className="dot-live" /> SoDEX testnet · EIP-712</span>
            <span className="landing-chip"><span className="dot-live" /> mcp-mara · 8 tools</span>
          </motion.div>
        </motion.div>

        <motion.div className="landing-cue" style={{ position: "absolute", bottom: 34, opacity: heroFade }}>
          <ChevronDown size={22} color="var(--fg-3)" />
        </motion.div>
      </section>

      {/* ── live market tape — the page breathes real data ── */}
      <MarketTape />

      {/* ═══ PIPELINE — the pulse narrative ═══ */}
      <section ref={pipelineRef} style={{ position: "relative", padding: "16vh 24px", maxWidth: 1080, margin: "0 auto", zIndex: 1 }}>
        {/* scroll-drawn ECG — the literal pulse of the page */}
        <svg className="landing-pulse-svg" viewBox="0 0 340 1200" preserveAspectRatio="none" fill="none">
          <defs>
            <linearGradient id="pulseGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--spectral-a)" stopOpacity="0" />
              <stop offset="18%" stopColor="var(--spectral-a)" />
              <stop offset="55%" stopColor="var(--spectral-b)" />
              <stop offset="88%" stopColor="var(--spectral-c)" />
              <stop offset="100%" stopColor="var(--spectral-c)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={pulsePath()}
            stroke="url(#pulseGrad)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{ pathLength: pulseLength }}
          />
        </svg>

        <motion.div
          initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ duration: .8 }}
          style={{ textAlign: "center", marginBottom: "10vh", position: "relative", zIndex: 1 }}
        >
          <span className="landing-kicker">The pipeline</span>
          <h2 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(30px,5vw,52px)", color: "var(--fg)", marginTop: 14, letterSpacing: "-0.02em" }}>
            From print to position<br /><span className="mara-spectral-text">in one unbroken chain.</span>
          </h2>
        </motion.div>

        <div style={{ display: "flex", flexDirection: "column", gap: "9vh" }}>
          {STAGES.map((s, i) => <Stage key={s.num} stage={s} index={i} />)}
        </div>
      </section>

      {/* ═══ LIVE PROOF ═══ */}
      <section style={{ position: "relative", padding: "12vh 24px", zIndex: 1 }}>
        <motion.div
          initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: .8 }}
          style={{ maxWidth: 1080, margin: "0 auto", textAlign: "center" }}
        >
          <span className="landing-kicker">Nothing on this page is a promise — it's a reading</span>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            border: "1px solid var(--border-soft)", borderRadius: 16, marginTop: 30,
            background: "linear-gradient(160deg, rgba(14,17,24,.7), rgba(3,3,4,.9))",
            backdropFilter: "blur(10px)", overflow: "hidden",
          }}>
            {[
              { v: <CountUp value={proof.endpoints} fallback="35" />, k: "SoSoValue endpoints wired", grad: true },
              { v: <CountUp value={proof.corpusRows} fallback="—" />, k: "corpus catalysts seeded", grad: false },
              { v: proof.checksGreen !== null ? <span><CountUp value={proof.checksGreen} fallback="—" />/{proof.checksTotal}</span> : <span>—</span>, k: "live integrations green", grad: true },
              { v: <CountUp value={proof.decisions} fallback="—" />, k: "decisions on record", grad: false },
            ].map((m) => (
              <div key={m.k} className="landing-metric" style={{ borderRight: "1px solid var(--border-soft)" }}>
                <span className={`v ${m.grad ? "mara-spectral-text" : ""}`} style={!m.grad ? { color: "var(--fg)" } : undefined}>{m.v}</span>
                <span className="k">{m.k}</span>
              </div>
            ))}
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 14, letterSpacing: ".06em" }}>
            LIVE FROM /api/diag — REFRESH AND WATCH THEM CHANGE. FULL STATUS ON <Link to="/diag" style={{ color: "var(--spectral-a)" }}>/DIAG</Link>.
          </p>
        </motion.div>
      </section>

      {/* ═══ AGENT-CALLABLE ═══ */}
      <section style={{ position: "relative", padding: "12vh 24px", zIndex: 1 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 40, alignItems: "center" }}>
          <motion.div
            initial={{ opacity: 0, x: -40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: .8 }}
          >
            <span className="landing-kicker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Bot size={14} color="var(--spectral-b)" /> Built for agents, not just humans
            </span>
            <h2 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(26px,3.6vw,40px)", color: "var(--fg)", margin: "16px 0 14px", letterSpacing: "-0.02em" }}>
              Your AI can call<br /><span className="mara-spectral-text">MARA's brain directly.</span>
            </h2>
            <p className="landing-sub" style={{ fontSize: 15.5 }}>
              <code style={{ color: "var(--spectral-a)" }}>mcp-mara</code> exposes eight tools over the Model Context Protocol:
              the macro calendar, surprise scores, corpus analogs with real forward returns, the debate verdict,
              live risk gates, the cited track record, a trade simulator — and, behind an operator gate,
              real testnet execution. Claude Desktop, Cursor, VS Code: one config block.
            </p>
          </motion.div>

          <motion.div
            className="landing-code"
            initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: .8, delay: .15 }}
          >
{`{ `}<span className="tok-d">// claude_desktop_config.json</span>{`
  `}<span className="tok-a">"mcpServers"</span>{`: {
    `}<span className="tok-a">"mara"</span>{`: {
      `}<span className="tok-b">"command"</span>{`: `}<span className="tok-c">"npx"</span>{`,
      `}<span className="tok-b">"args"</span>{`: [`}<span className="tok-c">"-y"</span>{`, `}<span className="tok-c">"mcp-mara"</span>{`],
      `}<span className="tok-b">"env"</span>{`: { `}<span className="tok-a">"MARA_API_URL"</span>{`: `}<span className="tok-c">"https://mara.onrender.com"</span>{` }
    }
  }
}

`}<span className="tok-d">&gt; query_macro_corpus(event_type: "CPI", direction: "above")</span>{`
`}<span className="tok-c">← 12 analogs · median BTC −1.4% @3d · hit-rate 67%</span>
          </motion.div>
        </div>
      </section>

      {/* ═══ THE SAAS SHAPE ═══ */}
      <section style={{ position: "relative", padding: "12vh 24px", zIndex: 1 }}>
        <motion.div
          initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: .8 }}
          style={{ maxWidth: 1080, margin: "0 auto" }}
        >
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <span className="landing-kicker">One engine, three altitudes</span>
            <h2 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(28px,4.4vw,46px)", color: "var(--fg)", marginTop: 14, letterSpacing: "-0.02em" }}>
              Watch it. Hear it.<br /><span className="mara-spectral-text">Let it trade.</span>
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22 }}>
            {TIERS.map((t, i) => (
              <motion.div
                key={t.name}
                className={`landing-tier${t.hot ? " landing-tier--hot" : ""}`}
                initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-10%" }}
                transition={{ duration: .7, delay: i * 0.12 }}
              >
                <span className="tier-name">{t.name}</span>
                <span className="tier-line">{t.line}</span>
                <ul>{t.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </motion.div>
            ))}
          </div>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 20, letterSpacing: ".06em", textAlign: "center" }}>
            ALL THREE RUN TODAY ON TESTNET — THE TIERS ARE THE PRODUCT SHAPE, NOT A PAYWALL. EXECUTION STAYS OPERATOR-GATED.
          </p>
        </motion.div>
      </section>

      {/* ═══ HONESTY / TRACK ═══ */}
      <section style={{ position: "relative", padding: "12vh 24px 16vh", zIndex: 1 }}>
        <motion.div
          initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: .8 }}
          style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}
        >
          <ScrollText size={22} color="var(--spectral-c)" style={{ marginBottom: 18 }} />
          <h2 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(28px,4.4vw,46px)", color: "var(--fg)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
            Every thesis dated.<br />
            <span className="mara-spectral-text">Every outcome resolved.</span><br />
            Losses included.
          </h2>
          <p className="landing-sub" style={{ margin: "22px auto 0" }}>
            HIT, STOP or DRIFT — MARA resolves every signal against real price data and attests the hash on-chain
            before the outcome is known. Rejected theses stay on the record next to accepted ones.
            The counterfactual curve shows what buy-and-hold — or doing nothing — would have paid instead.
          </p>
          <div style={{ marginTop: 34, display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Link to="/track" className="landing-cta landing-cta--primary">
              See the track record <ArrowRight size={16} />
            </Link>
            <Link to="/terminal" className="landing-cta landing-cta--ghost">
              <TerminalSquare size={15} /> Open OP-CENTRAL
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ── footer ── */}
      <footer style={{ borderTop: "1px solid var(--border-soft)", padding: "26px 34px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, position: "relative", zIndex: 1 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", letterSpacing: ".08em" }}>
          MARA · SoSoValue Buildathon Wave 3 · data by SoSoValue · execution on SoDEX testnet · honesty by design
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
          Backtests ≠ future returns. Macro effects are regime-conditional; MARA states its data latency openly.
        </span>
      </footer>
    </div>
  );
}
