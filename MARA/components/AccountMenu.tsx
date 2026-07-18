'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wallet, LogOut, User, Sparkles, ShieldCheck } from 'lucide-react';
import {
  useSession, restoreSession, loginGuest, loginWallet, loginGoogleCredential,
  logout, discoverWallets, loadGis, GOOGLE_CLIENT_ID,
  type DiscoveredWallet,
} from '@/lib/session';

/**
 * Credits chip + auth popover. Credits are the fuel for Signal Duel:
 * 1,000 MARA credits on first real login (Google or wallet signature).
 * Guest passes let you watch the engine but hold zero credits.
 */
export function AccountMenu() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void restoreSession(); }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Discover wallets + mount the Google button whenever the popover opens signed-out
  useEffect(() => {
    if (!open || session.user) return;
    void discoverWallets().then(setWallets);
    if (GOOGLE_CLIENT_ID) {
      void loadGis().then(() => {
        if (!googleBtnRef.current || !window.google?.accounts) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (res) => {
            setBusy('google'); setErr(null);
            loginGoogleCredential(res.credential)
              .then(() => setOpen(false))
              .catch((e: Error) => setErr(e.message))
              .finally(() => setBusy(null));
          },
        });
        googleBtnRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: 260,
        });
      }).catch(() => setErr('Google Sign-In failed to load'));
    }
  }, [open, session.user]);

  const connectWallet = async (w: DiscoveredWallet) => {
    setBusy(w.uuid); setErr(null);
    try {
      await loginWallet(w);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Wallet sign-in failed');
    } finally { setBusy(null); }
  };

  const guestPass = async () => {
    setBusy('guest'); setErr(null);
    try {
      await loginGuest();
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Guest pass failed');
    } finally { setBusy(null); }
  };

  return (
    <div ref={rootRef} className="relative pointer-events-auto">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 border border-glass-border bg-background/60 backdrop-blur-md px-4 py-2 rounded-full hover:border-amber/40 transition-colors group"
      >
        {session.user ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber shadow-[0_0_8px_var(--color-amber)]" />
            <span className="font-mono text-[10px] tracking-[0.2em] text-foreground uppercase">
              {session.credits.toLocaleString()} <span className="text-muted">CR</span>
            </span>
            <span className="hidden md:inline font-mono text-[10px] tracking-widest text-muted uppercase max-w-[120px] truncate">
              {session.user.name ?? session.user.walletAddress?.slice(0, 8) ?? 'operator'}
            </span>
          </>
        ) : (
          <>
            <User className="w-3 h-3 text-muted group-hover:text-amber transition-colors" />
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted uppercase group-hover:text-foreground transition-colors">
              {session.loading ? 'SYNC…' : 'CONNECT'}
            </span>
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-3 w-[300px] bg-background/95 backdrop-blur-2xl border border-glass-border shadow-2xl z-[200] p-6"
          >
            <div className="absolute top-0 left-0 w-1/2 h-[1px] bg-gradient-to-r from-amber/60 to-transparent" />

            {session.user ? (
              <div>
                <div className="text-[9px] font-mono text-muted tracking-[0.3em] uppercase mb-4">Identity</div>
                <div className="flex items-center gap-3 mb-5">
                  {session.user.avatar
                    ? <img src={session.user.avatar} alt="" className="w-9 h-9 rounded-full border border-glass-border" referrerPolicy="no-referrer" />
                    : <div className="w-9 h-9 rounded-full border border-glass-border flex items-center justify-center"><User className="w-4 h-4 text-muted" /></div>}
                  <div className="min-w-0">
                    <div className="text-sm text-foreground truncate">{session.user.name ?? 'Anonymous operator'}</div>
                    <div className="font-mono text-[9px] tracking-widest uppercase text-amber flex items-center gap-1.5">
                      <ShieldCheck className="w-3 h-3" />
                      {session.user.provider === 'wallet'
                        ? `${session.user.walletAddress?.slice(0, 6)}…${session.user.walletAddress?.slice(-4)} · signed`
                        : session.user.provider}
                    </div>
                  </div>
                </div>

                <div className="border border-glass-border bg-foreground/[0.02] p-4 mb-5">
                  <div className="text-[9px] font-mono text-muted tracking-[0.3em] uppercase mb-1">MARA Credits</div>
                  <div className="text-2xl font-mono text-foreground font-light">{session.credits.toLocaleString()}</div>
                  <div className="text-[10px] text-muted mt-1 font-sans">
                    {session.user.provider === 'guest'
                      ? 'Guest passes hold no credits — sign in with Google or a wallet to receive 1,000.'
                      : 'Stake them in Signal Duel. Beat the agent to double each stake.'}
                  </div>
                </div>

                <button
                  onClick={() => { void logout(); setOpen(false); }}
                  className="w-full flex items-center justify-center gap-2 border border-glass-border py-2.5 font-mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-coral hover:border-coral/40 transition-colors"
                >
                  <LogOut className="w-3 h-3" /> Disconnect
                </button>
              </div>
            ) : (
              <div>
                <div className="text-[9px] font-mono text-muted tracking-[0.3em] uppercase mb-2">Enter the system</div>
                <p className="text-[11px] text-muted font-sans leading-relaxed mb-5">
                  Sign in with Google or a wallet signature to receive
                  <span className="text-amber"> 1,000 MARA credits</span> — the stake currency of Signal Duel.
                </p>

                {GOOGLE_CLIENT_ID ? (
                  <div ref={googleBtnRef} className="mb-3 min-h-[40px]" />
                ) : (
                  <div className="mb-3 border border-glass-border p-3 text-[10px] font-mono text-muted tracking-wider">
                    GOOGLE SIGN-IN NOT CONFIGURED
                  </div>
                )}

                <div className="space-y-2 mb-3">
                  {wallets.length === 0 && (
                    <div className="border border-glass-border p-3 text-[10px] font-mono text-muted tracking-wider flex items-center gap-2">
                      <Wallet className="w-3 h-3" /> NO WALLET EXTENSION DETECTED
                    </div>
                  )}
                  {wallets.map((w) => (
                    <button
                      key={w.uuid}
                      onClick={() => void connectWallet(w)}
                      disabled={busy !== null}
                      className="w-full flex items-center gap-3 border border-glass-border px-4 py-2.5 hover:border-amber/40 hover:bg-amber/5 transition-colors disabled:opacity-40"
                    >
                      {w.icon
                        ? <img src={w.icon} alt="" className="w-4 h-4" />
                        : <Wallet className="w-4 h-4 text-muted" />}
                      <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-foreground">
                        {busy === w.uuid ? 'SIGN THE MESSAGE…' : w.name}
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => void guestPass()}
                  disabled={busy !== null}
                  className="w-full flex items-center justify-center gap-2 py-2 font-mono text-[10px] tracking-[0.2em] uppercase text-muted hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <Sparkles className="w-3 h-3" />
                  {busy === 'guest' ? 'ISSUING PASS…' : 'Browse as guest (0 credits)'}
                </button>

                {err && <div className="mt-3 text-[10px] font-mono text-coral tracking-wider break-words">{err}</div>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
