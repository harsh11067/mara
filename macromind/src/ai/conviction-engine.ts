import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { buildConvictionPrompt, buildStrictConvictionPrompt } from './prompts.js';
import { geminiClient, geminiKeyLabel, isQuotaError, rotateGeminiKey } from './gemini-pool.js';
import { DecisionStore } from '../store/decision-store.js';
import type { SurpriseResult, MarketContext, TradeDecision, AIDecisionRaw } from './types.js';
import type { Conviction, TradeAction, NoTradeReason } from '../store/decision-store.js';

const logger = createLogger('ConvictionEngine');

// ── Zod schema for AI response validation ─────────────────────────────────────

const AIResponseSchema = z.object({
  conviction: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR']),
  confidence: z.number().min(0).max(100),
  reasoning: z.string().min(10),
  key_factors: z.array(z.string()).max(5),
  risk_flags: z.array(z.string()),
});

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CONFIDENCE_TO_TRADE = config.risk.minConvictionScore; // 60

const TRADE_CONVICTIONS = new Set<string>([
  'STRONG_BULL', 'STRONG_BEAR', 'BULL', 'BEAR',
]);

const STRONG_TRADE_CONVICTIONS = new Set<string>([
  'STRONG_BULL', 'STRONG_BEAR',
]);

function convictionToAction(conviction: string, confidence: number, floor: number = MIN_CONFIDENCE_TO_TRADE): TradeAction {
  if (!TRADE_CONVICTIONS.has(conviction)) return 'NO_TRADE';
  if (confidence < floor) return 'NO_TRADE';
  // BULL/BEAR (non-strong) require higher confidence bar
  if (!STRONG_TRADE_CONVICTIONS.has(conviction) && confidence < Math.max(75, floor)) return 'NO_TRADE';
  return conviction.includes('BULL') ? 'LONG' : 'SHORT';
}

/**
 * Shared finalizer — turns a raw AI verdict (from the single-call engine OR the
 * agentic tool-use loop) into a persisted TradeDecision. Both AI paths persist
 * through here so the decision schema is identical regardless of engine.
 */
export function finalizeDecision(params: {
  raw: AIDecisionRaw | null;
  lastError?: string;
  surprise: SurpriseResult;
  market: MarketContext;
  eventId?: string;
  /** regime-conditional conviction floor (regime.ts); defaults to config floor */
  convictionFloor?: number;
  /** extra JSON persisted into market_context: agentTrace, debate, regime, dataQuality… */
  extraContext?: Record<string, unknown>;
}): TradeDecision {
  const { raw, lastError, surprise, market, eventId, extraContext } = params;
  const floor = params.convictionFloor ?? MIN_CONFIDENCE_TO_TRADE;
  const id = uuidv4();
  const timestamp = Date.now();

  let conviction: Conviction;
  let confidence: number;
  let reasoning: string;
  let keyFactors: string[];
  let riskFlags: string[];
  let action: TradeAction;
  let noTradeReason: NoTradeReason | undefined;

  if (!raw) {
    conviction = 'NEUTRAL';
    confidence = 0;
    reasoning = `AI analysis failed after retries. Last error: ${lastError ?? 'unknown'}`;
    keyFactors = [];
    riskFlags = ['ai_failure'];
    action = 'NO_TRADE';
    noTradeReason = 'ai_failure';
  } else {
    conviction = raw.conviction as Conviction;
    confidence = raw.confidence;
    reasoning = raw.reasoning;
    keyFactors = raw.key_factors;
    riskFlags = raw.risk_flags;
    action = convictionToAction(conviction, confidence, floor);
    if (action === 'NO_TRADE') noTradeReason = 'low_conviction';
  }

  const decision: TradeDecision = {
    id,
    timestamp,
    trigger: {
      event: surprise.event,
      surpriseScore: surprise.surpriseScore,
      surpriseDirection: surprise.surpriseDirection,
      actual: surprise.actual,
      forecast: surprise.forecast,
    },
    conviction,
    confidence,
    reasoning,
    keyFactors,
    riskFlags,
    newsHeadlines: market.recentHeadlines.slice(0, 5),
    etfFlowDirection: market.etfFlowDirection,
    currentPrice: market.btcPrice,
    recentVolatility: market.atr14,
    action,
    noTradeReason,
  };

  DecisionStore.insert({
    id,
    eventId: eventId ?? null,
    timestamp,
    conviction,
    confidence,
    reasoning,
    action,
    noTradeReason: noTradeReason ?? null,
    newsContext: market.recentHeadlines.slice(0, 10),
    marketContext: {
      eventName: surprise.event,
      actual: surprise.actual,
      forecast: surprise.forecast,
      btcPrice: market.btcPrice,
      btcChange1h: market.btcChange1h,
      btcChange24h: market.btcChange24h,
      btcVolume24h: market.btcVolume24h,
      atr14: market.atr14,
      etfFlowDirection: market.etfFlowDirection,
      surpriseScore: surprise.surpriseScore,
      surpriseDirection: surprise.surpriseDirection,
      ...extraContext,
    },
  });

  logger.info(`Decision: ${conviction} (${confidence}%) → ${action}`, {
    event: surprise.event,
    noTradeReason,
  });

  return decision;
}

