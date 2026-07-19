'use client';

/**
 * MARA Concierge — floating Gemini-backed helper (bottom-right, all pages).
 * Login required; 3 free questions, answers ≤100 words, +25 Qs for 250 CR.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, Sparkles, Lock } from 'lucide-react';
import { chatApi } from '@/lib/api';
import { useSession, setCredits } from '@/lib/session';

interface Msg { role: 'you' | 'mara'; text: string }

export function ChatDock() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<{ used: number; quota: number; cost: number; adds: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const signedIn = session.user !== null;

  useEffect(() => {
    if (open && signedIn) {
      void chatApi.quota().then((q) => setQuota({ used: q.used, quota: q.quota, cost: q.unlock.cost, adds: q.unlock.adds })).catch(() => {});
    }
  }, [open, signedIn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setNotice(null);
    setMsgs((m) => [...m, { role: 'you', text: q }]);
    setBusy(true);
    try {
      const res = await chatApi.send(q);
      if (res.reply) {
        setMsgs((m) => [...m, { role: 'mara', text: res.reply as string }]);
        if (res.used !== undefined && res.quota !== undefined) {
          setQuota((prev) => prev ? { ...prev, used: res.used as number, quota: res.quota as number } : prev);
        }
        if (res.credits !== undefined) setCredits(res.credits);
      } else if (res.premium) {
        setNotice(`Free questions used. Unlock ${res.premium.adds} more for ${res.premium.cost} CR (you hold ${res.premium.credits}).`);
      } else if (res.error) {
        setNotice(res.error);
      }
    } catch {
      setNotice('Concierge unreachable — try again shortly.');
    }
    setBusy(false);
  };

  const unlock = async () => {
    setNotice(null);
    const res = await chatApi.unlock().catch(() => ({ error: 'Unlock failed' } as const));
    if ('ok' in res && res.ok) {
      setQuota((prev) => prev ? { ...prev, used: res.used ?? prev.used, quota: res.quota ?? prev.quota } : prev);
      if (res.credits !== undefined) setCredits(res.credits);
      setNotice(`Premium unlocked — ${res.quota} total questions.`);
    } else {
      setNotice(('error' in res && res.error) || 'Unlock failed — need 250 CR (win some in the Arcade).');
    }
  };

  const exhausted = quota !== null && quota.used >= quota.quota;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="MARA Concierge"
        className="fixed bottom-6 right-6 z-[90] w-12 h-12 border border-amber/40 bg-background/90 backdrop-blur-md text-amber flex items-center justify-center hover:bg-amber/10 transition-colors shadow-lg shadow-black/40"
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-20 right-6 z-[90] w-[340px] max-w-[calc(100vw-3rem)] bg-background border border-glass-border shadow-2xl flex flex-col"
            style={{ height: 'min(480px, 70vh)' }}
          >
            <div className="px-4 py-3 border-b border-glass-border flex items-center justify-between">
              <div className="font-mono text-[11px] tracking-[0.25em] text-amber uppercase flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> MARA Concierge
              </div>
              {quota && (
                <div className="font-mono text-[10px] text-muted tracking-widest">{quota.used}/{quota.quota} Qs</div>
              )}
            </div>

            {!signedIn ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                <Lock className="w-5 h-5 text-muted" />
                <p className="font-sans text-sm text-muted leading-relaxed">
                  Sign in (Google or wallet) to talk to the concierge — 3 questions free, ≤100-word answers, grounded in the live engine.
                </p>
              </div>
            ) : (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {msgs.length === 0 && (
                    <p className="font-sans text-xs text-muted leading-relaxed">
                      Ask about the pipeline, the regime, duels, the arcade, or what the numbers mean.
                      Answers stay under 100 words and cite the live engine state.
                    </p>
                  )}
                  {msgs.map((m, i) => (
                    <div key={i} className={`font-sans text-sm leading-relaxed max-w-[90%] p-3 ${m.role === 'you' ? 'ml-auto bg-amber/10 text-foreground border border-amber/20' : 'bg-foreground/[0.03] text-foreground/90 border border-glass-border'}`}>
                      {m.text}
                    </div>
                  ))}
                  {busy && <div className="font-mono text-[10px] text-muted tracking-widest uppercase animate-pulse">thinking…</div>}
                  {notice && (
                    <div className="font-sans text-xs text-amber leading-relaxed border border-amber/30 bg-amber/5 p-3">
                      {notice}
                      {exhausted && (
                        <button onClick={() => void unlock()} className="block mt-2 font-mono text-[10px] tracking-widest uppercase border border-amber/50 px-3 py-1.5 hover:bg-amber/10 transition-colors">
                          Unlock +{quota?.adds} Qs · {quota?.cost} CR
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="p-3 border-t border-glass-border flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
                    placeholder={exhausted ? 'Quota used — unlock premium above' : 'Ask the machine…'}
                    disabled={exhausted || busy}
                    className="flex-1 bg-foreground/[0.03] border border-glass-border px-3 py-2 font-sans text-sm focus:outline-none focus:border-amber/50 disabled:opacity-50"
                  />
                  <button onClick={() => void ask()} disabled={busy || exhausted} className="font-mono text-[10px] tracking-widest uppercase border border-amber/40 text-amber px-3 hover:bg-amber/10 transition-colors disabled:opacity-40">
                    Ask
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
