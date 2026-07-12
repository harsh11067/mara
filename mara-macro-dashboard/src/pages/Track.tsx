/**
 * /track — the verifiable record. Dated theses with HIT/STOP/DRIFT outcomes,
 * the counterfactual curve (MARA vs buy-and-hold vs did-nothing), and the
 * corpus backtest with honestly-discounted metrics. Losses shown by design.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ScrollText, ArrowLeft, RefreshCw, TrendingUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { api } from "../api";

interface TrackData {
  theses: Array<{
    signalId: string; timestamp: number; event: string; conviction: string;
    confidence: number; action: string; noTradeReason: string | null;
    reasoning: string; surpriseScore: number | null;
    trade: null | { symbol: string; side: string; entry: number | null; outcome: string; outcomeDetail: string; pnl: number | null; sodexOrderId: string | null };
  }>;
  stats: { totalDecisions: number; accepted: number; rejected: number; hits: number; stops: number; drifts: number; open: number; winRate: number | null; cumulativePnl: number };
  counterfactual: { series: Array<{ ts: number; mara: number; buyHold: number; didNothing: number }>; note: string };
}

interface BacktestData {
  n: number;
  strategy: { totalReturnPct: number; sharpe: number | null; sharpeDiscounted: number | null; sortino: number | null; maxDrawdownPct: number; winRate: number | null };
  buyHold: { totalReturnPct: number; sharpe: number | null; maxDrawdownPct: number; correlationToStrategy: number | null };
  monteCarlo: { paths: number; var95Pct: number | null; cvar95Pct: number | null };
  caveats: string[];
}

const OUTCOME_TONE: Record<string, string> = {
  HIT: "var(--spectral-c)", STOP: "var(--neg)", DRIFT: "var(--amber)", OPEN: "var(--spectral-a)",
};

export default function Track() {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [backtest, setBacktest] = useState<BacktestData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.track().then((t) => setTrack(t as unknown as TrackData)).catch((e) => setErr(String(e)));
    api.backtest().then((b) => setBacktest(b as unknown as BacktestData)).catch(() => {});
  }, []);

  const s = track?.stats;

  return (
    <div className="landing-root landing-grain" style={{ minHeight: "100vh", padding: "90px 24px 60px" }}>
      <div className="landing-orb" style={{ top: "-20%", right: "-20%", opacity: .5 }} />

      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 16, padding: "18px 34px", background: "linear-gradient(180deg, rgba(3,3,4,.9), transparent)" }}>
        <Link to="/" style={{ color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 6, fontSize: 12, textDecoration: "none", letterSpacing: ".08em" }}><ArrowLeft size={14} /> MARA</Link>
      </nav>

      <div style={{ maxWidth: 940, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <span className="landing-kicker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ScrollText size={14} color="var(--spectral-c)" /> Verifiable track record
        </span>
        <h1 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(28px,4.5vw,44px)", color: "var(--fg)", margin: "12px 0 30px", letterSpacing: "-0.02em" }}>
          Signals with receipts.<br /><span className="mara-spectral-text">Outcomes with proof.</span>
        </h1>

        {err && <div className="landing-stage" style={{ borderColor: "var(--neg)", marginBottom: 20 }}><span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--neg)" }}>Backend unreachable: {err}</span></div>}
        {!track && !err && <div className="landing-stage" style={{ textAlign: "center", padding: 40 }}><RefreshCw size={18} color="var(--fg-3)" style={{ animation: "spin 1s linear infinite" }} /></div>}

        {/* stats */}
        {s && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", border: "1px solid var(--border-soft)", borderRadius: 14, overflow: "hidden", background: "rgba(10,11,14,.7)", marginBottom: 30 }}>
            {[
              { k: "THESES", v: String(s.totalDecisions), c: "var(--fg)" },
              { k: "HIT", v: String(s.hits), c: OUTCOME_TONE.HIT },
              { k: "STOP", v: String(s.stops), c: OUTCOME_TONE.STOP },
              { k: "DRIFT", v: String(s.drifts), c: OUTCOME_TONE.DRIFT },
              { k: "OPEN", v: String(s.open), c: OUTCOME_TONE.OPEN },
              { k: "WIN RATE", v: s.winRate != null ? `${s.winRate}%` : "—", c: "var(--fg)" },
              { k: "REJECTED (LOGGED)", v: String(s.rejected), c: "var(--fg-2)" },
            ].map((m) => (
              <div key={m.k} className="landing-metric" style={{ padding: "20px 8px", borderRight: "1px solid var(--border-soft)" }}>
                <span className="v" style={{ fontSize: 30, color: m.c }}>{m.v}</span>
                <span className="k">{m.k}</span>
              </div>
            ))}
          </div>
        )}

        {/* counterfactual curve */}
        {track && track.counterfactual.series.length > 1 && (
          <div className="landing-stage" style={{ marginBottom: 30, padding: "22px 24px" }}>
            <span className="landing-stage-num" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp size={13} /> COUNTERFACTUAL — MARA vs BUY-AND-HOLD vs DID-NOTHING
            </span>
            <div style={{ height: 260, marginTop: 16 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={track.counterfactual.series.map((p) => ({ ...p, date: new Date(p.ts).toISOString().slice(5, 10) }))}>
                  <XAxis dataKey="date" stroke="var(--fg-4)" fontSize={10} fontFamily="var(--font-mono)" />
                  <YAxis stroke="var(--fg-4)" fontSize={10} fontFamily="var(--font-mono)" domain={["auto", "auto"]} />
                  <Tooltip contentStyle={{ background: "#0a0b0e", border: "1px solid #1f2937", fontFamily: "var(--font-mono)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 11 }} />
                  <Line type="monotone" dataKey="mara" name="MARA NAV" stroke="#38e1ff" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="buyHold" name="BTC buy-and-hold" stroke="#7b6cff" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="didNothing" name="Did nothing" stroke="#454c59" strokeWidth={1} strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 10, lineHeight: 1.6 }}>{track.counterfactual.note}</p>
          </div>
        )}

        {/* backtest */}
        {backtest && (
          <div className="landing-stage" style={{ marginBottom: 30, padding: "22px 24px" }}>
            <span className="landing-stage-num">CORPUS BACKTEST — MACRO-SURPRISE STRATEGY ({backtest.n} PRINTS)</span>
            {backtest.n === 0 ? (
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)", marginTop: 10 }}>
                Corpus not seeded yet — POST /api/corpus/seed populates it from live SoSoValue history.
              </p>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginTop: 16 }}>
                  {[
                    { k: "STRATEGY RETURN", v: `${backtest.strategy.totalReturnPct}%` },
                    { k: "SHARPE", v: String(backtest.strategy.sharpe ?? "—") },
                    { k: "SHARPE ×0.5 (H&L)", v: String(backtest.strategy.sharpeDiscounted ?? "—") },
                    { k: "SORTINO", v: String(backtest.strategy.sortino ?? "—") },
                    { k: "MAX DRAWDOWN", v: `${backtest.strategy.maxDrawdownPct}%` },
                    { k: "WIN RATE", v: backtest.strategy.winRate != null ? `${backtest.strategy.winRate}%` : "—" },
                    { k: "BUY&HOLD RETURN", v: `${backtest.buyHold.totalReturnPct}%` },
                    { k: `MC VAR95 (${backtest.monteCarlo.paths} PATHS)`, v: `${backtest.monteCarlo.var95Pct ?? "—"}%` },
                  ].map((m) => (
                    <div key={m.k} style={{ textAlign: "center", padding: "12px 6px", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 18, color: "var(--fg)" }}>{m.v}</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".14em", color: "var(--fg-4)", marginTop: 4 }}>{m.k}</div>
                    </div>
                  ))}
                </div>
                <ul style={{ marginTop: 14, paddingLeft: 16 }}>
                  {backtest.caveats.map((cv, i) => (
                    <li key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", lineHeight: 1.7 }}>{cv}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {/* theses */}
        {track && (
          <>
            <span className="landing-kicker">Dated theses — accepted and rejected, all logged</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
              {track.theses.length === 0 && (
                <div className="landing-stage" style={{ textAlign: "center", padding: 30 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)" }}>
                    No theses yet — run a live cycle from <Link to="/judges" style={{ color: "var(--spectral-a)" }}>/judges</Link> and it lands here with a signal ID.
                  </span>
                </div>
              )}
              {track.theses.slice(0, 25).map((t) => (
                <div key={t.signalId} className="landing-stage" style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
                      {new Date(t.timestamp).toISOString().slice(0, 16).replace("T", " ")} · id {t.signalId.slice(0, 8)}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--fg)" }}>{t.event}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: t.conviction.includes("BULL") ? "var(--spectral-c)" : t.conviction.includes("BEAR") ? "var(--neg)" : "var(--fg-3)" }}>
                      {t.conviction} @{t.confidence}%
                    </span>
                    {t.surpriseScore != null && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)" }}>{t.surpriseScore > 0 ? "+" : ""}{t.surpriseScore.toFixed(2)}σ</span>
                    )}
                    <span style={{ marginLeft: "auto" }}>
                      {t.trade ? (
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 12, color: OUTCOME_TONE[t.trade.outcome] ?? "var(--fg-2)" }}>
                          {t.trade.outcome}
                        </span>
                      ) : (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>
                          NO_TRADE · {t.noTradeReason ?? "—"}
                        </span>
                      )}
                    </span>
                  </div>
                  <p style={{ fontFamily: "var(--font-sans)", fontWeight: 300, fontSize: 13, color: "var(--fg-2)", marginTop: 8, lineHeight: 1.55 }}>{t.reasoning}</p>
                  {t.trade && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 6 }}>
                      {t.trade.side} {t.trade.symbol} @ {t.trade.entry ?? "—"} · {t.trade.outcomeDetail}
                      {t.trade.pnl != null && <span style={{ color: t.trade.pnl >= 0 ? "var(--spectral-c)" : "var(--neg)" }}> · P&amp;L {t.trade.pnl >= 0 ? "+" : ""}{t.trade.pnl.toFixed(2)}</span>}
                      {t.trade.sodexOrderId && <span> · SoDEX order {t.trade.sodexOrderId}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
