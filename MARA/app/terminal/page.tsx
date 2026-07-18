'use client';

import { motion } from 'motion/react';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import { CognitionCanvas, type CognitionItem } from '@/components/terminal/CognitionCanvas';
import { GuillocheArt } from '@/components/terminal/GuillocheArt';
import { AccountMenu } from '@/components/AccountMenu';
import { openOnboarding } from '@/components/Onboarding';
import {
  api, createWebSocket, timeAgo, convictionTone,
  type BackendDecision, type BackendTrade, type BackendRisk, type BackendMarkets, type BackendNewsItem, type BackendDiag,
} from '@/lib/api';

export default function TerminalPage() {
  const [time, setTime] = useState<string>('');
  const [wsLive, setWsLive] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [items, setItems] = useState<CognitionItem[]>([]);
  const [latestDecision, setLatestDecision] = useState<BackendDecision | null>(null);
  const [latestTrade, setLatestTrade] = useState<BackendTrade | null>(null);
  const [risk, setRisk] = useState<BackendRisk | null>(null);
  const [markets, setMarkets] = useState<BackendMarkets | null>(null);
  const [news, setNews] = useState<BackendNewsItem[]>([]);
  const [aiLatency, setAiLatency] = useState<number | null>(null);
  const seq = useRef(0);

  const pushItem = (item: Omit<CognitionItem, 'id'>) => {
    seq.current += 1;
    setItems((prev) => [{ ...item, id: `${Date.now()}-${seq.current}` }, ...prev].slice(0, 12));
  };

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toISOString().split('T')[1].slice(0, -1) + 'Z');
    };
    update();
    const int = setInterval(update, 1000);
    return () => clearInterval(int);
  }, []);

  // Initial engine state
  useEffect(() => {
    void api.decisions().then((ds) => {
      if (ds.length > 0) {
        setLatestDecision(ds[0]);
        setItems(ds.slice(0, 4).map((d, i) => ({
          id: `seed-${i}`,
          node: `DECISION ${d.id.slice(0, 8).toUpperCase()}`,
          text: d.reasoning.length > 180 ? d.reasoning.slice(0, 177) + '…' : d.reasoning,
          conf: `${d.confidence}%`,
          type: convictionTone(d.conviction) === 'bear' ? 'alert' : convictionTone(d.conviction) === 'bull' ? 'warn' : 'info',
        })));
      }
    }).catch(() => {});
    void api.trades().then((ts) => { if (ts.length > 0) setLatestTrade(ts[0]); }).catch(() => {});
    void api.risk().then(setRisk).catch(() => {});
    void api.news().then(setNews).catch(() => {});
    void api.diag().then((d: BackendDiag) => {
      const gem = d.checks.find((c) => c.name === 'gemini');
      setAiLatency(gem?.latencyMs ?? null);
    }).catch(() => {});
    const marketPoll = () => void api.markets().then(setMarkets).catch(() => {});
    marketPoll();
    const mi = setInterval(marketPoll, 15_000);
    return () => clearInterval(mi);
  }, []);

  // Live WebSocket — the cognition stream is the real agent
  useEffect(() => {
    const dispose = createWebSocket((msg) => {
      switch (msg.type) {
        case 'init':
          setKillSwitch(msg.data.killSwitch);
          break;
        case 'agent_trace':
          pushItem({
            node: `TRACE ${String(msg.data.step).padStart(2, '0')}${msg.data.tool ? ` · ${msg.data.tool}` : ''}`,
            text: msg.data.summary,
            conf: msg.data.kind === 'final' ? 'VERDICT' : msg.data.kind === 'error' ? 'ERROR' : msg.data.kind === 'tool_call' ? 'TOOL' : 'THINK',
            type: msg.data.kind === 'error' ? 'alert' : msg.data.kind === 'final' ? 'warn' : 'info',
          });
          break;
        case 'decision':
          setLatestDecision(msg.data);
          pushItem({
            node: `DECISION ${msg.data.id.slice(0, 8).toUpperCase()}`,
            text: msg.data.reasoning.length > 180 ? msg.data.reasoning.slice(0, 177) + '…' : msg.data.reasoning,
            conf: `${msg.data.confidence}%`,
            type: convictionTone(msg.data.conviction) === 'bear' ? 'alert' : 'warn',
          });
          break;
        case 'trade':
          setLatestTrade(msg.data);
          break;
        case 'risk':
          setRisk((prev) => ({ ...(prev ?? {} as BackendRisk), ...msg.data }));
          break;
        case 'event_fired':
          pushItem({
            node: 'EVENT FIRED',
            text: `${msg.data.name} printed ${msg.data.actual ?? '—'} vs forecast ${msg.data.forecast ?? '—'}. Pipeline engaged.`,
            conf: 'LIVE',
            type: 'alert',
          });
          break;
        case 'status':
          setKillSwitch(msg.data.killSwitch);
          break;
      }
    }, () => setWsLive(true), () => setWsLive(false));
    return dispose;
  }, []);

  const drawdown = risk ? Math.min(100, (risk.drawdownPercent / (risk.limits?.maxDrawdownPct ?? 5)) * 100) : 0;
  const tickers = markets?.markets.slice(0, 4) ?? [];

  return (
    <div className="min-h-screen bg-background overflow-hidden relative selection:bg-amber/20 selection:text-amber">

      {/* Top Bar */}
      <header className="fixed top-0 w-full px-12 py-8 flex justify-between items-baseline z-50 pointer-events-none border-b border-foreground/5">
        <div className="flex gap-12 items-baseline pointer-events-auto">
          <Link href="/" className="text-2xl tracking-tight text-foreground hover:text-amber transition-colors font-display italic">MARA</Link>
          <div className="hidden md:flex gap-8 text-[10px] tracking-[0.2em] text-muted uppercase font-medium">
            <span className="text-foreground border-b border-foreground/30 pb-1">Cognition</span>
            <Link href="/duel" className="text-amber hover:text-foreground transition-colors cursor-pointer">Duel</Link>
            <Link href="/replay" className="hover:text-foreground transition-colors cursor-pointer">Replay</Link>
            <Link href="/edge" className="hover:text-foreground transition-colors cursor-pointer">Edge</Link>
            <Link href="/portfolio" className="hover:text-foreground transition-colors cursor-pointer">Portfolio</Link>
          </div>
        </div>

        <div className="flex gap-6 items-center pointer-events-auto">
          <button onClick={openOnboarding} aria-label="How it works" className="text-muted hover:text-amber transition-colors">
            <HelpCircle className="w-4 h-4" />
          </button>
          <div className="flex flex-col items-end">
            <span className="text-[10px] font-mono text-muted">{time || '—'}</span>
            <span className={`text-[9px] font-mono tracking-widest mt-1 ${killSwitch ? 'text-coral' : wsLive ? 'text-amber' : 'text-muted'}`}>
              {killSwitch ? 'KILL SWITCH ENGAGED' : wsLive ? 'CORE STATUS: SYNCHRONIZED' : 'CORE STATUS: LINKING…'}
            </span>
          </div>
          <div className="w-8 h-8 rounded-full border border-foreground/20 flex items-center justify-center">
            <div className={`w-1.5 h-1.5 rounded-full ${killSwitch ? 'bg-coral shadow-[0_0_8px_var(--color-coral)]' : wsLive ? 'bg-amber shadow-[0_0_8px_var(--color-amber)] animate-pulse' : 'bg-muted'}`} />
          </div>
          <AccountMenu />
        </div>
      </header>

      {/* Main Terminal Area */}
      <main className="relative h-[calc(100vh-80px)] w-full pt-16 px-12 pb-24 overflow-hidden flex flex-col md:block">

        {/* Massive Typography Overlay */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-0 mix-blend-soft-light opacity-10">
          <h1 className="text-[200px] leading-[0.8] tracking-tighter font-display italic">
            Macro<br/>Intelligence
          </h1>
        </div>

        {/* Guilloche Art / The Core Object */}
        <motion.div layoutId="core-object" className="absolute top-1/2 right-[-100px] -translate-y-1/2 w-[1000px] h-[1000px] z-0 pointer-events-none">
          <div className="absolute inset-0 bg-amber/5 rounded-full blur-[120px]" />
          <GuillocheArt />
        </motion.div>

        {/* Spatial UI Floating Cards — latest verdict + real risk state */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-10" style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}>
          <motion.div
            className="absolute top-[25%] right-[30%] w-72 bg-[#161412]/40 backdrop-blur-md border border-[#F6F1E9]/10 p-6 shadow-2xl"
            animate={{
              translateZ: [0, 60, 0],
              rotateX: [10, -5, 10],
              rotateY: [-15, 5, -15]
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          >
             <div className="text-[9px] font-mono text-amber tracking-widest uppercase mb-3">
               {latestDecision ? `Verdict · ${timeAgo(latestDecision.timestamp)}` : 'Verdict'}
             </div>
             <div className="text-2xl font-display text-foreground leading-tight">
               {latestDecision
                 ? `${latestDecision.marketContext?.eventName ?? 'Macro event'}: ${latestDecision.conviction.replace('_', ' ')}.`
                 : 'No verdict yet — the calendar is quiet.'}
             </div>
          </motion.div>

          <motion.div
            className="absolute top-[65%] left-[30%] w-64 bg-[#161412]/40 backdrop-blur-md border border-[#F6F1E9]/10 p-6 shadow-2xl"
            animate={{
              translateZ: [-20, 40, -20],
              rotateX: [-10, 15, -10],
              rotateY: [10, -10, 10]
            }}
            transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          >
             <div className="text-[9px] font-mono text-coral tracking-widest uppercase mb-3">Drawdown vs limit</div>
             <div className="text-xl font-mono text-foreground mb-4">
               {risk ? `${risk.drawdownPercent.toFixed(2)}% / ${risk.limits?.maxDrawdownPct ?? 5}%` : '—'}
             </div>
             <div className="h-1.5 w-full bg-[#090807] overflow-hidden rounded-full">
               <div className="h-full bg-coral transition-all duration-1000" style={{ width: `${drawdown}%` }} />
             </div>
          </motion.div>
        </div>

        {/* Floating Cognition Stream */}
        <motion.div
          className="relative z-10 w-[450px] mt-12 md:absolute md:top-24 md:left-12 flex flex-col gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.2 }}
        >
          <div className="flex flex-col">
            <span className="text-[10px] tracking-[0.3em] text-muted mb-6 uppercase">Processor // 01</span>
            <h2 className="text-5xl leading-[1.05] text-foreground font-display italic">
              Autonomous<br/>Reasoning
            </h2>
          </div>

          <CognitionCanvas items={items} />

          <div className="pt-2">
            <div className="flex items-center gap-4 mb-3">
              <span className="text-[9px] font-mono text-muted whitespace-nowrap tracking-[0.2em]">LIVE FEED</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-foreground/20 to-transparent" />
              <span className={`text-[9px] font-mono tracking-[0.2em] ${wsLive ? 'text-amber' : 'text-muted'}`}>
                {wsLive ? 'WS CONNECTED' : 'RECONNECTING'}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Execution & Data block */}
        <motion.div
          className="relative z-20 mt-16 md:absolute md:bottom-24 md:left-[500px] flex gap-16 items-end"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, delay: 0.4 }}
        >
          <div className="flex gap-12 border-l border-foreground/10 pl-8">
            <div className="flex flex-col">
              <span className="text-[9px] text-muted tracking-[0.2em] uppercase mb-2">Confidence</span>
              <span className="text-3xl font-mono text-foreground font-light">
                {latestDecision ? `${latestDecision.confidence}%` : '—'}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-muted tracking-[0.2em] uppercase mb-2">AI latency</span>
              <span className="text-3xl font-mono text-amber font-light">
                {aiLatency !== null ? `${aiLatency}ms` : '—'}
              </span>
            </div>
          </div>

          {/* Execution Feed — the latest real order */}
          <div className={`w-[300px] bg-secondary/80 backdrop-blur-xl border-l-2 p-6 ${latestTrade ? 'border-coral' : 'border-glass-border'}`}>
            {latestTrade ? (
              <div>
                <div className="text-[9px] font-mono text-coral mb-2 uppercase tracking-widest">
                  {latestTrade.status === 'OPEN' ? 'Position Open' : `Position ${latestTrade.status.toLowerCase()}`}
                </div>
                <div className="text-xl font-mono tracking-tight text-foreground mb-1">
                  {latestTrade.side} {latestTrade.symbol} ×{latestTrade.leverage ?? 1}
                </div>
                <div className="text-[10px] font-mono text-muted">
                  entry {latestTrade.entryPrice ?? '—'} · P&L {latestTrade.pnl !== null ? `${latestTrade.pnl >= 0 ? '+' : ''}${latestTrade.pnl.toFixed(2)}` : 'live'}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-[9px] font-mono text-muted mb-2 uppercase tracking-widest">Execution idle</div>
                <div className="text-sm font-sans text-muted leading-relaxed">
                  No live orders. The risk engine only commits capital when a verdict clears every gate.
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Market Matrix — real SoDEX tickers */}
        <motion.div
          className="relative z-20 mt-16 md:absolute md:top-24 md:right-12 w-[240px]"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1.2, delay: 0.6 }}
        >
          <div className="flex flex-col items-end text-right mb-8">
            <span className="text-[10px] tracking-[0.3em] text-muted mb-4 uppercase">Engine // 04</span>
            <h3 className="text-2xl leading-[1.1] text-foreground font-display italic">Live Markets</h3>
          </div>

          <div className="grid grid-cols-2 gap-px bg-foreground/10 border border-foreground/10 rounded-sm">
            {(tickers.length > 0 ? tickers : [null, null, null, null]).map((t, i) => (
              <div key={t?.symbol ?? i} className="bg-background/80 backdrop-blur-xl p-5 hover:bg-card transition-colors">
                <span className="block text-[9px] text-muted mb-2 uppercase tracking-widest">{t?.symbol ?? '—'}</span>
                <span className="text-lg font-mono text-foreground block truncate">
                  {t ? t.price.toLocaleString(undefined, { maximumFractionDigits: t.price > 100 ? 0 : 2 }) : '—'}
                </span>
                {t?.changePct !== null && t?.changePct !== undefined && (
                  <span className={`text-[10px] font-mono ${t.changePct >= 0 ? 'text-olive' : 'text-coral'}`}>
                    {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </motion.div>

      </main>

      {/* Bottom Bar: real headline ticker */}
      <footer className="fixed bottom-0 w-full z-50 px-12 py-4 border-t border-foreground/5 flex justify-between items-center bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-6 w-2/3">
          <div className="flex items-center gap-2 shrink-0">
            <div className={`w-1.5 h-1.5 rounded-full ${wsLive ? 'bg-coral animate-pulse' : 'bg-muted'}`} />
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-foreground">
              {wsLive ? 'Live Stream Active' : 'Stream Reconnecting'}
            </span>
          </div>
          <div className="h-4 w-[1px] bg-foreground/20 shrink-0" />
          <span className="text-[10px] font-mono text-muted overflow-hidden whitespace-nowrap overflow-ellipsis uppercase">
            {news.length > 0
              ? news.map((n) => n.title).join(' // ')
              : 'SOSOVALUE NEWS FEED SYNCING…'}
          </span>
        </div>
        <div className="flex gap-8 text-[9px] font-mono tracking-widest text-muted">
          <Link href="/portfolio" className="text-foreground cursor-pointer uppercase hover:text-amber transition-colors">Portfolio Desk</Link>
          <Link href="/replay" className="hover:text-foreground cursor-pointer uppercase transition-colors">Audit Log</Link>
        </div>
      </footer>
    </div>
  );
}
