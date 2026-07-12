/**
 * TIME MACHINE — scrub real macro history through MARA's decision logic.
 *
 * Every print is a real SoSoValue release with real BTC forward returns.
 * The verdict at each date uses only prints BEFORE it (no lookahead) — the
 * same analog-evidence layer the live agent consults. Scrubbing is free and
 * instant because nothing here calls an LLM.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Clock, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { replayApi, type ReplayTimeline } from "../api";
import AccountMenu from "../components/AccountMenu";

export default function Replay() {
  const [families, setFamilies] = useState<Array<{ event_type: string; n: number; first: string; last: string }>>([]);
  const [family, setFamily] = useState("CPI");
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    replayApi.families()
      .then((r) => {
        setFamilies(r.families);
        if (r.families.length && !r.families.some((f) => f.event_type === family)) {
          setFamily(r.families[0].event_type);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    setPlaying(false);
    replayApi.timeline(family)
      .then((t) => { setTimeline(t); setIdx(t.prints.length ? t.prints.length - 1 : 0); })
      .catch(() => setTimeline(null))
      .finally(() => setLoading(false));
  }, [family]);

  // autoplay
  useEffect(() => {
    if (!playing || !timeline?.prints.length) return;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= timeline.prints.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 900);
    return () => clearInterval(id);
  }, [playing, timeline]);

  const prints = timeline?.prints ?? [];
  const p = prints[idx];
  const equityPath = useMemo(() => {
    if (prints.length < 2) return "";
    const vals = prints.map((x) => x.cumulativePnlPct);
    const min = Math.min(...vals, 0), max = Math.max(...vals, 0.1);
    const W = 800, H = 120, range = max - min || 1;
    return prints.map((x, i) =>
      `${(i / (prints.length - 1)) * W},${H - ((x.cumulativePnlPct - min) / range) * H}`,
    ).join(" ");
  }, [prints]);

  const verdictTone = p?.replay.verdict === "BULL" ? "pos" : p?.replay.verdict === "BEAR" ? "neg" : "amber";

  return (
    <div className="mara-scanlines" style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--fg)", fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column" }}>
      <header className="mara-topbar-glow" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <Link to="/terminal" className="mc-btn mc-btn--ghost" style={{ textDecoration: "none", gap: 6 }}>
          <ArrowLeft size={13} /> Terminal
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Clock size={18} color="var(--phos)" />
          <span style={{ fontWeight: 800, fontSize: 17 }}>TIME<span className="mara-spectral-text">MACHINE</span></span>
          <span className="mc-badge mc-badge--amber">NO-LOOKAHEAD REPLAY</span>
        </div>
        <div style={{ marginLeft: "auto" }}><AccountMenu /></div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 1180, margin: "0 auto", padding: "26px 22px 60px" }}>
        {/* family picker */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {(families.length ? families : [{ event_type: "CPI", n: 0, first: "", last: "" }]).map((f) => (
            <button key={f.event_type}
              className={`mc-tab${f.event_type === family ? " mc-tab--active" : ""}`}
              onClick={() => setFamily(f.event_type)}>
              {f.event_type}{f.n > 0 ? ` · ${f.n}` : ""}
            </button>
          ))}
          {timeline?.summary && (
            <span className="mara-micro" style={{ marginLeft: "auto", alignSelf: "center", textTransform: "none" }}>
              {timeline.summary.totalPrints} real prints · traded {timeline.summary.traded} · stood down {timeline.summary.stoodDown}
              {timeline.summary.winRate !== null && <> · win rate <span className="mara-pos">{timeline.summary.winRate}%</span></>}
              {" "}· cumulative <span className={timeline.summary.cumulativePnlPct >= 0 ? "mara-pos" : "mara-neg"}>
                {timeline.summary.cumulativePnlPct >= 0 ? "+" : ""}{timeline.summary.cumulativePnlPct}%
              </span>
            </span>
          )}
        </div>

        {loading ? (
          <p className="mara-micro" style={{ textTransform: "none" }}>Loading the corpus…</p>
        ) : !prints.length ? (
          <div className="mc-panel" style={{ padding: 30 }}>
            <p className="mara-body" style={{ color: "var(--fg-2)" }}>
              {timeline?.note ?? "Corpus empty — the backend needs POST /api/corpus/seed once (≈9 API calls) to pull real macro history."}
            </p>
          </div>
        ) : (
          <>
            {/* the moment */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(300px,1fr)", gap: 18, alignItems: "stretch", marginBottom: 22 }}>
              <section className="mc-panel mc-corners" style={{ padding: 26 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                  <span className="tm-date-display">{p.date}</span>
                  <span className="mc-badge mc-badge--muted">{p.regime?.replace("_", " · ") ?? "REGIME N/A"}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, margin: "20px 0" }}>
                  {[
                    { k: `${family} ACTUAL`, v: p.actual ?? "—", t: "" },
                    { k: "FORECAST", v: p.forecast ?? "—", t: "" },
                    { k: "SURPRISE", v: p.surpriseZ !== null ? `${p.surpriseZ >= 0 ? "+" : ""}${p.surpriseZ.toFixed(2)}σ` : "—", t: Math.abs(p.surpriseZ ?? 0) > 1 ? "amber" : "" },
                    { k: "DIRECTION", v: (p.direction ?? "—").toUpperCase(), t: p.direction === "above" ? "rose" : p.direction === "below" ? "info" : "" },
                  ].map((m) => (
                    <div key={m.k} className="mc-stat" style={{ gap: 5, padding: "11px 13px" }}>
                      <span className="mara-label" style={{ fontSize: 10 }}>{m.k}</span>
                      <span className={`mara-value${m.t ? " mara-" + m.t : ""}`} style={{ fontSize: 19 }}>{m.v}</span>
                    </div>
                  ))}
                </div>

                {/* verdict card */}
                <div key={p.id} className="tm-verdict-card mc-card" style={{ padding: "16px 18px", borderColor: `var(--${verdictTone === "amber" ? "border-strong" : verdictTone})` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span className="mara-label">MARA REPLAY VERDICT</span>
                    <span className={`mc-badge mc-badge--${verdictTone}`}>
                      {p.replay.verdict}{p.replay.verdict !== "NEUTRAL" ? ` · ${p.replay.confidence}%` : ""}
                    </span>
                  </div>
                  <p className="mara-body" style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.6 }}>
                    {p.replay.explanation}
                  </p>
                  <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
                    <span className="mara-micro">ANALOGS: {p.replay.analogCount}</span>
                    {p.replay.analogHitRate !== null && <span className="mara-micro">CONSISTENCY: {p.replay.analogHitRate}%</span>}
                    <span className="mara-micro">SIZE ×{p.replay.sizeMultiplier}</span>
                  </div>
                </div>
              </section>

              {/* what actually happened */}
              <section className="mc-panel" style={{ padding: 26, display: "flex", flexDirection: "column" }}>
                <span className="mara-label" style={{ marginBottom: 14 }}>WHAT ACTUALLY HAPPENED · BTC</span>
                {(["d1", "d3", "d7", "d30"] as const).map((h) => {
                  const v = p.btcRet[h];
                  return (
                    <div key={h} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span className="mara-label" style={{ width: 42 }}>+{h.slice(1)}D</span>
                      <div className="mc-meter" style={{ flex: 1 }}>
                        <span style={{ width: `${Math.min(100, Math.abs(v ?? 0) * 8)}%`, background: (v ?? 0) >= 0 ? "var(--pos)" : "var(--neg)" }} />
                      </div>
                      <span className={`mara-data ${(v ?? 0) >= 0 ? "mara-pos" : "mara-neg"}`} style={{ fontWeight: 700, width: 72, textAlign: "right" }}>
                        {v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—"}
                      </span>
                    </div>
                  );
                })}
                <div style={{ marginTop: "auto", paddingTop: 16 }}>
                  <span className="mara-label" style={{ display: "block", marginBottom: 4 }}>REPLAY P&amp;L THIS PRINT (1D, REGIME-SIZED)</span>
                  <span className={`mara-value ${p.replay.hypotheticalPnlPct1d === null ? "mara-muted" : p.replay.hypotheticalPnlPct1d >= 0 ? "mara-pos" : "mara-neg"}`} style={{ fontSize: 26 }}>
                    {p.replay.hypotheticalPnlPct1d === null ? "NO TRADE" : `${p.replay.hypotheticalPnlPct1d >= 0 ? "+" : ""}${p.replay.hypotheticalPnlPct1d}%`}
                  </span>
                  <span className="mara-micro" style={{ display: "block", marginTop: 6 }}>
                    CUMULATIVE TO HERE: <span className={p.cumulativePnlPct >= 0 ? "mara-pos" : "mara-neg"}>{p.cumulativePnlPct >= 0 ? "+" : ""}{p.cumulativePnlPct}%</span>
                  </span>
                </div>
              </section>
            </div>

            {/* scrubber */}
            <section className="mc-panel" style={{ padding: "20px 26px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                <button className="mc-btn mc-btn--ghost" style={{ padding: "8px 10px" }} onClick={() => { setPlaying(false); setIdx(0); }}><SkipBack size={14} /></button>
                <button className="mc-btn mc-btn--amber" style={{ padding: "8px 14px" }} onClick={() => setPlaying(!playing)}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                  {playing ? "PAUSE" : "PLAY HISTORY"}
                </button>
                <button className="mc-btn mc-btn--ghost" style={{ padding: "8px 10px" }} onClick={() => { setPlaying(false); setIdx(prints.length - 1); }}><SkipForward size={14} /></button>
                <span className="mara-micro" style={{ marginLeft: "auto" }}>PRINT {idx + 1} / {prints.length} · {prints[0].date} → {prints[prints.length - 1].date}</span>
              </div>

              <input
                type="range" min={0} max={prints.length - 1} value={idx}
                className="tm-scrubber"
                onChange={(e) => { setPlaying(false); setIdx(parseInt(e.target.value)); }}
              />

              {/* tick strip */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10, height: 24 }}>
                {prints.map((x, i) => {
                  const t = x.replay.hypotheticalPnlPct1d;
                  const cls = i === idx ? "at" : t === null ? "" : t >= 0 ? "win" : "loss";
                  return <span key={x.id} className={`tm-tick ${cls}`} data-cursor="active" onClick={() => { setPlaying(false); setIdx(i); }} style={{ cursor: "pointer", flex: 1, maxWidth: 8, marginRight: 2 }} />;
                })}
              </div>

              {/* cumulative equity sparkline */}
              {equityPath && (
                <div style={{ marginTop: 18 }}>
                  <span className="mara-label" style={{ display: "block", marginBottom: 8 }}>CUMULATIVE REPLAY EQUITY (%)</span>
                  <svg viewBox="0 0 800 120" width="100%" height="90" preserveAspectRatio="none" style={{ display: "block" }}>
                    <defs>
                      <linearGradient id="tmfill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,182,39,.25)" />
                        <stop offset="100%" stopColor="rgba(255,182,39,0)" />
                      </linearGradient>
                    </defs>
                    <polygon points={`0,120 ${equityPath} 800,120`} fill="url(#tmfill)" />
                    <polyline points={equityPath} fill="none" stroke="var(--phos)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    {prints.length > 1 && (
                      <circle
                        cx={(idx / (prints.length - 1)) * 800}
                        cy={(() => {
                          const vals = prints.map((x) => x.cumulativePnlPct);
                          const min = Math.min(...vals, 0), max = Math.max(...vals, 0.1), range = max - min || 1;
                          return 120 - ((prints[idx].cumulativePnlPct - min) / range) * 120;
                        })()}
                        r="5" fill="var(--phos)" stroke="var(--bg-void)" strokeWidth="2"
                      />
                    )}
                  </svg>
                </div>
              )}

              {timeline?.method && (
                <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, marginTop: 14, lineHeight: 1.6, color: "var(--fg-3)" }}>
                  {timeline.method}
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
