import { Shield, AlertOctagon, Power, TrendingDown, Activity } from "lucide-react";
import PanelHeader from "./PanelHeader";

interface RiskEngineProps {
  balance: number;
  openPositions: number;
  maxOpenPositions: number;
  unrealizedPnl: number;
  isKilled: boolean;
  onKillSwitchToggle: () => void;
  drawdownPercent: number;
  maxDailyTrades: number;
  currentDailyTrades: number;
}

function CoverageRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
      <span className="mara-label">{label}</span>
      <span className={`mara-data${tone ? " mara-" + tone : ""}`} style={{ fontWeight: 700, fontSize: 14 }}>{value}</span>
    </div>
  );
}

function MeterBlock({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="mara-label">{label}</span>
        <span className={`mara-data mara-${tone}`} style={{ fontWeight: 700, fontSize: 13 }}>{value}</span>
      </div>
      <div className="mc-meter">
        <span style={{ width: `${Math.min(100, pct)}%`, background: `var(--${tone})` }} />
      </div>
    </div>
  );
}

export default function RiskEngine({
  balance,
  openPositions,
  maxOpenPositions,
  unrealizedPnl,
  isKilled,
  onKillSwitchToggle,
  drawdownPercent,
  maxDailyTrades,
  currentDailyTrades,
}: RiskEngineProps) {
  const totalEquity    = balance + unrealizedPnl;
  const availMargin    = Math.max(0, totalEquity * 0.88);
  const drawdownPct    = Math.min(drawdownPercent, 5.0);
  const drawdownTone   = drawdownPct > 4.0 ? "neg" : drawdownPct > 2.5 ? "amber" : "pos";
  const marginUtil     = 12.0;

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Risk Engine"
        icon={Shield}
        chip={
          isKilled
            ? <span className="mc-badge mc-badge--neg"><span className="dot" />HALTED</span>
            : <span className="mc-badge mc-badge--pos mara-glow-pos"><span className="mc-dot mc-dot--live" />ACTIVE MONITOR</span>
        }
      />

      <div className="mc-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "14px 18px" }}>

        {/* Kill switch alert */}
        {isKilled && (
          <div style={{ background: "var(--neg-bg)", border: "1px solid rgba(230,58,44,.3)", borderRadius: "var(--r-md)", padding: "12px 14px", display: "flex", gap: 10, marginBottom: 14 }}>
            <AlertOctagon size={16} color="var(--neg)" style={{ flexShrink: 0, marginTop: 1 }} />
            <p className="mara-body" style={{ color: "var(--neg)", fontSize: 13, lineHeight: 1.5 }}>
              Emergency halt active. All positions forced to market close. Scanning disabled until manual reset.
            </p>
          </div>
        )}

        {/* Two primary stat boxes */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div className="mc-stat">
            <span className="mara-label">Collateral Account Value</span>
            <span className="mara-value" style={{ fontSize: 22 }}>
              ${totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {unrealizedPnl !== 0 && (
              <span className={`mara-micro ${unrealizedPnl >= 0 ? "mara-pos" : "mara-neg"}`} style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
                {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })} unrealized
              </span>
            )}
          </div>
          <div className="mc-stat">
            <span className="mara-label">Available Leverage Margin</span>
            <span className="mara-value mara-pos" style={{ fontSize: 22 }}>
              ${availMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Coverage rows */}
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 6, marginBottom: 14 }}>
          <CoverageRow
            label="OPEN POSITIONS"
            value={`${openPositions} / ${maxOpenPositions}`}
            tone={openPositions >= maxOpenPositions ? "amber" : undefined}
          />
          <CoverageRow label="DAILY TRADES"   value={`${currentDailyTrades} / ${maxDailyTrades}`} />
          <CoverageRow label="COLLATERAL TYPE" value="USDC · Real-backed" />
          <CoverageRow label="NETWORK"         value="ValueChain Testnet" />
        </div>

        {/* Meter blocks */}
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <TrendingDown size={13} color="var(--fg-4)" />
            <span className="mara-label">RISK METERS</span>
          </div>

          <MeterBlock
            label="PORTFOLIO DRAWDOWN"
            value={`${drawdownPct.toFixed(2)}% / 5%`}
            pct={(drawdownPct / 5) * 100}
            tone={drawdownTone}
          />

          <MeterBlock
            label="MARGIN UTILIZATION"
            value={`${marginUtil.toFixed(1)}% / 40%`}
            pct={(marginUtil / 40) * 100}
            tone="info"
          />

          <MeterBlock
            label="POSITION CAPACITY"
            value={`${openPositions} / ${maxOpenPositions} slots`}
            pct={(openPositions / maxOpenPositions) * 100}
            tone={openPositions >= maxOpenPositions ? "amber" : "pos"}
          />
        </div>

        {/* Activity row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, padding: "8px 0", borderTop: "1px solid var(--border-soft)" }}>
          <Activity size={13} color="var(--pos)" />
          <span className="mara-micro mara-muted">
            Backend polling every 10s · WebSocket connected
          </span>
        </div>

        {/* Kill Switch button */}
        <button
          type="button"
          onClick={onKillSwitchToggle}
          className={`mc-btn mc-btn--full ${isKilled ? "mc-btn--pos" : "mc-btn--neg"}`}
          style={{ padding: "13px 0", fontSize: 13 }}
        >
          <Power size={15} />
          {isKilled ? "Reset Engine & Resume" : "Emergency Kill Switch"}
        </button>
      </div>
    </section>
  );
}
