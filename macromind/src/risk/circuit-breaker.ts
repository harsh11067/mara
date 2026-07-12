/**
 * Macro Circuit Breaker — de-risks around scheduled high-impact releases
 * (fixture.md §E5 / transformation.md §4 — the Sonar pattern, macro-native).
 *
 * Reads the upcoming-events table. If a high-impact event (CPI / FOMC / NFP /
 * PCE / PPI family) is inside the pre-event window, MARA:
 *   - blocks NEW discretionary entries (except the event-driven pipeline itself
 *     when the event actually fires — that is the whole point of MARA),
 *   - halves position size for event-driven trades placed in the window.
 *
 * The state is exposed on /api/risk and consumed by risk-limits + the MCP tool.
 */
import { EventStore } from '../store/event-store.js';
import { getEventMapping } from '../ai/event-mappings.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CircuitBreaker');

export interface CircuitBreakerState {
  active: boolean;
  reason: string | null;
  event: { name: string; date: string; minutesUntil: number | null } | null;
  windowMinutes: number;
  sizeMultiplier: number; // applied to event trades inside the window
  checkedAt: number;
}

const PRE_EVENT_WINDOW_MIN = 45;   // minutes before a scheduled high-impact release
const POST_EVENT_WINDOW_MIN = 15;  // minutes after (chop window)

/** Names that always count as high-impact even without a mapping hit. */
const HIGH_IMPACT_PATTERNS = /\b(CPI|FOMC|Nonfarm|Payroll|NFP|PCE|PPI|Rate Decision|Unemployment)\b/i;

function isHighImpact(name: string): boolean {
  const mapping = getEventMapping(name);
  if (mapping?.impactMagnitude === 'high') return true;
  return HIGH_IMPACT_PATTERNS.test(name);
}

/**
 * Events from SoSoValue carry a date (and sometimes a time). We treat a
 * date-only event as potentially firing any time that day, and use the standard
 * US release hour (12:30 UTC) as the best estimate for the countdown.
 */
function estimateEventMs(date: string): number {
  if (/T\d{2}:\d{2}/.test(date)) return new Date(date).getTime();
  return new Date(`${date}T12:30:00Z`).getTime();
}

export function getCircuitBreakerState(): CircuitBreakerState {
  const now = Date.now();
  const checkedAt = now;
  try {
    const events = EventStore.getRecent(50);
    for (const evt of events) {
      if (!isHighImpact(evt.name)) continue;
      if (evt.status === 'PROCESSED') continue;
      const eventMs = estimateEventMs(evt.date);
      if (!Number.isFinite(eventMs)) continue;
      const minsUntil = (eventMs - now) / 60_000;
      if (minsUntil <= PRE_EVENT_WINDOW_MIN && minsUntil >= -POST_EVENT_WINDOW_MIN) {
        return {
          active: true,
          reason: `${evt.name} ${minsUntil >= 0 ? `releases in ${Math.round(minsUntil)} min` : `released ${Math.round(-minsUntil)} min ago`} — de-risk window`,
          event: { name: evt.name, date: evt.date, minutesUntil: Math.round(minsUntil) },
          windowMinutes: PRE_EVENT_WINDOW_MIN,
          sizeMultiplier: 0.5,
          checkedAt,
        };
      }
    }
  } catch (err) {
    logger.warn('Circuit breaker check failed', { error: String(err) });
  }
  return {
    active: false, reason: null, event: null,
    windowMinutes: PRE_EVENT_WINDOW_MIN, sizeMultiplier: 1, checkedAt,
  };
}
