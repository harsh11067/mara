'use client';

/**
 * MARA ARCADE — two fast credit games on REAL BTC price moves (5-min settle).
 * Strike and settle prices are live SoDEX marks stored on every bet:
 * the market is the dice, never Math.random. Results arrive over WS.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Gamepad2, Timer, Zap } from 'lucide-react';
import { api, arcadeApi, createWebSocket, type ArcadeGame, type ArcadeBet, type WsMessage } from '@/lib/api';
import { useSession, setCredits } from '@/lib/session';

export function Arcade({ killSwitch: killSwitchProp }: { killSwitch?: boolean }) {
  const session = useSession();
  const [ksLive, setKsLive] = useState(false);
  const killSwitch = killSwitchProp ?? ksLive;
  const [games, setGames] = useState<ArcadeGame[]>([]);
  const [stats, setStats] = useState<{ totalBets: number; paidOut: number } | null>(null);
  const [stake, setStake] = useState(50);
  const [bets, setBets] = useState<ArcadeBet[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const signedIn = session.user !== null;
  const userId = session.user?.id;

  useEffect(() => {
    void arcadeApi.config().then((c) => { setGames(c.games); setStats({ totalBets: c.stats.totalBets, paidOut: c.stats.paidOut }); }).catch(() => {});
    void api.status().then((s) => setKsLive(s.killSwitch)).catch(() => {});
  }, []);

  useEffect(() => {
    if (signedIn) void arcadeApi.mine().then((r) => setBets(r.bets)).catch(() => {});
  }, [signedIn]);

  // Tick for countdowns
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live resolution over WS
  useEffect(() => {
    if (!userId) return;
    const dispose = createWebSocket((msg: WsMessage) => {
      if (msg.type === 'status') setKsLive(msg.data.killSwitch);
      if (msg.type === 'arcade_result' && msg.data.userId === userId) {
        setCredits(msg.data.credits);
        setFlash(`${msg.data.game} ${msg.data.pick}: ${msg.data.outcome}${msg.data.payout ? ` +${msg.data.payout} CR` : ''} (BTC moved ${msg.data.movePct >= 0 ? '+' : ''}${msg.data.movePct}%)`);
        void arcadeApi.mine().then((r) => setBets(r.bets)).catch(() => {});
        setTimeout(() => setFlash(null), 6000);
      }
    });
    return dispose;
  }, [userId]);

  const place = async (game: string, pick: string) => {
    if (!signedIn || busy) return;
    setBusy(`${game}:${pick}`);
    setFlash(null);
    const res = await arcadeApi.bet({ game, pick, stake }).catch(() => ({ error: 'Network error' }));
    setBusy(null);
    if ('ok' in res && res.ok) {
      if (res.credits !== undefined) setCredits(res.credits);
      setFlash(`Locked: ${pick} ${stake} CR @ $${res.strike?.toLocaleString()} — settles in 5 min.`);
      void arcadeApi.mine().then((r) => setBets(r.bets)).catch(() => {});
    } else {
      setFlash(('error' in res && res.error) || 'Bet rejected');
    }
  };

  const pending = bets.filter((b) => b.outcome === 'PENDING');

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-8">
        <div>
          <div className="font-mono text-[11px] tracking-[0.4em] text-amber uppercase mb-3 flex items-center gap-2">
            <Gamepad2 className="w-4 h-4" /> The Arcade — real marks, real settle
          </div>
          <h2 className="font-display text-4xl md:text-5xl">Five minutes. <span className="italic text-muted">One call.</span></h2>
        </div>
        {stats && (
          <div className="font-mono text-[11px] text-muted tracking-widest uppercase">
            {stats.totalBets} bets settled house-wide · {stats.paidOut.toLocaleString()} CR paid out
          </div>
        )}
      </div>

      {killSwitch && (
        <div className="border border-coral/40 bg-coral/5 p-4 mb-6 font-mono text-xs text-coral tracking-widest uppercase">
          ⛔ SAFE MODE — kill switch active, arcade paused until the operator resets.
        </div>
      )}

      {/* Stake slider shared by both games */}
      <div className="mara-glass p-5 mb-6 flex flex-wrap items-center gap-6">
        <span className="font-mono text-[11px] text-muted tracking-[0.25em] uppercase">Stake</span>
        <input type="range" min={10} max={500} step={10} value={stake}
          onChange={(e) => setStake(parseInt(e.target.value, 10))}
          className="flex-1 min-w-[160px] accent-[#FFB347]" />
        <span className="font-mono text-xl text-amber">{stake} CR</span>
        {!signedIn && <span className="font-sans text-xs text-muted">Sign in to play — credits are the stake.</span>}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {games.map((g) => (
          <motion.div
            key={g.key}
            initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            className="border border-glass-border bg-background/60 backdrop-blur-xl p-7 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-1/3 h-[1px] bg-gradient-to-r from-amber/50 to-transparent" />
            <div className="flex items-baseline justify-between mb-2">
              <div className="font-display text-3xl">{g.title}</div>
              <div className="font-mono text-[11px] text-olive tracking-widest uppercase">win pays {g.payoutX}×</div>
            </div>
            <p className="font-sans text-sm text-muted leading-relaxed mb-6 min-h-[40px]">{g.tagline}</p>
            <div className="flex gap-3">
              {g.picks.map((p) => (
                <button
                  key={p}
                  disabled={!signedIn || !!busy || killSwitch}
                  onClick={() => void place(g.key, p)}
                  className={`flex-1 py-3.5 border font-mono text-xs tracking-[0.25em] uppercase transition-colors disabled:opacity-40 ${
                    p === 'UP' || p === 'OVER'
                      ? 'border-olive/40 text-olive hover:bg-olive/10'
                      : 'border-coral/40 text-coral hover:bg-coral/10'
                  }`}
                >
                  {busy === `${g.key}:${p}` ? '…' : p}
                </button>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mt-4 border border-amber/40 bg-amber/5 p-4 font-mono text-xs text-amber tracking-wide"
          >
            <Zap className="w-3.5 h-3.5 inline mr-2" />{flash}
          </motion.div>
        )}
      </AnimatePresence>

      {/* My bets strip */}
      {signedIn && bets.length > 0 && (
        <div className="mt-8 border border-glass-border p-5">
          <div className="font-mono text-[11px] text-muted tracking-[0.3em] uppercase mb-4 flex items-center gap-2">
            <Timer className="w-3.5 h-3.5" /> Your bets {pending.length > 0 && <span className="text-amber">· {pending.length} settling</span>}
          </div>
          <div className="space-y-2">
            {bets.slice(0, 8).map((b) => {
              const secsLeft = Math.max(0, Math.ceil((b.resolve_at - now) / 1000));
              return (
                <div key={b.id} className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-xs border-b border-glass-border/40 pb-2 last:border-0">
                  <span className="text-foreground w-24">{b.game}</span>
                  <span className={b.pick === 'UP' || b.pick === 'OVER' ? 'text-olive' : 'text-coral'}>{b.pick}</span>
                  <span className="text-muted">{b.stake} CR @ ${b.strike.toLocaleString()}</span>
                  {b.outcome === 'PENDING' ? (
                    <span className="text-amber animate-pulse">settles in {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, '0')}</span>
                  ) : (
                    <span className={b.outcome === 'WIN' ? 'text-olive' : b.outcome === 'VOID' ? 'text-muted' : 'text-coral'}>
                      {b.outcome}{b.payout ? ` +${b.payout}` : ''} {b.settle_price ? `(settle $${b.settle_price.toLocaleString()})` : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
