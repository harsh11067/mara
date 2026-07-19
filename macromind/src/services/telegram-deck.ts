/**
 * MARA TELEGRAM DECK (Wave 6) — the bot answers back.
 *
 * Long-polls getUpdates (no webhook, works anywhere) and turns the broadcast
 * channel into a full product surface:
 *
 *   /start        — creates a real MARA account (provider 'telegram') + 500 CR
 *   /status       — engine status, kill switch, latest verdict
 *   /regime       — live 5-state regime + risk multipliers
 *   /next         — next macro events on the calendar
 *   /price        — live SoDEX BTC/ETH/SOL marks
 *   /credits      — your balance + recent ledger
 *   /bet up|down|over|under <stake> — Arcade bet on real BTC (5-min settle, DM'd result)
 *   /mybets       — your recent arcade bets
 *   /leaderboard  — top credit holders across web + telegram
 *   /poll         — (admin) push a market-style poll to the channel
 *   /kill /resume — (admin) the REAL kill switch, from your pocket
 *
 * Identity: chat id = provider_id. Credits share the same ledger as the web
 * app, so the leaderboard is one economy.
 */
import { createLogger } from '../utils/logger.js';
import { getDb } from '../store/db.js';
import { config } from '../config.js';
import { findOrCreateUser, creditsBalance, type User } from '../api/auth.js';
import { placeArcadeBet, myArcadeBets, ARCADE_GAMES, ARCADE_MIN_STAKE, ARCADE_MAX_STAKE } from '../games/arcade.js';
import { performDailyClaim, claimState } from '../api/community.js';
import { activateKillSwitch, resetKillSwitch, isKillSwitchActive } from '../executor/kill-switch.js';
import { classifyRegime } from '../risk/regime.js';
import { SoSoValueClient, BTC_CURRENCY_ID } from '../services/sosovalue-client.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { globalCache } from '../utils/ttl-cache.js';

const logger = createLogger('TgDeck');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID ?? '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID ?? '';

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

export async function tgSend(chatId: string | number, text: string): Promise<unknown> {
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return await res.json();
  } catch (err) {
    logger.warn('tgSend failed', { error: String(err).slice(0, 100) });
    return null;
  }
}

async function tgSendPoll(chatId: string | number, question: string, options: string[]): Promise<unknown> {
  try {
    const res = await fetch(`${API}/sendPoll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, question, options, is_anonymous: true }),
      signal: AbortSignal.timeout(8000),
    });
    return await res.json();
  } catch { return null; }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tgUser(chatId: number, name: string): User {
  return findOrCreateUser('telegram', String(chatId), { name }).user;
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function cmdStart(chatId: number, name: string): Promise<void> {
  const user = tgUser(chatId, name);
  await tgSend(chatId, [
    `⚡ <b>MARA DECK</b> — welcome, ${esc(name)}.`,
    ``,
    `You now hold <b>${creditsBalance(user.id)} CR</b> in the shared MARA economy (same ledger as the web app).`,
    ``,
    `/status — engine + latest verdict`,
    `/regime — live market regime`,
    `/next — upcoming macro prints`,
    `/price — live SoDEX marks`,
    `/bet up 50 — 5-min BTC direction bet`,
    `/bet over 50 — ±0.10% volatility bet`,
    `/claim — daily credit ration (streak bonus)`,
    `/mybets /credits /leaderboard`,
    ``,
    `Web terminal: https://mara-neon.vercel.app`,
  ].join('\n'));
}

