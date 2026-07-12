import { useState, useRef, useEffect, FormEvent } from "react";
import { Brain, Send, Newspaper, RefreshCw, ChevronDown, ChevronRight, Settings2, Wrench, MessagesSquare } from "lucide-react";
import { AiReasoning, DirectionType, AgentTraceStep } from "../types";
import PanelHeader from "./PanelHeader";

interface AiReasoningFeedProps {
  reasonings: AiReasoning[];
  onTriggerSimulation: (eventName: string, actual: string, forecast: string) => void;
  isSimulating: boolean;
  /** live agentic tool-use trace streamed over WebSocket */
  agentTrace: AgentTraceStep[];
  backendOnline: boolean;
}

const INSTRUMENTS = [
  { name: "U.S. Core CPI MoM",     consensus: "0.3%"  },
  { name: "Nonfarm Payrolls (May)", consensus: "185K"  },
  { name: "FOMC Rate Decision",     consensus: "5.50%" },
  { name: "PCE Price Index MoM",    consensus: "0.2%"  },
  { name: "Initial Jobless Claims", consensus: "210K"  },
];

function directionTone(dir: DirectionType): string {
  if (dir.includes("BULL")) return "pos";
  if (dir.includes("BEAR")) return "neg";
  return "muted";
}

function directionLabel(dir: DirectionType): string {
  return {
    STRONG_BULL: "STRONG BULLISH",
    BULL:        "BULLISH",
    NEUTRAL:     "NEUTRAL",
    BEAR:        "BEARISH",
    STRONG_BEAR: "STRONG BEARISH",
  }[dir];
}

function nowStamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

function traceIcon(kind: AgentTraceStep["kind"]) {
  if (kind === "tool_call") return "→";
  if (kind === "tool_result") return "←";
  if (kind === "final") return "◆";
  if (kind === "error") return "✗";
  return "…";
}

function traceColor(kind: AgentTraceStep["kind"]): string {
  if (kind === "tool_call") return "var(--info)";
  if (kind === "tool_result") return "var(--fg-3)";
  if (kind === "final") return "var(--pos)";
  if (kind === "error") return "var(--neg)";
  return "var(--fg-4)";
}

