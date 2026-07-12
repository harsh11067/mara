/**
 * Risk Engine — every value on this panel is backend truth:
 *   /api/risk    → live SoDEX balance, drawdown vs high-watermark, real limits
 *   /api/regime  → 5-state regime classifier + regime-conditional multipliers
 *                  + the event circuit breaker window
 * The fabricated fields the old panel showed (margin utilization, available
 * leverage margin) are GONE — nothing here is invented client-side.
 */
import { Shield, AlertOctagon, Power, Waves, Gauge } from "lucide-react";
import PanelHeader from "./PanelHeader";
import type { BackendRisk, BackendRegime } from "../api";

interface RiskEngineProps {
  risk: BackendRisk | null;
  regime: BackendRegime | null;
  openPositions: number;
  unrealizedPnl: number;
  isKilled: boolean;
  onKillSwitchToggle: () => void;
}

const REGIME_TONE: Record<string, string> = {
  BULL_QUIET: "pos", BULL_VOLATILE: "amber", RANGING: "info",
  BEAR_VOLATILE: "rose", CRASH: "neg",
};

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0" }}>
      <span className="mara-label">{label}</span>
      <span className={`mara-data${tone ? " mara-" + tone : ""}`} style={{ fontWeight: 700, fontSize: 13 }}>{value}</span>
    </div>
  );
}

function Meter({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="mara-label">{label}</span>
        <span className={`mara-data mara-${tone}`} style={{ fontWeight: 700, fontSize: 13 }}>{value}</span>
      </div>
      <div className="mc-meter">
        <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: `var(--${tone})` }} />
      </div>
    </div>
  );
}

