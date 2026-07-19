'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { Swords, TrendingUp, TrendingDown, Trophy, Flame, ChevronRight, HelpCircle } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { openOnboarding } from '@/components/Onboarding';
import { Arcade } from '@/components/Arcade';
import { TheFloor } from '@/components/TheFloor';
import {
  api, duelApi, createWebSocket, timeAgo,
  type BackendEvent, type DuelRow, type LeaderboardRow, type WsMessage,
} from '@/lib/api';
import { useSession, setCredits, refreshCredits } from '@/lib/session';

type Phase = 'setup' | 'running' | 'done';

interface DuelResultMsg {
  duelId: string; outcome: 'WIN' | 'LOSS' | 'PUSH' | 'ERROR';
  payout: number; verdict: string | null; confidence: number | null; credits: number;
}

const PRESETS = [
  { event: 'CPI (YoY)', actual: 4.1, forecast: 3.4, note: 'hot inflation shock' },
  { event: 'Nonfarm Payrolls', actual: 110, forecast: 180, note: 'big jobs miss' },
  { event: 'Core PCE Price Index (MoM)', actual: 0.2, forecast: 0.3, note: 'cool core print' },
];

const RANKS: Array<{ wins: number; title: string }> = [
  { wins: 0, title: 'OBSERVER' },
  { wins: 1, title: 'INITIATE' },
  { wins: 3, title: 'ANALYST' },
  { wins: 6, title: 'OPERATOR' },
  { wins: 10, title: 'ORACLE' },
  { wins: 15, title: 'MACRO SOVEREIGN' },
];

function rankFor(wins: number) {
  let current = RANKS[0], next: typeof RANKS[number] | null = null;
  for (const r of RANKS) { if (wins >= r.wins) current = r; }
  next = RANKS.find((r) => r.wins > wins) ?? null;
  return { current, next };
}

