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

export function TheFloor() {
  const session = useSession();
  const [comments, setComments] = useState<FloorComment[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => { void communityApi.comments().then((r) => setComments(r.comments)).catch(() => {}); };
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  const canPost = session.user !== null && session.user?.provider !== 'guest';

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
    </section>
  );
}