async function cmdStatus(chatId: number): Promise<void> {
  const last = getDb().prepare('SELECT conviction, confidence, action, created_at FROM decisions ORDER BY created_at DESC LIMIT 1')
    .get() as { conviction: string; confidence: number; action: string; created_at: number } | undefined;
  const counts = getDb().prepare('SELECT (SELECT COUNT(*) FROM decisions) AS d, (SELECT COUNT(*) FROM trades) AS t').get() as { d: number; t: number };
  await tgSend(chatId, [
    `🖥 <b>MARA STATUS</b>`,
    `Engine: LIVE · Kill switch: <b>${isKillSwitchActive() ? '🛑 ACTIVE' : '🟢 armed-standby'}</b>`,
    `Decisions logged: ${counts.d} · Trades: ${counts.t}`,
    last
      ? `Latest verdict: <b>${last.conviction}</b> @ ${last.confidence}% → ${last.action} (${new Date(last.created_at).toISOString().slice(0, 16)}Z)`
      : `No decisions yet — fire one from the web terminal.`,
  ].join('\n'));
}

async function cmdRegime(chatId: number): Promise<void> {
  try {
    const regime = await globalCache.wrap('regime:current', 5 * 60_000, async () => {
      const soso = new SoSoValueClient(config.sosovalue.apiKey);
      const klines = await soso.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 30 });
      return classifyRegime(klines);
    });
    await tgSend(chatId, [
      `🧭 <b>REGIME: ${regime.regime}</b>`,
      `BTC ${regime.trendPct >= 0 ? '+' : ''}${regime.trendPct}% / 30d · realized vol ${regime.realizedVolAnnual}%`,
      `Position size ×${regime.risk.sizeMultiplier} · stops ×${regime.risk.stopMultiplier} · conviction floor ${regime.risk.convictionFloor}%`,
    ].join('\n'));
  } catch {
    await tgSend(chatId, `Regime engine unreachable right now — try again in a minute.`);
  }
}

async function cmdNext(chatId: number): Promise<void> {
  try {
    const events = await globalCache.wrap('tg:next-events', 10 * 60_000, async () => {
      const soso = new SoSoValueClient(config.sosovalue.apiKey);
      return soso.getUpcomingEvents();
    });
    const top = events.slice(0, 5);
    if (top.length === 0) { await tgSend(chatId, 'No upcoming macro events on the calendar.'); return; }
    await tgSend(chatId, [
      `📅 <b>NEXT MACRO PRINTS</b>`,
      ...top.map((e) => `· ${esc(e.date)}${e.time ? ` ${esc(e.time)}` : ''} — ${esc(e.name)}${e.forecast != null ? ` (fcst ${e.forecast})` : ''}`),
      ``,
      `<i>When one lands, MARA argues, decides, and attests on ValueChain.</i>`,
    ].join('\n'));
  } catch {
    await tgSend(chatId, 'Calendar unreachable right now.');
  }
}

async function cmdPrice(chatId: number): Promise<void> {
  try {
    const client = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    const tickers = await client.getPerpsTickers();
    const rows = ['BTC-USD', 'ETH-USD', 'SOL-USD'].map((s) => {
      const t = tickers.find((x) => x.symbol === s);
      if (!t) return `· ${s}: —`;
      const chg = t.priceChange24h != null ? parseFloat(t.priceChange24h) : null;
      return `· <b>${s}</b>: $${parseFloat(t.lastPrice).toLocaleString()}${chg !== null ? ` (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)` : ''}`;
    });
    await tgSend(chatId, [`📈 <b>SoDEX LIVE</b>`, ...rows].join('\n'));
  } catch {
    await tgSend(chatId, 'SoDEX unreachable right now.');
  }
}

async function cmdCredits(chatId: number, name: string): Promise<void> {
  const user = tgUser(chatId, name);
  const ledger = getDb().prepare(
    'SELECT delta, reason FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
  ).all(user.id) as Array<{ delta: number; reason: string }>;
  await tgSend(chatId, [
    `💳 <b>${creditsBalance(user.id)} CR</b>`,
    ...ledger.map((l) => `· ${l.delta >= 0 ? '+' : ''}${l.delta} — ${l.reason}`),
  ].join('\n'));
}

