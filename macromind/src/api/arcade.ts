/**
 * Arcade REST surface (Wave 6) — see games/arcade.ts for the engine.
 *
 *   GET  /api/arcade         — game configs + house stats
 *   POST /api/arcade/bet     — { game, pick, stake } (login required)
 *   GET  /api/arcade/mine    — the caller's recent bets
 */
import type { Hono } from 'hono';
import { getUserFromRequest } from './auth.js';
import { isKillSwitchActive } from '../executor/kill-switch.js';
import {
  ARCADE_GAMES, ARCADE_MIN_STAKE, ARCADE_MAX_STAKE,
  placeArcadeBet, myArcadeBets, arcadeStats,
} from '../games/arcade.js';

export function arcadeRoutes(app: Hono): void {
  app.get('/api/arcade', (c) => {
    return c.json({
      games: Object.values(ARCADE_GAMES),
      minStake: ARCADE_MIN_STAKE,
      maxStake: ARCADE_MAX_STAKE,
      stats: arcadeStats(),
      note: 'Strike and settle are live SoDEX marks stored on every bet — the market is the dice, never Math.random.',
    });
  });

  app.post('/api/arcade/bet', async (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first — credits are the stake' }, 401);
    if (isKillSwitchActive()) return c.json({ error: 'SAFE MODE — kill switch active, all games paused' }, 403);

    type Body = { game?: string; pick?: string; stake?: number };
    let body: Body;
    try { body = await c.req.json() as Body; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
    try {
      const { bet, credits } = await placeArcadeBet({
        userId: user.id,
        game: (body.game ?? '').toUpperCase(),
        pick: body.pick ?? '',
        stake: body.stake ?? 0,
        source: 'web',
      });
      return c.json({
        ok: true, betId: bet.id, strike: bet.strike, resolveAt: bet.resolve_at, credits,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get('/api/arcade/mine', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first' }, 401);
    return c.json({ bets: myArcadeBets(user.id, 12) });
  });
}