// ── Main engine ───────────────────────────────────────────────────────────────

export class ConvictionEngine {

  /**
   * Analyze a macro surprise and market context to produce a trade decision.
   * Retries up to 3 times if Gemini returns malformed JSON.
   * Falls back to NO_TRADE if all retries fail.
   */
  async analyze(
    surprise: SurpriseResult,
    market: MarketContext,
    eventId?: string,
  ): Promise<TradeDecision> {
    const id = uuidv4();
    const timestamp = Date.now();

    let raw: AIDecisionRaw | null = null;
    let lastError = '';

    // ── Retry loop (max 3 attempts) ──────────────────────────────────────────
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const prompt = attempt === 1
          ? buildConvictionPrompt(surprise, market, market.recentHeadlines)
          : buildStrictConvictionPrompt(surprise, market, market.recentHeadlines);

        logger.info(`Gemini analysis attempt ${attempt}/3 for ${surprise.event} (${geminiKeyLabel()})`);

        const model = geminiClient().getGenerativeModel({
          model: config.gemini.model,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          generationConfig: {
            temperature: 0.2,       // low temperature for consistent structured output
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',  // force JSON mode
            // Disable thinking tokens for gemini-2.5-flash — thinking eats the output budget
            // causing truncated JSON. thinkingBudget=0 gives fast, deterministic output.
            thinkingConfig: { thinkingBudget: 0 },
          } as Record<string, unknown>,
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Strip any accidental markdown fences (shouldn't happen with JSON mode, but be safe)
        const cleaned = text
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        const parsed = JSON.parse(cleaned) as unknown;
        const validated = AIResponseSchema.parse(parsed);

        raw = {
          conviction: validated.conviction,
          confidence: validated.confidence,
          reasoning: validated.reasoning,
          key_factors: validated.key_factors,
          risk_flags: validated.risk_flags,
        };
        break; // success

      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn(`Gemini attempt ${attempt} failed`, { error: lastError.slice(0, 200) });

        if (attempt < 3) {
          if (isQuotaError(lastError)) {
            // Quota hit — switch to the sibling key immediately instead of
            // sleeping through the 429 backoff window.
            rotateGeminiKey(lastError);
            await new Promise((r) => setTimeout(r, 1000));
          } else {
            // Parse Gemini's retryDelay hint (e.g. "Please retry in 51s")
            const retryMatch = lastError.match(/retry\w*\s+in\s+(\d+)/i);
            const retryMs = retryMatch ? parseInt(retryMatch[1], 10) * 1000 : 2000 * attempt;
            const waitMs = Math.min(retryMs, 65_000); // cap at 65s
            logger.info(`Waiting ${waitMs / 1000}s before retry...`);
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }
      }
    }

    // ── Finalize via the shared helper (identical schema to the agentic path) ─
    void id; void timestamp;
    return finalizeDecision({
      raw, lastError, surprise, market, eventId,
      extraContext: { engine: 'single_call' },
    });
  }
}