async function cmdClaim(chatId: number, name: string): Promise<void> {
  const user = tgUser(chatId, name);
  const res = performDailyClaim(user.id);
  if (res.ok) {
    await tgSend(chatId, `🎁 <b>Daily ration claimed: +${res.amount} CR</b> (streak ${res.streak}🔥)\nBalance: ${creditsBalance(user.id)} CR`);
  } else {
    const st = claimState(user.id);
    const hrs = st.nextClaimAt ? Math.max(1, Math.ceil((st.nextClaimAt - Date.now()) / 3600_000)) : 20;
    await tgSend(chatId, `⏳ Already claimed — next ration in ~${hrs}h (+${st.nextAmount} CR waiting, streak ${st.streak}).`);
  }
}

async function cmdBet(chatId: number, name: string, args: string[]): Promise<void> {
  const pickRaw = (args[0] ?? '').toUpperCase();
  const stake = parseInt(args[1] ?? '', 10);
  const game = pickRaw === 'UP' || pickRaw === 'DOWN' ? 'PULSE'
    : pickRaw === 'OVER' || pickRaw === 'UNDER' ? 'OVERUNDER' : null;
  if (!game || !Number.isFinite(stake)) {
    await tgSend(chatId, `Usage: /bet up|down|over|under &lt;stake&gt;  (${ARCADE_MIN_STAKE}–${ARCADE_MAX_STAKE} CR)\n` +
      `up/down = ${esc(ARCADE_GAMES.PULSE.tagline)}\nover/under = ${esc(ARCADE_GAMES.OVERUNDER.tagline)}`);
    return;
  }
  const user = tgUser(chatId, name);
  try {
    const { bet, credits } = await placeArcadeBet({
      userId: user.id, game, pick: pickRaw, stake, source: 'telegram', tgChatId: String(chatId),
    });
    await tgSend(chatId,
      `🎯 <b>${game} LOCKED</b>: ${pickRaw} ${stake}CR\n` +
      `Strike: $${bet.strike.toLocaleString()} · settles in 5 min (I'll DM the result)\n` +
      `Balance: ${credits}CR`);
  } catch (err) {
    await tgSend(chatId, `❌ ${esc(err instanceof Error ? err.message : String(err))}`);
  }
}

async function cmdMyBets(chatId: number, name: string): Promise<void> {
  const user = tgUser(chatId, name);
  const bets = myArcadeBets(user.id, 8);
  if (bets.length === 0) { await tgSend(chatId, 'No bets yet — /bet up 50 to start.'); return; }
  await tgSend(chatId, [
    `🎰 <b>YOUR BETS</b>`,
    ...bets.map((b) => {
      const emoji = b.outcome === 'WIN' ? '🏆' : b.outcome === 'LOSS' ? '💀' : b.outcome === 'VOID' ? '↔️' : '⏳';
      return `${emoji} ${b.game} ${b.pick} ${b.stake}CR → ${b.outcome}${b.payout ? ` (+${b.payout})` : ''}`;
    }),
  ].join('\n'));
}

async function cmdLeaderboard(chatId: number): Promise<void> {
  const rows = getDb().prepare(`
    SELECT u.name, u.provider, COALESCE(SUM(l.delta),0) AS credits
    FROM users u LEFT JOIN credit_ledger l ON l.user_id = u.id
    WHERE u.provider != 'guest'
    GROUP BY u.id ORDER BY credits DESC LIMIT 8
  `).all() as Array<{ name: string | null; provider: string; credits: number }>;
  await tgSend(chatId, [
    `🏛 <b>CREDIT LEADERBOARD</b> (web + telegram, one economy)`,
    ...rows.map((r, i) => `${i + 1}. ${esc(r.name ?? 'operator')} — ${r.credits}CR <i>(${r.provider})</i>`),
  ].join('\n'));
}

function isAdmin(chatId: number): boolean {
  return ADMIN_CHAT_ID !== '' && String(chatId) === ADMIN_CHAT_ID;
}

