'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Swords, ShieldCheck, HelpCircle, TrendingDown, Link2, ExternalLink, Terminal } from 'lucide-react';
import { AccountMenu } from '@/components/AccountMenu';
import { openOnboarding } from '@/components/Onboarding';
import { api, edgeApi, API_BASE, type EdgeReport, type EdgeStrategyMetrics } from '@/lib/api';

const CONTRACT = '0x8BF2520742CCb4101f28C216fF564A221bba1B29';
const OPERATOR = '0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC';
const EXPLORER = 'https://testnet.sodex.com/explorer';

/** Count-up that animates when the value first arrives. */
function AnimatedPct({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const dur = 1200;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown >= 0 ? '+' : ''}{shown.toFixed(2)}%</>;
}

const LINES: Array<{ key: 'mara' | 'noStandDown' | 'naive' | 'buyHold'; label: string; stroke: string; dash?: string }> = [
  { key: 'mara',        label: 'MARA policy',        stroke: 'var(--color-amber)' },
  { key: 'noStandDown', label: 'No stand-downs',     stroke: 'var(--color-amber)', dash: '4 4' },
  { key: 'naive',       label: 'Naive z-chaser',     stroke: 'var(--color-coral)' },
  { key: 'buyHold',     label: 'Buy & hold BTC',     stroke: 'currentColor' },
];