export default function DuelPage() {
  const session = useSession();
  const [events, setEvents] = useState<BackendEvent[]>([]);
  const [eventName, setEventName] = useState(PRESETS[0].event);
  const [actual, setActual] = useState(String(PRESETS[0].actual));
  const [forecast, setForecast] = useState(String(PRESETS[0].forecast));
  const [prediction, setPrediction] = useState<'BULL' | 'BEAR' | null>(null);
  const [stake, setStake] = useState(100);
  const [phase, setPhase] = useState<Phase>('setup');
  const [result, setResult] = useState<DuelResultMsg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<DuelRow[]>([]);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const activeDuelId = useRef<string | null>(null);

  // Declared before any effect that references it (no use-before-define).
  const loadHistory = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([
        session.user ? duelApi.mine() : Promise.resolve(null),
        duelApi.leaderboard(),
      ]);
      if (m) setMine(m.duels);
      setBoard(l.leaderboard);
    } catch { /* backend offline */ }
  }, [session.user]);

  useEffect(() => {
    const cleanup = createWebSocket((msg: WsMessage) => {
      if (msg.type === 'duel_result') {
        const d = msg.data as unknown as DuelResultMsg;
        if (d.duelId === activeDuelId.current) {
          setResult(d);
          setPhase('done');
          setCredits(d.credits);
          void loadHistory();
        }
      }
    });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadHistory();
    api.events().then((e) => setEvents(e.slice(0, 8))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user?.id]);

  // ── Gamification: record, streak, rank ─────────────────────────────────────
  const record = useMemo(() => {
    const wins = mine.filter((d) => d.outcome === 'WIN').length;
    const losses = mine.filter((d) => d.outcome === 'LOSS').length;
    const pushes = mine.filter((d) => d.outcome === 'PUSH').length;
    let streak = 0;
    for (const d of mine) {
      if (d.outcome === 'WIN') streak += 1;
      else if (d.outcome === 'LOSS') break;
      // pushes don't break a streak
      else if (d.outcome === 'PUSH' || d.outcome === 'ERROR') continue;
      else break;
    }
    return { wins, losses, pushes, streak };
  }, [mine]);

  const { current: rank, next: nextRank } = rankFor(record.wins);
  const rankProgress = nextRank
    ? (record.wins - rank.wins) / (nextRank.wins - rank.wins)
    : 1;

  const signedIn = session.user !== null;
  const hasCredits = session.credits >= 25;
  const canLaunch =
    signedIn && hasCredits && prediction !== null && phase !== 'running' &&
    eventName.trim() !== '' && !isNaN(parseFloat(actual)) && !isNaN(parseFloat(forecast)) &&
    stake >= 25 && stake <= Math.min(500, session.credits);

  const launch = async () => {
    if (!prediction) return;
    setError(null);
    setResult(null);
    setPhase('running');
    try {
      const res = await duelApi.start({
        event: eventName.trim(),
        actual: parseFloat(actual),
        forecast: parseFloat(forecast),
        prediction,
        stake,
      });
      if (res.error || !res.duelId) {
        setError(res.error ?? 'Duel failed to start');
        setPhase('setup');
        return;
      }
      activeDuelId.current = res.duelId;
      if (res.credits !== undefined) setCredits(res.credits);
    } catch {
      setError('Backend unreachable');
      setPhase('setup');
    }
  };

  const resetArena = () => {
    setPhase('setup');
    setResult(null);
    setPrediction(null);
    activeDuelId.current = null;
    void refreshCredits();
  };

  // Beginner direction strip — which step is the player on?
  const currentStep = !signedIn ? 0 : !hasCredits ? 0 : prediction === null ? 2 : 3;
  const STEPS = ['Connect & get credits', 'Pick a macro print', 'Take a side', 'Duel the agent'];

  return (
    <div className="min-h-screen bg-background selection:bg-amber/20 selection:text-amber relative overflow-x-hidden">

      {/* Header */}
      <header className="fixed top-0 w-full px-8 md:px-12 py-6 flex justify-between items-center z-50 bg-background/70 backdrop-blur-md border-b border-foreground/5">
        <div className="flex gap-10 items-baseline">
          <Link href="/" className="text-2xl tracking-tight text-foreground hover:text-amber transition-colors font-display italic">MARA</Link>
          <div className="hidden md:flex gap-8 text-xs tracking-[0.2em] text-muted uppercase font-mono">
            <Link href="/terminal" className="hover:text-foreground transition-colors">Terminal</Link>
            <span className="text-amber border-b border-amber/40 pb-1">Duel</span>
            <Link href="/replay" className="hover:text-foreground transition-colors">Replay</Link>
            <Link href="/edge" className="hover:text-foreground transition-colors">Edge</Link>
            <Link href="/portfolio" className="hover:text-foreground transition-colors">Portfolio</Link>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <button onClick={openOnboarding} aria-label="How it works" className="text-muted hover:text-amber transition-colors"><HelpCircle className="w-4 h-4" /></button>
          <AccountMenu />
        </div>
      </header>

      <main className="pt-32 pb-24 px-8 md:px-12 max-w-[1500px] mx-auto relative z-10">

        {/* Title + player card */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10 mb-14">
          <div>
            <div className="font-mono text-xs tracking-[0.4em] text-amber uppercase mb-5 flex items-center gap-3">
              <Swords className="w-3.5 h-3.5" /> The Arena
            </div>
            <h1 className="font-display text-6xl md:text-8xl leading-[0.9] tracking-tight">
              Signal <span className="italic text-muted">Duel.</span>
            </h1>
            <p className="text-muted font-light text-lg mt-6 max-w-xl font-sans">
              Call the market&apos;s reaction to a macro print <em className="text-foreground not-italic">before</em> the
              agent reasons about it. Match MARA&apos;s verdict → your stake doubles. The pipeline is real —
              same engine, same tools, live.
            </p>
          </div>

          {/* Player rank card */}
          <div className="mara-glass p-6 w-full lg:w-[340px] shrink-0 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1/2 h-[1px] bg-gradient-to-r from-amber/60 to-transparent" />
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="font-mono text-[11px] tracking-[0.3em] text-muted uppercase mb-1">Rank</div>
                <div className="font-display text-2xl text-foreground">{rank.title}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px] tracking-[0.3em] text-muted uppercase mb-1">Streak</div>
                <div className={`font-mono text-2xl font-light flex items-center gap-1.5 justify-end ${record.streak > 0 ? 'text-amber' : 'text-muted'}`}>
                  {record.streak > 0 && <Flame className="w-4 h-4" />}{record.streak}
                </div>
              </div>
            </div>
            <div className="flex justify-between font-mono text-xs tracking-widest text-muted uppercase mb-2">
              <span>W {record.wins} · L {record.losses} · P {record.pushes}</span>
              <span>{nextRank ? `${nextRank.wins - record.wins} wins → ${nextRank.title}` : 'MAX RANK'}</span>
            </div>
            <div className="h-[3px] w-full bg-glass-border overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-amber to-coral"
                animate={{ width: `${Math.min(100, rankProgress * 100)}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>

        {/* Beginner direction strip */}
        <div className="flex flex-wrap items-center gap-3 mb-12 font-mono text-xs tracking-[0.2em] uppercase">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-3">
              <span className={`px-4 py-2 border transition-colors ${i === currentStep ? 'border-amber/50 text-amber bg-amber/5' : i < currentStep ? 'border-glass-border text-foreground/60 line-through decoration-amber/40' : 'border-glass-border text-muted'}`}>
                {String(i + 1).padStart(2, '0')} — {s}
              </span>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted/40" />}
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-8">
          {/* ── Arena column ── */}
          <div className="relative">
            <AnimatePresence mode="wait">
              {phase === 'done' && result ? (
                /* ── Result reveal ── */
                <motion.div
                  key="result"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="border border-glass-border bg-background p-12 md:p-16 relative overflow-hidden text-center"
                >
                  <div className={`absolute inset-0 pointer-events-none ${result.outcome === 'WIN' ? 'bg-amber/5' : result.outcome === 'LOSS' ? 'bg-coral/5' : 'bg-foreground/[0.02]'}`} />
                  <motion.div
                    initial={{ scale: 2.2, opacity: 0, rotate: -8 }}
                    animate={{ scale: 1, opacity: 1, rotate: -3 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 16, delay: 0.15 }}
                    className={`inline-block border-4 px-10 py-4 font-display text-6xl md:text-7xl tracking-tight mb-8 ${
                      result.outcome === 'WIN' ? 'border-amber text-amber' :
                      result.outcome === 'LOSS' ? 'border-coral text-coral' : 'border-muted text-muted'
                    }`}
                  >
                    {result.outcome === 'PUSH' ? 'PUSH' : result.outcome === 'ERROR' ? 'REFUND' : result.outcome}
                  </motion.div>

                  <div className="font-mono text-sm text-foreground mb-2 tracking-wider">
                    {result.outcome === 'WIN' && `+${result.payout} credits — you read the print before the machine.`}
                    {result.outcome === 'LOSS' && `The agent saw it differently. -${stake} credits.`}
                    {result.outcome === 'PUSH' && 'MARA called it NEUTRAL — stake returned in full.'}
                    {result.outcome === 'ERROR' && 'Pipeline error — stake refunded automatically.'}
                  </div>
                  <div className="font-mono text-[11px] text-muted tracking-widest uppercase mb-10">
                    Agent verdict: {result.verdict ?? '—'}{result.confidence !== null ? ` · confidence ${result.confidence}%` : ''}
                  </div>

                  {record.streak >= 2 && result.outcome === 'WIN' && (
                    <div className="font-mono text-[11px] text-amber tracking-[0.3em] uppercase mb-8 flex items-center justify-center gap-2">
                      <Flame className="w-4 h-4" /> {record.streak} WIN STREAK
                    </div>
                  )}

                  <button
                    onClick={resetArena}
                    className="inline-flex items-center gap-3 bg-foreground text-background px-8 py-3.5 rounded-full font-mono text-[11px] uppercase tracking-[0.2em] hover:bg-amber transition-colors"
                  >
                    Duel again <Swords className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ) : phase === 'running' ? (
                /* ── Pipeline running ── */
                <motion.div
                  key="running"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="border border-amber/20 bg-background p-16 relative overflow-hidden text-center min-h-[420px] flex flex-col items-center justify-center"
                >
                  <motion.div
                    className="absolute inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-amber/60 to-transparent"
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                    className="w-20 h-20 rounded-full border border-amber/30 border-t-amber mb-10"
                  />
                  <div className="font-display text-3xl md:text-4xl text-foreground mb-4">
                    MARA is <span className="italic text-amber">reasoning…</span>
                  </div>
                  <p className="font-sans text-muted text-sm max-w-md leading-relaxed">
                    Your {stake}-credit stake on <span className="text-foreground">{prediction}</span> is locked.
                    The live pipeline is consulting the surprise engine, corpus analogs and risk gates.
                    Verdict lands here over the WebSocket — usually 15–40 seconds.
                  </p>
                </motion.div>
              ) : (
                /* ── Setup ── */
                <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">

                  {!signedIn && (
                    <div className="border border-amber/30 bg-amber/5 p-8 relative overflow-hidden">
                      <div className="font-mono text-xs tracking-[0.3em] text-amber uppercase mb-3">Step 01 — Identity required</div>
                      <p className="font-sans text-foreground text-lg font-light leading-relaxed">
                        Use <span className="font-mono text-sm border border-glass-border px-2 py-0.5">CONNECT</span> (top right) and sign in
                        with Google or a wallet signature. Real logins receive <span className="text-amber">1,000 credits</span> to stake.
                      </p>
                    </div>
                  )}
                  {signedIn && !hasCredits && (
                    <div className="border border-amber/30 bg-amber/5 p-8">
                      <div className="font-mono text-xs tracking-[0.3em] text-amber uppercase mb-3">Credits required</div>
                      <p className="font-sans text-foreground text-lg font-light leading-relaxed">
                        {session.user?.provider === 'guest'
                          ? 'Guest passes hold no credits. Reconnect with Google or a wallet to receive 1,000 credits.'
                          : 'Balance below the 25-credit minimum stake. Win duels to rebuild it.'}
                      </p>
                    </div>
                  )}

                  {/* Event selection */}
                  <div className="border border-glass-border bg-background/60 backdrop-blur-xl p-8">
                    <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase mb-6">Step 02 — The print</div>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {PRESETS.map((p) => (
                        <button
                          key={p.event}
                          onClick={() => { setEventName(p.event); setActual(String(p.actual)); setForecast(String(p.forecast)); }}
                          className={`px-4 py-2 border font-mono text-xs tracking-wider uppercase transition-colors ${eventName === p.event ? 'border-amber/50 text-amber bg-amber/5' : 'border-glass-border text-muted hover:text-foreground hover:border-foreground/30'}`}
                        >
                          {p.event} · {p.note}
                        </button>
                      ))}
                      {events.filter((e) => e.forecast !== null).slice(0, 3).map((e) => (
                        <button
                          key={e.id}
                          onClick={() => { setEventName(e.name); setForecast(String(e.forecast)); setActual(String(e.actual ?? e.forecast)); }}
                          className={`px-4 py-2 border font-mono text-xs tracking-wider uppercase transition-colors ${eventName === e.name ? 'border-amber/50 text-amber bg-amber/5' : 'border-dashed border-glass-border text-muted hover:text-foreground'}`}
                        >
                          {e.name} · calendar
                        </button>
                      ))}
                    </div>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div className="md:col-span-1">
                        <label className="font-mono text-[11px] text-muted tracking-widest uppercase mb-2 block">Event</label>
                        <input value={eventName} onChange={(e) => setEventName(e.target.value)}
                          className="w-full bg-foreground/[0.02] border border-glass-border px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber/50" />
                      </div>
                      <div>
                        <label className="font-mono text-[11px] text-muted tracking-widest uppercase mb-2 block">Actual (printed)</label>
                        <input value={actual} onChange={(e) => setActual(e.target.value)}
                          className="w-full bg-foreground/[0.02] border border-glass-border px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber/50" />
                      </div>
                      <div>
                        <label className="font-mono text-[11px] text-muted tracking-widest uppercase mb-2 block">Forecast (expected)</label>
                        <input value={forecast} onChange={(e) => setForecast(e.target.value)}
                          className="w-full bg-foreground/[0.02] border border-glass-border px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-amber/50" />
                      </div>
                    </div>
                  </div>

                  {/* Side selection — the big duel cards */}
                  <div className="grid md:grid-cols-[1fr_auto_1fr] gap-6 items-stretch">
                    <motion.button
                      onClick={() => setPrediction('BULL')}
                      whileHover={{ y: -8 }}
                      className={`text-left border p-10 relative overflow-hidden group transition-colors duration-500 ${prediction === 'BULL' ? 'border-olive bg-olive/10' : 'border-glass-border bg-background hover:border-olive/40'}`}
                    >
                      <TrendingUp className={`w-32 h-32 absolute -right-6 -bottom-6 transition-colors ${prediction === 'BULL' ? 'text-olive/20' : 'text-muted/[0.06] group-hover:text-olive/10'}`} strokeWidth={0.75} />
                      <div className={`font-mono text-xs tracking-[0.3em] uppercase mb-4 ${prediction === 'BULL' ? 'text-olive' : 'text-muted'}`}>Crypto rips</div>
                      <div className="font-display text-5xl mb-3">BULL</div>
                      <p className="font-sans text-sm text-muted leading-relaxed max-w-[240px]">
                        This print is risk-on — you expect MARA to call BULL or STRONG BULL.
                      </p>
                    </motion.button>

                    <div className="hidden md:flex items-center">
                      <span className="font-display italic text-3xl text-muted/50">vs</span>
                    </div>

                    <motion.button
                      onClick={() => setPrediction('BEAR')}
                      whileHover={{ y: -8 }}
                      className={`text-left border p-10 relative overflow-hidden group transition-colors duration-500 ${prediction === 'BEAR' ? 'border-coral bg-coral/10' : 'border-glass-border bg-background hover:border-coral/40'}`}
                    >
                      <TrendingDown className={`w-32 h-32 absolute -right-6 -bottom-6 transition-colors ${prediction === 'BEAR' ? 'text-coral/20' : 'text-muted/[0.06] group-hover:text-coral/10'}`} strokeWidth={0.75} />
                      <div className={`font-mono text-xs tracking-[0.3em] uppercase mb-4 ${prediction === 'BEAR' ? 'text-coral' : 'text-muted'}`}>Crypto bleeds</div>
                      <div className="font-display text-5xl mb-3">BEAR</div>
                      <p className="font-sans text-sm text-muted leading-relaxed max-w-[240px]">
                        This print is risk-off — you expect MARA to call BEAR or STRONG BEAR.
                      </p>
                    </motion.button>
                  </div>

                  {/* Stake + launch */}
                  <div className="border border-glass-border bg-background/60 backdrop-blur-xl p-8 flex flex-col md:flex-row md:items-end gap-8">
                    <div className="flex-1">
                      <div className="flex justify-between font-mono text-xs tracking-[0.2em] uppercase mb-3">
                        <span className="text-muted">Step 03 — Stake</span>
                        <span className="text-amber">{stake} CR{prediction ? ` on ${prediction}` : ''} → win {stake * 2}</span>
                      </div>
                      <input
                        type="range" min={25} max={500} step={25} value={stake}
                        onChange={(e) => setStake(parseInt(e.target.value, 10))}
                        className="w-full accent-[#FFB347]"
                      />
                      <div className="flex justify-between font-mono text-[11px] text-muted mt-1">
                        <span>25 min</span>
                        <span>balance {session.credits.toLocaleString()}</span>
                        <span>500 max</span>
                      </div>
                    </div>
                    <button
                      onClick={() => void launch()}
                      disabled={!canLaunch}
                      className="shrink-0 inline-flex items-center justify-center gap-3 bg-foreground text-background px-10 py-4 rounded-full font-mono text-[11px] uppercase tracking-[0.25em] hover:bg-amber transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Swords className="w-4 h-4" /> Duel
                    </button>
                  </div>

                  {error && <div className="font-mono text-[11px] text-coral tracking-wider">{error}</div>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Right rail: leaderboard + my duels ── */}
          <div className="space-y-8">
            <div className="mara-glass p-6">
              <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase mb-5 flex items-center gap-2">
                <Trophy className="w-3.5 h-3.5 text-amber" /> Leaderboard · vs the agent
              </div>
              {board.length === 0 ? (
                <div className="font-sans text-sm text-muted">No duels fought yet. Be the first name here.</div>
              ) : (
                <div className="space-y-2">
                  {board.slice(0, 8).map((r) => (
                    <div key={r.rank} className="flex items-center gap-3 font-mono text-[11px] py-1.5 border-b border-glass-border/40 last:border-0">
                      <span className={`w-6 ${r.rank <= 3 ? 'text-amber' : 'text-muted'}`}>#{r.rank}</span>
                      <span className="flex-1 text-foreground truncate">{r.name}</span>
                      <span className="text-muted">{r.wins}W/{r.losses}L</span>
                      <span className={`w-12 text-right ${r.accuracy !== null && r.accuracy >= 50 ? 'text-olive' : 'text-muted'}`}>
                        {r.accuracy !== null ? `${r.accuracy}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mara-glass p-6">
              <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase mb-5">My duels</div>
              {!signedIn ? (
                <div className="font-sans text-sm text-muted">Connect to start your record.</div>
              ) : mine.length === 0 ? (
                <div className="font-sans text-sm text-muted">No duels yet — your first verdict awaits.</div>
              ) : (
                <div className="space-y-2">
                  {mine.slice(0, 8).map((d) => (
                    <div key={d.id} className="flex items-center gap-3 font-mono text-xs py-1.5 border-b border-glass-border/40 last:border-0">
                      <span className={`w-12 tracking-wider ${d.outcome === 'WIN' ? 'text-olive' : d.outcome === 'LOSS' ? 'text-coral' : d.outcome === 'PENDING' ? 'text-amber animate-pulse' : 'text-muted'}`}>
                        {d.outcome}
                      </span>
                      <span className="flex-1 text-foreground truncate">{d.event_name}</span>
                      <span className={d.prediction === 'BULL' ? 'text-olive' : 'text-coral'}>{d.prediction}</span>
                      <span className="text-muted w-14 text-right">{d.outcome === 'WIN' ? `+${d.payout}` : d.outcome === 'LOSS' ? `-${d.stake}` : `±0`}</span>
                      <span className="text-muted/60 w-14 text-right">{timeAgo(d.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-glass-border p-6 font-sans text-[11px] text-muted leading-relaxed">
              <span className="text-foreground font-mono text-[11px] tracking-[0.3em] uppercase block mb-2">House rules</span>
              Stakes 25–500 CR · win pays 2× · NEUTRAL verdict = push (full refund) ·
              pipeline failure = automatic refund · one duel per 20s globally (shared cooldown with live runs).
            </div>
          </div>
        </div>

        {/* Wave 6: fast credit games on real BTC marks + community board */}
        <Arcade />
        <TheFloor />
      </main>
    </div>
  );
}
