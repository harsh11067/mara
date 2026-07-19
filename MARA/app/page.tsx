'use client';

import { motion, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { MacroArtOverlay } from '@/components/landing/MacroArtOverlay';
import { MonetaryCore } from '@/components/landing/MonetaryCore';
import { AccountMenu } from '@/components/AccountMenu';
import { openOnboarding } from '@/components/Onboarding';
import Link from 'next/link';
import { ArrowRight, Activity, Zap, BrainCircuit, BarChart3, Globe, Fingerprint, Swords, History, HelpCircle, ShieldCheck } from 'lucide-react';
import {
  api, replayApi, timeAgo, convictionTone,
  type BackendDecision, type BackendRegime, type BackendPerformanceSummary, type ReplayTimeline,
} from '@/lib/api';
import { useEnvironment } from '@/components/context/EnvironmentContext';
import { captureReferral } from '@/lib/session';

const CARD_ICONS = [Activity, Zap, BrainCircuit, BarChart3, Globe, Fingerprint];

export default function LandingPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end']
  });
  const { regime } = useEnvironment();

  // ── Live engine state (everything below the fold is real) ────────────────
  const [decisions, setDecisions] = useState<BackendDecision[]>([]);
  const [perf, setPerf] = useState<BackendPerformanceSummary | null>(null);
  const [corpusRows, setCorpusRows] = useState<number | null>(null);
  const [cpiReplay, setCpiReplay] = useState<ReplayTimeline['summary'] | null>(null);

  useEffect(() => {
    captureReferral(); // ?ref=<userId> → +250 CR both sides on first real login
    void api.decisions().then(setDecisions).catch(() => {});
    void api.perfSummary().then(setPerf).catch(() => {});
    void api.diag().then((d) => setCorpusRows(d.corpus.rows)).catch(() => {});
    void replayApi.timeline('CPI').then((t) => setCpiReplay(t.summary ?? null)).catch(() => {});
  }, []);

  return (
    <div ref={containerRef} className="relative min-h-[500vh] bg-background selection:bg-amber/20 selection:text-amber">
      <MacroArtOverlay />

      {/* Navigation */}
      <nav className="fixed top-0 w-full p-8 flex justify-between items-center z-50">
        <div className="font-display text-2xl tracking-widest text-foreground mix-blend-difference">MARA</div>
        <div className="flex gap-6 md:gap-8 items-center text-sm font-mono tracking-widest text-muted uppercase">
          <Link href="/terminal" className="hover:text-foreground transition-colors duration-500 hidden sm:inline">Terminal</Link>
          <Link href="/duel" className="text-amber hover:text-foreground transition-colors duration-500">Duel</Link>
          <Link href="/replay" className="hover:text-foreground transition-colors duration-500">Replay</Link>
          <Link href="/edge" className="hover:text-foreground transition-colors duration-500">Edge</Link>
          <Link href="/portfolio" className="hover:text-foreground transition-colors duration-500 hidden sm:inline">Portfolio</Link>
          <button onClick={openOnboarding} aria-label="How it works" className="hover:text-amber transition-colors">
            <HelpCircle className="w-4 h-4" />
          </button>
          <AccountMenu />
        </div>
      </nav>

      {/* 01 Hero / The Intelligence */}
      <section className="relative h-[120vh] w-full pt-48 px-12 pb-24 overflow-hidden flex flex-col justify-center items-center">
        <motion.div layoutId="core-object" className="absolute inset-0 z-0 flex items-center justify-center">
          <MonetaryCore />
        </motion.div>
        <motion.div
          initial={{ y: 100, opacity: 0, filter: 'blur(30px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full h-full"
        >
          <div className="absolute top-24 left-12 md:left-24 font-mono text-[10px] tracking-[0.4em] text-muted uppercase rotate-90 origin-left">
            01 — The Intelligence
          </div>

          <h1 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-display text-[15vw] tracking-tighter text-foreground leading-[0.85] w-full text-center mix-blend-difference pointer-events-none z-20">
            Thoughts before <br />
            <span className="text-muted/40 italic">actions.</span>
          </h1>

          <div className="absolute bottom-24 right-12 md:right-24 max-w-sm text-right">
            <p className="font-sans text-xl md:text-3xl text-foreground font-light tracking-wide leading-snug drop-shadow-2xl">
              An autonomous macro agent <br/>trading real events on SoDEX.
            </p>
          </div>
        </motion.div>
      </section>

      {/* 02 How it reasons — the meters are the LIVE regime classifier */}
      <section className="relative min-h-[150vh] py-32 px-12 md:px-24">
        <div className="absolute inset-0 w-full h-full opacity-[0.02] pointer-events-none"
             style={{ backgroundImage: 'linear-gradient(var(--color-foreground) 1px, transparent 1px), linear-gradient(90deg, var(--color-foreground) 1px, transparent 1px)', backgroundSize: '100px 100px' }} />

        <div className="relative w-full h-full pt-32">
          <motion.div
            className="absolute top-0 right-12 md:right-32 text-right"
            initial={{ opacity: 0, y: -50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20%" }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          >
            <div className="font-mono text-[10px] tracking-[0.4em] text-amber mb-8 uppercase">02 — Cognition</div>
            <h2 className="font-display text-[6vw] leading-[0.9] tracking-tight">
              We do not <br/><span className="text-muted italic">guess.</span>
            </h2>
          </motion.div>

          <motion.div
            className="absolute top-[400px] left-12 md:left-24 max-w-xl z-20"
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20%" }}
            transition={{ duration: 1.5, delay: 0.2, ease: "easeOut" }}
          >
             <h2 className="font-display text-[6vw] leading-[0.9] tracking-tight mb-12">
              We reason.
            </h2>
            <p className="text-muted text-xl md:text-2xl font-light leading-relaxed">
              When a macro number prints, MARA interrogates its tools — the surprise engine,
              {corpusRows ? ` a corpus of ${corpusRows} historical releases` : ' a corpus of historical releases'},
              ETF flows, the live regime — and argues bull against bear before a verdict is allowed to exist.
            </p>
          </motion.div>

          <motion.div
            className="absolute top-[200px] left-1/2 -translate-x-1/4 w-[60vw] h-[800px] border border-glass-border bg-background/50 backdrop-blur-2xl p-16 flex flex-col justify-end z-10"
            initial={{ opacity: 0, y: 100 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ y: -15, rotateX: 1, rotateY: -1 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ type: "spring", stiffness: 40, damping: 20, mass: 1.5 }}
          >
            <div className="absolute top-0 right-0 w-full h-[1px] bg-gradient-to-r from-transparent via-amber/20 to-transparent" />
            <div className="absolute top-16 left-16 font-mono text-[9px] tracking-[0.3em] text-muted uppercase">
              Live regime classifier {regime ? `— ${regime.regime.replace('_', ' ')}` : '— connecting…'}
            </div>
            <div className="relative z-10 flex flex-col gap-12 w-full max-w-2xl ml-auto">
              {(regime ? [
                { label: '30-day BTC trend', display: `${regime.trendPct >= 0 ? '+' : ''}${regime.trendPct.toFixed(1)}%`, w: Math.min(1, Math.abs(regime.trendPct) / 40) },
                { label: 'Realized vol (annualized)', display: `${regime.realizedVolAnnual.toFixed(1)}%`, w: Math.min(1, regime.realizedVolAnnual / 150) },
                { label: 'Position size multiplier', display: `${regime.risk.sizeMultiplier.toFixed(2)}×`, w: Math.min(1, regime.risk.sizeMultiplier / 1.5) },
              ] : [
                { label: 'Awaiting engine telemetry', display: '—', w: 0 },
              ]).map((v, i) => (
                <div key={i} className="flex flex-col gap-4">
                  <div className="flex justify-between font-mono text-xs text-muted tracking-widest uppercase">
                    <span>{v.label}</span>
                    <span className="text-foreground">{v.display}</span>
                  </div>
                  <div className="h-[1px] w-full bg-glass-border relative overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-amber"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${v.w * 100}%` }}
                      transition={{ delay: 0.5 + i * 0.3, duration: 2, ease: "easeOut" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* 03 Live Cognition — cards are the agent's REAL latest decisions */}
      <section className="relative min-h-[200vh] py-32 bg-secondary/30">
        <div className="sticky top-0 h-screen flex flex-col justify-center overflow-hidden pt-24">
          <div className="absolute top-24 right-12 md:right-24 font-mono text-[10px] tracking-[0.4em] text-coral uppercase text-right">03 — Live Stream</div>
          <h2 className="absolute top-32 left-12 md:left-24 font-display text-[8vw] tracking-tighter mix-blend-overlay opacity-30">The Pulse</h2>

          <div className="flex gap-16 overflow-visible whitespace-nowrap will-change-transform pb-12 px-12 md:px-32 mt-32 z-10">
            <motion.div
              className="flex gap-16"
              style={{ x: useTransform(scrollYProgress, [0.3, 0.7], ['0%', '-80%']) }}
            >
              {(decisions.length > 0 ? decisions.slice(0, 6) : [null]).map((d, idx) => {
                const Icon = CARD_ICONS[idx % CARD_ICONS.length];
                const tone = d ? convictionTone(d.conviction) : 'flat';
                return (
                  <motion.div
                    key={d?.id ?? 'empty'}
                    className="w-[500px] h-[600px] shrink-0 bg-background border border-glass-border p-12 flex flex-col justify-between group hover:border-amber/30 transition-colors duration-1000 ease-out relative overflow-hidden"
                    whileHover={{ y: -20, rotateZ: 1 }}
                    transition={{ type: "spring", stiffness: 60, damping: 15, mass: 1 }}
                  >
                    <div className="absolute -bottom-16 -right-16 text-muted/[0.03] group-hover:text-muted/[0.05] transition-colors duration-1000 pointer-events-none">
                      <Icon className="w-96 h-96" strokeWidth={0.5} />
                    </div>

                    <div className="absolute inset-0 opacity-[0.015] bg-[linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
                    <div className="absolute -right-24 -top-24 w-64 h-64 bg-amber/5 rounded-full blur-3xl group-hover:bg-amber/10 transition-colors duration-1000 pointer-events-none" />

                    <div className="flex justify-between items-start relative z-10">
                      <div className="font-mono text-[9px] text-muted tracking-[0.3em] uppercase">
                        {d ? 'Decision' : 'Standby'}
                      </div>
                      <div className="font-mono text-[9px] text-foreground tracking-widest border border-glass-border px-4 py-2 rounded-full">
                        {d ? `ID ${d.id.slice(0, 8).toUpperCase()}` : 'AWAITING EVENT'}
                      </div>
                    </div>
                    <div className="relative z-10 mt-auto">
                      <div className="h-16 w-full mb-8 flex items-end gap-1 opacity-20">
                        {[...Array(12)].map((_, j) => (
                          <div key={j} className="flex-1 bg-amber" style={{ height: `${Math.max(10, ((j * 37 + (d ? d.confidence : 30) * 7) % 100))}%` }} />
                        ))}
                      </div>

                      <div className="font-sans font-light text-3xl md:text-4xl text-foreground mb-8 leading-snug whitespace-normal line-clamp-4">
                        {d
                          ? (d.marketContext?.eventName
                              ? `${d.marketContext.eventName}: ${d.conviction.replace('_', ' ')}.`
                              : `${d.conviction.replace('_', ' ')} — ${d.reasoning.split('. ')[0]}.`)
                          : 'The agent is watching the macro calendar. The next print starts the next thought.'}
                      </div>
                      <div className="flex items-center gap-6 text-xs font-mono whitespace-normal">
                        <span className={`tracking-widest ${tone === 'bear' ? 'text-coral' : 'text-amber'}`}>
                          {d ? `CONFIDENCE ${d.confidence}%` : 'LIVE FEED'}
                        </span>
                        <span className="text-muted/30">|</span>
                        <span className="text-muted tracking-widest uppercase">{d ? timeAgo(d.timestamp) : 'WS CONNECTED'}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </div>
      </section>

      {/* 04 & 05 Execution and Risk */}
      <section className="relative min-h-[150vh] py-32 px-12 md:px-24">
        <div className="relative w-full h-full max-w-[1600px] mx-auto">
          {/* Execution Engine */}
          <motion.div
            className="absolute top-24 left-0 w-[60%] border border-glass-border bg-background p-16 z-20"
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ y: -10, rotateZ: 0.5 }}
            transition={{ type: "spring", stiffness: 50, damping: 20, mass: 1 }}
            viewport={{ once: true, margin: "-10%" }}
          >
            <div className="absolute top-0 left-0 w-1/2 h-[1px] bg-gradient-to-r from-gold to-transparent" />
            <div className="font-mono text-[10px] tracking-[0.4em] text-gold mb-12 uppercase">04 — Execution</div>
            <h3 className="font-display text-[5vw] leading-[0.9] tracking-tight mb-8">Insight to order.</h3>
            <p className="text-2xl text-muted font-light max-w-xl mb-16 leading-relaxed">
              Verdicts become EIP-712-signed perpetual orders on SoDEX with stops and targets attached,
              plus SSI index rotations — the full research-to-execution loop with no human in between.
            </p>
            <div className="grid grid-cols-2 gap-y-12 gap-x-8 font-mono border-t border-glass-border pt-12">
              <div>
                <div className="text-muted mb-4 uppercase tracking-[0.2em] text-[9px]">Decisions logged</div>
                <div className="text-foreground text-5xl font-light">{perf ? perf.totalTrades + decisions.length : '—'}</div>
              </div>
              <div>
                <div className="text-muted mb-4 uppercase tracking-[0.2em] text-[9px]">Historical prints in corpus</div>
                <div className="text-foreground text-5xl font-light">{corpusRows ?? '—'}</div>
              </div>
            </div>
          </motion.div>

          {/* Risk Philosophy */}
          <motion.div
            className="absolute top-[600px] right-0 w-[45%] bg-secondary/80 backdrop-blur-xl p-16 z-30"
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ y: -15, rotateZ: -1 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ type: "spring", stiffness: 45, damping: 15, mass: 1.2, delay: 0.2 }}
          >
            <div className="font-mono text-[10px] tracking-[0.4em] text-rust mb-12 uppercase">05 — Risk</div>
            <h3 className="font-display text-[4vw] leading-[0.9] tracking-tight mb-8">Absolute <br/>Preservation.</h3>
            <p className="text-xl text-muted font-light leading-relaxed mb-12">
              A regime classifier scales position size, a circuit breaker halts trading around
              high-impact releases, and a kill switch closes everything. The risk engine can veto
              any verdict — and does.
            </p>
            <div className="w-full h-[1px] bg-glass-border" />
          </motion.div>

          {/* Track Record — the Time Machine's honest replay */}
          <motion.div
            className="absolute top-[1000px] left-[10%] w-[50%] p-16 border-l border-olive/30 z-10"
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ x: 10 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ type: "spring", stiffness: 40, damping: 20, mass: 1, delay: 0.4 }}
          >
            <div className="font-mono text-[10px] tracking-[0.4em] text-olive mb-8 uppercase">06 — Empirical Truth</div>
            <p className="text-3xl text-foreground font-light leading-snug mb-6">
              {cpiReplay
                ? <>Replayed over every CPI print in the corpus with zero lookahead: {cpiReplay.traded} trades, {cpiReplay.stoodDown} stand-downs, {cpiReplay.winRate ?? '—'}% wins, {cpiReplay.cumulativePnlPct >= 0 ? '+' : ''}{cpiReplay.cumulativePnlPct}% cumulative.</>
                : <>Every verdict is replayed against history with zero lookahead — no promises, just the record.</>}
            </p>
            <Link href="/replay" className="font-mono text-[10px] tracking-[0.3em] uppercase text-olive hover:text-foreground transition-colors inline-flex items-center gap-2">
              Audit it yourself in the Time Machine <ArrowRight className="w-3 h-3" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* 07 Play — the two arenas */}
      <section className="relative pt-60 pb-32 px-12 md:px-24 mt-36">
        <div className="max-w-[1600px] mx-auto">
          <div className="font-mono text-[10px] tracking-[0.4em] text-amber uppercase mb-8">07 — The Arena</div>
          <h2 className="font-display text-[5vw] leading-[1.05] tracking-tight pb-6 mb-24 md:mb-32">
            Don&apos;t just watch it. <span className="text-muted italic">Play it.</span>
          </h2>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-8 mt-12">
            <Link href="/duel">
              <motion.div
                className="border border-amber/30 bg-background p-14 relative overflow-hidden group h-full"
                whileHover={{ y: -12, rotateZ: 0.5 }}
                transition={{ type: 'spring', stiffness: 50, damping: 16 }}
              >
                <div className="absolute -right-16 -bottom-16 text-amber/[0.04] group-hover:text-amber/[0.08] transition-colors duration-700">
                  <Swords className="w-80 h-80" strokeWidth={0.5} />
                </div>
                <div className="font-mono text-[9px] tracking-[0.3em] text-amber uppercase mb-6">Signal Duel</div>
                <h3 className="font-display text-4xl md:text-5xl leading-tight mb-6">Beat the agent<br/>to the verdict.</h3>
                <p className="text-muted font-light text-lg leading-relaxed mb-10 max-w-md">
                  Stake credits on BULL or BEAR before the real pipeline runs. Match MARA and double your stake. Climb the leaderboard.
                </p>
                <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-foreground inline-flex items-center gap-3 group-hover:text-amber transition-colors">
                  Enter the arena <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </span>
              </motion.div>
            </Link>
            <Link href="/replay">
              <motion.div
                className="border border-glass-border bg-background p-14 relative overflow-hidden group h-full"
                whileHover={{ y: -12, rotateZ: -0.5 }}
                transition={{ type: 'spring', stiffness: 50, damping: 16 }}
              >
                <div className="absolute -right-16 -bottom-16 text-muted/[0.04] group-hover:text-muted/[0.08] transition-colors duration-700">
                  <History className="w-80 h-80" strokeWidth={0.5} />
                </div>
                <div className="font-mono text-[9px] tracking-[0.3em] text-muted uppercase mb-6">Time Machine</div>
                <h3 className="font-display text-4xl md:text-5xl leading-tight mb-6">Scrub two years<br/>of macro prints.</h3>
                <p className="text-muted font-light text-lg leading-relaxed mb-10 max-w-md">
                  Watch MARA re-decide every CPI, NFP and FOMC in the corpus — no lookahead, honest stand-downs, real forward returns.
                </p>
                <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-foreground inline-flex items-center gap-3 group-hover:text-amber transition-colors">
                  Rewind time <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </span>
              </motion.div>
            </Link>
            <Link href="/edge">
              <motion.div
                className="border border-olive/30 bg-background p-14 relative overflow-hidden group h-full"
                whileHover={{ y: -12, rotateZ: 0.5 }}
                transition={{ type: 'spring', stiffness: 50, damping: 16 }}
              >
                <div className="absolute -right-16 -bottom-16 text-olive/[0.04] group-hover:text-olive/[0.08] transition-colors duration-700">
                  <ShieldCheck className="w-80 h-80" strokeWidth={0.5} />
                </div>
                <div className="font-mono text-[9px] tracking-[0.3em] text-olive uppercase mb-6">Proof of Edge</div>
                <h3 className="font-display text-4xl md:text-5xl leading-tight mb-6">Four strategies.<br/>One gauntlet.</h3>
                <p className="text-muted font-light text-lg leading-relaxed mb-10 max-w-md">
                  MARA vs a version of itself that never stands down, a naive z-chaser, and buy-and-hold — same prints, zero lookahead, losses included.
                </p>
                <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-foreground inline-flex items-center gap-3 group-hover:text-amber transition-colors">
                  See the measurement <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </span>
              </motion.div>
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent z-0" />
        <motion.div
          className="relative z-10 text-center max-w-3xl px-8"
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-20%" }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        >
          <div className="font-mono text-xs tracking-[0.3em] text-amber mb-8 uppercase">08 — Initialization</div>
          <h2 className="font-display text-6xl md:text-8xl mb-12">Enter the System.</h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Link href="/terminal" className="inline-flex items-center gap-4 bg-foreground text-background px-8 py-4 rounded-full font-mono uppercase tracking-widest text-sm hover:bg-amber transition-colors duration-500 group">
              Open Terminal
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link href="/duel" className="inline-flex items-center gap-4 border border-glass-border text-foreground px-8 py-4 rounded-full font-mono uppercase tracking-widest text-sm hover:border-amber hover:text-amber transition-colors duration-500">
              Challenge the agent
            </Link>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
