/**
 * MARA ARCADE (Wave 6) — fast credit bets on REAL BTC price moves.
 *
 * Two games, one engine, two surfaces (web /duel Arcade + Telegram /bet):
 *
 *   PULSE      — call the direction of BTC over the next 5 minutes (UP/DOWN).
 *                Win pays 1.9×. Dead-flat tie voids and refunds.
 *   OVERUNDER  — call whether BTC's absolute move over 5 minutes exceeds
 *                ±0.10% (OVER) or stays inside the band (UNDER). Win pays 1.9×.
 *
 * Honesty contract: the strike is the live SoDEX ticker at bet time, the
 * settle is the live ticker at resolve time, both stored on the row. No
 * house-side randomness anywhere — the market is the dice.
 */
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../store/db.js';
import { config } from '../config.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { spendCredits, grantCredits, creditsBalance } from '../api/auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Arcade');

export const ARCADE_GAMES = {
  PULSE: {
    key: 'PULSE',
    title: 'Pulse',
    tagline: 'Call BTC direction over the next 5 minutes.',
    picks: ['UP', 'DOWN'] as string[],
    durationSec: 300,
    payoutX: 1.9,
    threshold: null as number | null,
  },
  OVERUNDER: {
    key: 'OVERUNDER',
    title: 'Over / Under',
    tagline: 'Does BTC move more than ±0.10% in 5 minutes — or stay inside the band?',
    picks: ['OVER', 'UNDER'] as string[],
    durationSec: 300,
    payoutX: 1.9,
    threshold: 0.10,
  },
} as const;

export type ArcadeGameKey = keyof typeof ARCADE_GAMES;

export const ARCADE_MIN_STAKE = 10;
export const ARCADE_MAX_STAKE = 500;
const SYMBOL = 'BTC-USD';

export interface ArcadeBetRow {
  id: string; user_id: string; game: string; pick: string; stake: number;
  symbol: string; strike: number; threshold: number | null;
  resolve_at: number; settle_price: number | null;
  outcome: string; payout: number; source: string; tg_chat_id: string | null;
  created_at: number; resolved_at: number | null;
}

async function livePrice(): Promise<number> {
  const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
  const t = await client.getPerpsTicker(SYMBOL);
  const p = t ? parseFloat(t.lastPrice) : NaN;
  if (!Number.isFinite(p) || p <= 0) throw new Error('Live BTC price unavailable');
  return p;
}

export async function placeArcadeBet(params: {
  userId: string; game: string; pick: string; stake: number;
  source: 'web' | 'telegram'; tgChatId?: string;
}): Promise<{ bet: ArcadeBetRow; credits: number }> {
  const game = ARCADE_GAMES[params.game as ArcadeGameKey];
  if (!game) throw new Error(`Unknown game — pick one of ${Object.keys(ARCADE_GAMES).join(', ')}`);
  const pick = params.pick.toUpperCase();
  if (!game.picks.includes(pick)) throw new Error(`${game.title}: pick must be ${game.picks.join(' or ')}`);
  const stake = Math.round(params.stake);
  if (!Number.isFinite(stake) || stake < ARCADE_MIN_STAKE || stake > ARCADE_MAX_STAKE) {
    throw new Error(`Stake must be ${ARCADE_MIN_STAKE}–${ARCADE_MAX_STAKE} credits`);
  }

  const strike = await livePrice();
  const now = Date.now();
  const bet: ArcadeBetRow = {
    id: uuidv4(), user_id: params.userId, game: game.key, pick, stake,
    symbol: SYMBOL, strike, threshold: game.threshold,
    resolve_at: now + game.durationSec * 1000, settle_price: null,
    outcome: 'PENDING', payout: 0, source: params.source,
    tg_chat_id: params.tgChatId ?? null, created_at: now, resolved_at: null,
  };

  // Escrow first — insert only if the spend succeeds
  spendCredits(params.userId, stake, 'arcade_stake', bet.id);
  getDb().prepare(`
    INSERT INTO arcade_bets (id, user_id, game, pick, stake, symbol, strike, threshold,
      resolve_at, settle_price, outcome, payout, source, tg_chat_id, created_at, resolved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(bet.id, bet.user_id, bet.game, bet.pick, bet.stake, bet.symbol, bet.strike,
    bet.threshold, bet.resolve_at, null, 'PENDING', 0, bet.source, bet.tg_chat_id, bet.created_at, null);

  logger.info(`Arcade ${game.key}: ${pick} ${stake}CR @ $${strike} (${params.source})`);
  return { bet, credits: creditsBalance(params.userId) };
}

export function myArcadeBets(userId: string, limit = 12): ArcadeBetRow[] {
  return getDb().prepare(
    'SELECT * FROM arcade_bets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ).all(userId, limit) as ArcadeBetRow[];
}

export function arcadeStats(): { totalBets: number; resolved: number; paidOut: number } {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS totalBets,
           SUM(CASE WHEN outcome != 'PENDING' THEN 1 ELSE 0 END) AS resolved,
           COALESCE(SUM(payout), 0) AS paidOut
    FROM arcade_bets
  `).get() as { totalBets: number; resolved: number; paidOut: number };
  return row;
}

