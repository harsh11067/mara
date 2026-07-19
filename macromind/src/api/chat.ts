/**
 * MARA CONCIERGE (Wave 6) — a Gemini-backed helper riding the same key pool
 * as the trading engines.
 *
 * Product rules (enforced server-side, not just UI copy):
 *   - Login required (any real session; guests included — they just have 0 CR
 *     to unlock more).
 *   - 3 free questions per account. Answers hard-capped at ~100 words.
 *   - After the free quota: unlock +25 questions for 250 CR (the "premium"
 *     tier lives inside the credit economy, same as duels and the arcade).
 *   - Every answer is grounded with live engine context (regime, latest
 *     verdict, kill-switch state) so the bot talks about THIS system.
 */
import type { Hono } from 'hono';
import { getDb } from '../store/db.js';
import { config } from '../config.js';
import { getUserFromRequest, spendCredits, creditsBalance } from './auth.js';
import { geminiClient, rotateGeminiKey, isQuotaError } from '../ai/gemini-pool.js';
import { isKillSwitchActive } from '../executor/kill-switch.js';
import { globalCache } from '../utils/ttl-cache.js';
import { classifyRegime, type RegimeState } from '../risk/regime.js';
import { SoSoValueClient, BTC_CURRENCY_ID } from '../services/sosovalue-client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Concierge');

export const CHAT_FREE_QUOTA = 3;
export const CHAT_UNLOCK_COST = 250;
export const CHAT_UNLOCK_PACK = 25;
const MAX_WORDS = 100;

interface UsageRow { user_id: string; used: number; quota: number }

function usage(userId: string): UsageRow {
  const db = getDb();
  let row = db.prepare('SELECT user_id, used, quota FROM chat_usage WHERE user_id = ?').get(userId) as UsageRow | undefined;
  if (!row) {
    db.prepare('INSERT INTO chat_usage (user_id, used, quota, updated_at) VALUES (?,?,?,?)')
      .run(userId, 0, CHAT_FREE_QUOTA, Date.now());
    row = { user_id: userId, used: 0, quota: CHAT_FREE_QUOTA };
  }
  return row;
}

function capWords(s: string, max: number): string {
  const words = s.trim().split(/\s+/);
  return words.length <= max ? s.trim() : words.slice(0, max).join(' ') + '…';
}

async function liveContext(): Promise<string> {
  let regimeLine = 'regime: unavailable';
  try {
    const regime = await globalCache.wrap('regime:current', 5 * 60_000, async () => {
      const soso = new SoSoValueClient(config.sosovalue.apiKey);
      const klines = await soso.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 30 });
      return classifyRegime(klines);
    }) as RegimeState;
    regimeLine = `regime: ${regime.regime} (BTC ${regime.trendPct}%/30d, vol ${regime.realizedVolAnnual}%, size ×${regime.risk.sizeMultiplier})`;
  } catch { /* keep fallback */ }
  const last = getDb().prepare('SELECT conviction, confidence, action FROM decisions ORDER BY created_at DESC LIMIT 1')
    .get() as { conviction: string; confidence: number; action: string } | undefined;
  return [
    regimeLine,
    last ? `latest verdict: ${last.conviction} @ ${last.confidence}% → ${last.action}` : 'no decisions yet',
    `kill switch: ${isKillSwitchActive() ? 'ACTIVE (engine halted)' : 'inactive'}`,
  ].join('; ');
}

const SYSTEM = [
  'You are the MARA Concierge — the in-app guide of MARA, an autonomous macro trading agent',
  '(SoSoValue macro data → surprise z-score → Gemini agentic debate → risk gates → EIP-712 orders',
  'on SoDEX testnet → on-chain attestation on ValueChain, contract 0x8BF2…1B29).',
  'Product surfaces: /terminal (live cognition), /duel (stake credits vs the agent verdict; the',
  'Arcade there settles bets purely on live SoDEX BTC price moves after 5 minutes — up/down or',
  '±0.10% over/under, win pays 1.9×), /replay (no-lookahead Time Machine), /edge (4-strategy',
  'Proof of Edge), /portfolio (desk). Telegram bot: /bet /status /regime /next /price.',
  `Answer in AT MOST ${MAX_WORDS} words. Be direct, concrete, honest about testnet scope.`,
  'Never invent performance numbers; if asked for financial advice, note MARA is a testnet research agent.',
].join(' ');

export function chatRoutes(app: Hono): void {
  // Quota introspection for the dock UI
  app.get('/api/chat/quota', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in to use the concierge' }, 401);
    const u = usage(user.id);
    return c.json({
      used: u.used, quota: u.quota,
      unlock: { cost: CHAT_UNLOCK_COST, adds: CHAT_UNLOCK_PACK },
      credits: creditsBalance(user.id),
    });
  });

  // Premium unlock: +25 questions for 250 CR
  app.post('/api/chat/unlock', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in first' }, 401);
    try {
      spendCredits(user.id, CHAT_UNLOCK_COST, 'chat_unlock');
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Insufficient credits' }, 402);
    }
    const u = usage(user.id);
    getDb().prepare('UPDATE chat_usage SET quota = ?, updated_at = ? WHERE user_id = ?')
      .run(u.quota + CHAT_UNLOCK_PACK, Date.now(), user.id);
    return c.json({ ok: true, used: u.used, quota: u.quota + CHAT_UNLOCK_PACK, credits: creditsBalance(user.id) });
  });

  app.post('/api/chat', async (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Sign in to use the concierge' }, 401);

    let message = '';
    try {
      const body = await c.req.json() as { message?: string };
      message = (body.message ?? '').trim().slice(0, 500);
    } catch { /* handled below */ }
    if (!message) return c.json({ error: 'message is required' }, 400);

    const u = usage(user.id);
    if (u.used >= u.quota) {
      return c.json({
        error: `Free questions used (${u.used}/${u.quota}).`,
        premium: { cost: CHAT_UNLOCK_COST, adds: CHAT_UNLOCK_PACK, credits: creditsBalance(user.id) },
      }, 402);
    }

    const context = await liveContext();
    const prompt = `${SYSTEM}\n\nLive engine state right now: ${context}\n\nUser question: ${message}`;

    let reply = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const model = geminiClient().getGenerativeModel({ model: config.gemini.model });
        const res = await model.generateContent(prompt);
        reply = capWords(res.response.text(), MAX_WORDS);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaError(msg) && attempt === 0) { rotateGeminiKey(msg); continue; }
        logger.warn('concierge generation failed', { error: msg.slice(0, 120) });
        return c.json({ error: 'The concierge is briefly unavailable — your quota was not charged.' }, 503);
      }
    }

    getDb().prepare('UPDATE chat_usage SET used = used + 1, updated_at = ? WHERE user_id = ?')
      .run(Date.now(), user.id);
    return c.json({ reply, used: u.used + 1, quota: u.quota, credits: creditsBalance(user.id) });
  });
}
