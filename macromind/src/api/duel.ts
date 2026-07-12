/**
 * SIGNAL DUEL — stake MARA credits on your macro read before the agent speaks.
 *
 * Flow:
 *   1. Operator picks an event print (name / actual / forecast), a direction
 *      (BULL or BEAR) and a stake. The stake is deducted immediately.
 *   2. The REAL pipeline runs (same Analyzer as /api/trigger — live Gemini,
 *      live market data, on-chain attestation).
 *   3. Resolution vs the agent's verdict:
 *        agent BULL-group  + you BULL  → WIN  (stake ×2 back)
 *        agent BEAR-group  + you BEAR  → WIN  (stake ×2 back)
 *        agent NEUTRAL                 → PUSH (stake refunded)
 *        otherwise                     → LOSS (stake burned)
 *      Pipeline failure → ERROR (stake refunded — never charged for our miss).
 *
 * The duel result is broadcast over WS as { type: 'duel_result' } so the
 * terminal reveals it live.
 */
import type { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../store/db.js';
import { createLogger } from '../utils/logger.js';
import { Analyzer } from '../ai/analyzer.js';
import { isKillSwitchActive } from '../executor/kill-switch.js';
import { getUserFromRequest, spendCredits, grantCredits, creditsBalance } from './auth.js';
import { tryAcquireTrigger } from './trigger-lock.js';

const logger = createLogger('Duel');

const MIN_STAKE = 25;
const MAX_STAKE = 500;
const BULL_GROUP = new Set(['STRONG_BULL', 'BULL']);
const BEAR_GROUP = new Set(['STRONG_BEAR', 'BEAR']);

interface DuelRow {
  id: string; user_id: string; event_name: string;
  actual: number; forecast: number; prediction: string; stake: number;
  mara_verdict: string | null; mara_confidence: number | null; decision_id: string | null;
  outcome: string; payout: number; created_at: number; resolved_at: number | null;
}

function resolveDuel(duelId: string, userId: string, prediction: string, stake: number,
  verdict: string, confidence: number, decisionId: string | null,
  broadcast: (type: string, data: unknown) => void): void {
  let outcome: 'WIN' | 'LOSS' | 'PUSH';
  let payout = 0;
  if (verdict === 'NEUTRAL') {
    outcome = 'PUSH'; payout = stake;
    grantCredits(userId, stake, 'duel_push', duelId);
  } else if ((BULL_GROUP.has(verdict) && prediction === 'BULL') || (BEAR_GROUP.has(verdict) && prediction === 'BEAR')) {
    outcome = 'WIN'; payout = stake * 2;
    grantCredits(userId, payout, 'duel_win', duelId);
  } else {
    outcome = 'LOSS'; payout = 0;
  }
  getDb().prepare(
    'UPDATE duels SET mara_verdict = ?, mara_confidence = ?, decision_id = ?, outcome = ?, payout = ?, resolved_at = ? WHERE id = ?',
  ).run(verdict, confidence, decisionId, outcome, payout, Date.now(), duelId);
  broadcast('duel_result', {
    duelId, userId, prediction, stake, verdict, confidence, outcome, payout,
    credits: creditsBalance(userId),
  });
  logger.info(`Duel ${duelId.slice(0, 8)}: you=${prediction} agent=${verdict} → ${outcome} (${payout})`);
}

export function duelRoutes(app: Hono, broadcast: (type: string, data: unknown) => void): void {
  app.post('/api/duel/start', async (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first — a guest pass works (POST /api/auth/guest)' }, 401);
    if (isKillSwitchActive()) return c.json({ error: 'Kill switch active — engine halted' }, 403);

    type Body = { event?: string; actual?: number; forecast?: number; previous?: number; prediction?: string; stake?: number };
    let body: Body;
    try { body = await c.req.json() as Body; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const { event, actual, forecast, prediction } = body;
    const stake = Math.round(body.stake ?? 0);
    if (!event || actual === undefined || forecast === undefined) {
      return c.json({ error: 'event, actual and forecast are required' }, 400);
    }
    if (prediction !== 'BULL' && prediction !== 'BEAR') {
      return c.json({ error: 'prediction must be BULL or BEAR' }, 400);
    }
    if (stake < MIN_STAKE || stake > MAX_STAKE) {
      return c.json({ error: `stake must be between ${MIN_STAKE} and ${MAX_STAKE} credits` }, 400);
    }

    const lock = tryAcquireTrigger();
    if (!lock.ok) {
      return c.json({ error: `A live cycle is already running — retry in ${lock.retryInSec}s` }, 429);
    }

    try {
      spendCredits(user.id, stake, 'duel_stake');
    } catch (err) {
      return c.json({ error: String(err instanceof Error ? err.message : err) }, 402);
    }

    const duelId = uuidv4();
    getDb().prepare(
      'INSERT INTO duels (id, user_id, event_name, actual, forecast, prediction, stake, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(duelId, user.id, event, actual, forecast, prediction, stake, Date.now());

    // Fire the REAL pipeline — resolve when the verdict lands
    const analyzer = new Analyzer();
    analyzer.analyze({ eventName: event, actual, forecast, previous: body.previous ?? null })
      .then(({ decision }) => {
        broadcast('decision', {
          decisionId: decision.id, eventName: event,
          conviction: decision.conviction, confidence: decision.confidence,
          action: decision.action, reasoning: decision.reasoning, timestamp: Date.now(),
        });
        resolveDuel(duelId, user.id, prediction, stake, decision.conviction, decision.confidence, decision.id, broadcast);
      })
      .catch((err) => {
        logger.error('Duel pipeline error — refunding stake', { error: String(err) });
        grantCredits(user.id, stake, 'duel_refund', duelId);
        getDb().prepare('UPDATE duels SET outcome = ?, payout = ?, resolved_at = ? WHERE id = ?')
          .run('ERROR', stake, Date.now(), duelId);
        broadcast('duel_result', {
          duelId, userId: user.id, prediction, stake, verdict: null, confidence: null,
          outcome: 'ERROR', payout: stake, credits: creditsBalance(user.id),
        });
      });

    return c.json({
      ok: true, duelId, stake, prediction,
      credits: creditsBalance(user.id),
      message: 'Duel locked. The agent is analyzing — verdict arrives over the live feed.',
    });
  });

  app.get('/api/duel/mine', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    const rows = getDb()
      .prepare('SELECT * FROM duels WHERE user_id = ? ORDER BY created_at DESC LIMIT 25')
      .all(user.id) as DuelRow[];
    return c.json({ duels: rows, credits: creditsBalance(user.id) });
  });

  app.get('/api/duel/leaderboard', (c) => {
    const rows = getDb().prepare(`
      SELECT u.id, COALESCE(u.name, 'Operator') AS name, u.provider,
             COALESCE((SELECT SUM(delta) FROM credit_ledger l WHERE l.user_id = u.id), 0) AS credits,
             SUM(CASE WHEN d.outcome = 'WIN'  THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN d.outcome = 'LOSS' THEN 1 ELSE 0 END) AS losses,
             SUM(CASE WHEN d.outcome = 'PUSH' THEN 1 ELSE 0 END) AS pushes,
             COUNT(d.id) AS duels
      FROM users u LEFT JOIN duels d ON d.user_id = u.id AND d.outcome != 'PENDING'
      GROUP BY u.id
      HAVING duels > 0 OR credits != 0
      ORDER BY credits DESC, wins DESC
      LIMIT 20
    `).all() as Array<{ id: string; name: string; provider: string; credits: number; wins: number; losses: number; pushes: number; duels: number }>;
    return c.json({
      leaderboard: rows.map((r, i) => ({
        rank: i + 1,
        name: r.name,
        provider: r.provider,
        credits: r.credits,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        pushes: r.pushes ?? 0,
        duels: r.duels ?? 0,
        accuracy: (r.wins + r.losses) > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : null,
      })),
      generatedAt: Date.now(),
    });
  });
}
