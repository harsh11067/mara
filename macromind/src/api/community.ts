/**
 * Community + support surfaces (Wave 6):
 *
 *   POST /api/feedback  — "Submit a request": email* + description* (+category,
 *                         subject, page). Stored, then pushed to the operator's
 *                         Telegram so nothing rots in a table.
 *   GET  /api/comments  — The Floor: latest community strategy comments.
 *   POST /api/comments  — post to The Floor (login required, 280 chars).
 *   GET  /api/referral  — the caller's referral link + how many joined.
 */
import type { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../store/db.js';
import { getUserFromRequest, grantCredits, creditsBalance, REFERRAL_BONUS } from './auth.js';
import { tgSend } from '../services/telegram-deck.js';
import { sbInsert, sbSelect, supabaseTableReady } from '../store/supabase-store.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Community');

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID ?? '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CATEGORIES = ['bug', 'feature-request', 'data-issue', 'account', 'other'];

// The Floor rules (Wave 7): every post stays visible for at least 24 hours,
// and each account gets 3 posts per rolling 24-hour window.
const FLOOR_RETENTION_MS = 24 * 60 * 60 * 1000;
const FLOOR_POSTS_PER_DAY = 3;
const FLOOR_MIN_VISIBLE = 12; // when the last 24h are quiet, backfill with older posts

type FloorPost = { id: string; user_id?: string | null; name: string; body: string; created_at: number };

// ── Daily Ration (Wave 7) — one claim per day, streak grows the payout ────────
// 50 CR base, +25 per consecutive day, capped at 200. 20h cooldown (kind to
// timezones); missing 48h resets the streak. Shared by web + Telegram /claim.
const CLAIM_BASE = 50, CLAIM_STEP = 25, CLAIM_MAX = 200;
const CLAIM_COOLDOWN_MS = 20 * 60 * 60 * 1000;
const STREAK_WINDOW_MS = 48 * 60 * 60 * 1000;
const claimAmount = (streak: number) => Math.min(CLAIM_BASE + (streak - 1) * CLAIM_STEP, CLAIM_MAX);

export function claimState(userId: string): { claimable: boolean; streak: number; nextAmount: number; nextClaimAt: number | null } {
  const row = getDb().prepare('SELECT last_claim_at, streak FROM daily_claims WHERE user_id = ?')
    .get(userId) as { last_claim_at: number; streak: number } | undefined;
  const now = Date.now();
  const sinceLast = row ? now - row.last_claim_at : Infinity;
  const nextStreak = !row ? 1 : sinceLast > STREAK_WINDOW_MS ? 1 : row.streak + 1;
  return {
    claimable: sinceLast >= CLAIM_COOLDOWN_MS,
    streak: row?.streak ?? 0,
    nextAmount: claimAmount(nextStreak),
    nextClaimAt: row ? row.last_claim_at + CLAIM_COOLDOWN_MS : null,
  };
}

/** Claim-row upsert + grant in one transaction; ok=false when still cooling down. */
export function performDailyClaim(userId: string): { ok: boolean; amount: number; streak: number } {
  const db = getDb();
  const now = Date.now();
  let amount = 0, streak = 0;
  const ok = db.transaction((): boolean => {
    const row = db.prepare('SELECT last_claim_at, streak FROM daily_claims WHERE user_id = ?')
      .get(userId) as { last_claim_at: number; streak: number } | undefined;
    if (row && now - row.last_claim_at < CLAIM_COOLDOWN_MS) return false;
    streak = !row ? 1 : now - row.last_claim_at > STREAK_WINDOW_MS ? 1 : row.streak + 1;
    amount = claimAmount(streak);
    db.prepare(`INSERT INTO daily_claims (user_id, last_claim_at, streak) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET last_claim_at = excluded.last_claim_at, streak = excluded.streak`)
      .run(userId, now, streak);
    grantCredits(userId, amount, 'daily_claim', `streak_${streak}`);
    return true;
  })();
  if (ok) logger.info(`Daily claim: ${userId.slice(0, 8)} +${amount} CR (streak ${streak})`);
  return { ok, amount, streak };
}

function floorQuota(userId: string): { used: number; max: number; resetAt: number | null } {
  const since = Date.now() - FLOOR_RETENTION_MS;
  const rows = getDb().prepare(
    'SELECT created_at FROM comments WHERE user_id = ? AND created_at > ? ORDER BY created_at ASC',
  ).all(userId, since) as { created_at: number }[];
  return {
    used: rows.length,
    max: FLOOR_POSTS_PER_DAY,
    // the oldest post inside the window falling out is when a slot frees up
    resetAt: rows.length >= FLOOR_POSTS_PER_DAY ? rows[0].created_at + FLOOR_RETENTION_MS : null,
  };
}

