/**
 * MARA OP-CENTRAL — the terminal.
 *
 * Wave 3 real-engine rules (mocks.md A1–A8):
 *   - No seeded data. No Math.random(). No client-side verdicts.
 *   - Tickers come from /api/markets (live SoDEX testnet marks).
 *   - Stats come from /api/performance/summary (real trades only).
 *   - SSI panel comes from /api/ssi (real spot balances + rotation table).
 *   - The trigger fires POST /api/trigger; the verdict arrives over WebSocket
 *     from the real Gemini agentic pipeline, with the live tool-call trace.
 */
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Cpu, Wifi, Radar, ScrollText, Swords, Clock, HelpCircle } from "lucide-react";
import {
  MacroEvent, AiReasoning, Trade, SsiHolding, RotationLog, AgentTraceStep,
} from "./types";

import MacroCalendar        from "./components/MacroCalendar";
import AiReasoningFeed      from "./components/AiReasoningFeed";
import TradeStream          from "./components/TradeStream";
import RiskEngine           from "./components/RiskEngine";
import PerformanceCard      from "./components/PerformanceCard";
import SsiPortfolio         from "./components/SsiPortfolio";
import OnChainAttestation   from "./components/OnChainAttestation";
import AccountMenu          from "./components/AccountMenu";
import Onboarding           from "./components/Onboarding";

import {
  api,
  mapDecision,
  mapEvent,
  mapTrade,
  mapSsiHoldings,
  mapRotations,
  createWebSocket,
  type WsMessage,
  type BackendPerformanceSummary,
  type BackendRisk,
  type BackendRegime,
  type DiagCheck,
} from "./api";

interface TickerQuote { sym: string; px: number | null; chg: number | null }

const ONBOARD_KEY = "mara_onboarded";

