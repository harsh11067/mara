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
import { getUserFromRequest, REFERRAL_BONUS } from './auth.js';
import { tgSend } from '../services/telegram-deck.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Community');

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID ?? '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CATEGORIES = ['bug', 'feature-request', 'data-issue', 'account', 'other'];

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
    getDb().prepare(
      'INSERT INTO feedback (id, user_id, email, category, subject, description, page, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, user?.id ?? null, email, category, subject, description.slice(0, 2000), page, Date.now());

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
  app.get('/api/comments', (c) => {
    const rows = getDb().prepare(
      'SELECT id, name, body, created_at FROM comments ORDER BY created_at DESC LIMIT 50',
    ).all();
    return c.json({ comments: rows });
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

    const id = uuidv4();
    getDb().prepare('INSERT INTO comments (id, user_id, name, body, created_at) VALUES (?,?,?,?,?)')
      .run(id, user.id, user.name ?? 'operator', text, Date.now());
    return c.json({ ok: true, id });
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
