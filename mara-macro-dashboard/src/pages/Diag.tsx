/**
 * /diag — live integration proof. Every dependency pinged with latency and a
 * real value snippet; the 35-endpoint registry with rotating live probes.
 * Green here means "not mocked" — that's the whole point of the page.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Radar, CheckCircle2, XCircle, RefreshCw, ArrowLeft, ShieldAlert } from "lucide-react";
import { api, type BackendDiag } from "../api";

export default function Diag() {
  const [diag, setDiag] = useState<BackendDiag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.diag()
      .then((d) => { setDiag(d); setErr(null); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const overallColor = diag?.overall === "green" ? "var(--spectral-c)" : diag?.overall === "degraded" ? "var(--amber)" : "var(--neg)";

  return (
    <div className="landing-root landing-grain" style={{ minHeight: "100vh", padding: "90px 24px 60px" }}>
      <div className="landing-orb" style={{ top: "-25%", left: "-15%", opacity: .5 }} />

      <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 40, display: "flex", alignItems: "center", gap: 16, padding: "18px 34px", background: "linear-gradient(180deg, rgba(3,3,4,.9), transparent)" }}>
        <Link to="/" style={{ color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 6, fontSize: 12, textDecoration: "none", letterSpacing: ".08em" }}><ArrowLeft size={14} /> MARA</Link>
      </nav>

      <div style={{ maxWidth: 900, margin: "0 auto", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
          <div>
            <span className="landing-kicker" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Radar size={14} color="var(--spectral-a)" /> Live integration diagnostics
            </span>
            <h1 style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "clamp(28px,4.5vw,44px)", color: "var(--fg)", margin: "12px 0 6px", letterSpacing: "-0.02em" }}>
              Nothing is mocked.<br /><span className="mara-spectral-text">Watch it prove itself.</span>
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {diag && (
              <span className="landing-chip" style={{ borderColor: overallColor }}>
                <span className="dot-live" style={{ background: overallColor, boxShadow: `0 0 10px ${overallColor}` }} />
                OVERALL: {diag.overall.toUpperCase()}
              </span>
            )}
            <button onClick={load} className="landing-cta landing-cta--ghost" style={{ padding: "9px 16px", fontSize: 12, border: "1px solid var(--border-strong)", cursor: "pointer", background: "rgba(14,17,24,.6)" }}>
              <RefreshCw size={13} style={loading ? { animation: "spin 1s linear infinite" } : undefined} /> Re-check
            </button>
          </div>
        </div>

        {err && (
          <div className="landing-stage" style={{ marginTop: 26, borderColor: "var(--neg)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <ShieldAlert size={16} color="var(--neg)" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--neg)" }}>
                Backend unreachable: {err}. Cold start can take ~1 min on the free tier — retry shortly.
              </span>
            </div>
          </div>
        )}

        {/* checks */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 30 }}>
          {(diag?.checks ?? []).map((chk) => (
            <div key={chk.name} className={`landing-stage${chk.ok ? " landing-stage--lit" : ""}`} style={{ padding: "16px 22px", display: "flex", alignItems: "center", gap: 16, borderColor: chk.ok ? undefined : "rgba(230,58,44,.5)" }}>
              {chk.ok ? <CheckCircle2 size={18} color="var(--spectral-c)" /> : <XCircle size={18} color="var(--neg)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>{chk.label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: chk.ok ? "var(--fg-2)" : "var(--neg)", marginTop: 3, wordBreak: "break-word" }}>{chk.detail}</div>
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)", flexShrink: 0 }}>
                {chk.latencyMs != null ? `${chk.latencyMs}ms` : ""}
              </span>
            </div>
          ))}
          {!diag && !err && (
            <div className="landing-stage" style={{ textAlign: "center", padding: 40 }}>
              <RefreshCw size={18} color="var(--fg-3)" style={{ animation: "spin 1s linear infinite" }} />
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)", marginTop: 10 }}>Running live checks…</div>
            </div>
          )}
        </div>

        {/* endpoint registry */}
        {diag && (
          <>
            <div style={{ marginTop: 44 }}>
              <span className="landing-kicker">SoSoValue endpoint registry — {diag.endpointRegistry.total} wired across {Object.keys(diag.endpointRegistry.byModule).length} modules</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 16 }}>
                {Object.entries(diag.endpointRegistry.byModule).map(([mod, n]) => (
                  <div key={mod} className="landing-metric landing-stage" style={{ padding: "18px 8px" }}>
                    <span className="v mara-spectral-text" style={{ fontSize: 30 }}>{n}</span>
                    <span className="k">{mod}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {diag.endpointRegistry.probedLive.map((p) => (
                  <div key={p.path} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {p.ok ? <CheckCircle2 size={12} color="var(--spectral-c)" /> : <XCircle size={12} color="var(--neg)" />}
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-2)" }}>{p.path}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)" }}>{p.latencyMs}ms · probed live this cycle (rotates to respect 20 req/min)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* circuit breaker + corpus */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 34 }}>
              <div className="landing-stage" style={{ padding: "18px 22px" }}>
                <span className="landing-stage-num">MACRO CIRCUIT BREAKER</span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: diag.circuitBreaker.active ? "var(--amber)" : "var(--fg-2)", marginTop: 8 }}>
                  {diag.circuitBreaker.active ? `ACTIVE — ${diag.circuitBreaker.reason}` : "Inactive — no high-impact release inside the de-risk window."}
                </div>
              </div>
              <div className="landing-stage" style={{ padding: "18px 22px" }}>
                <span className="landing-stage-num">CATALYST CORPUS</span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-2)", marginTop: 8 }}>
                  {diag.corpus.rows} historical prints seeded{diag.corpus.byEvent ? ` · ${Object.entries(diag.corpus.byEvent).map(([k, v]) => `${k}:${v}`).join(" ")}` : ""}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