export default function AiReasoningFeed({ reasonings, onTriggerSimulation, isSimulating, agentTrace, backendOnline }: AiReasoningFeedProps) {
  const [expandedId, setExpandedId]       = useState<string | null>(reasonings[0]?.id ?? null);
  const [instIdx, setInstIdx]             = useState(0);
  const [actual, setActual]               = useState("0.5%");
  const [consensus, setConsensus]         = useState(INSTRUMENTS[0].consensus);
  const [freshId, setFreshId]             = useState<string | null>(null);
  const prevLen = useRef(reasonings.length);

  useEffect(() => {
    if (reasonings.length > prevLen.current) {
      const newest = reasonings[0];
      if (newest) {
        setFreshId(newest.id);
        setExpandedId(newest.id);
        setTimeout(() => setFreshId(null), 1400);
      }
    }
    prevLen.current = reasonings.length;
  }, [reasonings]);

  const pickInst = (i: number) => {
    setInstIdx(i);
    setConsensus(INSTRUMENTS[i].consensus);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onTriggerSimulation(INSTRUMENTS[instIdx].name, actual, consensus);
  };

  const fmt = (score: number) => `${score > 0 ? "+" : ""}${score.toFixed(2)}σ`;

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Live AI Operational Reasoning Feed"
        icon={Brain}
        chip={<span className="mc-badge mc-badge--pos"><span className="dot" />MODEL: GEMINI-2.5-FLASH</span>}
      />

      {/* Macro Release Simulator */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <Settings2 size={16} color="var(--pos)" />
          <span className="mara-h2" style={{ fontSize: 14 }}>Run Live Cycle — Real Pipeline Trigger</span>
          <span className="mara-micro" style={{ marginLeft: "auto", color: "var(--fg-4)", textTransform: "none", letterSpacing: 0 }}>
            {backendOnline ? "runs the REAL Gemini agent server-side" : "backend offline"}
          </span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
            <div className="mc-field" style={{ minWidth: 0 }}>
              <span className="mara-label">Macro Instrument</span>
              <div className="mc-select">
                <select
                  className="mc-input"
                  value={instIdx}
                  onChange={e => pickInst(+e.target.value)}
                  disabled={isSimulating}
                  style={{ fontSize: 13 }}
                >
                  {INSTRUMENTS.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mc-field" style={{ minWidth: 0 }}>
              <span className="mara-label">Released (Actual)</span>
              <input
                className="mc-input"
                value={actual}
                onChange={e => setActual(e.target.value)}
                disabled={isSimulating}
                style={{ fontSize: 14 }}
              />
            </div>
            <div className="mc-field" style={{ minWidth: 0 }}>
              <span className="mara-label">Consensus</span>
              <input
                className="mc-input"
                value={consensus}
                onChange={e => setConsensus(e.target.value)}
                disabled={isSimulating}
                style={{ fontSize: 14 }}
              />
            </div>
            <button
              type="submit"
              className="mc-btn mc-btn--pos"
              disabled={isSimulating}
              style={{ height: 44, whiteSpace: "nowrap" }}
            >
              {isSimulating ? (
                <><RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Agent running…</>
              ) : (
                <><Send size={14} /> Run Live Cycle</>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* ── Live agentic tool-use trace (Edgework rule: every number = a tool call) ── */}
      {(isSimulating || agentTrace.length > 0) && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0, maxHeight: 170, overflowY: "auto" }} className="mc-scroll">
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
            <Wrench size={13} color="var(--info)" />
            <span className="mara-label">AGENT TOOL-CALL TRACE (LIVE)</span>
            {isSimulating && <RefreshCw size={11} color="var(--info)" style={{ animation: "spin 1s linear infinite" }} />}
          </div>
          {agentTrace.length === 0 ? (
            <span className="mara-micro" style={{ color: "var(--fg-4)", textTransform: "none", letterSpacing: 0 }}>
              Waiting for the agent to pick up the event…
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {agentTrace.map((t) => (
                <div key={`${t.runId}-${t.step}`} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: traceColor(t.kind), flexShrink: 0, width: 12 }}>
                    {traceIcon(t.kind)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: t.kind === "final" ? "var(--pos)" : "var(--fg-3)", lineHeight: 1.5, wordBreak: "break-word" }}>
                    {t.summary}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Feed */}
      <div className="mc-scroll" style={{ padding: "14px 18px", overflowY: "auto", flex: 1, minHeight: 0 }}>
        {reasonings.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 120, gap: 8 }}>
            <Brain size={24} color="var(--border)" />
            <span className="mara-body">No decisions yet — inject a macro event above</span>
          </div>
        ) : reasonings.map((item, idx) => {
          const isExpanded = expandedId === item.id;
          const isFresh    = item.id === freshId;
          const tone       = directionTone(item.direction);
          const isNewest   = idx === 0;

          return (
            <div key={item.id} style={{ marginBottom: 10 }}>
              {/* Row card */}
              <div
                className="mc-card"
                style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "16px 18px",
                  boxShadow: isFresh ? "var(--glow-amber)" : isNewest && isSimulating ? "var(--glow-amber)" : "none",
                  transition: "box-shadow 1s ease",
                  cursor: "pointer",
                }}
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                {isExpanded
                  ? <ChevronDown size={14} color="var(--fg-4)" style={{ flexShrink: 0 }} />
                  : <ChevronRight size={14} color="var(--fg-4)" style={{ flexShrink: 0 }} />
                }
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-3)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  [{item.timestamp ? new Date(item.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }) : nowStamp()}]
                </span>
                <span className="mara-h2" style={{ fontSize: 14 }}>{item.eventName.toUpperCase()}</span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--fg-2)" }}>
                    Dev: <span className={`mara-${item.surpriseScore > 0 ? "neg" : item.surpriseScore < 0 ? "pos" : "muted"}`}>
                      {fmt(item.surpriseScore)}
                    </span>
                  </span>
                  <span className={`mc-badge mc-badge--${tone}`}>{directionLabel(item.direction)}</span>
                </span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="mc-card" style={{ borderTop: "none", borderTopLeftRadius: 0, borderTopRightRadius: 0, padding: "16px 18px" }}>
                  {/* Metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
                    {[
                      { label: "ACTUAL",     value: item.actual,                     colored: false, green: false },
                      { label: "FORECAST",   value: item.forecast,                   colored: false, green: false },
                      { label: "DEVIATION",  value: fmt(item.surpriseScore),         colored: true,  green: false },
                      { label: "CONFIDENCE", value: `${item.confidence}%`,           colored: false, green: true  },
                    ].map(m => (
                      <div key={m.label} className="mc-stat" style={{ padding: "10px 12px", gap: 4 }}>
                        <span className="mara-label">{m.label}</span>
                        <span className="mara-data" style={{
                          fontWeight: 700, fontSize: 14,
                          color: m.green ? "var(--pos)"
                               : m.colored ? (item.surpriseScore < 0 ? "var(--pos)" : item.surpriseScore > 0 ? "var(--neg)" : "var(--fg-3)")
                               : "var(--fg)",
                        }}>{m.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Sigma bar */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="mara-micro mara-neg">−3σ BEARISH</span>
                      <span className="mara-micro mara-muted">0σ NEUTRAL</span>
                      <span className="mara-micro mara-pos">+3σ BULLISH</span>
                    </div>
                    <div className="mc-meter">
                      <span style={{
                        width: `${Math.min(100, Math.max(0, 50 + item.surpriseScore * 15))}%`,
                        background: item.direction.includes("BULL") ? "var(--pos)" : item.direction.includes("BEAR") ? "var(--neg)" : "var(--fg-3)",
                      }} />
                    </div>
                  </div>

                  {/* Reasoning */}
                  {item.reasoning && (
                    <div style={{ marginBottom: 12 }}>
                      <span className="mara-label" style={{ display: "block", marginBottom: 6 }}>
                        AI ANALYSIS{item.engine === "agentic_tool_use" ? " · AGENTIC (TOOL-GROUNDED)" : ""}
                      </span>
                      <p className="mara-body" style={{ lineHeight: 1.6 }}>{item.reasoning}</p>
                    </div>
                  )}

                  {/* Bull/Bear/Synthesiser debate */}
                  {item.debate && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <MessagesSquare size={12} color="var(--violet, #7b6cff)" />
                        <span className="mara-label">MACRO DEBATE — BULL vs BEAR vs SYNTHESISER</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ borderLeft: "2px solid var(--pos)", paddingLeft: 10 }}>
                          <span className="mara-micro mara-pos" style={{ display: "block" }}>BULL</span>
                          <span className="mara-body" style={{ fontSize: 12, color: "var(--fg-2)" }}>{item.debate.bull_case}</span>
                        </div>
                        <div style={{ borderLeft: "2px solid var(--neg)", paddingLeft: 10 }}>
                          <span className="mara-micro mara-neg" style={{ display: "block" }}>BEAR</span>
                          <span className="mara-body" style={{ fontSize: 12, color: "var(--fg-2)" }}>{item.debate.bear_case}</span>
                        </div>
                        <div style={{ borderLeft: "2px solid var(--info)", paddingLeft: 10 }}>
                          <span className="mara-micro" style={{ display: "block", color: "var(--info)" }}>SYNTHESIS</span>
                          <span className="mara-body" style={{ fontSize: 12, color: "var(--fg-2)" }}>{item.debate.synthesis}</span>
                        </div>
                        {item.debate.dissent && (
                          <div style={{ borderLeft: "2px solid var(--amber, #e8a900)", paddingLeft: 10 }}>
                            <span className="mara-micro mara-amber" style={{ display: "block" }}>DISSENT</span>
                            <span className="mara-body" style={{ fontSize: 12, color: "var(--fg-3)" }}>{item.debate.dissent}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Source news */}
                  {item.sourceNews.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <Newspaper size={12} color="var(--fg-4)" />
                        <span className="mara-label">SOSOVALUE NEWS SOURCES</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {item.sourceNews.map((news, i) => (
                          <div key={i} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                            <span className="mara-micro" style={{ color: "var(--fg-3)", textTransform: "none", letterSpacing: 0 }}>{news}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