export default function RiskEngine({ risk, regime, openPositions, unrealizedPnl, isKilled, onKillSwitchToggle }: RiskEngineProps) {
  const balance = risk?.liveBalance ?? risk?.accountBalance ?? null;
  const maxDrawdown = risk?.limits?.maxDrawdownPct ?? 5;
  const drawdown = Math.max(0, risk?.drawdownPercent ?? 0);
  const drawdownTone = drawdown > maxDrawdown * 0.8 ? "neg" : drawdown > maxDrawdown * 0.5 ? "amber" : "pos";
  const maxOpen = risk?.limits?.maxOpenPositions ?? 0;
  const maxDaily = risk?.limits?.maxDailyTrades ?? 0;
  const regimeTone = regime && !regime.error ? (REGIME_TONE[regime.regime] ?? "info") : "muted";
  const breaker = regime?.circuitBreaker;

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Risk Engine"
        icon={Shield}
        chip={
          isKilled
            ? <span className="mc-badge mc-badge--neg"><span className="dot" />HALTED</span>
            : <span className="mc-badge mc-badge--pos mara-glow-pos"><span className="mc-dot mc-dot--live" />LIVE STATE</span>
        }
      />

      <div className="mc-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "14px 18px" }}>

        {isKilled && (
          <div style={{ background: "var(--neg-bg)", border: "1px solid rgba(255,79,56,.3)", borderRadius: "var(--r-md)", padding: "12px 14px", display: "flex", gap: 10, marginBottom: 14 }}>
            <AlertOctagon size={16} color="var(--neg)" style={{ flexShrink: 0, marginTop: 1 }} />
            <p className="mara-body" style={{ color: "var(--neg)", fontSize: 13, lineHeight: 1.5 }}>
              Emergency halt active. Scanning and execution disabled until manual reset.
            </p>
          </div>
        )}

        {/* Live account state — real SoDEX balance */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div className="mc-stat">
            <span className="mara-label">SoDEX Balance · Live</span>
            <span className="mara-value" style={{ fontSize: 22 }}>
              {balance !== null
                ? `$${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </span>
            {unrealizedPnl !== 0 && (
              <span className={`mara-micro ${unrealizedPnl >= 0 ? "mara-pos" : "mara-neg"}`} style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
                {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })} unrealized
              </span>
            )}
          </div>
          <div className="mc-stat">
            <span className="mara-label">Realized P&amp;L · Cum.</span>
            <span className={`mara-value ${(risk?.cumulativePnl ?? 0) >= 0 ? "mara-pos" : "mara-neg"}`} style={{ fontSize: 22 }}>
              {risk
                ? `${risk.cumulativePnl >= 0 ? "+" : ""}$${Math.abs(risk.cumulativePnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </span>
          </div>
        </div>

        {/* Regime block — the adaptive layer, live from /api/regime */}
        <div className="mc-card" style={{ padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Waves size={13} color="var(--phos-dim)" />
              <span className="mara-label">MARKET REGIME</span>
            </div>
            <span className={`mc-badge mc-badge--${regimeTone === "muted" ? "muted" : regimeTone}`}>
              {regime && !regime.error ? regime.regime.replace("_", " · ") : "AWAITING DATA"}
            </span>
          </div>
          {regime && !regime.error ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 8 }}>
                {[
                  { k: "TREND", v: `${regime.trendPct >= 0 ? "+" : ""}${regime.trendPct}%`, t: regime.trendPct >= 0 ? "pos" : "neg" },
                  { k: "ANN. VOL", v: `${regime.realizedVolAnnual}%`, t: regime.realizedVolAnnual > 60 ? "amber" : "" },
                  { k: "SIZE", v: `×${regime.risk.sizeMultiplier}`, t: "amber" },
                ].map((m) => (
                  <div key={m.k} style={{ textAlign: "center" }}>
                    <span className="mara-micro" style={{ display: "block" }}>{m.k}</span>
                    <span className={`mara-data${m.t ? " mara-" + m.t : ""}`} style={{ fontWeight: 700 }}>{m.v}</span>
                  </div>
                ))}
              </div>
              <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, lineHeight: 1.5 }}>
                Stops ×{regime.risk.stopMultiplier} · conviction floor {regime.risk.convictionFloor}% · {regime.lookbackDays}d lookback
              </p>
            </>
          ) : (
            <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0 }}>
              Regime classifier needs the backend online.
            </p>
          )}
        </div>

        {/* Circuit breaker — real event-window state */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid var(--border-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Gauge size={13} color={breaker?.active ? "var(--amber)" : "var(--fg-4)"} />
            <span className="mara-label">EVENT CIRCUIT BREAKER</span>
          </div>
          <span className={`mc-badge ${breaker?.active ? "mc-badge--amber" : "mc-badge--muted"}`}>
            {breaker?.active ? "IN WINDOW" : "CLEAR"}
          </span>
        </div>
        {breaker?.active && breaker.reason && (
          <p className="mara-micro mara-amber" style={{ textTransform: "none", letterSpacing: 0, marginBottom: 8, lineHeight: 1.5 }}>
            {breaker.reason}
          </p>
        )}

        {/* Hard limits — configured server-side, served by /api/risk */}
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 10, marginBottom: 8 }}>
          <Row label="OPEN POSITIONS" value={maxOpen ? `${openPositions} / ${maxOpen}` : String(openPositions)} tone={maxOpen > 0 && openPositions >= maxOpen ? "amber" : undefined} />
          <Row label="TRADES RECORDED" value={risk ? `${risk.totalTrades}${maxDaily ? ` · max ${maxDaily}/day` : ""}` : "—"} />
          <Row label="WIN RATE" value={risk && risk.totalTrades > 0 ? `${risk.winRate}%` : "—"} />
          <Row label="MAX LEVERAGE" value={risk?.limits ? `×${risk.limits.maxLeverage}` : "—"} />
        </div>

        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <Meter
            label="PORTFOLIO DRAWDOWN"
            value={`${drawdown.toFixed(2)}% / ${maxDrawdown}%`}
            pct={(drawdown / maxDrawdown) * 100}
            tone={drawdownTone}
          />
          <Meter
            label="POSITION CAPACITY"
            value={maxOpen ? `${openPositions} / ${maxOpen} slots` : "—"}
            pct={maxOpen ? (openPositions / maxOpen) * 100 : 0}
            tone={maxOpen > 0 && openPositions >= maxOpen ? "amber" : "pos"}
          />
        </div>

        <button
          type="button"
          onClick={onKillSwitchToggle}
          className={`mc-btn mc-btn--full ${isKilled ? "mc-btn--pos" : "mc-btn--neg"}`}
          style={{ padding: "13px 0", fontSize: 13, marginTop: 6 }}
        >
          <Power size={15} />
          {isKilled ? "Reset Engine & Resume" : "Emergency Kill Switch"}
        </button>
      </div>
    </section>
  );
}