export function communityRoutes(app: Hono): void {
  // ── Feedback / support requests ────────────────────────────────────────────
  app.post('/api/feedback', async (c) => {
    type Body = { email?: string; category?: string; subject?: string; description?: string; page?: string };
    let body: Body;
    try { body = await c.req.json() as Body; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const email = (body.email ?? '').trim();
    const description = (body.description ?? '').trim();
    if (!EMAIL_RE.test(email)) return c.json({ error: 'A valid email address is required' }, 400);
    if (description.length < 10) return c.json({ error: 'Describe the problem in at least 10 characters' }, 400);
    const category = CATEGORIES.includes(body.category ?? '') ? (body.category as string) : 'other';
    const subject = (body.subject ?? '').trim().slice(0, 120) || null;
    const page = (body.page ?? '').trim().slice(0, 120) || null;
    const user = getUserFromRequest(c);

    const id = uuidv4();
    const createdAt = Date.now();
    getDb().prepare(
      'INSERT INTO feedback (id, user_id, email, category, subject, description, page, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, user?.id ?? null, email, category, subject, description.slice(0, 2000), page, createdAt);
    sbInsert('feedback_inbox', {
      id, user_id: user?.id ?? null, email, category, subject,
      description: description.slice(0, 2000), page, created_at: createdAt,
    });

    // Push to the operator — feedback that nobody reads is theater
    if (ADMIN_CHAT_ID) {
      void tgSend(ADMIN_CHAT_ID, [
        `📮 <b>FEEDBACK [${category}]</b>${subject ? ` — ${subject.replace(/</g, '&lt;')}` : ''}`,
        `From: ${email.replace(/</g, '&lt;')}${page ? ` · page: ${page}` : ''}`,
        ``,
        description.slice(0, 600).replace(/</g, '&lt;'),
      ].join('\n'));
    }
    logger.info(`Feedback ${id.slice(0, 8)} [${category}] from ${email}`);
    return c.json({ ok: true, id, message: 'Request received — it lands directly in the operator\'s Telegram.' });
  });

  // ── The Floor — community comments ─────────────────────────────────────────
  // Reads prefer the Supabase durable copy (posts survive redeploys even if
  // the SQLite file is lost); SQLite remains the fallback + rate-limit ledger.
  app.get('/api/comments', async (c) => {
    const since = Date.now() - FLOOR_RETENTION_MS;
    let rows: FloorPost[] | null = null;
    if (supabaseTableReady('floor_posts')) {
      rows = await sbSelect<FloorPost>('floor_posts', 'select=id,name,body,created_at&order=created_at.desc&limit=100');
    }
    if (!rows) {
      rows = getDb().prepare(
        'SELECT id, name, body, created_at FROM comments ORDER BY created_at DESC LIMIT 100',
      ).all() as FloorPost[];
    }
    // Retention contract: everything from the last 24h is always shown;
    // older posts only backfill quiet boards up to FLOOR_MIN_VISIBLE.
    const recent = rows.filter((r) => r.created_at > since);
    const shown = recent.length >= FLOOR_MIN_VISIBLE
      ? recent
      : rows.slice(0, Math.max(FLOOR_MIN_VISIBLE, recent.length));

    const user = getUserFromRequest(c);
    return c.json({
      comments: shown,
      retentionHours: 24,
      quota: user && user.provider !== 'guest' ? floorQuota(user.id) : null,
      durable: supabaseTableReady('floor_posts'),
    });
  });

  app.post('/api/comments', async (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in to post on The Floor' }, 401);
    if (user.provider === 'guest') return c.json({ error: 'The Floor needs a real login (Google or wallet)' }, 403);
    let text = '';
    try {
      const body = await c.req.json() as { body?: string };
      text = (body.body ?? '').trim();
    } catch { /* handled below */ }
    if (text.length < 2) return c.json({ error: 'Say something' }, 400);
    if (text.length > 280) return c.json({ error: 'Max 280 characters' }, 400);

    const quota = floorQuota(user.id);
    if (quota.used >= quota.max) {
      const mins = quota.resetAt ? Math.ceil((quota.resetAt - Date.now()) / 60_000) : 60;
      return c.json({ error: `Floor limit: ${quota.max} posts per 24h. Next slot in ~${mins} min.`, quota }, 429);
    }

    const id = uuidv4();
    const row = { id, user_id: user.id, name: user.name ?? 'operator', body: text, created_at: Date.now() };
    getDb().prepare('INSERT INTO comments (id, user_id, name, body, created_at) VALUES (?,?,?,?,?)')
      .run(row.id, row.user_id, row.name, row.body, row.created_at);
    sbInsert('floor_posts', row); // durable copy
    return c.json({ ok: true, id, quota: floorQuota(user.id) });
  });

  app.get('/api/claim', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first' }, 401);
    return c.json(claimState(user.id));
  });

  app.post('/api/claim', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first' }, 401);
    if (user.provider === 'guest') return c.json({ error: 'Daily ration needs a real login (Google, wallet or Telegram)' }, 403);
    const res = performDailyClaim(user.id);
    if (!res.ok) {
      const st = claimState(user.id);
      return c.json({ error: `Already claimed — next ration in ~${Math.max(1, Math.ceil(((st.nextClaimAt ?? Date.now()) - Date.now()) / 3600_000))}h`, ...st }, 429);
    }
    // claimState().streak intentionally wins the spread — it reflects the post-claim row
    return c.json({ ok: true, amount: res.amount, credits: creditsBalance(user.id), ...claimState(user.id) });
  });

  // ── Credits leaderboard (Wave 7) — web parity with Telegram /leaderboard ───
  app.get('/api/leaderboard/credits', (c) => {
    const rows = getDb().prepare(`
      SELECT u.name, u.provider, COALESCE(SUM(l.delta), 0) AS credits
      FROM users u JOIN credit_ledger l ON l.user_id = u.id
      GROUP BY u.id HAVING credits > 0
      ORDER BY credits DESC LIMIT 10
    `).all() as Array<{ name: string | null; provider: string; credits: number }>;
    return c.json({ leaderboard: rows.map((r, i) => ({ rank: i + 1, name: r.name ?? 'operator', provider: r.provider, credits: r.credits })) });
  });

  // ── Referral link + stats ──────────────────────────────────────────────────
  app.get('/api/referral', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first' }, 401);
    const joined = getDb().prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?')
      .get(user.id) as { n: number };
    return c.json({
      code: user.id,
      link: `https://mara-neon.vercel.app/?ref=${user.id}`,
      bonus: REFERRAL_BONUS,
      joined: joined.n,
      earned: joined.n * REFERRAL_BONUS,
    });
  });
}
