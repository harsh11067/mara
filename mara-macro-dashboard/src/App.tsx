import { useState, useEffect, useRef } from "react";
import { Cpu, Wifi, Wallet, LogOut } from "lucide-react";
import {
  INITIAL_EVENTS,
  INITIAL_REASONINGS,
  INITIAL_TRADES,
  INITIAL_HOLDINGS,
  INITIAL_ROTATION_LOGS,
  MacroEvent,
  AiReasoning,
  Trade,
  SsiHolding,
  RotationLog,
  DirectionType,
} from "./types";

import MacroCalendar        from "./components/MacroCalendar";
import AiReasoningFeed      from "./components/AiReasoningFeed";
import TradeStream          from "./components/TradeStream";
import RiskEngine           from "./components/RiskEngine";
import PerformanceCard      from "./components/PerformanceCard";
import SsiPortfolio         from "./components/SsiPortfolio";
import OnChainAttestation   from "./components/OnChainAttestation";
import { OPERATOR_ADDRESS }  from "./operator";

import {
  api,
  mapDecision,
  mapEvent,
  mapTrade,
  createWebSocket,
  type WsMessage,
} from "./api";

interface EthereumProvider {
  request: (args: { method: string }) => Promise<string[]>;
  isMetaMask?: boolean;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
}
declare global {
  interface Window { ethereum?: EthereumProvider }
}

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [events,       setEvents]       = useState<MacroEvent[]>(INITIAL_EVENTS);
  const [reasonings,   setReasonings]   = useState<AiReasoning[]>(INITIAL_REASONINGS);
  const [trades,       setTrades]       = useState<Trade[]>(INITIAL_TRADES);
  const [holdings,     setHoldings]     = useState<SsiHolding[]>(INITIAL_HOLDINGS);
  const [rotationLogs, setRotationLogs] = useState<RotationLog[]>(INITIAL_ROTATION_LOGS);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isSimulating,    setIsSimulating]    = useState(false);
  const [isKilled,        setIsKilled]        = useState(false);

  // Wallet
  const [walletAddress,      setWalletAddress]      = useState<string | null>(null);
  const [walletIsMetaMask,   setWalletIsMetaMask]   = useState(false);
  const [isConnecting,       setIsConnecting]       = useState(false);
  const [showWalletDropdown, setShowWalletDropdown] = useState(false);

  // Tickers
  const [btcPrice, setBtcPrice] = useState(68518.5);
  const [ethPrice, setEthPrice] = useState(3601.7);
  const [solPrice, setSolPrice] = useState(145.25);
  const [btcChange, setBtcChange] = useState(-1.12);
  const [ethChange, setEthChange] = useState(0.85);
  const [solChange, setSolChange] = useState(-2.4);

  // Account / risk
  const [balance,            setBalance]            = useState(124238.9);
  const [drawdownPercent,    setDrawdownPercent]    = useState(1.45);
  const [currentDailyTrades, setCurrentDailyTrades] = useState(4);

  const [pnlHistory, setPnlHistory] = useState([
    { name: "05/10", value: 120000 },
    { name: "05/13", value: 121500 },
    { name: "05/15", value: 122240 },
    { name: "05/18", value: 122240 },
    { name: "05/20", value: 122258 },
    { name: "05/28", value: 124238 },
  ]);

  const [winRate,      setWinRate]      = useState(0.684);
  const [profitFactor, setProfitFactor] = useState(2.15);
  const [sharpeRatio,  setSharpeRatio]  = useState(2.45);
  const [averageR,     setAverageR]     = useState(1.8);

  const [backendOnline, setBackendOnline] = useState(false);
  // Bumped on every new decision so the on-chain attestation panel re-checks
  // the contract (the decision is written on-chain a few seconds later).
  const [attestationRefresh, setAttestationRefresh] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UTC clock
  const [utcTime, setUtcTime] = useState("");
  useEffect(() => {
    const fmt = () => new Date().toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: "UTC",
    });
    setUtcTime(fmt());
    const id = setInterval(() => setUtcTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);

  // Ticker fluctuation
  useEffect(() => {
    if (isKilled) return;
    const id = setInterval(() => {
      const bd = (Math.random() - 0.49) * 12;
      const ed = (Math.random() - 0.49) * 1.5;
      const sd = (Math.random() - 0.49) * 0.15;
      setBtcPrice(p => p + bd);
      setEthPrice(p => p + ed);
      setSolPrice(p => p + sd);
      setBtcChange(c => Math.max(-9, Math.min(9, c + (Math.random() - 0.5) * 0.1)));
      setEthChange(c => Math.max(-9, Math.min(9, c + (Math.random() - 0.5) * 0.08)));
      setSolChange(c => Math.max(-9, Math.min(9, c + (Math.random() - 0.5) * 0.12)));
      setTrades(prev =>
        prev.map(t => {
          if (t.status === "OPEN" && t.instrument.includes("BTC")) {
            const pnl    = (t.priceEntry - (btcPrice + bd)) * t.quantity;
            const pnlPct = (pnl / (t.sizeUsd / t.leverage)) * 100;
            return { ...t, pnl, pnlPercent: pnlPct };
          }
          return t;
        })
      );
    }, 3500);
    return () => clearInterval(id);
  }, [isKilled, btcPrice]);

  // Backend polling
  const mergeBackendData = async () => {
    try {
      const [evts, decs, trd, risk] = await Promise.all([
        api.events(), api.decisions(), api.trades(), api.risk(),
      ]);
      setBackendOnline(true);

      if (evts.length > 0) {
        const backendEvts = evts.map(mapEvent);
        setEvents(prev => {
          const names = new Set(backendEvts.map(e => e.name));
          return [...backendEvts, ...prev.filter(e => !names.has(e.name))].slice(0, 12);
        });
      }
      if (decs.length > 0) {
        const mapped = decs.map(mapDecision);
        setReasonings(prev => {
          const ids = new Set(mapped.map(r => r.id));
          return [...mapped, ...prev.filter(r => !ids.has(r.id))].slice(0, 20);
        });
        const latest = decs[0];
        if (latest.marketContext?.btcPrice) setBtcPrice(latest.marketContext.btcPrice as number);
      }
      if (trd.length > 0) {
        const mapped = trd.map(mapTrade);
        setTrades(prev => {
          const ids = new Set(mapped.map(t => t.id));
          return [...mapped, ...prev.filter(t => !ids.has(t.id))].slice(0, 20);
        });
      }

      const liveBalance = risk.liveBalance ?? risk.accountBalance;
      if (liveBalance > 0) setBalance(liveBalance);
      setDrawdownPercent(Math.max(0, risk.drawdownPercent));
      setCurrentDailyTrades(risk.totalTrades);
      setIsKilled(risk.killSwitchActive);
      if (risk.winRate > 0) setWinRate(risk.winRate / 100);

      if (risk.cumulativePnl !== 0) {
        const slug = `${new Date().getMonth() + 1}/${new Date().getDate()}`;
        setPnlHistory(h => {
          const v = Math.round((liveBalance || 124238) + risk.cumulativePnl);
          if (h[h.length - 1]?.value === v) return h;
          return [...h, { name: slug, value: v }];
        });
      }
    } catch {
      // Backend offline — keep mock data
    }
  };

  useEffect(() => {
    void mergeBackendData();
    pollRef.current = setInterval(() => void mergeBackendData(), 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket
  useEffect(() => {
    const cleanup = createWebSocket(
      (msg: WsMessage) => {
        setBackendOnline(true);
        if (msg.type === "init") {
          if (msg.data.killSwitch !== undefined) setIsKilled(msg.data.killSwitch);
          if (msg.data.decisions?.length) {
            setReasonings(prev => {
              const inc = msg.data.decisions.map(mapDecision);
              const ids = new Set(inc.map(r => r.id));
              return [...inc, ...prev.filter(r => !ids.has(r.id))].slice(0, 20);
            });
          }
        }
        if (msg.type === "decision") {
          const d = msg.data;
          const r: AiReasoning = {
            id:            d.id,
            eventName:     (d as { eventName?: string }).eventName ?? "Macro Event",
            timestamp:     d.timestamp ?? Date.now(),
            surpriseScore: d.marketContext?.surpriseScore as number ?? 0,
            direction:     d.conviction as DirectionType,
            confidence:    d.confidence,
            actual:        String(d.marketContext?.actual ?? "—"),
            forecast:      String(d.marketContext?.forecast ?? "—"),
            reasoning:     d.reasoning ?? "",
            sourceNews:    d.newsContext ?? [],
          };
          setReasonings(prev => [r, ...prev.filter(x => x.id !== d.id)].slice(0, 20));
          if ((d as { btcPrice?: number }).btcPrice) setBtcPrice((d as { btcPrice: number }).btcPrice);
          setAttestationRefresh(n => n + 1);  // nudge on-chain panel to re-check
        }
        if (msg.type === "trade") {
          setTrades(prev => {
            const t = mapTrade(msg.data as Parameters<typeof mapTrade>[0]);
            return [t, ...prev.filter(x => x.id !== t.id)].slice(0, 20);
          });
        }
        if (msg.type === "risk") {
          const r = msg.data as { killSwitchActive: boolean; drawdownPercent: number };
          setIsKilled(r.killSwitchActive);
          setDrawdownPercent(Math.max(0, r.drawdownPercent));
        }
        if (msg.type === "status") setIsKilled(msg.data.killSwitch);
      },
      () => setBackendOnline(true),
    );
    return cleanup;
  }, []);

  // Wallet
  const handleConnectWallet = async () => {
    if (isConnecting || walletAddress) return;
    setIsConnecting(true);
    const eth = window.ethereum;
    if (eth) {
      try {
        const accounts = await eth.request({ method: "eth_requestAccounts" });
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          setWalletIsMetaMask(true);
        }
      } catch {
        // User rejected
      }
      setIsConnecting(false);
    } else {
      setTimeout(() => {
        // No MetaMask → show the REAL MARA operator wallet (single source of
        // truth), never a throwaway demo address.
        setWalletAddress(OPERATOR_ADDRESS);
        setWalletIsMetaMask(false);
        setIsConnecting(false);
      }, 800);
    }
  };

  const handleDisconnectWallet = () => {
    setWalletAddress(null);
    setWalletIsMetaMask(false);
    setShowWalletDropdown(false);
  };

  // Trigger simulation
  const handleTriggerSimulation = (eventName: string, actual: string, forecast: string) => {
    if (isKilled) return;
    setIsSimulating(true);

    const parseVal = (s: string) => {
      const n = parseFloat(s.replace(/[%K]/g, ""));
      return isNaN(n) ? 0 : s.includes("K") ? n * 1000 : n;
    };
    const actualNum   = parseVal(actual);
    const forecastNum = parseVal(forecast);

    if (backendOnline) {
      api.trigger({ event: eventName, actual: actualNum, forecast: forecastNum }).catch(() => {});
    }

    setTimeout(() => {
      const diff   = actualNum - forecastNum;
      let surprise = 0;
      let dir: DirectionType = "NEUTRAL";
      let modelConf = 90;
      const isPct = actual.includes("%");

      if (isPct) {
        surprise = diff / 0.15;
        if (eventName.includes("CPI") || eventName.includes("PCE")) {
          if      (diff >  0.05) { dir = "STRONG_BEAR"; modelConf = 85 + Math.floor(Math.random() * 10); }
          else if (diff >  0)    { dir = "BEAR";         modelConf = 75 + Math.floor(Math.random() * 15); }
          else if (diff < -0.05) { dir = "STRONG_BULL";  modelConf = 82 + Math.floor(Math.random() * 12); }
          else if (diff <  0)    { dir = "BULL";         modelConf = 70 + Math.floor(Math.random() * 20); }
        }
      } else {
        surprise = diff / 25;
        if (eventName.includes("Payroll") || eventName.includes("Claims")) {
          if      (diff < -30) { dir = "STRONG_BULL"; modelConf = 84 + Math.floor(Math.random() * 12); }
          else if (diff <   0) { dir = "BULL";        modelConf = 72 + Math.floor(Math.random() * 18); }
          else if (diff >  30) { dir = "STRONG_BEAR"; modelConf = 86 + Math.floor(Math.random() * 10); }
          else if (diff >   0) { dir = "BEAR";        modelConf = 70 + Math.floor(Math.random() * 20); }
        }
      }

      let tradeSide: "LONG" | "SHORT" | "ROTATION" = "LONG";
      let reasoning = "";
      let headlines: string[] = [];

      if (dir.includes("BULL")) {
        tradeSide = "LONG";
        reasoning = `${eventName} printed at ${actual} vs consensus ${forecast} (${surprise.toFixed(2)}σ). Dovish macro surprise triggers liquidity rotation into risk-on assets. Initiated LONG in BTC-USD.PERP on SoDEX with 3× leverage, stop at -1.5× ATR.`;
        headlines = [
          `REUTERS: ${eventName} Prints ${actual}, Beats ${forecast} Estimate`,
          `BLOOMBERG: Dovish Macro Signals Prompt $35M Risk-On Rebalance`,
          `COINANALYST: BTC Dominance Tests Key Levels Amid Structural Bid`,
        ];
      } else if (dir.includes("BEAR")) {
        tradeSide = "SHORT";
        reasoning = `${eventName} printed at ${actual} vs consensus ${forecast} (${surprise.toFixed(2)}σ). Hawkish surprise reinforces higher-for-longer rate regime. Initiated SHORT hedge, rotated 15% MAG7.ssi → USSI yield reserve.`;
        headlines = [
          `BLOOMBERG: Macro Surprise at ${actual} Triggers Rates Repricing`,
          `REUTERS: Stickier Indicators Threaten Near-Term Easing`,
          `COINANALYST: Futures Premium Falls Post-Release`,
        ];
      } else {
        tradeSide = "ROTATION";
        reasoning = `${eventName} aligned with consensus at ${actual} (0.00σ). No directional edge detected. Standard yield farming remains active, no new perp exposure initiated.`;
        headlines = [`FEDWATCH: Aligned Macro Signals Neutralize Short-Term Opportunities`];
      }

      const newTrade: Trade = {
        id:         `trd-${(trades.length + 1).toString().padStart(3, "0")}`,
        timeStr:    "Just now",
        timestamp:  Date.now(),
        event:      eventName,
        instrument: "BTC-USD.PERP (SoDEX)",
        side:       tradeSide,
        sizeUsd:    12500,
        quantity:   12500 / btcPrice,
        priceEntry: btcPrice,
        leverage:   tradeSide === "ROTATION" ? 1 : 3,
        stopLoss:   btcPrice * (dir.includes("BULL") ? 0.985 : 1.015),
        takeProfit: btcPrice * (dir.includes("BULL") ? 1.045 : 0.960),
        pnl:        tradeSide === "ROTATION" ? 0 : (Math.random() - 0.45) * 150,
        pnlPercent: tradeSide === "ROTATION" ? 0 : (Math.random() - 0.45) * 1.5,
        status:     tradeSide === "ROTATION" ? "CLOSED" : "OPEN",
      };

      let updatedHoldings = [...holdings];
      let newRotationLogs = [...rotationLogs];
      if (dir.includes("BEAR")) {
        updatedHoldings = holdings.map(h => {
          if (h.ticker === "MAG7.ssi") return { ...h, valueUsd: h.valueUsd - 5000, allocationPercent: Math.round(((h.valueUsd - 5000) / (balance + 10000)) * 100) };
          if (h.ticker === "USSI")     return { ...h, valueUsd: h.valueUsd + 5000, allocationPercent: Math.round(((h.valueUsd + 5000) / (balance + 10000)) * 100) };
          return h;
        });
        newRotationLogs = [{
          id: `rot-${(rotationLogs.length + 1).toString().padStart(3, "0")}`,
          timeStr: "Just now", fromTicker: "MAG7.ssi", toTicker: "USSI", percentage: 5,
          reason: `${eventName} surprise (+${surprise.toFixed(1)}σ). Shifted $5K from tech equity basket to USSI yield reserve.`,
        }, ...rotationLogs];
      } else if (dir.includes("BULL")) {
        updatedHoldings = holdings.map(h => {
          if (h.ticker === "USSI")     return { ...h, valueUsd: h.valueUsd - 7500, allocationPercent: Math.max(0, Math.round(((h.valueUsd - 7500) / (balance + 10000)) * 100)) };
          if (h.ticker === "DEFI.ssi") return { ...h, valueUsd: h.valueUsd + 7500, allocationPercent: Math.round(((h.valueUsd + 7500) / (balance + 10000)) * 100) };
          return h;
        });
        newRotationLogs = [{
          id: `rot-${(rotationLogs.length + 1).toString().padStart(3, "0")}`,
          timeStr: "Just now", fromTicker: "USSI", toTicker: "DEFI.ssi", percentage: 7.5,
          reason: `${eventName} dovish (-${Math.abs(surprise).toFixed(1)}σ). Rotated $7.5K dry powder into DeFi high-beta.`,
        }, ...rotationLogs];
      }

      const calEvt = events.find(e => e.name.toLowerCase().includes(eventName.toLowerCase().split(" ")[0]));
      if (calEvt) {
        setEvents(prev => prev.map(e => e.id === calEvt.id ? { ...e, state: "fired" as const, actual } : e));
      }

      const newReasoning: AiReasoning = {
        id:           `reason-${(reasonings.length + 1).toString().padStart(3, "0")}`,
        eventName,
        timestamp:    Date.now(),
        surpriseScore: surprise,
        direction:    dir,
        confidence:   modelConf,
        actual,
        forecast,
        reasoning,
        sourceNews:   headlines,
      };

      setReasonings(prev => [newReasoning, ...prev]);
      setTrades(prev => [newTrade, ...prev]);
      setHoldings(updatedHoldings);
      setRotationLogs(newRotationLogs);

      const newBal = balance + newTrade.pnl;
      setBalance(newBal);
      setDrawdownPercent(prev => Math.max(0.4, prev - 0.1));
      setCurrentDailyTrades(n => n + 1);
      const slug = `${new Date().getMonth() + 1}/${new Date().getDate()}`;
      setPnlHistory(h => [...h, { name: slug, value: Math.round(newBal) }]);
      if (dir !== "NEUTRAL") {
        setWinRate(p => Math.min(0.95, p + 0.012));
        setProfitFactor(p => Math.min(4.0, p + 0.05));
        setSharpeRatio(p => Math.min(5.0, p + 0.03));
      }
      setIsSimulating(false);
    }, 2000);
  };

  // Kill switch
  const handleKillSwitchToggle = () => {
    if (!isKilled) {
      setIsKilled(true);
      setTrades(prev => prev.map(t => t.status === "OPEN" ? { ...t, status: "CLOSED" as const, timeStr: "Forced Exit" } : t));
      if (backendOnline) api.killSwitch().catch(() => {});
    } else {
      setIsKilled(false);
      if (backendOnline) api.resetKillSwitch().catch(() => {});
    }
  };

  const tickers = [
    { sym: "BTC/USDC", px: btcPrice, chg: btcChange },
    { sym: "ETH/USDC", px: ethPrice, chg: ethChange },
    { sym: "SOL/USDC", px: solPrice, chg: solChange },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)", color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
      {/* ── TopBar ── */}
      <header style={{ display: "flex", alignItems: "center", gap: 28, padding: "14px 22px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div className="artifact-spin-move" style={{ width: 42, height: 42, borderRadius: "var(--r-md)", background: "var(--bg-card)", border: "1px solid var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--info)" }}>
            <Cpu size={22} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: 20, letterSpacing: ".01em", color: "var(--fg)" }}>
                MARA<span style={{ color: "var(--fg-4)", margin: "0 1px" }}>:</span><span style={{ color: "var(--info)" }}>OP-CENTRAL</span>
              </span>
              <span className="mc-badge mc-badge--pos">AUTONOMOUS</span>
              {backendOnline && <span className="mc-badge mc-badge--info"><span className="dot" />API LIVE</span>}
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)", letterSpacing: ".02em" }}>
              Macro-Aware Research &amp; Execution Agent · Operational Kernel
            </span>
          </div>
        </div>

        {/* Ticker */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {tickers.map((q, i) => (
              <div key={q.sym} style={{ display: "flex", alignItems: "center", gap: 22 }}>
                {i > 0 && <span style={{ width: 1, height: 30, background: "var(--border)", display: "block" }} />}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em", color: "var(--fg-3)" }}>{q.sym}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
                    {q.px.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{" "}
                    <span className={q.chg >= 0 ? "mara-pos" : "mara-neg"}>{q.chg >= 0 ? "+" : ""}{q.chg.toFixed(2)}%</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right group */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>

          {/* Wallet */}
          {!walletAddress ? (
            <button
              onClick={() => void handleConnectWallet()}
              disabled={isConnecting}
              className="mc-btn"
              style={{ gap: 7 }}
            >
              <Wallet size={13} />
              {isConnecting ? "Connecting…" : window.ethereum ? "Connect MetaMask" : "Connect Wallet"}
            </button>
          ) : (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowWalletDropdown(!showWalletDropdown)}
                className="mc-badge mc-badge--pos"
                style={{ padding: "8px 12px", cursor: "pointer" }}
              >
                <span className="mc-dot mc-dot--live" />
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
                {walletIsMetaMask && <span style={{ marginLeft: 4, color: "var(--pos-dim)", fontSize: 10 }}>MetaMask</span>}
              </button>

              {showWalletDropdown && (
                <div style={{
                  position: "absolute", right: 0, top: "calc(100% + 8px)", width: 260, zIndex: 50,
                  background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
                  padding: 16, boxShadow: "0 8px 24px rgba(0,0,0,.6)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span className="mara-label">Wallet</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="mc-dot" style={{ background: "var(--pos)", width: 6, height: 6 }} />
                      <span className="mara-micro mara-pos">CONNECTED</span>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <span className="mara-label" style={{ display: "block", marginBottom: 4 }}>ADDRESS</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-1)", wordBreak: "break-all", lineHeight: 1.6 }}>{walletAddress}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                    <div>
                      <span className="mara-label" style={{ display: "block", marginBottom: 4 }}>BALANCE</span>
                      <span className="mara-value" style={{ fontSize: 18 }}>${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="mara-micro" style={{ display: "block", marginTop: 2 }}>USDC</span>
                    </div>
                    <span className={`mc-badge ${walletIsMetaMask ? "mc-badge--info" : "mc-badge--muted"}`}>
                      {walletIsMetaMask ? "MetaMask" : "Operator"}
                    </span>
                  </div>
                  {!walletIsMetaMask && (
                    <div style={{ background: "var(--amber-bg)", border: "1px solid rgba(232,169,0,.25)", borderRadius: "var(--r-xs)", padding: "8px 10px", marginBottom: 10 }}>
                      <span className="mara-micro mara-amber" style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
                        MetaMask not detected. Showing the MARA operator wallet (read-only).
                      </span>
                    </div>
                  )}
                  <button
                    onClick={handleDisconnectWallet}
                    className="mc-btn mc-btn--neg mc-btn--full"
                    style={{ padding: "9px 0" }}
                  >
                    <LogOut size={13} /> Disconnect
                  </button>
                </div>
              )}
            </div>
          )}

          {/* UTC Clock */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "right" }}>
            <span className="mara-micro" style={{ color: "var(--fg-3)" }}>Desks Operational Clock (UTC)</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}>
              {utcTime || "—"} UTC
            </span>
          </div>

          {/* Status badge */}
          <span
            className={`mc-badge ${isKilled ? "mc-badge--neg" : backendOnline ? "mc-badge--pos" : "mc-badge--muted"}`}
            style={{ padding: "8px 12px" }}
          >
            <Wifi size={13} style={{ marginRight: 5 }} />
            {isKilled ? "HALTED" : backendOnline ? "LIVE · SEC-3" : "OFFLINE"}
          </span>
        </div>
      </header>

      {/* ── Main 3-column grid ── */}
      <main style={{
        flex: 1, minHeight: 0, display: "grid",
        gridTemplateColumns: "minmax(380px,1fr) minmax(420px,1.05fr) minmax(440px,1.15fr)",
        gap: 14, padding: 14, overflow: "hidden",
      }}>

        {/* Col 1: Macro Calendar + Risk Engine */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "hidden" }}>
          <div style={{ height: 260, flexShrink: 0 }}>
            <MacroCalendar
              events={events}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <RiskEngine
              balance={balance}
              openPositions={trades.filter(t => t.status === "OPEN").length}
              maxOpenPositions={3}
              unrealizedPnl={trades.filter(t => t.status === "OPEN").reduce((s, t) => s + t.pnl, 0)}
              isKilled={isKilled}
              onKillSwitchToggle={handleKillSwitchToggle}
              drawdownPercent={drawdownPercent}
              maxDailyTrades={30}
              currentDailyTrades={currentDailyTrades}
            />
          </div>
        </div>

        {/* Col 2: AI Reasoning Feed */}
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <AiReasoningFeed
            reasonings={reasonings}
            onTriggerSimulation={handleTriggerSimulation}
            isSimulating={isSimulating}
          />
        </div>

        {/* Col 3: Performance + Trades + SSI */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "hidden" }}>
          <div style={{ height: 310, flexShrink: 0 }}>
            <PerformanceCard
              pnlHistory={pnlHistory}
              winRate={winRate}
              profitFactor={profitFactor}
              sharpeRatio={sharpeRatio}
              totalTrades={trades.filter(t => t.status === "CLOSED" && t.side !== "ROTATION").length}
              averageR={averageR}
            />
          </div>
          <div style={{ height: 220, flexShrink: 0 }}>
            <TradeStream trades={trades} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <SsiPortfolio holdings={holdings} rotationLogs={rotationLogs} />
          </div>
          <div style={{ flex: 0, minHeight: 0 }}>
            <OnChainAttestation refreshSignal={attestationRefresh} />
          </div>
        </div>
      </main>

      {/* ── Status Footer ── */}
      <footer style={{ padding: "8px 22px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span className="mc-dot mc-dot--live" />
        <span className="mara-micro mara-muted">
          MARA Autonomous Risk Monitor · All systems checked · Inference ready · Backend {backendOnline ? "ONLINE" : "OFFLINE"}
        </span>
        <span className="mara-micro" style={{ marginLeft: "auto", color: "var(--fg-4)" }}>
          RISK CYCLE #{currentDailyTrades} · {new Date().toISOString().slice(0, 10)}
        </span>
      </footer>
    </div>
  );
}
