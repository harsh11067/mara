/**
 * SIGNAL DUEL — you vs the agent, staked in MARA credits.
 *
 * Pick a macro print, call BULL or BEAR before MARA speaks, stake credits.
 * The REAL pipeline runs (live Gemini + live market data + on-chain
 * attestation) and the verdict resolves your duel over the WebSocket.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Swords, TrendingUp, TrendingDown, Trophy, History, Zap } from "lucide-react";
import { api, duelApi, createWebSocket, type WsMessage, type DuelRow, type LeaderboardRow, type BackendEvent } from "../api";
import { useSession, refreshCredits, setCredits, loginGuest } from "../session";
import AccountMenu from "../components/AccountMenu";

type Phase = "setup" | "running" | "done";

interface DuelResultMsg {
  duelId: string; verdict: string | null; confidence: number | null;
  outcome: "WIN" | "LOSS" | "PUSH" | "ERROR"; payout: number; credits: number;
  prediction: string; stake: number;
}

const PRESETS = [
  { event: "CPI (YoY)", actual: 4.1, forecast: 3.4, note: "hot inflation shock" },
  { event: "Nonfarm Payrolls", actual: 110, forecast: 180, note: "big jobs miss" },
  { event: "Core PCE Price Index (MoM)", actual: 0.2, forecast: 0.3, note: "cool core print" },
];

export default function Duel() {
  const session = useSession();
  const [events, setEvents] = useState<BackendEvent[]>([]);
  const [eventName, setEventName] = useState(PRESETS[0].event);
  const [actual, setActual] = useState(String(PRESETS[0].actual));
  const [forecast, setForecast] = useState(String(PRESETS[0].forecast));
  const [prediction, setPrediction] = useState<"BULL" | "BEAR" | null>(null);
  const [stake, setStake] = useState(100);
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<DuelResultMsg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<DuelRow[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const activeDuelId = useRef<string | null>(null);

  // live feed — duel results arrive here
  useEffect(() => {
    const cleanup = createWebSocket((msg: WsMessage & { type: string; data?: unknown }) => {
      if ((msg as { type: string }).type === "duel_result") {
        const d = (msg as unknown as { data: DuelResultMsg }).data;
        if (d.duelId === activeDuelId.current) {
          setResult(d);
          setPhase("done");
          setCredits(d.credits);
          void loadHistory();
        }
      }
    });
    return cleanup;
  }, []);

  const loadHistory = async () => {
    try {
      const [m, l] = await Promise.all([
        session.user ? duelApi.mine() : Promise.resolve(null),
        duelApi.leaderboard(),
      ]);
      if (m) setMine(m.duels);
      setBoard(l.leaderboard);
    } catch { /* backend offline */ }
  };

  useEffect(() => {
    void loadHistory();
    api.events().then((e) => setEvents(e.slice(0, 8))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user?.id]);

  const canLaunch = useMemo(() =>
    session.user !== null && prediction !== null && phase !== "running" &&
    eventName.trim() && !isNaN(parseFloat(actual)) && !isNaN(parseFloat(forecast)) &&
    stake >= 25 && stake <= Math.min(500, session.credits),
  [session, prediction, phase, eventName, actual, forecast, stake]);

  const launch = async () => {
    if (!prediction) return;
    setError(null);
    setResult(null);
    setPhase("running");
    try {
      const res = await duelApi.start({
        event: eventName.trim(),
        actual: parseFloat(actual),
        forecast: parseFloat(forecast),
        prediction,
        stake,
      });
      if (res.error || !res.duelId) {
        setError(res.error ?? "Duel failed to start");
        setPhase("setup");
        return;
      }
      activeDuelId.current = res.duelId;
      if (res.credits !== undefined) setCredits(res.credits);
    } catch {
      setError("Backend unreachable");
      setPhase("setup");
    }
  };

  const resetArena = () => {
    setPhase("setup");
    setResult(null);
    setPrediction(null);
    activeDuelId.current = null;
    void refreshCredits();
  };

  const outcomeTone = result?.outcome === "WIN" ? "pos" : result?.outcome === "LOSS" ? "neg" : "amber";

  return (
    <div className="mara-scanlines" style={{ minHeight: "100vh", background: "var(--bg-base)", color: "var(--fg)", fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <header className="mara-topbar-glow" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 22px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <Link to="/terminal" className="mc-btn mc-btn--ghost" style={{ textDecoration: "none", gap: 6 }}>
          <ArrowLeft size={13} /> Terminal
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Swords size={18} color="var(--phos)" />
          <span style={{ fontWeight: 800, fontSize: 17 }}>SIGNAL<span className="mara-spectral-text">DUEL</span></span>
          <span className="mc-badge mc-badge--amber">YOU vs THE AGENT</span>
        </div>
        <div style={{ marginLeft: "auto" }}><AccountMenu /></div>
      </header>

      <main style={{ flex: 1, width: "100%", maxWidth: 1180, margin: "0 auto", padding: "26px 22px 60px", display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(300px,1fr)", gap: 18, alignItems: "start" }}>
        {/* ── ARENA ── */}
        <section className={`duel-arena${phase === "running" ? " duel-scan" : ""}`} style={{ padding: 26 }}>
          <p className="mara-serif" style={{ fontSize: 26, color: "var(--fg)", marginBottom: 4 }}>
            Call the market <em>before</em> the agent speaks.
          </p>
          <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, marginBottom: 22, lineHeight: 1.6 }}>
            Same print, two analysts. If your direction matches MARA's live verdict you win 2× your stake.
            NEUTRAL verdict = push, stake returned. The pipeline is real — live Gemini tool calls, live data, on-chain attestation.
          </p>

          {phase === "done" && result ? (
            /* ── REVEAL ── */
            <div style={{ textAlign: "center", padding: "26px 0 10px" }}>
              <div className="mara-label" style={{ marginBottom: 14 }}>THE AGENT SAYS</div>
              <div className="mara-serif" style={{ fontSize: 46, color: "var(--fg)", marginBottom: 6 }}>
                {result.verdict ?? "—"}
                {result.confidence != null && <span style={{ color: "var(--fg-3)", fontSize: 24 }}> · {result.confidence}%</span>}
              </div>
              <div className="mara-micro" style={{ marginBottom: 26 }}>
                YOUR CALL: <span className={result.prediction === "BULL" ? "mara-pos" : "mara-neg"}>{result.prediction}</span> · STAKE {result.stake} CR
              </div>
              <div style={{ marginBottom: 26 }}>
                <span className={`duel-stamp mara-${outcomeTone}`}>
                  {result.outcome}{result.outcome === "WIN" ? ` +${result.payout}` : result.outcome === "PUSH" || result.outcome === "ERROR" ? " · REFUND" : ` −${result.stake}`}
                </span>
              </div>
              <button className="mc-btn mc-btn--amber" onClick={resetArena}>
                <Swords size={13} /> Run It Back
              </button>
            </div>
          ) : (
            <>
              {/* event setup */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div className="mc-field">
                  <span className="mara-label">EVENT</span>
                  <input className="mc-input" value={eventName} onChange={(e) => setEventName(e.target.value)} disabled={phase === "running"} />
                </div>
                <div className="mc-field">
                  <span className="mara-label">ACTUAL</span>
                  <input className="mc-input" value={actual} onChange={(e) => setActual(e.target.value)} disabled={phase === "running"} />
                </div>
                <div className="mc-field">
                  <span className="mara-label">FORECAST</span>
                  <input className="mc-input" value={forecast} onChange={(e) => setForecast(e.target.value)} disabled={phase === "running"} />
                </div>
              </div>

              {/* presets + real calendar events */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
                {PRESETS.map((p) => (
                  <button key={p.event} className="mc-btn mc-btn--ghost" style={{ fontSize: 10, padding: "6px 10px" }}
                    disabled={phase === "running"}
                    onClick={() => { setEventName(p.event); setActual(String(p.actual)); setForecast(String(p.forecast)); }}>
                    {p.event} · {p.note}
                  </button>
                ))}
                {events.filter((e) => e.forecast !== null).slice(0, 3).map((e) => (
                  <button key={e.id} className="mc-btn mc-btn--ghost" style={{ fontSize: 10, padding: "6px 10px" }}
                    disabled={phase === "running"}
                    onClick={() => {
                      setEventName(e.name);
                      setForecast(String(e.forecast));
                      setActual(String(e.actual ?? e.forecast));
                    }}>
                    {e.name} · {e.date} (calendar)
                  </button>
                ))}
              </div>

              {/* BULL vs BEAR */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center", marginBottom: 22 }}>
                <div
                  className={`duel-side${prediction === "BULL" ? " sel-bull" : ""}`}
                  data-cursor="active"
                  onClick={() => phase !== "running" && setPrediction("BULL")}
                >
                  <TrendingUp size={26} color="var(--pos)" />
                  <div className="mara-h2" style={{ margin: "10px 0 6px", color: "var(--pos)" }}>BULL</div>
                  <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, lineHeight: 1.5 }}>
                    This print sends BTC up. Risk appetite returns.
                  </p>
                </div>
                <span className="duel-vs">vs</span>
                <div
                  className={`duel-side${prediction === "BEAR" ? " sel-bear" : ""}`}
                  data-cursor="active"
                  onClick={() => phase !== "running" && setPrediction("BEAR")}
                >
                  <TrendingDown size={26} color="var(--neg)" />
                  <div className="mara-h2" style={{ margin: "10px 0 6px", color: "var(--neg)" }}>BEAR</div>
                  <p className="mara-micro" style={{ textTransform: "none", letterSpacing: 0, lineHeight: 1.5 }}>
                    This print bleeds risk assets. BTC sells off.
                  </p>
                </div>
              </div>

              {/* stake */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span className="mara-label">STAKE</span>
                  <span className="mara-value mara-amber" style={{ fontSize: 18 }}>{stake} <span style={{ fontSize: 11, color: "var(--fg-3)" }}>CR</span></span>
                </div>
                <input
                  type="range" min={25} max={500} step={25} value={stake}
                  className="duel-stake-range"
                  disabled={phase === "running"}
                  onChange={(e) => setStake(parseInt(e.target.value))}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span className="mara-micro">MIN 25</span>
                  <span className="mara-micro">WIN PAYS {stake * 2}</span>
                  <span className="mara-micro">MAX 500</span>
                </div>
              </div>

              {/* launch */}
              {session.user ? (
                <button className="mc-btn mc-btn--amber mc-btn--full" style={{ padding: "15px 0", fontSize: 14 }}
                  disabled={!canLaunch} onClick={() => void launch()}>
                  <Swords size={15} />
                  {phase === "running" ? "THE AGENT IS ANALYZING — LIVE TOOL CALLS RUNNING…" : "LOCK IT IN — RUN THE REAL PIPELINE"}
                </button>
              ) : (
                <button className="mc-btn mc-btn--amber mc-btn--full" style={{ padding: "15px 0", fontSize: 14 }}
                  onClick={() => void loginGuest().then(loadHistory)}>
                  <Zap size={15} /> GET A GUEST PASS (400 CR) &amp; DUEL
                </button>
              )}
              {session.user && stake > session.credits && (
                <p className="mara-micro mara-neg" style={{ textTransform: "none", letterSpacing: 0, marginTop: 8 }}>
                  Not enough credits — you have {session.credits}.
                </p>
              )}
              {error && (
                <p className="mara-micro mara-neg" style={{ textTransform: "none", letterSpacing: 0, marginTop: 8 }}>{error}</p>
              )}
              {phase === "running" && (
                <p className="mara-micro mara-amber mara-filament" style={{ textTransform: "none", letterSpacing: 0, marginTop: 10 }}>
                  Verdict lands here automatically — usually 20–60s. Watch the tool trace in the Terminal feed.
                </p>
              )}
            </>
          )}
        </section>

        {/* ── SIDE: leaderboard + history ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section className="mc-panel">
            <div className="mc-modhead">
              <span className="ic"><Trophy size={18} /></span>
              <div className="titles"><span className="mara-h1" style={{ fontSize: 15 }}>Leaderboard</span></div>
            </div>
            <div style={{ padding: "6px 0" }}>
              {board.length === 0 ? (
                <p className="mara-micro" style={{ padding: "14px 18px", textTransform: "none" }}>No duels resolved yet — be the first name on the board.</p>
              ) : (
                <table className="mc-table">
                  <thead><tr><th>#</th><th>Operator</th><th className="num">CR</th><th className="num">W-L</th><th className="num">ACC</th></tr></thead>
                  <tbody>
                    {board.slice(0, 8).map((r) => (
                      <tr key={r.rank}>
                        <td style={{ color: r.rank === 1 ? "var(--phos)" : undefined }}>{r.rank}</td>
                        <td>{r.name}<span className="mara-micro" style={{ marginLeft: 6, color: "var(--fg-4)" }}>{r.provider}</span></td>
                        <td className="num" style={{ color: "var(--phos)" }}>{r.credits.toLocaleString()}</td>
                        <td className="num">{r.wins}-{r.losses}</td>
                        <td className="num">{r.accuracy !== null ? `${r.accuracy}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="mc-panel">
            <div className="mc-modhead">
              <span className="ic"><History size={18} /></span>
              <div className="titles"><span className="mara-h1" style={{ fontSize: 15 }}>Your Duels</span></div>
            </div>
            <div className="mc-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
              {mine.length === 0 ? (
                <p className="mara-micro" style={{ padding: "14px 18px", textTransform: "none" }}>
                  {session.user ? "No duels yet." : "Sign in to see your record."}
                </p>
              ) : mine.map((d) => (
                <div key={d.id} style={{ padding: "11px 18px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={`mc-badge ${d.outcome === "WIN" ? "mc-badge--pos" : d.outcome === "LOSS" ? "mc-badge--neg" : d.outcome === "PENDING" ? "mc-badge--info" : "mc-badge--amber"}`}>
                    {d.outcome}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mara-data" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d.event_name} · you {d.prediction}{d.mara_verdict ? ` / agent ${d.mara_verdict}` : ""}
                    </div>
                    <div className="mara-micro" style={{ marginTop: 2 }}>
                      {new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <span className={`mara-data ${d.outcome === "WIN" ? "mara-pos" : d.outcome === "LOSS" ? "mara-neg" : ""}`} style={{ fontWeight: 700, fontSize: 13 }}>
                    {d.outcome === "WIN" ? `+${d.payout - d.stake}` : d.outcome === "LOSS" ? `−${d.stake}` : `${d.stake}`}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
