/**
 * Global trigger cooldown — one live Gemini pipeline cycle at a time.
 * Shared by POST /api/trigger and Signal Duel so API budgets hold.
 */
const COOLDOWN_MS = 20_000;
let lastAt = 0;

export function tryAcquireTrigger(): { ok: true } | { ok: false; retryInSec: number } {
  const since = Date.now() - lastAt;
  if (since < COOLDOWN_MS) {
    return { ok: false, retryInSec: Math.ceil((COOLDOWN_MS - since) / 1000) };
  }
  lastAt = Date.now();
  return { ok: true };
}
