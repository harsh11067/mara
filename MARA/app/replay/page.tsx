'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { History, Play, Pause, Eye, Target, HelpCircle } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { openOnboarding } from '@/components/Onboarding';
import { replayApi, type ReplayTimeline, type ReplayPrint } from '@/lib/api';

type Family = { event_type: string; n: number; first: string; last: string };
type Guess = 'BULL' | 'BEAR' | 'NEUTRAL';

export default function ReplayPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [family, setFamily] = useState<string>('CPI');
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Prophecy mode (predict-before-reveal calibration game) ────────────────
  const [prophecy, setProphecy] = useState(false);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [revealed, setRevealed] = useState(true);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void replayApi.families().then((f) => {
      setFamilies(f.families);
      if (f.families.length > 0 && !f.families.some((x) => x.event_type === 'CPI')) {
        setFamily(f.families[0].event_type);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setPlaying(false);
    void replayApi.timeline(family).then((t) => {
      setTimeline(t);
      setIdx(Math.max(0, t.prints.length - 1));
      setLoading(false);
      setRevealed(!prophecy);
      setGuess(null);
    }).catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family]);

  // Autoplay
  useEffect(() => {
    if (playTimer.current) clearInterval(playTimer.current);
    if (playing && timeline) {
      playTimer.current = setInterval(() => {
        setIdx((i) => {
          if (i >= timeline.prints.length - 1) { setPlaying(false); return i; }
          return i + 1;
        });
      }, 900);
    }
    return () => { if (playTimer.current) clearInterval(playTimer.current); };
  }, [playing, timeline]);

  // Reset reveal state when the scrubber moves in prophecy mode
  useEffect(() => {
    if (prophecy && !playing) { setRevealed(false); setGuess(null); }
    if (!prophecy) setRevealed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, prophecy]);

  const print = timeline?.prints[idx] ?? null;
  const summary = timeline?.summary;

  const makeGuess = (g: Guess) => {
    if (!print || revealed) return;
    setGuess(g);
    setRevealed(true);
    const correct = g === print.replay.verdict;
    setScore((s) => ({
      right: s.right + (correct ? 1 : 0),
      total: s.total + 1,
      streak: correct ? s.streak + 1 : 0,
    }));
  };

  // Equity path across the timeline (cumulative P&L %)
  const eq = useMemo(() => {
    const prints = timeline?.prints ?? [];
    if (prints.length < 2) return null;
    const vals = prints.map((p) => p.cumulativePnlPct);
    const min = Math.min(...vals, 0), max = Math.max(...vals, 0.001);
    const range = max - min || 1;
    const path = prints.map((p, i) => {
      const x = (i / (prints.length - 1)) * 100;
      const y = 92 - ((p.cumulativePnlPct - min) / range) * 84;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
    const cx = (idx / (prints.length - 1)) * 100;
    const cy = 92 - ((prints[idx].cumulativePnlPct - min) / range) * 84;
    return { path, cx, cy };
  }, [timeline, idx]);

  const retMeter = (label: string, v: number | null) => (
    <div key={label}>
      <div className="flex justify-between font-mono text-[9px] tracking-widest uppercase mb-1.5">
        <span className="text-muted">{label}</span>
        <span className={v === null ? 'text-muted' : v >= 0 ? 'text-olive' : 'text-coral'}>
          {v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`}
        </span>
      </div>
      <div className="h-[3px] bg-glass-border relative overflow-hidden">
        {v !== null && (
          <div
            className={`absolute inset-y-0 ${v >= 0 ? 'left-1/2 bg-olive' : 'right-1/2 bg-coral'}`}
            style={{ width: `${Math.min(50, Math.abs(v) * 5)}%` }}
          />
        )}
        <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-muted/40" />
      </div>
    </div>
  );

  const verdictTone = (v: ReplayPrint['replay']['verdict']) =>
    v === 'BULL' ? 'text-olive' : v === 'BEAR' ? 'text-coral' : 'text-muted';

  return (
    <div className="min-h-screen bg-background selection:bg-amber/20 selection:text-amber relative overflow-x-hidden">

      {/* Header */}
      <header className="fixed top-0 w-full px-8 md:px-12 py-6 flex justify-between items-center z-50 bg-background/70 backdrop-blur-md border-b border-foreground/5">
        <div className="flex gap-10 items-baseline">
          <Link href="/" className="text-2xl tracking-tight text-foreground hover:text-amber transition-colors font-display italic">MARA</Link>
          <div className="hidden md:flex gap-8 text-[10px] tracking-[0.2em] text-muted uppercase font-mono">
            <Link href="/terminal" className="hover:text-foreground transition-colors">Terminal</Link>
            <Link href="/duel" className="text-amber hover:text-foreground transition-colors">Duel</Link>
            <span className="text-foreground border-b border-foreground/30 pb-1">Replay</span>
            <Link href="/portfolio" className="hover:text-foreground transition-colors">Portfolio</Link>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <button onClick={openOnboarding} aria-label="How it works" className="text-muted hover:text-amber transition-colors"><HelpCircle className="w-4 h-4" /></button>
          <AccountMenu />
        </div>
      </header>

      <main className="pt-32 pb-24 px-8 md:px-12 max-w-[1500px] mx-auto relative z-10">

        {/* Title */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 mb-12">
          <div>
            <div className="font-mono text-[10px] tracking-[0.4em] text-muted uppercase mb-5 flex items-center gap-3">
              <History className="w-3.5 h-3.5" /> No lookahead · real forward returns
            </div>
            <h1 className="font-display text-6xl md:text-8xl leading-[0.9] tracking-tight">
              Time <span className="italic text-muted">Machine.</span>
            </h1>
            <p className="text-muted font-light text-lg mt-6 max-w-xl font-sans">
              Scrub through every historical {family} print. For each one, MARA re-decides using only
              the analogs that existed <em className="text-foreground not-italic">before that day</em> —
              and history grades the call.
            </p>
          </div>

          {/* Prophecy mode toggle + score */}
          <div className="mara-glass p-6 w-full lg:w-[340px] shrink-0">
            <button
              onClick={() => { setProphecy((p) => !p); setScore({ right: 0, total: 0, streak: 0 }); }}
              className={`w-full flex items-center justify-between border px-4 py-3 transition-colors font-mono text-[10px] tracking-[0.2em] uppercase ${prophecy ? 'border-amber/50 text-amber bg-amber/5' : 'border-glass-border text-muted hover:text-foreground'}`}
            >
              <span className="flex items-center gap-2"><Target className="w-3.5 h-3.5" /> Prophecy mode</span>
              <span>{prophecy ? 'ON' : 'OFF'}</span>
            </button>
            <p className="font-sans text-[11px] text-muted leading-relaxed mt-3">
              {prophecy
                ? 'Verdicts are hidden. Call each print yourself, then see how you calibrate against the machine.'
                : 'Turn on to guess each verdict before it\'s revealed — a pure calibration game, no credits at risk.'}
            </p>
            {prophecy && score.total > 0 && (
              <div className="flex justify-between font-mono text-[10px] tracking-widest uppercase mt-4 pt-4 border-t border-glass-border">
                <span className="text-foreground">{score.right}/{score.total} matched</span>
                <span className={score.streak > 1 ? 'text-amber' : 'text-muted'}>streak {score.streak}</span>
              </div>
            )}
          </div>
        </div>

        {/* Family tabs */}
        <div className="flex flex-wrap gap-2 mb-10">
          {(families.length > 0 ? families : [{ event_type: family, n: 0, first: '', last: '' }]).map((f) => (
            <button
              key={f.event_type}
              onClick={() => setFamily(f.event_type)}
              className={`px-5 py-2.5 border font-mono text-[10px] tracking-[0.2em] uppercase transition-colors ${family === f.event_type ? 'border-amber/50 text-amber bg-amber/5' : 'border-glass-border text-muted hover:text-foreground hover:border-foreground/30'}`}
            >
              {f.event_type}{f.n ? ` · ${f.n}` : ''}
            </button>
          ))}
        </div>

        {loading || !timeline || !print ? (
          <div className="border border-glass-border p-16 text-center font-mono text-[11px] text-muted tracking-widest uppercase">
            {loading ? 'Rewinding the corpus…' : 'No prints in this family yet.'}
          </div>
        ) : (
          <>
            {/* Summary stats row */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-foreground/10 border border-foreground/10 mb-10">
                {[
                  ['Prints', String(summary.totalPrints)],
                  ['Traded', String(summary.traded)],
                  ['Stood down', String(summary.stoodDown)],
                  ['Win rate', summary.winRate !== null ? `${summary.winRate}%` : '—'],
                  ['Cumulative', `${summary.cumulativePnlPct >= 0 ? '+' : ''}${summary.cumulativePnlPct}%`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-background p-5">
                    <div className="font-mono text-[9px] text-muted tracking-[0.3em] uppercase mb-2">{k}</div>
                    <div className={`font-mono text-2xl font-light ${k === 'Cumulative' ? (summary.cumulativePnlPct >= 0 ? 'text-olive' : 'text-coral') : 'text-foreground'}`}>{v}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid lg:grid-cols-[1fr_400px] gap-8">
              {/* ── Left: scrubber + verdict ── */}
              <div className="space-y-8">
                {/* Scrubber */}
                <div className="border border-glass-border bg-background/60 backdrop-blur-xl p-8">
                  <div className="flex items-center justify-between mb-6">
                    <div className="font-display text-4xl md:text-5xl italic text-foreground">{print.date}</div>
                    <button
                      onClick={() => setPlaying((p) => !p)}
                      className="flex items-center gap-2 border border-glass-border px-5 py-2.5 font-mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-amber hover:border-amber/40 transition-colors"
                    >
                      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {playing ? 'Pause' : 'Autoplay'}
                    </button>
                  </div>

                  <input
                    type="range" min={0} max={timeline.prints.length - 1} value={idx}
                    onChange={(e) => { setPlaying(false); setIdx(parseInt(e.target.value, 10)); }}
                    className="w-full accent-[#FFB347] mb-3"
                  />

                  {/* Tick strip — each print graded by hindsight */}
                  <div className="flex gap-[2px] h-6 items-end">
                    {timeline.prints.map((p, i) => {
                      const traded = p.replay.verdict !== 'NEUTRAL';
                      const won = traded && p.replay.hypotheticalPnlPct1d !== null && p.replay.hypotheticalPnlPct1d > 0;
                      return (
                        <button
                          key={p.id}
                          onClick={() => { setPlaying(false); setIdx(i); }}
                          className={`flex-1 transition-all ${i === idx ? 'h-6' : 'h-3'} ${
                            !traded ? 'bg-glass-border' : won ? 'bg-olive/70' : 'bg-coral/70'
                          } ${i === idx ? 'outline outline-1 outline-amber' : ''}`}
                          aria-label={p.date}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between font-mono text-[9px] text-muted mt-2 tracking-widest uppercase">
                    <span>{timeline.prints[0]?.date}</span>
                    <span className="text-foreground">{idx + 1} / {timeline.prints.length}</span>
                    <span>{timeline.prints[timeline.prints.length - 1]?.date}</span>
                  </div>
                </div>

                {/* The print */}
                <div className="grid grid-cols-3 gap-px bg-foreground/10 border border-foreground/10">
                  {[
                    ['Actual', print.actual],
                    ['Forecast', print.forecast],
                    ['Surprise σ', print.surpriseZ !== null ? print.surpriseZ.toFixed(2) : null],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="bg-background p-6">
                      <div className="font-mono text-[9px] text-muted tracking-[0.3em] uppercase mb-2">{String(k)}</div>
                      <div className="font-mono text-3xl font-light text-foreground">{v ?? '—'}</div>
                    </div>
                  ))}
                </div>

                {/* Verdict — hidden behind the prophecy game when active */}
                <AnimatePresence mode="wait">
                  {!revealed ? (
                    <motion.div
                      key="guess"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="border border-amber/30 bg-background p-10 text-center"
                    >
                      <div className="font-mono text-[10px] tracking-[0.3em] text-amber uppercase mb-6 flex items-center justify-center gap-2">
                        <Eye className="w-3.5 h-3.5" /> Call it before the machine
                      </div>
                      <div className="font-display text-3xl text-foreground mb-8">
                        {family} prints {print.actual ?? '—'} vs {print.forecast ?? '—'} expected. Your verdict?
                      </div>
                      <div className="flex flex-wrap justify-center gap-4">
                        {(['BULL', 'NEUTRAL', 'BEAR'] as Guess[]).map((g) => (
                          <button
                            key={g}
                            onClick={() => makeGuess(g)}
                            className={`px-8 py-3.5 border font-mono text-[11px] tracking-[0.25em] uppercase transition-colors ${
                              g === 'BULL' ? 'border-olive/40 text-olive hover:bg-olive/10' :
                              g === 'BEAR' ? 'border-coral/40 text-coral hover:bg-coral/10' :
                              'border-glass-border text-muted hover:text-foreground'
                            }`}
                          >
                            {g === 'NEUTRAL' ? 'STAND DOWN' : g}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`verdict-${print.id}`}
                      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                      className="border border-glass-border bg-background p-10 relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-1/2 h-[1px] bg-gradient-to-r from-amber/50 to-transparent" />
                      {guess !== null && (
                        <div className={`font-mono text-[10px] tracking-[0.3em] uppercase mb-4 ${guess === print.replay.verdict ? 'text-olive' : 'text-coral'}`}>
                          {guess === print.replay.verdict ? '◆ You matched the machine' : `◇ You said ${guess === 'NEUTRAL' ? 'STAND DOWN' : guess} — machine disagrees`}
                        </div>
                      )}
                      <div className="flex flex-wrap items-baseline gap-6 mb-6">
                        <div className={`font-display text-6xl ${verdictTone(print.replay.verdict)}`}>
                          {print.replay.verdict === 'NEUTRAL' ? 'STAND DOWN' : print.replay.verdict}
                        </div>
                        {print.replay.verdict !== 'NEUTRAL' && (
                          <div className="font-mono text-sm text-muted tracking-widest uppercase">
                            confidence {print.replay.confidence}% · size ×{print.replay.sizeMultiplier}
                          </div>
                        )}
                      </div>
                      <p className="font-sans text-muted leading-relaxed mb-8 max-w-2xl">{print.replay.explanation}</p>
                      <div className="flex flex-wrap gap-8 font-mono text-[10px] tracking-widest uppercase">
                        <span className="text-muted">Analogs used: <span className="text-foreground">{print.replay.analogCount}</span></span>
                        {print.replay.analogHitRate !== null && (
                          <span className="text-muted">Analog hit rate: <span className="text-foreground">{print.replay.analogHitRate}%</span></span>
                        )}
                        {print.replay.hypotheticalPnlPct1d !== null && (
                          <span className="text-muted">Hypothetical P&L (1d): <span className={print.replay.hypotheticalPnlPct1d >= 0 ? 'text-olive' : 'text-coral'}>
                            {print.replay.hypotheticalPnlPct1d >= 0 ? '+' : ''}{print.replay.hypotheticalPnlPct1d.toFixed(2)}%
                          </span></span>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Right: what actually happened + equity ── */}
              <div className="space-y-8">
                <div className="mara-glass p-6">
                  <div className="font-mono text-[10px] tracking-[0.3em] text-muted uppercase mb-6">What BTC actually did</div>
                  <div className="space-y-5">
                    {retMeter('+1 day', print.btcRet.d1)}
                    {retMeter('+3 days', print.btcRet.d3)}
                    {retMeter('+7 days', print.btcRet.d7)}
                    {retMeter('+30 days', print.btcRet.d30)}
                  </div>
                  {print.regime && (
                    <div className="font-mono text-[9px] text-muted tracking-widest uppercase mt-6 pt-4 border-t border-glass-border">
                      Regime that day: <span className="text-foreground">{print.regime}</span>
                    </div>
                  )}
                </div>

                <div className="mara-glass p-6">
                  <div className="font-mono text-[10px] tracking-[0.3em] text-muted uppercase mb-2">Strategy equity · cumulative</div>
                  <div className={`font-mono text-3xl font-light mb-4 ${print.cumulativePnlPct >= 0 ? 'text-olive' : 'text-coral'}`}>
                    {print.cumulativePnlPct >= 0 ? '+' : ''}{print.cumulativePnlPct.toFixed(2)}%
                  </div>
                  {eq && (
                    <svg className="w-full h-32" preserveAspectRatio="none" viewBox="0 0 100 100">
                      <path d={eq.path} fill="none" stroke="var(--color-amber)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                      <circle cx={eq.cx} cy={eq.cy} r="2.2" fill="var(--color-amber)" />
                    </svg>
                  )}
                </div>

                <div className="border border-glass-border p-6 font-sans text-[11px] text-muted leading-relaxed">
                  <span className="text-foreground font-mono text-[9px] tracking-[0.3em] uppercase block mb-2">Method — honest by construction</span>
                  {timeline.method ??
                    'Each print is decided using only analogs dated strictly before it. Fewer than 3 analogs → the agent stands down rather than guess. P&L uses real next-day BTC returns scaled by the regime size multiplier.'}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
