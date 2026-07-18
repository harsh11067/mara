/**
 * Gemini API key pool — dual-key rotation so the pipeline never halts on a
 * single free-tier quota. All AI engines draw their client from here; on a
 * quota/rate-limit error they call rotateGeminiKey() and retry on the sibling
 * key instead of sleeping through the 429 backoff window.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('GeminiPool');

const keys = config.gemini.apiKeys;
const clients = keys.map((k) => new GoogleGenerativeAI(k));
let cursor = 0;

/** Client bound to the currently active key. */
export function geminiClient(): GoogleGenerativeAI {
  return clients[cursor % clients.length];
}

/** The currently active raw key (diag health checks). */
export function currentGeminiKey(): string {
  return keys[cursor % keys.length];
}

/** 1-based index of the active key, for logs ("key 2/2"). */
export function geminiKeyLabel(): string {
  return `key ${(cursor % keys.length) + 1}/${keys.length}`;
}

/** Advance to the next key. No-op with a single key. */
export function rotateGeminiKey(reason?: string): void {
  if (keys.length < 2) return;
  cursor = (cursor + 1) % keys.length;
  logger.warn(`Rotated Gemini API key → ${geminiKeyLabel()}${reason ? ` (${reason.slice(0, 120)})` : ''}`);
}

/** True when an error message smells like quota/rate-limit — the rotate signal. */
export function isQuotaError(message: string): boolean {
  return /\b429\b|quota|RESOURCE_EXHAUSTED|rate.?limit|Too Many Requests/i.test(message);
}
