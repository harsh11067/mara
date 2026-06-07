import { useState, useEffect } from "react";
import { Calendar, CheckCircle2, Eye, Activity } from "lucide-react";
import { MacroEvent } from "../types";
import PanelHeader from "./PanelHeader";

interface MacroCalendarProps {
  events: MacroEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}

export default function MacroCalendar({ events, selectedEventId, onSelectEvent }: MacroCalendarProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getRelativeTime = (timestamp: number) => {
    const diff = timestamp - now;
    if (diff > 0) {
      const hours = Math.floor(diff / 3600000);
      const mins  = Math.floor((diff % 3600000) / 60000);
      if (hours > 24) return `${Math.floor(hours / 24)}d`;
      return `${hours.toString().padStart(2, "0")}h ${mins.toString().padStart(2, "0")}m`;
    } else {
      const elapsed = now - timestamp;
      const hours = Math.floor(elapsed / 3600000);
      const mins  = Math.floor((elapsed % 3600000) / 60000);
      if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
      if (hours === 0) return `${mins}m ago`;
      return `${hours}h ${mins}m ago`;
    }
  };

  return (
    <section className="mc-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <PanelHeader
        title="Macro Calendar"
        icon={Calendar}
        chip={<span className="mc-badge mc-badge--info">SoSoValue API</span>}
      />

      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "64px 1fr 84px 110px", padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span className="mara-label">Imp</span>
        <span className="mara-label">Event</span>
        <span className="mara-label" style={{ textAlign: "right" }}>Cons</span>
        <span className="mara-label" style={{ textAlign: "right" }}>Ago</span>
      </div>

      {/* Event rows */}
      <div className="mc-scroll" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {events.map((event) => {
          const isSelected = selectedEventId === event.id;
          const isLive     = event.state === "watching";
          const isFired    = event.state === "fired";

          return (
            <div
              key={event.id}
              onClick={() => onSelectEvent(isSelected ? null : event.id)}
              style={{
                display: "grid",
                gridTemplateColumns: "64px 1fr 84px 110px",
                alignItems: "center",
                padding: "13px 16px",
                background: isLive ? "var(--bg-row-hi)" : isSelected ? "var(--bg-card-2)" : "transparent",
                borderLeft: isLive ? "2px solid var(--amber)" : "2px solid transparent",
                borderBottom: "1px solid var(--border-soft)",
                cursor: "pointer",
                transition: "background .12s",
              }}
            >
              <div>
                {event.impact === "high"   && <span className="mc-badge mc-badge--rose">HIGH</span>}
                {event.impact === "medium" && <span className="mc-badge mc-badge--amber">MED</span>}
                {event.impact === "low"    && <span className="mc-badge mc-badge--muted">LOW</span>}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="mara-name" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 4 }}>
                  {isFired   && <CheckCircle2 size={11} color="var(--pos)" />}
                  {isLive    && <Activity size={11} color="var(--amber)" />}
                  {!isFired && !isLive && <Eye size={11} color="var(--fg-4)" />}
                  {event.dateStr}
                </span>
              </div>

              <span className="mara-data" style={{ textAlign: "right", color: "var(--fg-3)" }}>{event.consensus}</span>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                {event.actual ? (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                    color: parseFloat(event.actual) > parseFloat(event.consensus) ? "var(--pos)"
                         : parseFloat(event.actual) < parseFloat(event.consensus) ? "var(--neg)"
                         : "var(--fg-1)",
                  }}>{event.actual}</span>
                ) : (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-4)" }}>—</span>
                )}
                <span className={`mara-micro ${isLive ? "mara-amber" : "mara-muted"}`}>
                  {isLive ? "LIVE" : getRelativeTime(event.timestamp)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected detail drawer */}
      {selectedEventId && (() => {
        const ev = events.find(e => e.id === selectedEventId);
        if (!ev) return null;
        return (
          <div style={{ borderTop: "1px solid var(--border)", padding: "14px 16px", background: "var(--bg-panel)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span className="mara-label">{ev.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onSelectEvent(null); }}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", cursor: "pointer", background: "none", border: "none" }}
              >
                CLOSE ×
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
              {[
                { label: "FORECAST", value: ev.consensus },
                { label: "PREVIOUS", value: ev.previous },
                { label: "ACTUAL",   value: ev.actual ?? "—" },
              ].map(m => (
                <div key={m.label} className="mc-stat" style={{ padding: "10px 12px", gap: 4 }}>
                  <span className="mara-label">{m.label}</span>
                  <span className="mara-data" style={{ fontSize: 15, fontWeight: 700 }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </section>
  );
}
