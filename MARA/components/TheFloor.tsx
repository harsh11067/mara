'use client';

/**
 * THE FLOOR — community strategy chatter. Real logins only, 280 chars,
 * shared across every operator on the desk.
 */
import { useEffect, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { communityApi, timeAgo } from '@/lib/api';
import { useSession } from '@/lib/session';

interface FloorComment { id: string; name: string; body: string; created_at: number }
interface FloorQuota { used: number; max: number; resetAt: number | null }

export function TheFloor() {
  const session = useSession();
  const [comments, setComments] = useState<FloorComment[]>([]);
  const [quota, setQuota] = useState<FloorQuota | null>(null);
  const [durable, setDurable] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [board, setBoard] = useState<Array<{ rank: number; name: string; provider: string; credits: number }>>([]);

  const load = () => {
    void communityApi.comments().then((r) => {
      setComments(r.comments);
      setQuota(r.quota ?? null);
      setDurable(Boolean(r.durable));
    }).catch(() => {});
    void communityApi.creditsBoard().then((r) => setBoard(r.leaderboard)).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  const canPost = session.user !== null && session.user?.provider !== 'guest';
  const quotaLeft = quota ? Math.max(0, quota.max - quota.used) : null;

  const post = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    const res = await communityApi.postComment(body).catch(() => ({ error: 'Network error' }));
    setBusy(false);
    if ('ok' in res && res.ok) { setText(''); load(); }
    else setErr(('error' in res && res.error) || 'Post failed');
  };

  return (
    <section className="mt-16 border border-glass-border bg-background/60 backdrop-blur-xl p-7">
      <div className="font-mono text-[11px] tracking-[0.4em] text-muted uppercase mb-2 flex items-center gap-2">
        <MessagesSquare className="w-4 h-4" /> The Floor
      </div>
      <p className="font-sans text-sm text-muted leading-relaxed mb-6">
        Strategy talk, macro reads, duel trash-talk. Visible to every operator — real logins can post.
        Posts stay on the board for 24h · 3 posts per operator per day
        {durable && <span className="text-amber/70"> · durable store on</span>}
        {canPost && quotaLeft !== null && (
          <span className={quotaLeft === 0 ? 'text-coral' : 'text-amber/70'}>
            {' '}· {quotaLeft === 0
              ? `limit reached${quota?.resetAt ? ` — next slot in ~${Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 3600_000))}h` : ''}`
              : `${quotaLeft} post${quotaLeft === 1 ? '' : 's'} left today`}
          </span>
        )}
      </p>

      <div className="flex gap-3 mb-6">
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 280))}
          onKeyDown={(e) => { if (e.key === 'Enter') void post(); }}
          placeholder={canPost ? 'Your read on the market… (280 chars)' : 'Sign in with Google or a wallet to post'}
          disabled={!canPost || busy}
          className="flex-1 bg-foreground/[0.03] border border-glass-border px-4 py-3 font-sans text-sm focus:outline-none focus:border-amber/50 disabled:opacity-50"
        />
        <button onClick={() => void post()} disabled={!canPost || busy}
          className="font-mono text-xs tracking-[0.2em] uppercase border border-amber/40 text-amber px-5 hover:bg-amber/10 transition-colors disabled:opacity-40">
          Post
        </button>
      </div>
      {err && <div className="font-sans text-xs text-coral mb-4">{err}</div>}

      <div className="grid md:grid-cols-[1fr_280px] gap-8">
        <div className="space-y-4 max-h-72 overflow-y-auto pr-2">
          {comments.length === 0 && (
            <div className="font-mono text-xs text-muted tracking-widest uppercase">The floor is quiet — first call wins respect.</div>
          )}
          {comments.map((cm) => (
            <div key={cm.id} className="border-l-2 border-glass-border pl-4">
              <div className="font-mono text-[11px] tracking-widest uppercase mb-1">
                <span className="text-amber">{cm.name}</span>
                <span className="text-muted ml-3">{timeAgo(cm.created_at)}</span>
              </div>
              <div className="font-sans text-sm text-foreground/90 leading-relaxed">{cm.body}</div>
            </div>
          ))}
        </div>

        {/* Credits leaderboard — web parity with the Telegram /leaderboard */}
        <div className="border border-glass-border p-4 h-fit">
          <div className="font-mono text-[11px] tracking-[0.3em] text-muted uppercase mb-3">Credit Kings</div>
          {board.length === 0 ? (
            <div className="font-mono text-[11px] text-muted uppercase tracking-widest">No balances yet.</div>
          ) : (
            <div className="space-y-1.5">
              {board.map((r) => (
                <div key={r.rank} className="flex items-baseline gap-2 font-mono text-[11px]">
                  <span className="text-muted w-5">{r.rank}.</span>
                  <span className="text-foreground truncate flex-1">{r.name}</span>
                  <span className="text-muted text-[10px] uppercase">{r.provider}</span>
                  <span className="text-amber">{r.credits.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
