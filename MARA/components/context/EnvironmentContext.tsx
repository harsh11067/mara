'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { api, type BackendRegime } from '@/lib/api';

/**
 * The ambience of the whole app is driven by the REAL market regime from the
 * engine's classifier (/api/regime): realized BTC volatility sets the glow
 * intensity and noise level; the trend direction sets the color temperature.
 * No random walks — when the market is calm the interface is calm.
 */

type EnvironmentState = {
  volatility: number;                    // 0..1, from realized annualized BTC vol
  marketTrend: 'bullish' | 'bearish';
  regime: BackendRegime | null;          // full classifier output for any consumer
};

const EnvironmentContext = createContext<EnvironmentState>({ volatility: 0.35, marketTrend: 'bullish', regime: null });

export function EnvironmentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EnvironmentState>({ volatility: 0.35, marketTrend: 'bullish', regime: null });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const regime = await api.regime();
        if (!alive || regime.error) return;
        // Map annualized vol (~20% calm … ~100%+ crisis) onto a 0.1–0.9 glow scale
        const vol = Math.max(0.1, Math.min(0.9, regime.realizedVolAnnual / 110));
        setState({
          volatility: vol,
          marketTrend: regime.trendPct >= 0 ? 'bullish' : 'bearish',
          regime,
        });
      } catch { /* backend offline — keep the last real reading */ }
    };
    void load();
    const interval = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  return (
    <EnvironmentContext.Provider value={state}>
      <AmbientMarketGlow state={state} />
      {children}
    </EnvironmentContext.Provider>
  );
}

function AmbientMarketGlow({ state }: { state: EnvironmentState }) {
  const isBearish = state.marketTrend === 'bearish';
  const intensity = state.volatility;

  return (
    <motion.div
      className="fixed inset-0 pointer-events-none z-[-1] mix-blend-screen"
      animate={{
        background: isBearish
          ? `radial-gradient(circle at 50% 10%, rgba(255, 60, 0, ${intensity * 0.08}), transparent 80%)`
          : `radial-gradient(circle at 50% 10%, rgba(255, 179, 71, ${intensity * 0.06}), transparent 80%)`
      }}
      transition={{ duration: 4, ease: 'easeInOut' }}
    />
  );
}

export const useEnvironment = () => useContext(EnvironmentContext);