export default function App() {
  // ── State — all empty until the backend speaks (honest by design) ──────────
  const [events,       setEvents]       = useState<MacroEvent[]>([]);
  const [reasonings,   setReasonings]   = useState<AiReasoning[]>([]);
  const [trades,       setTrades]       = useState<Trade[]>([]);
  const [holdings,     setHoldings]     = useState<SsiHolding[]>([]);
  const [rotationLogs, setRotationLogs] = useState<RotationLog[]>([]);
  const [agentTrace,   setAgentTrace]   = useState<AgentTraceStep[]>([]);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isSimulating,    setIsSimulating]    = useState(false);
  const [isKilled,        setIsKilled]        = useState(false);

  // Onboarding — first visit gets the walkthrough
  const [showOnboard, setShowOnboard] = useState(() => !localStorage.getItem(ONBOARD_KEY));

  // Live tickers (real SoDEX marks — null until fetched)
  const [tickers, setTickers] = useState<TickerQuote[]>([
    { sym: "BTC-USD", px: null, chg: null },
    { sym: "ETH-USD", px: null, chg: null },
    { sym: "SOL-USD", px: null, chg: null },
  ]);

  // Account / risk — full backend objects, nothing derived client-side
  const [risk,   setRisk]   = useState<BackendRisk | null>(null);
  const [regime, setRegime] = useState<BackendRegime | null>(null);
  const [perf, setPerf] = useState<BackendPerformanceSummary | null>(null);
  const [diagChecks, setDiagChecks] = useState<DiagCheck[]>([]);

  const [backendOnline, setBackendOnline] = useState(false);
  const [attestationRefresh, setAttestationRefresh] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // UTC clock
  const [utcTime, setUtcTime] = useState("");
  useEffect(() => {
    const fmt = () => new Date().toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: "UTC",
    });
    setUtcTime(fmt());
    const id = setInterval(() => setUtcTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Live market tickers (real SoDEX testnet marks, 12 s poll) ──────────────
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const data = await api.markets();
        if (data.markets.length > 0) {
          setTickers(["BTC-USD", "ETH-USD", "SOL-USD"].map((sym) => {
            const m = data.markets.find((x) => x.symbol === sym);
            return { sym, px: m?.price ?? null, chg: m?.changePct ?? null };
          }));
        }
      } catch { /* backend offline — tickers stay “—” */ }
    };
    void fetchMarkets();
    const id = setInterval(() => void fetchMarkets(), 12_000);
    return () => clearInterval(id);
  }, []);

  // ── Backend polling (single source of truth) ────────────────────────────────
  const mergeBackendData = async () => {
    try {
      const [evts, decs, trd, riskState] = await Promise.all([
        api.events(), api.decisions(), api.trades(), api.risk(),
      ]);
      setBackendOnline(true);

      setEvents(evts.map(mapEvent).slice(0, 12));
      setReasonings(decs.map(mapDecision).slice(0, 20));
      setTrades(trd.map(mapTrade).slice(0, 20));

      setRisk(riskState);
      setIsKilled(riskState.killSwitchActive);
    } catch {
      setBackendOnline(false);
    }

    // secondary, cheaper surfaces — independent failures tolerated
    try { setPerf(await api.perfSummary()); } catch { /* keep last */ }
    try {
      const ssi = await api.ssi();
      setHoldings(mapSsiHoldings(ssi));
      setRotationLogs(mapRotations(ssi));
    } catch { /* keep last */ }
  };

  useEffect(() => {
    void mergeBackendData();
    pollRef.current = setInterval(() => void mergeBackendData(), 10_000);
    // diag (module registry) + regime refresh on a slower cadence
    const diagId = setInterval(() => {
      api.diag().then((d) => setDiagChecks(d.checks)).catch(() => {});
      api.regime().then(setRegime).catch(() => {});
    }, 60_000);
    api.diag().then((d) => setDiagChecks(d.checks)).catch(() => {});
    api.regime().then(setRegime).catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearInterval(diagId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── WebSocket: decisions, trades, risk, agent trace — the live spine ───────
  useEffect(() => {
    const cleanup = createWebSocket(
      (msg: WsMessage) => {
        setBackendOnline(true);
        if (msg.type === "init") {
          if (msg.data.killSwitch !== undefined) setIsKilled(msg.data.killSwitch);
          if (msg.data.decisions?.length) {
            setReasonings(prev => {
              const inc = msg.data.decisions.map(mapDecision);
              const ids = new Set(inc.map(r => r.id));
              return [...inc, ...prev.filter(r => !ids.has(r.id))].slice(0, 20);
            });
          }
        }
        if (msg.type === "decision") {
          const d = msg.data;
          const id = (d as { decisionId?: string }).decisionId ?? d.id;
          const r: AiReasoning = {
            id,
            eventName:     (d as { eventName?: string }).eventName ?? "Macro Event",
            timestamp:     d.timestamp ?? Date.now(),
            surpriseScore: (d.marketContext?.surpriseScore as number) ?? 0,
            direction:     d.conviction,
            confidence:    d.confidence,
            actual:        String(d.marketContext?.actual ?? "—"),
            forecast:      String(d.marketContext?.forecast ?? "—"),
            reasoning:     d.reasoning ?? "",
            sourceNews:    d.newsContext ?? [],
          };
          setReasonings(prev => [r, ...prev.filter(x => x.id !== id)].slice(0, 20));
          setIsSimulating(false);
          if (simTimeoutRef.current) { clearTimeout(simTimeoutRef.current); simTimeoutRef.current = null; }
          setAttestationRefresh(n => n + 1);
        }
        if (msg.type === "agent_trace") {
          const step = msg.data;
          setAgentTrace(prev => {
            const next = prev.length > 0 && prev[0].runId !== step.runId ? [step] : [...prev, step];
            return next.slice(-40);
          });
        }
        if (msg.type === "trade") {
          setTrades(prev => {
            const t = mapTrade(msg.data as Parameters<typeof mapTrade>[0]);
            return [t, ...prev.filter(x => x.id !== t.id)].slice(0, 20);
          });
        }
        if (msg.type === "risk") {
          const r = msg.data as Partial<BackendRisk>;
          if (r.killSwitchActive !== undefined) setIsKilled(r.killSwitchActive);
          setRisk((prev) => (prev ? { ...prev, ...r } : prev));
        }
        if (msg.type === "status") setIsKilled(msg.data.killSwitch);
      },
      () => setBackendOnline(true),
    );
    return cleanup;
  }, []);

  const closeOnboarding = () => {
    localStorage.setItem(ONBOARD_KEY, "1");
    setShowOnboard(false);
  };

  // ── Trigger: REAL backend cycle only — no client-side theater ──────────────
  const handleTrigger = (eventName: string, actual: string, forecast: string) => {
    if (isKilled || isSimulating) return;
    const parseVal = (s: string) => {
      const n = parseFloat(s.replace(/[%K]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    setIsSimulating(true);
    setAgentTrace([]);
    api.trigger({ event: eventName, actual: parseVal(actual), forecast: parseVal(forecast) })
      .then((res) => {
        if (res.error) {
          setIsSimulating(false);
          setAgentTrace([{ runId: "err", step: 1, kind: "error", summary: res.error, ts: Date.now() }]);
        }
      })
      .catch(() => {
        setIsSimulating(false);
        setAgentTrace([{ runId: "err", step: 1, kind: "error", summary: "Backend unreachable — start macromind (npm start) to run a live cycle.", ts: Date.now() }]);
      });
    // Safety: the pipeline (Gemini + tools) can take a while; stop the spinner
    // after 90 s even if no decision arrives.
    simTimeoutRef.current = setTimeout(() => setIsSimulating(false), 90_000);
  };

  // Kill switch — backend is authoritative; UI reflects the WS echo
  const handleKillSwitchToggle = () => {
    if (!isKilled) {
      api.killSwitch().catch(() => {});
      setIsKilled(true);
    } else {
      api.resetKillSwitch().catch(() => {});
      setIsKilled(false);
    }
  };

  return (
    <div className="mara-scanlines" style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)", color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
      {/* ── TopBar ── */}
      <header className="mara-topbar-glow" style={{ display: "flex", alignItems: "center", gap: 28, padding: "14px 22px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div className="artifact-spin-move mara-core-glow" style={{ width: 42, height: 42, borderRadius: "var(--r-md)", background: "var(--bg-card)", border: "1px solid var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--info)" }}>
            <Cpu size={22} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 20, letterSpacing: ".01em", color: "var(--fg)" }}>
                MARA<span style={{ color: "var(--fg-4)", margin: "0 1px" }}>:</span><span className="mara-spectral-text">OP-CENTRAL</span>
              </span>
              <span className="mc-badge mc-badge--pos">AUTONOMOUS</span>
              {backendOnline && <span className="mc-badge mc-badge--info"><span className="dot" />API LIVE</span>}
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", letterSpacing: ".02em" }}>
              Macro-Aware Research &amp; Execution Agent · Operational Kernel
            </span>
          </div>
        </div>

        {/* Ticker — live SoDEX marks */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {tickers.map((q, i) => (
              <div key={q.sym} style={{ display: "flex", alignItems: "center", gap: 22 }}>
                {i > 0 && <span style={{ width: 1, height: 30, background: "var(--border)", display: "block" }} />}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em", color: "var(--fg-3)" }}>
                    {q.sym} <span style={{ color: "var(--fg-4)" }}>· SoDEX</span>
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
                    {q.px !== null ? q.px.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}{" "}
                    {q.chg !== null && (
                      <span className={q.chg >= 0 ? "mara-pos" : "mara-neg"}>{q.chg >= 0 ? "+" : ""}{q.chg.toFixed(2)}%</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right group */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Nav */}
          <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link to="/duel" className="mc-btn mc-btn--amber" style={{ gap: 6, textDecoration: "none" }}><Swords size={13} /> Duel</Link>
            <Link to="/replay" className="mc-btn" style={{ gap: 6, textDecoration: "none" }}><Clock size={13} /> Replay</Link>
            <Link to="/track" className="mc-btn" style={{ gap: 6, textDecoration: "none" }}><ScrollText size={13} /> Track</Link>
            <Link to="/diag" className="mc-btn" style={{ gap: 6, textDecoration: "none" }}><Radar size={13} /> Diag</Link>
            <button className="mc-btn mc-btn--ghost" style={{ padding: "9px 10px" }} title="How this works" onClick={() => setShowOnboard(true)}>
              <HelpCircle size={13} />
            </button>
          </nav>

          {/* Account: Google / wallet / guest + credits */}
          <AccountMenu />

          {/* UTC Clock */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "right" }}>
            <span className="mara-micro" style={{ color: "var(--fg-3)" }}>Desks Operational Clock (UTC)</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}>
              {utcTime || "—"} UTC
            </span>
          </div>

          {/* Status badge */}
          <span
            className={`mc-badge ${isKilled ? "mc-badge--neg" : backendOnline ? "mc-badge--pos" : "mc-badge--muted"}`}
            style={{ padding: "8px 12px" }}
          >
            <Wifi size={13} style={{ marginRight: 5 }} />
            {isKilled ? "HALTED" : backendOnline ? "LIVE · SEC-3" : "OFFLINE"}
          </span>
        </div>
      </header>

      {/* ── Backend-offline banner (honest, replaces silent mock data) ── */}
      {!backendOnline && (
        <div style={{ padding: "10px 22px", background: "var(--amber-bg)", borderBottom: "1px solid rgba(232,169,0,.25)", flexShrink: 0 }}>
          <span className="mara-micro mara-amber" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }}>
            Backend offline — panels show live data only, nothing is simulated. Start the engine: <code>cd macromind &amp;&amp; npm start</code>
          </span>
        </div>
      )}

      {/* ── Main 3-column grid ── */}
      <main style={{
        flex: 1, minHeight: 0, display: "grid",
        gridTemplateColumns: "minmax(380px,1fr) minmax(420px,1.05fr) minmax(440px,1.15fr)",
        gap: 14, padding: 14, overflow: "hidden",
      }}>

        {/* Col 1: Macro Calendar + Risk Engine */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "hidden" }}>
          <div style={{ height: 260, flexShrink: 0 }}>
            <MacroCalendar
              events={events}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <RiskEngine
              risk={risk}
              regime={regime}
              openPositions={trades.filter(t => t.status === "OPEN").length}
              unrealizedPnl={trades.filter(t => t.status === "OPEN").reduce((s, t) => s + t.pnl, 0)}
              isKilled={isKilled}
              onKillSwitchToggle={handleKillSwitchToggle}
            />
          </div>
        </div>

        {/* Col 2: AI Reasoning Feed (with live agent trace) */}
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <AiReasoningFeed
            reasonings={reasonings}
            onTriggerSimulation={handleTrigger}
            isSimulating={isSimulating}
            agentTrace={agentTrace}
            backendOnline={backendOnline}
          />
        </div>

        {/* Col 3: Performance + Trades + SSI */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "hidden" }}>
          <div style={{ height: 310, flexShrink: 0 }}>
            <PerformanceCard perf={perf} diagChecks={diagChecks} />
          </div>
          <div style={{ height: 220, flexShrink: 0 }}>
            <TradeStream trades={trades} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <SsiPortfolio holdings={holdings} rotationLogs={rotationLogs} />
          </div>
          <div style={{ flex: 0, minHeight: 0 }}>
            <OnChainAttestation refreshSignal={attestationRefresh} />
          </div>
        </div>
      </main>

      {/* ── Status Footer ── */}
      <footer style={{ padding: "8px 22px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span className="mc-dot mc-dot--live" />
        <span className="mara-micro mara-muted">
          MARA Autonomous Risk Monitor · Backend {backendOnline ? "ONLINE" : "OFFLINE"} · every number on this screen is live or absent — never simulated
        </span>
        <span className="mara-micro" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>
          TRADES #{risk?.totalTrades ?? 0} · {new Date().toISOString().slice(0, 10)}
        </span>
      </footer>

      {showOnboard && <Onboarding onClose={closeOnboarding} />}
    </div>
  );
}
