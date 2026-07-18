'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, X } from 'lucide-react';

const STEPS: Array<{ tag: string; title: React.ReactNode; body: string }> = [
  {
    tag: '01 — What this is',
    title: <>An agent that <em className="italic text-amber">reads the macro tape</em>.</>,
    body: 'MARA watches U.S. macro releases (CPI, jobs, Fed decisions), reasons about them with an AI pipeline grounded in 100+ historical prints, and executes risk-managed trades on SoDEX. Everything you see on screen is live engine state — nothing is staged.',
  },
  {
    tag: '02 — Get credits',
    title: <>Sign in, receive <em className="italic text-amber">1,000 credits</em>.</>,
    body: 'Use the CONNECT chip (top right). Google or a wallet signature both work — a wallet "connects" by cryptographically signing a one-time message, not just showing an address. Guests can watch everything but hold no credits.',
  },
  {
    tag: '03 — Duel the agent',
    title: <>Call the market <em className="italic text-amber">before MARA does</em>.</>,
    body: 'In SIGNAL DUEL you pick a macro print, stake credits on BULL or BEAR, and then the real AI pipeline runs. Match the agent\'s verdict and your stake doubles. If the pipeline itself fails, your stake is refunded — you never lose to an error.',
  },
  {
    tag: '04 — Rewind time',
    title: <>Replay <em className="italic text-amber">a decade of prints</em>.</>,
    body: 'TIME MACHINE scrubs through real historical releases and shows what MARA would have done with only the data available on that day — no lookahead. Early prints honestly say "not enough history." The P&L curve is computed from real forward BTC returns.',
  },
  {
    tag: '05 — Watch it think',
    title: <>The terminal is <em className="italic text-amber">a window, not a poster</em>.</>,
    body: 'TERMINAL streams the agent\'s reasoning steps live over WebSocket. PORTFOLIO shows real positions, risk limits and the kill switch. Fire a live run from the portfolio desk and watch the whole loop execute.',
  },
];

export function Onboarding() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem('mara_onboarded')) {
      setVisible(true);
    }
    const onOpen = () => { setStep(0); setVisible(true); };
    window.addEventListener('mara:onboarding', onOpen);
    return () => window.removeEventListener('mara:onboarding', onOpen);
  }, []);

  const close = () => {
    localStorage.setItem('mara_onboarded', '1');
    setVisible(false);
  };

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-background/85 backdrop-blur-md p-6"
        >
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-xl border border-glass-border bg-background p-10 md:p-14 shadow-2xl"
          >
            <div className="absolute top-0 left-0 w-2/3 h-[1px] bg-gradient-to-r from-amber/60 to-transparent" />
            <button onClick={close} className="absolute top-5 right-5 text-muted hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>

            <div className="font-mono text-[10px] tracking-[0.4em] text-amber uppercase mb-6">{s.tag}</div>
            <h2 className="font-display text-3xl md:text-4xl leading-tight text-foreground mb-6">{s.title}</h2>
            <p className="text-muted font-sans text-sm md:text-base leading-relaxed mb-10">{s.body}</p>

            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    className={`h-[3px] transition-all duration-500 ${i === step ? 'w-8 bg-amber' : 'w-3 bg-glass-border hover:bg-muted'}`}
                    aria-label={`Step ${i + 1}`}
                  />
                ))}
              </div>
              <button
                onClick={() => (last ? close() : setStep(step + 1))}
                className="inline-flex items-center gap-3 bg-foreground text-background px-6 py-2.5 rounded-full font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-amber transition-colors group"
              >
                {last ? 'Enter the system' : 'Next'}
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Re-open the guide from anywhere (the "?" buttons dispatch this). */
export function openOnboarding() {
  window.dispatchEvent(new Event('mara:onboarding'));
}