export default function EdgePage() {
  const [report, setReport] = useState<EdgeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void edgeApi.report().then(setReport).catch((e) => setError(String(e)));
    void api.attestation().then(setChain).catch(() => {});
  }, []);

  const chart = useMemo(() => {
    const eq = report?.equity ?? [];
    if (eq.length < 2) return null;
    const all = eq.flatMap((p) => [p.mara, p.noStandDown, p.naive, p.buyHold]);
    const min = Math.min(...all), max = Math.max(...all);
    const range = max - min || 1;
    const pathFor = (key: (typeof LINES)[number]['key']) =>
      eq.map((p, i) => {
        const x = (i / (eq.length - 1)) * 100;
        const y = 94 - ((p[key] - min) / range) * 88;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(' ');
    // y for the "100" baseline (starting equity)
    const baseY = 94 - ((100 - min) / range) * 88;
    return { paths: LINES.map((l) => ({ ...l, d: pathFor(l.key) })), baseY };
  }, [report]);

  const strategies: Array<{ m: EdgeStrategyMetrics; hero?: boolean }> = report ? [
    { m: report.strategies.mara, hero: true },
    { m: report.strategies.maraNoStandDown },
    { m: report.strategies.naive },
    { m: report.strategies.buyHold },
  ] : [];

  const pct = (v: number | null | undefined, plus = true) =>
    v === null || v === undefined ? '—' : `${plus && v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  return (
    <div className="min-h-screen bg-background selection:bg-amber/20 selection:text-amber relative overflow-x-hidden">

      {/* Header */}
      <header className="fixed top-0 w-full px-8 md:px-12 py-6 flex justify-between items-center z-50 bg-background/70 backdrop-blur-md border-b border-foreground/5">
        <div className="flex gap-10 items-baseline">
          <Link href="/" className="text-2xl tracking-tight text-foreground hover:text-amber transition-colors font-display italic">MARA</Link>
          <div className="hidden md:flex gap-8 text-xs tracking-[0.2em] text-muted uppercase font-mono">
            <Link href="/terminal" className="hover:text-foreground transition-colors">Terminal</Link>
            <Link href="/duel" className="hover:text-foreground transition-colors">Duel</Link>
            <Link href="/replay" className="hover:text-foreground transition-colors">Replay</Link>
            <span className="text-foreground border-b border-foreground/30 pb-1">Edge</span>
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
        <div className="mb-14">
          <div className="font-mono text-xs tracking-[0.4em] text-muted uppercase mb-5 flex items-center gap-3">
            <Swords className="w-3.5 h-3.5" /> Four strategies · same real prints · zero lookahead
          </div>
          <h1 className="font-display text-6xl md:text-8xl leading-[0.9] tracking-tight">
            Proof of <span className="italic text-muted">Edge.</span>
          </h1>
          <p className="text-muted font-light text-lg mt-6 max-w-2xl font-sans">
            The question every judge should ask: <em className="text-foreground not-italic">where&apos;s the edge?</em>{' '}
            Here MARA&apos;s discipline runs head-to-head against a version of itself that never stands down,
            a naive surprise-chasing bot, and buy-and-hold — on the identical corpus of real macro prints,
            each decided using only history that existed before that day.
          </p>
        </div>

        {error && (
          <div className="border border-coral/40 p-10 font-mono text-[11px] text-coral tracking-widest uppercase mb-10">
            Engine unreachable — {error}
          </div>
        )}
        {!report && !error && (
          <div className="border border-glass-border p-16 text-center font-mono text-[11px] text-muted tracking-widest uppercase">
            Running the gauntlet…
          </div>
        )}

        {report && report.n > 0 && (
          <>
            {/* The restraint headline */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="border border-amber/30 bg-amber/[0.03] p-10 mb-12 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1/2 h-[1px] bg-gradient-to-r from-amber/60 to-transparent" />
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <div className="font-mono text-xs tracking-[0.3em] text-amber uppercase mb-4 flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5" /> The measured value of restraint
                  </div>
                  <div className="font-display text-5xl md:text-6xl text-foreground">
                    <AnimatedPct value={report.restraintValuePct} />{' '}
                    <span className="text-muted italic text-3xl md:text-4xl">from standing down</span>
                  </div>
                  <p className="font-sans text-muted text-sm leading-relaxed mt-4 max-w-2xl">
                    MARA declined {report.strategies.mara.stoodDown} of {report.n} prints — thin evidence, in-line
                    surprises, or a conviction below the regime&apos;s floor. This number is what that discipline was
                    worth versus being forced to trade every print. A system that only ever trades is lying about its edge.
                  </p>
                </div>
                <div className="font-mono text-xs tracking-widest uppercase text-muted shrink-0">
                  {report.window.from} → {report.window.to}<br />
                  {report.n} prints · 5 event families
                </div>
              </div>
            </motion.div>

            {/* Scoreboard */}
            <motion.div
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="grid md:grid-cols-2 xl:grid-cols-4 gap-px bg-foreground/10 border border-foreground/10 mb-12">
              {strategies.map(({ m, hero }) => (
                <div key={m.label} className={`bg-background p-7 ${hero ? 'relative' : ''}`}>
                  {hero && <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-amber to-transparent" />}
                  <div className={`font-mono text-xs tracking-[0.25em] uppercase mb-5 ${hero ? 'text-amber' : 'text-muted'}`}>
                    {m.label}
                  </div>
                  <div className={`font-mono text-4xl font-light mb-6 ${m.totalReturnPct >= 0 ? 'text-olive' : 'text-coral'}`}>
                    {pct(m.totalReturnPct)}
                  </div>
                  <div className="space-y-2.5 font-mono text-xs tracking-widest uppercase">
                    {([
                      ['Sharpe', m.sharpe !== null ? String(m.sharpe) : '—'],
                      ['· discounted ×0.5', m.sharpeDiscounted !== null ? String(m.sharpeDiscounted) : '—'],
                      ['Sortino', m.sortino !== null ? String(m.sortino) : '—'],
                      ['Max drawdown', pct(m.maxDrawdownPct, false)],
                      ['Win rate', m.winRate !== null ? `${m.winRate}%` : '—'],
                      ['Trades / stand-downs', `${m.tradesTaken} / ${m.stoodDown}`],
                    ] as const).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4">
                        <span className="text-muted">{k}</span>
                        <span className="text-foreground">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>

            <div className="grid lg:grid-cols-[1fr_420px] gap-8 mb-12">
              {/* Equity chart */}
              <div className="border border-glass-border bg-background/60 backdrop-blur-xl p-8">
                <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase mb-6">
                  Equity · start = 100 · compounded per print
                </div>
                {chart && (
                  <svg className="w-full h-72 text-muted" preserveAspectRatio="none" viewBox="0 0 100 100">
                    <line x1="0" x2="100" y1={chart.baseY} y2={chart.baseY} stroke="currentColor" strokeOpacity="0.2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" strokeDasharray="1 3" />
                    {chart.paths.map((p) => (
                      <path key={p.key} d={p.d} fill="none" stroke={p.stroke} strokeOpacity={p.key === 'buyHold' ? 0.55 : 1}
                        strokeWidth={p.key === 'mara' ? 1.6 : 1} strokeDasharray={p.dash} vectorEffect="non-scaling-stroke" />
                    ))}
                  </svg>
                )}
                <div className="flex flex-wrap gap-x-8 gap-y-2 mt-6 font-mono text-[11px] tracking-widest uppercase">
                  {LINES.map((l) => (
                    <span key={l.key} className="flex items-center gap-2 text-muted">
                      <svg width="22" height="6"><line x1="0" x2="22" y1="3" y2="3" stroke={l.stroke === 'currentColor' ? 'var(--color-foreground)' : l.stroke} strokeOpacity={l.key === 'buyHold' ? 0.55 : 1} strokeWidth={l.key === 'mara' ? 2.2 : 1.4} strokeDasharray={l.dash} /></svg>
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Per-regime honesty table */}
              <div className="space-y-8">
                <div className="mara-glass p-6">
                  <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase mb-5">
                    Regime by regime · honest column included
                  </div>
                  <div className="space-y-3">
                    {report.perRegime.map((r) => (
                      <div key={r.regime} className="flex items-center justify-between gap-3 font-mono text-xs tracking-widest uppercase border-b border-glass-border/60 pb-3 last:border-0">
                        <span className="text-foreground">{r.regime}<span className="text-muted ml-2">×{r.prints}</span></span>
                        <span className="flex gap-4">
                          <span className={r.maraRetPct >= 0 ? 'text-olive' : 'text-coral'}>M {pct(r.maraRetPct)}</span>
                          <span className="text-muted">B&H {pct(r.buyHoldRetPct)}</span>
                          <span className={r.maraWins ? 'text-amber' : 'text-muted'}>{r.maraWins ? '◆' : '◇'}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="font-sans text-[11px] text-muted leading-relaxed mt-4">
                    ◆ = MARA ahead in that regime, ◇ = buy-and-hold ahead. Both symbols appear because
                    this is a measurement, not a pitch.
                  </p>
                </div>

                <div className="mara-glass p-6">
                  <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase mb-4">
                    Monte Carlo · {report.monteCarlo.paths} bootstrap paths
                  </div>
                  <div className="flex gap-10 font-mono">
                    <div>
                      <div className="text-[11px] text-muted tracking-[0.3em] uppercase mb-1">VaR 95</div>
                      <div className="text-2xl font-light text-foreground">{pct(report.monteCarlo.var95Pct)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted tracking-[0.3em] uppercase mb-1">CVaR 95</div>
                      <div className="text-2xl font-light text-foreground">{pct(report.monteCarlo.cvar95Pct)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stand-down ledger */}
            <motion.div
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="border border-glass-border bg-background/60 backdrop-blur-xl p-8 mb-12">
              <div className="flex items-center justify-between mb-6">
                <div className="font-mono text-xs tracking-[0.3em] text-muted uppercase flex items-center gap-2">
                  <TrendingDown className="w-3.5 h-3.5" /> The stand-down ledger — every print MARA refused, and why
                </div>
                <div className="font-mono text-xs text-muted tracking-widest uppercase">{report.standDowns.length} refusals</div>
              </div>
              <div className="max-h-80 overflow-y-auto pr-2 space-y-0">
                {report.standDowns.map((s, i) => (
                  <div key={`${s.date}-${s.eventType}-${i}`} className="grid grid-cols-[90px_90px_1fr_110px] gap-4 items-baseline py-2.5 border-b border-glass-border/50 last:border-0 font-mono text-xs">
                    <span className="text-muted tracking-widest">{s.date}</span>
                    <span className="text-foreground tracking-widest uppercase">{s.eventType}</span>
                    <span className="text-muted font-sans text-[11px] normal-case tracking-normal">{s.reason}</span>
                    <span className={`text-right tracking-widest ${s.dodgedRetPct === null ? 'text-muted' : s.dodgedRetPct < 0 ? 'text-olive' : 'text-coral'}`}>
                      {s.dodgedRetPct === null ? '—' : s.dodgedRetPct < 0 ? `dodged ${s.dodgedRetPct.toFixed(2)}%` : `missed +${s.dodgedRetPct.toFixed(2)}%`}
                    </span>
                  </div>
                ))}
              </div>
              <p className="font-sans text-[11px] text-muted leading-relaxed mt-5">
                Green rows are losses the discipline dodged; red rows are gains it missed. Both are shown —
                the counterfactual line in the chart is the sum of this ledger.
              </p>
            </motion.div>

            {/* Don't take our word for it — verify everything yourself */}
            <motion.div
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="border border-olive/30 bg-olive/[0.03] p-8 mb-12 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-1/2 h-[1px] bg-gradient-to-r from-olive/60 to-transparent" />
              <div className="font-mono text-[11px] tracking-[0.3em] text-olive uppercase mb-6 flex items-center gap-2">
                <Link2 className="w-4 h-4" /> Don&apos;t take this page&apos;s word for it
              </div>
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <div className="font-mono text-xs text-muted tracking-[0.25em] uppercase mb-2">On-chain attestation · ValueChain testnet</div>
                  <p className="font-sans text-sm text-muted leading-relaxed mb-3">
                    Every MARA decision hash lands on a public chain (chainId 138565) this server can&apos;t rewrite.
                    {chain && typeof chain.totalAttestations === 'number' ? <> Live contract reads: <span className="text-foreground">{String(chain.totalAttestations)} attestations recorded.</span></> : null}
                  </p>
                  <div className="space-y-2">
                    <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 font-mono text-sm text-amber hover:text-foreground transition-colors">
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" /> Contract {CONTRACT.slice(0, 10)}… on the explorer
                    </a>
                    <a href={`${EXPLORER}/address/${OPERATOR}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 font-mono text-sm text-amber hover:text-foreground transition-colors">
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" /> Operator wallet {OPERATOR.slice(0, 10)}…
                    </a>
                  </div>
                </div>
                <div>
                  <div className="font-mono text-xs text-muted tracking-[0.25em] uppercase mb-2">The raw numbers</div>
                  <p className="font-sans text-sm text-muted leading-relaxed mb-3">
                    Everything rendered above comes from one JSON document. Open it, recompute anything.
                  </p>
                  <a href={`${API_BASE}/api/edge`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-2 font-mono text-sm border border-amber/40 text-amber px-4 py-2 hover:bg-amber/10 transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" /> GET /api/edge (raw JSON)
                  </a>
                </div>
                <div>
                  <div className="font-mono text-xs text-muted tracking-[0.25em] uppercase mb-2 flex items-center gap-2"><Terminal className="w-3.5 h-3.5" /> From your own terminal</div>
                  <div className="bg-background border border-glass-border p-3 font-mono text-[11px] text-foreground/90 leading-relaxed overflow-x-auto whitespace-pre">
{`curl ${API_BASE}/api/edge \\
  | jq .restraintValuePct

curl -X POST https://testnet.valuechain.xyz \\
  -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,
   "method":"eth_getCode",
   "params":["${CONTRACT.slice(0, 20)}…","latest"]}'`}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Method + caveats */}
            <motion.div
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10%' }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="grid md:grid-cols-2 gap-8"
            >
              <div className="border border-glass-border p-6 font-sans text-sm text-muted leading-relaxed">
                <span className="text-foreground font-mono text-xs tracking-[0.3em] uppercase block mb-2">Method</span>
                {report.method}
              </div>
              <div className="border border-glass-border p-6 font-sans text-sm text-muted leading-relaxed">
                <span className="text-foreground font-mono text-xs tracking-[0.3em] uppercase block mb-2">Caveats — read them</span>
                <ul className="list-disc pl-4 space-y-1.5">
                  {report.caveats.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            </motion.div>
          </>
        )}

        {report && report.n === 0 && (
          <div className="border border-glass-border p-16 text-center font-mono text-[11px] text-muted tracking-widest uppercase">
            Corpus is empty — the gauntlet needs seeded history. {report.caveats[0]}
          </div>
        )}
      </main>
    </div>
  );
}
