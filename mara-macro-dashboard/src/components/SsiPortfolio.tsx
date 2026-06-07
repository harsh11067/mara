import { Compass, RotateCw, ExternalLink } from "lucide-react";
import { SsiHolding, RotationLog } from "../types";
import PanelHeader from "./PanelHeader";

interface SsiPortfolioProps {
  holdings: SsiHolding[];
  rotationLogs: RotationLog[];
}

const holdingtone = (ticker: string): string => {
  if (ticker === "BTC")                             return "amber";
  if (ticker === "SOL")                             return "violet";
  if (ticker === "MAG7.ssi")                        return "info";
  if (ticker === "DEFI.ssi")                        return "pos";
  if (ticker === "MEME.ssi")                        return "rose";
  if (ticker === "USSI" || ticker.includes("USD"))  return "muted";
  return "info";
};

const holdingBarColor = (ticker: string): string => {
  if (ticker === "BTC")                             return "#e8a900";
  if (ticker === "SOL")                             return "#5b5ee8";
  if (ticker === "MAG7.ssi")                        return "#2a6fe6";
  if (ticker === "DEFI.ssi")                        return "#00b87d";
  if (ticker === "MEME.ssi")                        return "#ec4f6c";
  if (ticker === "USSI" || ticker.includes("USD"))  return "#454c59";
  return "#2a6fe6";
};

export default function SsiPortfolio({ holdings, rotationLogs }: SsiPortfolioProps) {
  const totalValueUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="SSI Portfolio"
        icon={Compass}
        chip={
          <span className="mc-badge mc-badge--pos" style={{ padding: "7px 11px" }}>
            <span className="dot" />
            NAV ${totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        }
      />

      {/* SoSoValue Attribution */}
      <div style={{ borderBottom: "1px solid var(--border)", padding: "9px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)" }}>
          Indices sourced via <span style={{ color: "var(--info)", fontWeight: 600 }}>SoSoValue Terminal API</span>
          {" "}· 11 endpoints · MAG7 / DEFI / MEME / USSI
        </span>
        <ExternalLink size={12} color="var(--fg-4)" />
      </div>

      <div className="mc-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "14px 16px" }}>

        {/* Holdings */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          {holdings.map(hold => (
            <div key={hold.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mara-name" style={{ fontSize: 13 }}>{hold.name}</span>
                  <span className={`mc-badge mc-badge--${holdingtone(hold.ticker)} artifact-spin-move`}>{hold.ticker}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mara-data" style={{ fontWeight: 700 }}>{hold.allocationPercent}%</span>
                  <span className="mara-data" style={{ color: "var(--fg-3)", fontSize: 12 }}>
                    ${hold.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className={`mara-micro ${hold.dailyChange > 0 ? "mara-pos" : hold.dailyChange < 0 ? "mara-neg" : "mara-muted"}`}
                    style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
                    {hold.dailyChange > 0 ? "+" : ""}{hold.dailyChange}%
                  </span>
                </div>
              </div>
              <div className="mc-meter">
                <span style={{ width: `${hold.allocationPercent}%`, background: holdingBarColor(hold.ticker) }} />
              </div>
            </div>
          ))}
        </div>

        {/* Rotation Log */}
        {rotationLogs.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <RotateCw size={13} color="var(--fg-4)" />
              <span className="mara-label">ROTATION LOG</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rotationLogs.slice(0, 3).map(log => (
                <div key={log.id} className="mc-card" style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="mc-badge mc-badge--neg">{log.fromTicker}</span>
                      <span className="mara-micro mara-muted">→</span>
                      <span className="mc-badge mc-badge--pos">{log.toTicker}</span>
                      <span className="mara-micro mara-muted">{log.percentage}%</span>
                    </div>
                    <span className="mara-micro">{log.timeStr}</span>
                  </div>
                  <p className="mara-body" style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>{log.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
