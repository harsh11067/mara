'use client';

/**
 * QuickActions — Feedback ("Submit a request") + Referral link buttons.
 * Rendered next to AccountMenu so they appear in every page header.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LifeBuoy, UserPlus, X, Check, Copy } from 'lucide-react';
import { communityApi } from '@/lib/api';
import { useSession } from '@/lib/session';

const CATEGORIES = [
  ['bug', 'Bug / something broke'],
  ['feature-request', 'Feature request'],
  ['data-issue', 'Data looks wrong'],
  ['account', 'Account / credits'],
  ['other', 'Other'],
] as const;

export function QuickActions() {
  const session = useSession();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  // Feedback form state
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<string>('bug');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // Referral state
  const [refData, setRefData] = useState<{ link: string; bonus: number; joined: number; earned: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setState(null);
    setSending(true);
    const res = await communityApi.feedback({
      email, category, subject: subject || undefined, description,
      page: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }).catch(() => ({ error: 'Network error — try again' }));
    setSending(false);
    if ('ok' in res && res.ok) {
      setState('sent');
      setDescription(''); setSubject('');
    } else {
      setState(('error' in res && res.error) || 'Submission failed');
    }
  };

  const openReferral = async () => {
    setRefOpen((o) => !o);
    setFeedbackOpen(false);
    if (!refData && session.user !== null) {
      const r = await communityApi.referral().catch(() => null);
      if (r && !r.error) setRefData({ link: r.link, bonus: r.bonus, joined: r.joined, earned: r.earned });
    }
  };

  const copyLink = () => {
    if (!refData) return;
    void navigator.clipboard.writeText(refData.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative flex items-center gap-4">
      <button
        onClick={() => { setFeedbackOpen((o) => !o); setRefOpen(false); }}
        aria-label="Submit a request"
        title="Feedback / support"
        className="text-muted hover:text-amber transition-colors"
      >
        <LifeBuoy className="w-4 h-4" />
      </button>
      <button
        onClick={() => void openReferral()}
        aria-label="Invite — referral link"
        title="Invite a player (+250 CR each)"
        className="text-muted hover:text-amber transition-colors"
      >
        <UserPlus className="w-4 h-4" />
      </button>

      {/* Feedback modal */}
      <AnimatePresence>
        {feedbackOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute right-0 top-10 w-[340px] max-w-[85vw] bg-background border border-glass-border shadow-2xl p-5 z-[95]"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[11px] tracking-[0.25em] text-amber uppercase">Submit a request</div>
              <button onClick={() => setFeedbackOpen(false)} className="text-muted hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <p className="font-sans text-[11px] text-muted leading-relaxed mb-4">
              Fields marked with an asterisk (*) are required. Requests land directly in the operator&apos;s Telegram.
            </p>
            <div className="space-y-3">
              <div>
                <label className="font-mono text-[10px] text-muted tracking-widest uppercase block mb-1">Your email address *</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com"
                  className="w-full bg-foreground/[0.03] border border-glass-border px-3 py-2 font-sans text-sm focus:outline-none focus:border-amber/50" />
              </div>
              <div>
                <label className="font-mono text-[10px] text-muted tracking-widest uppercase block mb-1">Category *</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-foreground/[0.03] border border-glass-border px-3 py-2 font-sans text-sm focus:outline-none focus:border-amber/50">
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="font-mono text-[10px] text-muted tracking-widest uppercase block mb-1">Subject</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-foreground/[0.03] border border-glass-border px-3 py-2 font-sans text-sm focus:outline-none focus:border-amber/50" />
              </div>
              <div>
                <label className="font-mono text-[10px] text-muted tracking-widest uppercase block mb-1">Problem description *</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4}
                  placeholder="What happened, what you expected, and where."
                  className="w-full bg-foreground/[0.03] border border-glass-border px-3 py-2 font-sans text-sm focus:outline-none focus:border-amber/50 resize-none" />
              </div>
              <button onClick={() => void submit()} disabled={sending}
                className="w-full font-mono text-[11px] tracking-[0.2em] uppercase border border-amber/40 text-amber py-2.5 hover:bg-amber/10 transition-colors disabled:opacity-50">
                {sending ? 'Sending…' : 'Submit request'}
              </button>
              {state && (
                <div className={`font-sans text-xs leading-relaxed ${state === 'sent' ? 'text-olive' : 'text-coral'}`}>
                  {state === 'sent' ? '✓ Received — thank you. It just pinged the operator.' : state}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Referral popover */}
      <AnimatePresence>
        {refOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute right-0 top-10 w-[320px] max-w-[85vw] bg-background border border-glass-border shadow-2xl p-5 z-[95]"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[11px] tracking-[0.25em] text-amber uppercase">Invite a player</div>
              <button onClick={() => setRefOpen(false)} className="text-muted hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {session.user === null ? (
              <p className="font-sans text-xs text-muted leading-relaxed">Sign in to get your referral link — you and every player who joins through it get <span className="text-amber">+250 CR</span>.</p>
            ) : !refData ? (
              <p className="font-mono text-[10px] text-muted tracking-widest uppercase">loading…</p>
            ) : (
              <>
                <p className="font-sans text-xs text-muted leading-relaxed mb-3">
                  Both sides earn <span className="text-amber">+{refData.bonus} CR</span> when someone signs up through your link.
                  So far: <span className="text-foreground">{refData.joined} joined · {refData.earned} CR earned</span>.
                </p>
                <div className="flex gap-2">
                  <div className="flex-1 bg-foreground/[0.03] border border-glass-border px-3 py-2 font-mono text-[10px] text-foreground truncate">{refData.link}</div>
                  <button onClick={copyLink} className="border border-amber/40 text-amber px-3 hover:bg-amber/10 transition-colors">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
