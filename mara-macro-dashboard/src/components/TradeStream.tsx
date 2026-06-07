import { Layers, Sparkles } from "lucide-react";
import { Trade } from "../types";
import PanelHeader from "./PanelHeader";

interface TradeStreamProps {
  trades: Trade[];
}

export default function TradeStream({ trades }: TradeStreamProps) {
  const openCount = trades.filter(t => t.status === "OPEN").length;

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Trade Execution Stream"
        icon={Layers}
        chip={
          <span className="mc-badge mc-badge--amber" style={{ padding: "6px 10px" }}>
            <span className="dot" />SoDEX Testnet
          </span>
        }
      />

      <div className="mc-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        <table className="mc-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Instrument / Source</th>
              <th>Side</th>
              <th className="num">Lev</th>
              <th className="num">Qty / Price</th>
              <th className="num">P&amp;L</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--fg-4)", padding: "28px 0" }}>
                  <span className="mara-micro">No trades yet</span>
                </td>
              </tr>
            ) : trades.map(trade => {
              const isOpen     = trade.status === "OPEN";
              const isRotation = trade.side === "ROTATION";

              return (
                <tr key={trade.id}>
                  <td>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>
                      {trade.timeStr}
                    </span>
                  </td>
                  <td>
                    <div className="mara-name" style={{ fontSize: 12 }}>{trade.instrument.split(" ")[0]}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>{trade.event}</div>
                  </td>
                  <td>
                    {trade.side === "LONG"     && <span className="mc-badge mc-badge--pos">LONG</span>}
                    {trade.side === "SHORT"    && <span className="mc-badge mc-badge--rose">SHORT</span>}
                    {trade.side === "ROTATION" && <span className="mc-badge mc-badge--info">ROTATE</span>}
                  </td>
                  <td className="num">
                    <span className="mara-data" style={{ fontSize: 12 }}>
                      {isRotation ? "—" : `${trade.leverage}×`}
                    </span>
                  </td>
                  <td className="num">
                    <div className="mara-data" style={{ fontSize: 12 }}>
                      {isRotation ? "—" : `${trade.quantity.toFixed(4)}`}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 1 }}>
                      {isRotation ? "—" : `@$${trade.priceEntry.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                    </div>
                  </td>
                  <td className="num">
                    {isRotation ? (
                      <span className="mara-muted">—</span>
                    ) : (
                      <>
                        <div style={{
                          fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700,
                          color: trade.pnl > 0 ? "var(--pos)" : trade.pnl < 0 ? "var(--neg)" : "var(--fg-3)",
                        }}>
                          {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div style={{
                          fontFamily: "var(--font-mono)", fontSize: 10,
                          color: trade.pnl > 0 ? "var(--pos-dim)" : trade.pnl < 0 ? "var(--neg-dim)" : "var(--fg-4)",
                          marginTop: 1,
                        }}>
                          {trade.pnlPercent >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    {isOpen ? (
                      <span className="mc-badge mc-badge--pos">
                        <span className="mc-dot mc-dot--live" style={{ width: 5, height: 5 }} />
                        LIVE
                      </span>
                    ) : (
                      <span className="mc-badge mc-badge--muted">FILLED</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Sparkles size={12} color="var(--amber)" />
          <span className="mara-micro">Active WebSockets: 3 Connected</span>
        </div>
        <span className="mara-micro mara-muted">
          {openCount} open · SECURE GAS-FREE TRADING (VALUECHAIN TESTNET)
        </span>
      </div>
    </section>
  );
}
