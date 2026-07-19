'use client';

/**
 * TICKER TAPE — the whole live board as a rolling marquee (Wave 7).
 * One `/api/ticker` call carries every SoDEX perps symbol, every spot pair
 * and the SoSoValue SSI indices; refreshed every 30s. Pure CSS animation,
 * duplicated track for a seamless loop. Hidden on the landing page.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { portfolioApi } from '@/lib/api';

interface TapeItem { symbol: string; price: number; changePct: number | null; src: 'perps' | 'spot' | 'ssi' }

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return p.toPrecision(4);
}

export function TickerTape() {
  const pathname = usePathname();
  const [items, setItems] = useState<TapeItem[]>([]);

  useEffect(() => {
    if (pathname === '/') return;
    let stale = false;
    const pull = () => void portfolioApi.ticker()
      .then((r) => { if (!stale && r.items?.length) setItems(r.items); })
      .catch(() => {});
    pull();
    const t = setInterval(pull, 30_000);
    return () => { stale = true; clearInterval(t); };
  }, [pathname]);

  if (pathname === '/' || items.length === 0) return null;

  // ~40s per viewport-width scales with item count so density ≠ speed
  const duration = Math.max(60, items.length * 1.1);

  const cell = (t: TapeItem, i: number) => (
    <span key={`${t.symbol}-${i}`} className="inline-flex items-baseline gap-1.5 px-4 whitespace-nowrap">
      <span className={`font-mono text-[11px] tracking-wider uppercase ${t.src === 'ssi' ? 'text-amber/80' : 'text-muted'}`}>
        {t.symbol}
      </span>
      <span className="font-mono text-[11px] text-foreground">${fmtPrice(t.price)}</span>
      {t.changePct !== null && (
        <span className={`font-mono text-[10px] ${t.changePct > 0 ? 'text-olive' : t.changePct < 0 ? 'text-coral' : 'text-muted'}`}>
          {t.changePct > 0 ? '+' : ''}{t.changePct.toFixed(2)}%
        </span>
      )}
    </span>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[80] h-7 bg-background/90 backdrop-blur-md border-t border-glass-border overflow-hidden pointer-events-none select-none">
      <div
        className="flex items-center h-full w-max"
        style={{ animation: `mara-tape ${duration}s linear infinite` }}
      >
        {items.map(cell)}
        {items.map((t, i) => cell(t, i + items.length))}
      </div>
    </div>
  );
}
