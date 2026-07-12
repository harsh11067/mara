/**
 * Telegram Signal Broadcaster (creative feature — fixture.md §B7 distribution)
 *
 * Free-tier distribution channel: every decision (including NO_TRADE — wins
 * AND passes, the transparency practice of credible signal channels) and every
 * executed trade is broadcast to the configured channel via the Bot API.
 *
 * No polling, no library — plain HTTPS sendMessage. Disabled cleanly when
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL_ID are unset.
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Telegram');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID ?? '';

export function telegramEnabled(): boolean {
  return BOT_TOKEN.length > 10 && CHANNEL_ID.length > 3;
}

async function send(text: string): Promise<boolean> {
  if (!telegramEnabled()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json() as { ok?: boolean; description?: string };
    if (!json.ok) {
      logger.warn('Telegram send failed', { description: json.description });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('Telegram send error', { error: String(err).slice(0, 120) });
    return false;
  }
}

/** Live check for /diag — getMe proves the token is real. */
export async function telegramCheck(): Promise<{ ok: boolean; detail: string }> {
  if (!telegramEnabled()) return { ok: false, detail: 'not configured' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, {
      signal: AbortSignal.timeout(6000),
    });
    const json = await res.json() as { ok?: boolean; result?: { username?: string } };
    return json.ok
      ? { ok: true, detail: `@${json.result?.username ?? 'bot'}` }
      : { ok: false, detail: 'invalid token' };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 80) };
  }
}

const CONVICTION_EMOJI: Record<string, string> = {
  STRONG_BULL: '🟢🟢', BULL: '🟢', NEUTRAL: '⚪', BEAR: '🔴', STRONG_BEAR: '🔴🔴',
};

export async function broadcastDecision(d: {
  eventName: string; conviction: string; confidence: number;
  action: string; reasoning: string; surpriseScore?: number;
  signalId?: string;
}): Promise<void> {
  const emoji = CONVICTION_EMOJI[d.conviction] ?? '⚪';
  const z = d.surpriseScore !== undefined ? ` (${d.surpriseScore.toFixed(2)}σ)` : '';
  const lines = [
    `${emoji} <b>MARA SIGNAL — ${escapeHtml(d.eventName)}</b>${z}`,
    ``,
    `Verdict: <b>${d.conviction}</b> @ ${d.confidence}% → <b>${d.action}</b>`,
    ``,
    escapeHtml(d.reasoning.slice(0, 400)),
  ];
  if (d.signalId) lines.push(``, `<i>signal id: ${d.signalId.slice(0, 8)} · every signal is logged, wins and losses alike</i>`);
  await send(lines.join('\n'));
}

export async function broadcastTrade(t: {
  symbol: string; side: string; entryPrice: number; quantity: number;
}): Promise<void> {
  await send([
    `⚡ <b>MARA EXECUTION</b>`,
    ``,
    `${t.side} ${t.quantity} ${escapeHtml(t.symbol)} @ $${t.entryPrice.toLocaleString()}`,
    `<i>EIP-712 signed on SoDEX testnet</i>`,
  ].join('\n'));
}

export async function broadcastKillSwitch(reason: string): Promise<void> {
  await send(`🛑 <b>MARA KILL SWITCH</b>\n\n${escapeHtml(reason)}\nAll positions flat. No new trades until operator reset.`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