async function cmdPoll(chatId: number, args: string[]): Promise<void> {
  if (!isAdmin(chatId)) { await tgSend(chatId, 'Polls are operator-only.'); return; }
  const question = args.join(' ') || 'Next CPI print vs forecast — where does it land?';
  await tgSendPoll(CHANNEL_ID, question, ['Above forecast (hot) 🔥', 'In line 😐', 'Below forecast (cool) ❄️']);
  await tgSend(chatId, '📊 Poll pushed to the channel.');
}

async function cmdKill(chatId: number, on: boolean): Promise<void> {
  if (!isAdmin(chatId)) { await tgSend(chatId, 'The kill switch answers only to the operator.'); return; }
  if (on) {
    await activateKillSwitch('Activated by operator via Telegram');
    await tgSend(chatId, '🛑 KILL SWITCH ACTIVE — orders cancelled, positions closed, engine halted.');
  } else {
    resetKillSwitch();
    await tgSend(chatId, '🟢 Kill switch reset — engine live again.');
  }
}

// ── Update loop ───────────────────────────────────────────────────────────────

let running = false;
let offset = 0;

async function handleMessage(msg: NonNullable<TgUpdate['message']>): Promise<void> {
  const text = (msg.text ?? '').trim();
  if (!text.startsWith('/')) return;
  const chatId = msg.chat.id;
  // Only serve commands in private chats (the channel stays a clean broadcast surface)
  if (msg.chat.type !== 'private') return;
  const name = msg.from?.first_name ?? msg.from?.username ?? 'operator';
  const [cmd, ...args] = text.split(/\s+/);
  const c = cmd.toLowerCase().replace(/@.+$/, '');

  switch (c) {
    case '/start': case '/help': return cmdStart(chatId, name);
    case '/status': return cmdStatus(chatId);
    case '/regime': return cmdRegime(chatId);
    case '/next': return cmdNext(chatId);
    case '/price': return cmdPrice(chatId);
    case '/credits': return cmdCredits(chatId, name);
    case '/claim': return cmdClaim(chatId, name);
    case '/bet': return cmdBet(chatId, name, args);
    case '/mybets': return cmdMyBets(chatId, name);
    case '/leaderboard': return cmdLeaderboard(chatId);
    case '/poll': return cmdPoll(chatId, args);
    case '/kill': return cmdKill(chatId, true);
    case '/resume': return cmdKill(chatId, false);
    default:
      return void tgSend(chatId, `Unknown command. /help lists everything.`);
  }
}

async function pollOnce(): Promise<void> {
  const res = await fetch(`${API}/getUpdates?timeout=25&offset=${offset}&allowed_updates=%5B%22message%22%5D`, {
    signal: AbortSignal.timeout(35_000),
  });
  const json = await res.json() as { ok?: boolean; result?: TgUpdate[]; description?: string };
  if (!json.ok) {
    // 409 = another instance is polling (e.g. local dev vs Render) — back off quietly
    if ((json.description ?? '').includes('terminated by other getUpdates')) {
      await new Promise((r) => setTimeout(r, 30_000));
      return;
    }
    throw new Error(json.description ?? 'getUpdates failed');
  }
  for (const u of json.result ?? []) {
    offset = Math.max(offset, u.update_id + 1);
    if (u.message) await handleMessage(u.message).catch((err) =>
      logger.warn('command failed', { error: String(err).slice(0, 120) }));
  }
}

export function startTelegramDeck(): void {
  if (BOT_TOKEN.length < 10) { logger.info('Telegram deck disabled (no bot token)'); return; }
  if (running) return;
  running = true;
  logger.info(`Telegram deck LIVE — commands enabled${ADMIN_CHAT_ID ? ' (admin bound)' : ' (no TELEGRAM_ADMIN_CHAT_ID — /kill & /poll disabled)'}`);
  void (async () => {
    while (running) {
      try { await pollOnce(); } catch (err) {
        logger.warn('deck poll error', { error: String(err).slice(0, 100) });
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  })();
}

export function stopTelegramDeck(): void { running = false; }
