'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Activity, X, ShieldAlert, ShieldCheck, HelpCircle } from 'lucide-react';
import { useEnvironment } from '@/components/context/EnvironmentContext';
import { motion, AnimatePresence } from 'motion/react';
import { AccountMenu } from '@/components/AccountMenu';
import { openOnboarding } from '@/components/Onboarding';
import {
  api, portfolioApi, createWebSocket, timeAgo,
  type BackendTrade, type BackendRisk, type BackendMarkets, type BackendNewsItem,
  type BackendDiag, type BackendDecision, type BackendPerformanceSummary,
  type BackendAccount, type BackendEtfFlows, type BackendBacktest,
} from '@/lib/api';

type DeskTab = 'positions' | 'exchange' | 'etf' | 'quant';

interface LogRow { id: string; time: string; tag: string; text: string; tone: 'bull' | 'bear' | 'flat' }

/** Deterministic sparkline path per symbol — decorative texture, not data. */
function sparkPath(seedStr: string): string {
  let seed = 0;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
  const pts = [...Array(6)].map((_, i) => {
    seed = (seed * 137 + 71) % 997;
    return `${i * 20},${4 + (seed % 14)}`;
  });
  return `M${pts.join(' L')}`;
}

export default function PortfolioPage() {
  const { volatility, marketTrend, regime } = useEnvironment();
  const [time, setTime] = useState('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [trades, setTrades] = useState<BackendTrade[]>([]);
  const [selectedPos, setSelectedPos] = useState<BackendTrade | null>(null);
  const [risk, setRisk] = useState<BackendRisk | null>(null);
  const [markets, setMarkets] = useState<BackendMarkets | null>(null);
  const [news, setNews] = useState<BackendNewsItem[]>([]);
  const [diag, setDiag] = useState<BackendDiag | null>(null);
  const [latestDecision, setLatestDecision] = useState<BackendDecision | null>(null);
  const [perf, setPerf] = useState<BackendPerformanceSummary | null>(null);

  const [sortConfig, setSortConfig] = useState<{ key: 'symbol' | 'pnl', direction: 'asc' | 'desc' } | null>(null);
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);

  // Wave 5 desk tabs: exchange-truth, institutional flows, quant
  const [deskTab, setDeskTab] = useState<DeskTab>('positions');
  const [account, setAccount] = useState<BackendAccount | null>(null);
  const [etfBtc, setEtfBtc] = useState<BackendEtfFlows | null>(null);
  const [etfEth, setEtfEth] = useState<BackendEtfFlows | null>(null);
  const [etfSymbol, setEtfSymbol] = useState<'BTC' | 'ETH'>('BTC');
  const [backtest, setBacktest] = useState<BackendBacktest | null>(null);

  // Fire Live Run form
  const [runEvent, setRunEvent] = useState('CPI YoY');
  const [runActual, setRunActual] = useState('3.4');
  const [runForecast, setRunForecast] = useState('3.2');
  const [runState, setRunState] = useState<string | null>(null);
  const seq = useRef(0);

  const pushLog = (tag: string, text: string, tone: LogRow['tone']) => {
    seq.current += 1;
    setLogs((prev) => [{
      id: `${Date.now()}-${seq.current}`,
      time: new Date().toISOString().substring(11, 19),
      tag, text, tone,
    }, ...prev].slice(0, 25));
  };

  useEffect(() => {
    const updateTime = () => {
      setTime(new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initial state + polling
  useEffect(() => {
    const load = () => {
      void api.trades().then(setTrades).catch(() => {});
      void api.risk().then(setRisk).catch(() => {});
      void api.markets().then(setMarkets).catch(() => {});
      void portfolioApi.account().then(setAccount).catch(() => {});
    };
    load();
    void api.news().then(setNews).catch(() => {});
    void api.diag().then(setDiag).catch(() => {});
    void api.perfSummary().then(setPerf).catch(() => {});
    void portfolioApi.etf('BTC').then(setEtfBtc).catch(() => {});
    void portfolioApi.etf('ETH').then(setEtfEth).catch(() => {});
    void portfolioApi.backtest().then(setBacktest).catch(() => {});
    void api.decisions().then((ds) => {
      if (ds.length) {
        setLatestDecision(ds[0]);
        ds.slice(0, 6).reverse().forEach((d) => pushLog(
          d.action === 'NO_TRADE' ? 'PASS' : d.action,
          `${d.marketContext?.eventName ?? 'Event'} → ${d.conviction.replace('_', ' ')} (${d.confidence}%)`,
          d.action === 'LONG' ? 'bull' : d.action === 'SHORT' ? 'bear' : 'flat',
        ));
      }
    }).catch(() => {});
    const poll = setInterval(load, 30_000);
    return () => clearInterval(poll);
  }, []);

  // Live WebSocket
  useEffect(() => {
    const dispose = createWebSocket((msg) => {
      switch (msg.type) {
        case 'decision':
          setLatestDecision(msg.data);
          pushLog(
            msg.data.action === 'NO_TRADE' ? 'PASS' : msg.data.action,
            `${msg.data.marketContext?.eventName ?? 'Event'} → ${msg.data.conviction.replace('_', ' ')} (${msg.data.confidence}%)`,
            msg.data.action === 'LONG' ? 'bull' : msg.data.action === 'SHORT' ? 'bear' : 'flat',
          );
          break;
        case 'trade':
          setTrades((prev) => [msg.data, ...prev.filter((t) => t.id !== msg.data.id)]);
          pushLog(msg.data.side, `${msg.data.symbol} ${msg.data.status} @ ${msg.data.entryPrice ?? 'mkt'}`, msg.data.side === 'LONG' ? 'bull' : 'bear');
          break;
        case 'risk':
          setRisk((prev) => ({ ...(prev ?? {} as BackendRisk), ...msg.data }));
          break;
        case 'event_fired':
          pushLog('EVENT', `${msg.data.name}: ${msg.data.actual ?? '—'} vs ${msg.data.forecast ?? '—'}`, 'flat');
          break;
        case 'agent_trace':
          if (msg.data.kind === 'tool_call' || msg.data.kind === 'final') {
            pushLog('AGENT', msg.data.summary.slice(0, 90), 'flat');
          }
          break;
      }
    });
    return dispose;
  }, []);

  const fireRun = async () => {
    setRunState('Firing the live pipeline…');
    try {
      const res = await api.trigger({
        event: runEvent,
        actual: parseFloat(runActual),
        forecast: parseFloat(runForecast),
      });
      setRunState(res.message ?? res.error ?? (res.ok ? 'Pipeline engaged — watch the log.' : 'Rejected'));
      if (res.ok) setTimeout(() => { setIsTradeModalOpen(false); setRunState(null); }, 2500);
    } catch (e) {
      setRunState(e instanceof Error ? e.message : 'Trigger failed');
    }
  };

  const toggleKill = async () => {
    if (!risk) return;
    if (risk.killSwitchActive) await api.resetKillSwitch();
    else await api.killSwitch();
    void api.risk().then(setRisk).catch(() => {});
  };

  const sortedTrades = [...trades].sort((a, b) => {
    if (!sortConfig) return 0;
    const va = sortConfig.key === 'pnl' ? (a.pnl ?? 0) : a.symbol;
    const vb = sortConfig.key === 'pnl' ? (b.pnl ?? 0) : b.symbol;
    if (va < vb) return sortConfig.direction === 'asc' ? -1 : 1;
    if (va > vb) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: 'symbol' | 'pnl') => {
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const tickers = markets?.markets.slice(0, 4) ?? [];
  const diagChecks = (diag?.checks ?? []).filter((c) => ['sosovalue', 'sodex', 'gemini'].includes(c.name)).slice(0, 3);
  const equity = perf?.equity ?? [];

  // Equity curve SVG path from real points
  const eqPath = (() => {
    if (equity.length < 2) return null;
    const vals = equity.map((p) => p.value);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    return equity.map((p, i) => {
      const x = (i / (equity.length - 1)) * 100;
      const y = 90 - ((p.value - min) / range) * 80;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  })();

  return (
    <div className="min-h-screen bg-background text-foreground font-mono selection:bg-amber/20 selection:text-amber overflow-hidden flex flex-col relative z-10">

      {/* Global filter reacting to REAL volatility */}
      <motion.div
        className="absolute inset-0 pointer-events-none mix-blend-overlay z-0"
        animate={{
          backgroundColor: volatility > 0.6
            ? `rgba(200, 60, 20, ${volatility * 0.2})`
            : `rgba(255, 179, 71, ${volatility * 0.1})`,
        }}
        transition={{ duration: 2 }}
      />

      {/* Top Header */}
      <header className="h-12 border-b border-glass-border flex items-center px-4 justify-between bg-[#090807] shrink-0 z-50 shadow-md">
        <div className="flex items-center gap-6 text-[10px] tracking-widest text-muted uppercase">
          <Link href="/" className="hover:text-amber transition-colors flex items-center gap-2">
            <span className="w-2 h-2 bg-foreground rounded-sm inline-block" />
            SYS_MENU
          </Link>
          <span className="text-glass-border">|</span>
          <span className="text-amber">PORTFOLIO_DESK</span>
          <span className="text-glass-border">|</span>
          <span>VOL: {regime ? `${regime.realizedVolAnnual.toFixed(1)}%` : '—'}</span>
          <span className="text-glass-border">|</span>
          <span className={marketTrend === 'bullish' ? 'text-olive' : 'text-coral'}>
            REGIME: {regime ? regime.regime.replace('_', ' ') : 'SYNCING'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] tracking-widest text-muted">
          <Link href="/duel" className="text-amber hover:text-foreground transition-colors uppercase">Duel</Link>
          <Link href="/replay" className="hover:text-foreground transition-colors uppercase">Replay</Link>
          <Link href="/edge" className="hover:text-foreground transition-colors uppercase">Edge</Link>
          <button onClick={openOnboarding} aria-label="Help" className="hover:text-amber transition-colors"><HelpCircle className="w-3.5 h-3.5" /></button>
          <span className="hidden md:inline">{time}</span>
          <AccountMenu />
        </div>
      </header>

      {/* Main Grid Layout */}
      <main className="flex-1 p-2 flex gap-2 overflow-hidden h-[calc(100vh-48px)]">

        {/* Left Sidebar */}
        <aside className="w-64 flex flex-col gap-2 shrink-0">
          <div className="mara-glass p-4 flex-1 overflow-y-auto">
            <div className="text-[9px] text-muted tracking-widest uppercase mb-4 border-b border-glass-border pb-2">Desks</div>
            <ul className="space-y-1 text-xs">
              {[
                { label: 'Portfolio (this desk)', href: '/portfolio', active: true },
                { label: 'Cognition Terminal', href: '/terminal', active: false },
                { label: 'Signal Duel', href: '/duel', active: false },
                { label: 'Time Machine', href: '/replay', active: false },
                { label: 'Proof of Edge', href: '/edge', active: false },
              ].map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={`block p-2 cursor-pointer transition-colors ${item.active ? 'bg-amber/10 text-amber border-l-2 border-amber' : 'text-muted hover:bg-foreground/5 hover:text-foreground'}`}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div className="text-[9px] text-muted tracking-widest uppercase mt-8 mb-4 border-b border-glass-border pb-2">Data Plane · Live Probes</div>
            <div className="space-y-4">
              {diagChecks.length === 0 && (
                <div className="text-[10px] text-muted">probing…</div>
              )}
              {diagChecks.map((c) => (
                <div key={c.name}>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-muted uppercase">{c.name}</span>
                    <span className={c.ok ? 'text-foreground' : 'text-coral'}>
                      {c.ok ? `${c.latencyMs ?? '—'}ms` : 'DOWN'}
                    </span>
                  </div>
                  <div className="h-1 bg-background rounded-full overflow-hidden">
                    <div
                      className={`h-full ${c.ok ? 'bg-amber' : 'bg-coral'}`}
                      style={{ width: `${c.ok ? Math.max(8, Math.min(100, 100 - (c.latencyMs ?? 0) / 20)) : 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Kill switch — the real one */}
            <div className="text-[9px] text-muted tracking-widest uppercase mt-8 mb-4 border-b border-glass-border pb-2">Master Control</div>
            <button
              onClick={() => void toggleKill()}
              className={`w-full flex items-center justify-center gap-2 border py-2.5 text-[10px] tracking-[0.2em] uppercase transition-colors ${
                risk?.killSwitchActive
                  ? 'border-coral/40 text-coral hover:bg-coral/10'
                  : 'border-glass-border text-muted hover:text-coral hover:border-coral/40'
              }`}
            >
              {risk?.killSwitchActive ? <ShieldAlert className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
              {risk?.killSwitchActive ? 'KILL ACTIVE — RESET' : 'KILL SWITCH'}
            </button>
          </div>

          <div className="mara-glass p-4 shrink-0 bg-background/40">
             <div className="text-[9px] text-muted tracking-widest uppercase mb-2">Account (SoDEX testnet)</div>
             <div className="text-2xl text-foreground font-light tracking-tight">
               {risk ? `$${(risk.liveBalance ?? risk.accountBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
             </div>
             <div className={`text-xs mt-1 flex items-center gap-1 ${risk && risk.cumulativePnl >= 0 ? 'text-olive' : 'text-coral'}`}>
               <ArrowUpRight className="w-3 h-3"/>
               {risk ? `${risk.cumulativePnl >= 0 ? '+' : ''}${risk.cumulativePnl.toFixed(2)} cumulative P&L` : 'syncing'}
             </div>
          </div>
        </aside>

        {/* Center */}
        <section className="flex-1 flex flex-col gap-2 min-w-0 relative">
          {/* Real tickers */}
          <div className="flex gap-2 h-32 shrink-0">
            {(tickers.length > 0 ? tickers : [null, null, null, null]).map((t, i) => (
              <div key={t?.symbol ?? i} className="flex-1 mara-glass p-4 flex flex-col justify-between relative overflow-hidden group">
                <div className="text-[10px] text-muted tracking-widest uppercase">{t?.symbol ?? '—'}</div>
                <div>
                  <div className="text-xl text-foreground tracking-tight">
                    {t ? t.price.toLocaleString(undefined, { maximumFractionDigits: t.price > 100 ? 0 : 2 }) : '—'}
                  </div>
                  <div className={`text-xs mt-1 ${t && (t.changePct ?? 0) >= 0 ? 'text-olive' : 'text-coral'}`}>
                    {t && t.changePct !== null ? `${t.changePct >= 0 ? '+' : ''}${t.changePct.toFixed(2)}%` : ''}
                  </div>
                </div>
                {t && (
                  <svg className="absolute bottom-0 left-0 w-full h-12 opacity-30 group-hover:opacity-60 transition-opacity" preserveAspectRatio="none" viewBox="0 0 100 20">
                    <path d={sparkPath(t.symbol)} fill="none" stroke="currentColor" strokeWidth="1" className={(t.changePct ?? 0) >= 0 ? 'text-olive' : 'text-coral'} />
                  </svg>
                )}
              </div>
            ))}
          </div>

          {/* Positions table — REAL trades */}
          <div className="flex-1 mara-glass p-0 flex flex-col min-h-0 relative overflow-hidden bg-background/20">
             <div className="h-8 border-b border-glass-border flex items-center px-4 justify-between bg-foreground/[0.02]">
               <div className="flex items-center gap-1">
                 {([
                   ['positions', risk ? `Agent Positions · ${risk.openPositions} open` : 'Agent Positions'],
                   ['exchange', 'Exchange · SoDEX'],
                   ['etf', 'ETF Flows'],
                   ['quant', 'Quant'],
                 ] as Array<[DeskTab, string]>).map(([tab, label]) => (
                   <button
                     key={tab}
                     onClick={() => setDeskTab(tab)}
                     className={`text-[10px] tracking-widest uppercase px-3 py-1 transition-colors ${deskTab === tab ? 'text-amber bg-amber/10' : 'text-muted hover:text-foreground'}`}
                   >
                     {label}
                   </button>
                 ))}
               </div>
               <button
                 onClick={() => setIsTradeModalOpen(true)}
                 className="text-[10px] tracking-widest uppercase bg-amber text-background px-3 py-1 rounded-sm hover:bg-amber/80 transition-colors"
               >
                 Fire Live Run
               </button>
             </div>

             {/* ── Exchange tab: signed SoDEX reads — venue truth, not our DB ── */}
             {deskTab === 'exchange' && (
               <div className="flex-1 overflow-auto p-4 space-y-6">
                 {!account ? (
                   <div className="text-[10px] text-muted">reading the venue (signed request)…</div>
                 ) : (
                   <>
                     <div className="flex flex-wrap gap-6 items-baseline">
                       <div>
                         <div className="text-[9px] text-muted tracking-widest uppercase mb-1">Perps available</div>
                         <div className="text-2xl font-light text-foreground">
                           {account.perps.availableBalance !== null ? `$${account.perps.availableBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                         </div>
                       </div>
                       <div className="text-[10px] text-muted tracking-widest uppercase">
                         {account.venue} · operator {account.operator.slice(0, 6)}…{account.operator.slice(-4)}
                       </div>
                     </div>

                     <div>
                       <div className="text-[9px] text-muted tracking-widest uppercase mb-2 border-b border-glass-border pb-1">Open positions on the venue ({account.perps.positions.length})</div>
                       {account.perps.positions.length === 0 ? (
                         <div className="text-[10px] text-muted font-sans py-2">Flat on the exchange right now — the honest state of the book.</div>
                       ) : (
                         <table className="w-full text-xs text-left border-collapse">
                           <thead><tr className="text-muted border-b border-glass-border/50">
                             <th className="pb-2 font-normal">SYMBOL</th><th className="pb-2 font-normal">SIDE</th>
                             <th className="pb-2 font-normal text-right">QTY</th><th className="pb-2 font-normal text-right">ENTRY</th>
                             <th className="pb-2 font-normal text-right">MARK</th><th className="pb-2 font-normal text-right">uPNL</th>
                           </tr></thead>
                           <tbody className="text-foreground/80">
                             {account.perps.positions.map((p, i) => (
                               <tr key={`${p.symbol}-${i}`} className="border-b border-glass-border/30">
                                 <td className="py-2 text-foreground">{String(p.symbol ?? '—')}</td>
                                 <td className={`py-2 text-[10px] ${String(p.positionSide).toUpperCase() === 'SHORT' ? 'text-coral' : 'text-olive'}`}>{String(p.positionSide ?? '—')}</td>
                                 <td className="py-2 text-right text-muted">{String(p.quantity ?? '—')}</td>
                                 <td className="py-2 text-right text-muted">{String(p.entryPrice ?? '—')}</td>
                                 <td className="py-2 text-right text-muted">{String(p.markPrice ?? '—')}</td>
                                 <td className={`py-2 text-right ${parseFloat(String(p.unrealizedPnl ?? '0')) >= 0 ? 'text-olive' : 'text-coral'}`}>{String(p.unrealizedPnl ?? '—')}</td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       )}
                     </div>

                     <div>
                       <div className="text-[9px] text-muted tracking-widest uppercase mb-2 border-b border-glass-border pb-1">Orders on the book ({account.perps.orders.length})</div>
                       {account.perps.orders.length === 0 ? (
                         <div className="text-[10px] text-muted font-sans py-2">No resting orders. Fire a live run and the EIP-712-signed order will appear here, read back from SoDEX itself.</div>
                       ) : (
                         <table className="w-full text-xs text-left border-collapse">
                           <thead><tr className="text-muted border-b border-glass-border/50">
                             <th className="pb-2 font-normal">ORDER</th><th className="pb-2 font-normal">SYMBOL</th>
                             <th className="pb-2 font-normal text-right">PRICE</th><th className="pb-2 font-normal text-right">QTY</th>
                             <th className="pb-2 font-normal text-right">STATUS</th>
                           </tr></thead>
                           <tbody className="text-foreground/80">
                             {account.perps.orders.slice(0, 12).map((o, i) => (
                               <tr key={`${o.orderId ?? o.clOrdID ?? i}`} className="border-b border-glass-border/30">
                                 <td className="py-2 text-muted">{String(o.clOrdID ?? o.orderId ?? '—').slice(0, 14)}</td>
                                 <td className="py-2 text-foreground">{String(o.symbol ?? '—')}</td>
                                 <td className="py-2 text-right text-muted">{String(o.price ?? '—')}</td>
                                 <td className="py-2 text-right text-muted">{String(o.quantity ?? '—')}</td>
                                 <td className="py-2 text-right text-[10px] text-muted">{String(o.status ?? '—')}</td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                       )}
                     </div>

                     {account.spot.length > 0 && (
                       <div>
                         <div className="text-[9px] text-muted tracking-widest uppercase mb-2 border-b border-glass-border pb-1">Spot balances (SSI rotation account)</div>
                         <div className="flex flex-wrap gap-2">
                           {account.spot.slice(0, 10).map((s, i) => (
                             <span key={i} className="border border-glass-border px-3 py-1.5 text-[10px] text-foreground">
                               {String(s.asset ?? s.symbol ?? s.currency ?? '?')} <span className="text-muted">{String(s.free ?? s.available ?? s.balance ?? '')}</span>
                             </span>
                           ))}
                         </div>
                       </div>
                     )}
                   </>
                 )}
               </div>
             )}

             {/* ── ETF flows tab: SoSoValue US spot-ETF daily net flows ── */}
             {deskTab === 'etf' && (() => {
               const etf = etfSymbol === 'BTC' ? etfBtc : etfEth;
               const hist = (etf?.history ?? []).slice(0, 14).reverse();
               const flows = hist.map((h) => h.dailyNetFlow ?? h.totalNetFlow ?? 0);
               const maxAbs = Math.max(...flows.map(Math.abs), 1);
               const fmtUsd = (v: number) => {
                 const a = Math.abs(v);
                 const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0);
                 return `${v < 0 ? '-' : '+'}$${s}`;
               };
               return (
                 <div className="flex-1 overflow-auto p-4 flex flex-col">
                   <div className="flex items-center justify-between mb-4">
                     <div className="flex gap-1">
                       {(['BTC', 'ETH'] as const).map((s) => (
                         <button key={s} onClick={() => setEtfSymbol(s)}
                           className={`text-[10px] tracking-widest uppercase px-3 py-1 border transition-colors ${etfSymbol === s ? 'border-amber/50 text-amber bg-amber/5' : 'border-glass-border text-muted hover:text-foreground'}`}>
                           {s} spot ETFs
                         </button>
                       ))}
                     </div>
                     {hist.length > 0 && hist[hist.length - 1].totalNetAssets !== undefined && (
                       <div className="text-[10px] text-muted tracking-widest uppercase">
                         Net assets {fmtUsd(hist[hist.length - 1].totalNetAssets ?? 0).replace('+', '')}
                       </div>
                     )}
                   </div>
                   {!etf ? (
                     <div className="text-[10px] text-muted">loading SoSoValue ETF data…</div>
                   ) : hist.length === 0 ? (
                     <div className="text-[10px] text-muted font-sans">{etf.error ?? 'No ETF history returned.'}</div>
                   ) : (
                     <>
                       <div className="flex-1 flex items-end gap-1.5 min-h-[120px] border-b border-glass-border pb-px">
                         {hist.map((h, i) => {
                           const v = flows[i];
                           return (
                             <div key={h.date} className="flex-1 flex flex-col justify-end items-center gap-1 group relative">
                               <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 text-[9px] text-foreground whitespace-nowrap">{fmtUsd(v)}</div>
                               <div
                                 className={`w-full ${v >= 0 ? 'bg-olive/70' : 'bg-coral/70'} group-hover:opacity-100 opacity-80`}
                                 style={{ height: `${Math.max(3, (Math.abs(v) / maxAbs) * 110)}px` }}
                               />
                             </div>
                           );
                         })}
                       </div>
                       <div className="flex justify-between text-[9px] text-muted tracking-widest uppercase mt-2">
                         <span>{hist[0]?.date}</span>
                         <span>daily net flow · green in / red out</span>
                         <span>{hist[hist.length - 1]?.date}</span>
                       </div>
                       <p className="text-[10px] text-muted font-sans leading-relaxed mt-4">{etf.note}</p>
                     </>
                   )}
                 </div>
               );
             })()}

             {/* ── Quant tab: the backtest engine, honestly discounted ── */}
             {deskTab === 'quant' && (
               <div className="flex-1 overflow-auto p-4">
                 {!backtest ? (
                   <div className="text-[10px] text-muted">running the numbers…</div>
                 ) : backtest.n === 0 ? (
                   <div className="text-[10px] text-muted font-sans">{backtest.caveats[0]}</div>
                 ) : (
                   <div className="space-y-6">
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-foreground/10 border border-foreground/10">
                       {([
                         ['Strategy return', `${backtest.strategy.totalReturnPct >= 0 ? '+' : ''}${backtest.strategy.totalReturnPct}%`, backtest.strategy.totalReturnPct >= 0],
                         ['vs Buy & hold', `${backtest.buyHold.totalReturnPct >= 0 ? '+' : ''}${backtest.buyHold.totalReturnPct}%`, backtest.buyHold.totalReturnPct >= 0],
                         ['Sharpe (×0.5 disc.)', backtest.strategy.sharpeDiscounted !== null ? String(backtest.strategy.sharpeDiscounted) : '—', true],
                         ['Sortino', backtest.strategy.sortino !== null ? String(backtest.strategy.sortino) : '—', true],
                         ['Max drawdown', `${backtest.strategy.maxDrawdownPct}%`, false],
                         ['Win rate', backtest.strategy.winRate !== null ? `${backtest.strategy.winRate}%` : '—', true],
                         ['VaR 95 (MC ×1000)', backtest.monteCarlo.var95Pct !== null ? `${backtest.monteCarlo.var95Pct}%` : '—', false],
                         ['CVaR 95', backtest.monteCarlo.cvar95Pct !== null ? `${backtest.monteCarlo.cvar95Pct}%` : '—', false],
                       ] as Array<[string, string, boolean]>).map(([k, v, pos]) => (
                         <div key={k} className="bg-background p-4">
                           <div className="text-[9px] text-muted tracking-[0.25em] uppercase mb-2">{k}</div>
                           <div className={`text-xl font-light ${v.startsWith('+') ? 'text-olive' : v.startsWith('-') && pos ? 'text-coral' : 'text-foreground'}`}>{v}</div>
                         </div>
                       ))}
                     </div>
                     <div className="text-[10px] text-muted font-sans leading-relaxed space-y-1">
                       {backtest.caveats.map((cv) => <div key={cv}>· {cv}</div>)}
                     </div>
                     <Link href="/edge" className="inline-block text-[10px] tracking-widest uppercase border border-amber/40 text-amber px-4 py-2 hover:bg-amber/10 transition-colors">
                       Full head-to-head → Proof of Edge
                     </Link>
                   </div>
                 )}
               </div>
             )}

             {deskTab === 'positions' && (
             <div className="flex-1 overflow-auto p-4">
               {trades.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-8">
                   <div className="text-muted text-xs leading-relaxed max-w-sm font-sans">
                     No positions yet. The agent only trades when a macro print clears the surprise,
                     conviction and risk gates — fire a live run to watch the whole loop.
                   </div>
                   <button onClick={() => setIsTradeModalOpen(true)} className="text-[10px] tracking-widest uppercase border border-amber/40 text-amber px-4 py-2 hover:bg-amber/10 transition-colors">
                     Fire Live Run
                   </button>
                 </div>
               ) : (
               <table className="w-full text-xs text-left border-collapse">
                 <thead>
                   <tr className="text-muted border-b border-glass-border/50">
                     <th className="pb-2 font-normal cursor-pointer hover:text-amber transition-colors" onClick={() => handleSort('symbol')}>
                       SYMBOL {sortConfig?.key === 'symbol' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                     </th>
                     <th className="pb-2 font-normal">SIDE</th>
                     <th className="pb-2 font-normal text-right">LEV</th>
                     <th className="pb-2 font-normal text-right">ENTRY</th>
                     <th className="pb-2 font-normal text-right">STOP / TARGET</th>
                     <th className="pb-2 font-normal text-right cursor-pointer hover:text-amber transition-colors" onClick={() => handleSort('pnl')}>
                       PNL {sortConfig?.key === 'pnl' ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                     </th>
                     <th className="pb-2 font-normal text-right">STATUS</th>
                   </tr>
                 </thead>
                 <tbody className="text-foreground/80">
                   {sortedTrades.map((pos) => (
                     <tr key={pos.id} onClick={() => setSelectedPos(pos)} className="cursor-pointer border-b border-glass-border/30 hover:bg-foreground/5 transition-colors group">
                       <td className="py-3 font-medium text-foreground">
                         <div className="flex items-center gap-2">
                           <div className={`w-1 h-1 rounded-full ${pos.side === 'LONG' ? 'bg-olive' : 'bg-coral'}`} />
                           {pos.symbol}
                         </div>
                       </td>
                       <td className={`py-3 text-[10px] tracking-wider ${pos.side === 'LONG' ? 'text-olive' : 'text-coral'}`}>{pos.side}</td>
                       <td className="py-3 text-right">{pos.leverage ?? 1}×</td>
                       <td className="py-3 text-right text-muted">{pos.entryPrice?.toLocaleString() ?? '—'}</td>
                       <td className="py-3 text-right text-muted">
                         {pos.stopLoss?.toLocaleString() ?? '—'} / {pos.takeProfit?.toLocaleString() ?? '—'}
                       </td>
                       <td className={`py-3 text-right ${(pos.pnl ?? 0) >= 0 ? 'text-olive' : 'text-coral'}`}>
                         {pos.pnl !== null ? `${pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}` : 'live'}
                       </td>
                       <td className="py-3 text-right text-[10px] tracking-wider text-muted">{pos.status}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
               )}
             </div>
             )}
          </div>

          {/* Bottom Row — real execution log + real equity curve */}
          <div className="flex gap-2 h-48 shrink-0">
             <div className="w-[40%] mara-glass p-0 flex flex-col bg-background/20">
               <div className="h-8 border-b border-glass-border flex items-center px-4 bg-foreground/[0.02]">
                 <div className="text-[10px] text-muted tracking-widest uppercase">Engine Log · Live</div>
               </div>
               <div className="flex-1 overflow-auto p-4 space-y-2">
                 {logs.length === 0 && (
                   <div className="text-[10px] text-muted">Waiting for engine activity…</div>
                 )}
                 <AnimatePresence initial={false}>
                   {logs.map(log => (
                     <motion.div
                       key={log.id}
                       initial={{ opacity: 0, x: -10 }}
                       animate={{ opacity: 1, x: 0 }}
                       exit={{ opacity: 0 }}
                       transition={{ duration: 0.3 }}
                       className={`flex gap-3 text-[10px] font-mono border-l-2 p-1.5 bg-foreground/[0.01] hover:bg-foreground/[0.03] transition-colors ${log.tone === 'bull' ? 'border-olive/30' : log.tone === 'bear' ? 'border-coral/30' : 'border-glass-border'}`}>
                       <span className="text-muted/60 shrink-0">{log.time}</span>
                       <span className={`shrink-0 ${log.tone === 'bull' ? 'text-olive' : log.tone === 'bear' ? 'text-coral' : 'text-amber'}`}>{log.tag}</span>
                       <span className="text-foreground flex-1 truncate">{log.text}</span>
                     </motion.div>
                   ))}
                 </AnimatePresence>
               </div>
             </div>

             <div className="flex-1 mara-glass p-4 relative overflow-hidden flex flex-col bg-background/20">
               <div className="text-[10px] text-muted tracking-widest uppercase z-10 flex items-center gap-2 mb-2">
                 <Activity className="w-3 h-3 text-amber" />
                 Equity Curve {perf ? `· ${perf.closedTrades} closed · ${perf.winRate !== null ? `${perf.winRate}% wins` : 'no closes yet'}` : ''}
               </div>
               {eqPath ? (
                 <svg className="flex-1 w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                   <path d={eqPath} fill="none" stroke="var(--color-amber)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                 </svg>
               ) : (
                 <div className="flex-1 flex items-center justify-center text-[10px] text-muted font-sans">
                   The equity curve draws itself from real closed trades — none yet.
                 </div>
               )}
               <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent pointer-events-none" />
             </div>
          </div>

          {/* Position detail drawer — real trade */}
          <AnimatePresence>
            {selectedPos && (
              <motion.div
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
                className="absolute top-0 right-0 bottom-0 w-[60%] bg-background/95 backdrop-blur-3xl border-l border-glass-border z-50 p-8 shadow-2xl flex flex-col"
              >
                 <div className="flex justify-between items-start mb-8 border-b border-glass-border pb-4">
                   <div>
                     <div className="text-[10px] text-muted tracking-widest uppercase mb-1">Position Detail</div>
                     <div className="text-3xl font-display">{selectedPos.symbol} <span className={selectedPos.side === 'LONG' ? 'text-olive' : 'text-coral'}>{selectedPos.side}</span></div>
                   </div>
                   <button onClick={() => setSelectedPos(null)} className="p-2 hover:bg-foreground/10 rounded-sm transition-colors">
                     <X className="w-5 h-5 text-muted" />
                   </button>
                 </div>

                 <div className="grid grid-cols-3 gap-8">
                    {[
                      ['Status', selectedPos.status],
                      ['Leverage', `${selectedPos.leverage ?? 1}×`],
                      ['Quantity', selectedPos.quantity ?? '—'],
                      ['Entry', selectedPos.entryPrice?.toLocaleString() ?? '—'],
                      ['Stop-loss', selectedPos.stopLoss?.toLocaleString() ?? '—'],
                      ['Take-profit', selectedPos.takeProfit?.toLocaleString() ?? '—'],
                      ['Exit', selectedPos.exitPrice?.toLocaleString() ?? 'open'],
                      ['P&L', selectedPos.pnl !== null ? `${selectedPos.pnl >= 0 ? '+' : ''}${selectedPos.pnl.toFixed(2)}` : 'live'],
                      ['Opened', selectedPos.openedAt ? timeAgo(selectedPos.openedAt) : '—'],
                    ].map(([k, v]) => (
                      <div key={String(k)}>
                        <div className="text-[10px] text-muted tracking-widest uppercase mb-2">{k}</div>
                        <div className="font-mono text-lg">{String(v)}</div>
                      </div>
                    ))}
                 </div>

                 <div className="mt-8 flex-1 border border-glass-border rounded-sm bg-foreground/[0.02] p-6 overflow-auto">
                   <div className="text-[10px] text-muted tracking-widest uppercase mb-3">Provenance</div>
                   <p className="text-sm font-sans text-muted leading-relaxed">
                     {selectedPos.decisionId
                       ? `This order was placed autonomously by decision ${selectedPos.decisionId.slice(0, 8)} — every trade carries its reasoning chain. SoDEX order: ${selectedPos.sodexOrderId ?? 'pending'}.`
                       : 'Manual/system order without an attached decision.'}
                   </p>
                 </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Fire Live Run modal — triggers the REAL pipeline */}
          <AnimatePresence>
            {isTradeModalOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.95, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, y: 20 }}
                  className="w-[420px] bg-background border border-glass-border shadow-2xl p-6 relative"
                >
                  <button onClick={() => { setIsTradeModalOpen(false); setRunState(null); }} className="absolute top-4 right-4 text-muted hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                  <div className="text-[10px] text-amber tracking-widest uppercase mb-2">Fire Live Run</div>
                  <p className="text-[11px] font-sans text-muted leading-relaxed mb-6">
                    Inject a macro print and the full pipeline runs for real: surprise math → AI agent
                    → risk gates → (testnet) execution. Shared 20s cooldown across all users.
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] text-muted tracking-widest uppercase mb-1 block">Event</label>
                      <select
                        value={runEvent}
                        onChange={(e) => setRunEvent(e.target.value)}
                        className="w-full bg-foreground/[0.02] border border-glass-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/50"
                      >
                        <option>CPI YoY</option>
                        <option>Core CPI YoY</option>
                        <option>Nonfarm Payrolls</option>
                        <option>FOMC Rate Decision</option>
                        <option>PCE YoY</option>
                        <option>Unemployment Rate</option>
                      </select>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted tracking-widest uppercase mb-1 block">Actual</label>
                        <input value={runActual} onChange={(e) => setRunActual(e.target.value)} className="w-full bg-foreground/[0.02] border border-glass-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/50" />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-muted tracking-widest uppercase mb-1 block">Forecast</label>
                        <input value={runForecast} onChange={(e) => setRunForecast(e.target.value)} className="w-full bg-foreground/[0.02] border border-glass-border px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber/50" />
                      </div>
                    </div>

                    <button
                      onClick={() => void fireRun()}
                      className="w-full bg-amber/20 text-amber border border-amber/30 py-3 text-xs tracking-widest uppercase hover:bg-amber/30 transition-colors"
                    >
                      Engage Pipeline
                    </button>
                    {runState && <div className="text-[10px] font-mono text-muted leading-relaxed">{runState}</div>}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Right Sidebar — real news + latest verdict */}
        <aside className="w-72 flex flex-col gap-2 shrink-0">
           <div className="flex-1 mara-glass p-0 flex flex-col bg-background/20">
              <div className="h-8 border-b border-glass-border flex items-center px-4 bg-foreground/[0.02]">
                <div className="text-[10px] text-muted tracking-widest uppercase">Macro Wire · SoSoValue</div>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-3">
                 {news.length === 0 && (
                   <div className="text-[10px] text-muted">news feed syncing…</div>
                 )}
                 {news.map((n, i) => (
                   <div key={n.id} className={`p-3 rounded-sm transition-colors cursor-default border ${i === 0 ? 'bg-amber/5 border-amber/20' : 'bg-foreground/5 border-glass-border opacity-80 hover:opacity-100'}`}>
                     <div className={`text-[9px] tracking-widest uppercase mb-1 ${i === 0 ? 'text-amber' : 'text-muted'}`}>
                       {timeAgo(n.publishTime || n.releaseTime)}{n.matchedCurrencies.length ? ` · ${n.matchedCurrencies.slice(0, 3).join(' ')}` : ''}
                     </div>
                     <div className="text-xs text-foreground font-sans leading-snug">{n.title}</div>
                   </div>
                 ))}
              </div>
           </div>

           <div className="h-48 mara-glass p-6 relative overflow-hidden group bg-background/40">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber/10 rounded-full blur-2xl group-hover:bg-amber/20 transition-colors" />
              <div className="text-[9px] text-muted tracking-widest uppercase mb-4">Latest Verdict</div>
              <div className={`text-3xl font-display leading-none mb-3 ${latestDecision && latestDecision.action === 'SHORT' ? 'text-coral' : 'text-foreground'}`}>
                {latestDecision ? latestDecision.conviction.replace('_', ' ') : 'STANDBY'}
              </div>
              <div className="text-xs text-muted font-sans leading-relaxed line-clamp-3">
                {latestDecision
                  ? `${latestDecision.confidence}% — ${latestDecision.reasoning}`
                  : 'The desk renders the agent\'s most recent reasoning here the moment a print fires.'}
              </div>
           </div>
        </aside>

      </main>
    </div>
  );
}