function settleOne(bet: ArcadeBetRow, settle: number): { outcome: 'WIN' | 'LOSS' | 'VOID'; payout: number } {
  const game = ARCADE_GAMES[bet.game as ArcadeGameKey];
  if (bet.game === 'PULSE') {
    if (settle === bet.strike) return { outcome: 'VOID', payout: bet.stake };
    const up = settle > bet.strike;
    const win = (up && bet.pick === 'UP') || (!up && bet.pick === 'DOWN');
    return { outcome: win ? 'WIN' : 'LOSS', payout: win ? Math.floor(bet.stake * game.payoutX) : 0 };
  }
  // OVERUNDER
  const movePct = Math.abs((settle - bet.strike) / bet.strike) * 100;
  const over = movePct >= (bet.threshold ?? 0.10);
  const win = (over && bet.pick === 'OVER') || (!over && bet.pick === 'UNDER');
  return { outcome: win ? 'WIN' : 'LOSS', payout: win ? Math.floor(bet.stake * game.payoutX) : 0 };
}

type Broadcast = (type: string, data: unknown) => void;
type TelegramDm = (chatId: string, text: string) => Promise<unknown>;

let resolverTimer: ReturnType<typeof setInterval> | null = null;

/** Resolve every due bet against the live price. Runs every 20s. */
export function startArcadeResolver(broadcast: Broadcast, telegramDm?: TelegramDm): void {
  if (resolverTimer) return;
  resolverTimer = setInterval(() => { void resolveDue(broadcast, telegramDm); }, 20_000);
  logger.info('Arcade resolver armed (20s cadence)');
}

export function stopArcadeResolver(): void {
  if (resolverTimer) { clearInterval(resolverTimer); resolverTimer = null; }
}

async function resolveDue(broadcast: Broadcast, telegramDm?: TelegramDm): Promise<void> {
  const due = getDb().prepare(
    "SELECT * FROM arcade_bets WHERE outcome = 'PENDING' AND resolve_at <= ? LIMIT 25",
  ).all(Date.now()) as ArcadeBetRow[];
  if (due.length === 0) return;

  let settle: number;
  try { settle = await livePrice(); } catch (err) {
    logger.warn('Arcade resolver: no live price, retrying next tick', { error: String(err).slice(0, 80) });
    return;
  }

  for (const bet of due) {
    const { outcome, payout } = settleOne(bet, settle);
    if (payout > 0) {
      grantCredits(bet.user_id, payout, outcome === 'VOID' ? 'arcade_void' : 'arcade_win', bet.id);
    }
    getDb().prepare(
      'UPDATE arcade_bets SET settle_price = ?, outcome = ?, payout = ?, resolved_at = ? WHERE id = ?',
    ).run(settle, outcome, payout, Date.now(), bet.id);

    const movePct = ((settle - bet.strike) / bet.strike) * 100;
    broadcast('arcade_result', {
      betId: bet.id, userId: bet.user_id, game: bet.game, pick: bet.pick,
      stake: bet.stake, strike: bet.strike, settle, movePct: Math.round(movePct * 1000) / 1000,
      outcome, payout, credits: creditsBalance(bet.user_id),
    });

    if (bet.source === 'telegram' && bet.tg_chat_id && telegramDm) {
      const emoji = outcome === 'WIN' ? '🏆' : outcome === 'VOID' ? '↔️' : '💀';
      void telegramDm(bet.tg_chat_id,
        `${emoji} <b>${bet.game} settled</b>\n` +
        `${bet.pick} ${bet.stake}CR · strike $${bet.strike.toLocaleString()} → settle $${settle.toLocaleString()} ` +
        `(${movePct >= 0 ? '+' : ''}${movePct.toFixed(3)}%)\n` +
        `<b>${outcome}</b>${payout > 0 ? ` — paid ${payout}CR` : ''} · balance ${creditsBalance(bet.user_id)}CR`);
    }
    logger.info(`Arcade settled ${bet.id.slice(0, 8)}: ${bet.game} ${bet.pick} → ${outcome} (${payout})`);
  }
}
