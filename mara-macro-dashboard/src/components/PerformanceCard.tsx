import { useState } from "react";
import { TrendingUp, RefreshCw, CheckCircle, XCircle, Play } from "lucide-react";
import PanelHeader from "./PanelHeader";

interface PerformanceCardProps {
  pnlHistory: { name: string; value: number }[];
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  totalTrades: number;
  averageR: number;
}

interface SubAgent {
  id: string;
  name: string;
  desc: string;
  conf: string;
  rate: string;
  tone: string;
  status: string;
  endpoint: string;
}

const SUB_AGENTS: SubAgent[] = [
  { id: "sa-1", name: "MARA_MCTS_CORE",       desc: "Monte Carlo Tree Search · Macro Decision", conf: "94%",  rate: "1.2ms",  tone: "pos",    status: "ACTIVE",    endpoint: "/api/status"    },
  { id: "sa-2", name: "NLP_SENTITUDE_V2",      desc: "Sovereign Web Grounding · News Parsing",  conf: "88%",  rate: "3.4ms",  tone: "info",   status: "COMPUTING", endpoint: "/api/decisions" },
  { id: "sa-3", name: "SODEX_LIQUID_ROUTER",   desc: "Exchange Routing Protocol · Order Mgmt",  conf: "91%",  rate: "0.8ms",  tone: "pos",    status: "ACTIVE",    endpoint: "/api/trades"    },
  { id: "sa-4", name: "RISK_GOVERNOR_X",        desc: "Drawdown Guardian · Kill-Switch Monitor", conf: "99%",  rate: "0.3ms",  tone: "amber",  status: "GUARDING",  endpoint: "/api/risk"      },
  { id: "sa-5", name: "BASIS_ARB_SCOUT",        desc: "Cross-Venue Basis Opportunity Scanner",   conf: "76%",  rate: "5.1ms",  tone: "muted",  status: "STANDBY",   endpoint: "/api/status"    },
];

type DiagResult = { ok: true; summary: string } | { ok: false; error: string };

