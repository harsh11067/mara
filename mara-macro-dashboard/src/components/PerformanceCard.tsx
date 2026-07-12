/**
 * Agent Performance — REAL numbers only (mocks.md A4/A6).
 * KPIs come from /api/performance/summary (computed from executed trades).
 * The module table is the REAL system registry driven by /api/diag — the same
 * live checks the judges' /diag page runs, not invented "sub-agents".
 */
import { useState } from "react";
import { TrendingUp, CheckCircle, XCircle, Activity } from "lucide-react";
import PanelHeader from "./PanelHeader";
import type { BackendPerformanceSummary, DiagCheck } from "../api";

interface PerformanceCardProps {
  perf: BackendPerformanceSummary | null;
  diagChecks: DiagCheck[];
}

export default function PerformanceCard({ perf, diagChecks }: PerformanceCardProps) {
  const [tab, setTab] = useState<0 | 1>(0);

  const equity = perf?.equity ?? [];
  const pts = equity.map((p) => p.value);
  const totalNetPnl = perf?.cumulativePnl ?? 0;

  // Build SVG equity curve from real realized P&L
  const minV = pts.length ? Math.min(...pts, 0) : 0;
  const maxV = pts.length ? Math.max(...pts, 0) : 1;
  const range = maxV - minV || 1;
  const W = 560, H = 120;
  const path = pts.map((v, i) =>
    `${(i / Math.max(1, pts.length - 1)) * W},${H - ((v - minV) / range) * H}`
  ).join(" ");

  const kpi = (v: number | null | undefined, suffix = "", digits = 2): string =>
    v === null || v === undefined ? "—" : `${v.toFixed(digits)}${suffix}`;

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Agent Performance Metrics"
        icon={TrendingUp}
        chip={
          <span className={`mc-badge ${totalNetPnl >= 0 ? "mc-badge--pos" : "mc-badge--neg"}`} style={{ padding: "7px 11px" }}>
            <span className="dot" />
            {totalNetPnl >= 0 ? "+" : ""}${Math.abs(totalNetPnl).toLocaleString(undefined, { maximumFractionDigits: 2 })} realized
          </span>
        }
      />

      {/* 5 KPI stat boxes — real or "—", never invented */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 0, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {[
          { label: "WIN RATE",      value: perf?.winRate != null ? `${perf.winRate}%` : "—", tone: (perf?.winRate ?? 0) >= 50 ? "pos" : "" },
          { label: "PROFIT FACTOR", value: kpi(perf?.profitFactor),                          tone: "" },
          { label: "SHARPE",        value: kpi(perf?.sharpe),                                tone: "" },
          { label: "CLOSED TRADES", value: String(perf?.closedTrades ?? 0),                  tone: "" },
          { label: "OPEN",          value: String(perf?.openTrades ?? 0),                    tone: (perf?.openTrades ?? 0) > 0 ? "pos" : "" },
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
        >[ 02: System Modules · Live ]</span>
        <span className="mara-micro" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>REAL DATA ONLY</span>
      </div>

      {/* Tab content */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, flex: 1, minHeight: 0, overflow: "hidden" }}>
        {tab === 0 ? (
          <div style={{ padding: "18px" }}>
            {pts.length >= 2 ? (
              <>
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
                  <span className="mara-micro">Realized P&amp;L from {perf?.closedTrades ?? 0} closed trades</span>
                  <span className={`mara-micro ${totalNetPnl >= 0 ? "mara-pos" : "mara-neg"}`}>
                    {totalNetPnl >= 0 ? "+" : ""}${totalNetPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 130, gap: 8 }}>
                <Activity size={22} color="var(--border)" />
                <span className="mara-body" style={{ color: "var(--fg-3)" }}>
                  No closed trades yet — the curve draws itself from real fills only.
                </span>
              </div>
            )}
          </div>
        ) : (
          /* REAL module registry — live /api/diag checks */
          <div className="mc-scroll" style={{ overflowY: "auto", height: "100%" }}>
            <table className="mc-table">
              <thead>
                <tr>
                  <th>System Module</th>
                  <th className="num">Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {diagChecks.length === 0 ? (
                  <tr><td colSpan={3}><span className="mara-body" style={{ color: "var(--fg-3)" }}>Waiting for /api/diag…</span></td></tr>
                ) : diagChecks.map((chk) => (
                  <tr key={chk.name}>
                    <td>
                      <div className="mara-name" style={{ fontSize: 12 }}>{chk.label}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                        {chk.ok
                          ? <CheckCircle size={10} color="var(--pos)" />
                          : <XCircle size={10} color="var(--neg)" />}
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: chk.ok ? "var(--pos)" : "var(--neg)" }}>
                          {chk.detail}
                        </span>
                      </div>
                    </td>
                    <td className="num">{chk.latencyMs != null ? `${chk.latencyMs}ms` : "—"}</td>
                    <td><span className={`mc-badge ${chk.ok ? "mc-badge--pos" : "mc-badge--neg"}`}>{chk.ok ? "LIVE" : "DOWN"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