export default function PerformanceCard({ pnlHistory, winRate, profitFactor, sharpeRatio, totalTrades }: PerformanceCardProps) {
  const [tab, setTab]             = useState<0 | 1>(0);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [diagResults, setDiagResults] = useState<Record<string, DiagResult>>({});

  const totalNetPnl = (pnlHistory[pnlHistory.length - 1]?.value ?? 0) - (pnlHistory[0]?.value ?? 0);
  const sessionOpen = pnlHistory[0]?.value ?? 0;
  const sessionNow  = pnlHistory[pnlHistory.length - 1]?.value ?? 0;

  const runDiagnostic = async (agent: SubAgent) => {
    if (runningId) return;
    setRunningId(agent.id);
    try {
      const res = await fetch(agent.endpoint, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Record<string, unknown>;

      let summary = "";
      if (agent.endpoint === "/api/status") {
        summary = `running=${data.running} · uptime ${Math.floor((data.uptime as number) / 60)}m`;
      } else if (agent.endpoint === "/api/decisions") {
        const arr = data as unknown as unknown[];
        summary = `${Array.isArray(arr) ? arr.length : 0} decisions on record`;
      } else if (agent.endpoint === "/api/trades") {
        const arr = data as unknown as unknown[];
        summary = `${Array.isArray(arr) ? arr.length : 0} trades on record`;
      } else if (agent.endpoint === "/api/risk") {
        const r = data as { accountBalance?: number; killSwitchActive?: boolean };
        summary = `bal=$${r.accountBalance ?? 0} · kill=${r.killSwitchActive}`;
      } else {
        summary = "OK";
      }
      setDiagResults(prev => ({ ...prev, [agent.id]: { ok: true, summary } }));
    } catch (err) {
      setDiagResults(prev => ({ ...prev, [agent.id]: { ok: false, error: String(err).slice(0, 40) } }));
    } finally {
      setRunningId(null);
    }
  };

  // Build SVG equity curve from pnlHistory
  const pts = pnlHistory.map(p => p.value);
  const minV = Math.min(...pts);
  const maxV = Math.max(...pts);
  const range = maxV - minV || 1;
  const W = 560, H = 120;
  const path = pts.map((v, i) =>
    `${(i / Math.max(1, pts.length - 1)) * W},${H - ((v - minV) / range) * H}`
  ).join(" ");

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Agent Performance Metrics"
        icon={TrendingUp}
        chip={
          <span className="mc-badge mc-badge--pos" style={{ padding: "7px 11px" }}>
            <span className="dot" />
            {totalNetPnl >= 0 ? "+" : ""}${Math.abs(totalNetPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} YTD
          </span>
        }
      />

      {/* 5 KPI stat boxes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 0, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {[
          { label: "WIN RATE",      value: `${(winRate * 100).toFixed(1)}%`, tone: "pos" },
          { label: "PROFIT FACTOR", value: profitFactor.toFixed(2),          tone: ""    },
          { label: "SHARPE",        value: sharpeRatio.toFixed(2),           tone: ""    },
          { label: "TOTAL TRADES",  value: String(totalTrades),              tone: ""    },
          { label: "EQUITY",        value: `$${(sessionNow / 1000).toFixed(1)}K`, tone: sessionNow >= sessionOpen ? "pos" : "neg" },
        ].map((m, i) => (
          <div
            key={m.label}
            className="mc-stat"
            style={{ borderRadius: 0, border: "none", borderRight: i < 4 ? "1px solid var(--border)" : "none", gap: 6, padding: "12px 14px" }}
          >
            <span className="mara-label">{m.label}</span>
            <span className={`mara-value${m.tone ? " mara-" + m.tone : ""}`} style={{ fontSize: 20 }}>{m.value}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px 0", flexShrink: 0 }}>
        <span
          className={`mc-tab${tab === 0 ? " mc-tab--active" : ""}`}
          onClick={() => setTab(0)}
        >[ 01: Realized Equity Curve ]</span>
        <span
          className={`mc-tab${tab === 1 ? " mc-tab--active" : ""}`}
          onClick={() => setTab(1)}
        >[ 02: Kernel Sub-Agents ]</span>
        <span className="mara-micro" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>AGENTIC_SUB_RESOURCES</span>
      </div>

      {/* Tab content */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, flex: 1, minHeight: 0, overflow: "hidden" }}>
        {tab === 0 ? (
          /* Equity Curve */
          <div style={{ padding: "18px" }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="120" preserveAspectRatio="none" style={{ display: "block" }}>
              <defs>
                <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="rgba(0,184,125,0.22)" />
                  <stop offset="100%" stopColor="rgba(0,184,125,0)" />
                </linearGradient>
              </defs>
              <polygon points={`0,${H} ${path} ${W},${H}`} fill="url(#eqfill)" />
              <polyline points={path} fill="none" stroke="var(--pos)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
              <span className="mara-micro">Session Open · ${sessionOpen.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className={`mara-micro ${sessionNow >= sessionOpen ? "mara-pos" : "mara-neg"}`}>
                Now · ${sessionNow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                {" "}({totalNetPnl >= 0 ? "+" : ""}${totalNetPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })})
              </span>
            </div>
          </div>
        ) : (
          /* Sub-agent table */
          <div className="mc-scroll" style={{ overflowY: "auto", height: "100%" }}>
            <table className="mc-table">
              <thead>
                <tr>
                  <th>Sub-System Model</th>
                  <th className="num">Confidence</th>
                  <th className="num">Rate</th>
                  <th>Status</th>
                  <th className="num">Diagnostic</th>
                </tr>
              </thead>
              <tbody>
                {SUB_AGENTS.map(agent => {
                  const isRunning = runningId === agent.id;
                  const result    = diagResults[agent.id];
                  return (
                    <tr key={agent.id}>
                      <td>
                        <div className="mara-name" style={{ fontSize: 12 }}>{agent.name}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{agent.desc}</div>
                        {result && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                            {result.ok
                              ? <><CheckCircle size={10} color="var(--pos)" /><span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--pos)" }}>{result.summary}</span></>
                              : <><XCircle size={10} color="var(--neg)" /><span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--neg)" }}>{result.error}</span></>
                            }
                          </div>
                        )}
                      </td>
                      <td className="num">{agent.conf}</td>
                      <td className="num">{agent.rate}</td>
                      <td><span className={`mc-badge mc-badge--${agent.tone}`}>{agent.status}</span></td>
                      <td className="num">
                        <button
                          className="mc-btn"
                          style={{ padding: "5px 10px", fontSize: 11 }}
                          onClick={() => void runDiagnostic(agent)}
                          disabled={isRunning || runningId !== null}
                        >
                          {isRunning
                            ? <RefreshCw size={10} style={{ animation: "spin 1s linear infinite" }} />
                            : <><Play size={10} /> Test</>
                          }
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
