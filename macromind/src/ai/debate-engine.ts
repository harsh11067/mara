/**
 * Bull/Bear/Synthesiser Macro-Debate Engine (fixture.md §B4)
 *
 * Nobody debates macro surprises: three adversarial roles argue the print,
 * then a synthesiser issues the verdict with explicit dissent.
 *
 * Quota-aware: ONE structured Gemini call plays all three roles (the fixture's
 * recommended collapse for the free tier), grounded in the surprise math,
 * market context, and real corpus analogs (citations by analog date).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import type { SurpriseResult, MarketContext } from './types.js';
import type { CorpusAnswer } from '../corpus/corpus.js';

const logger = createLogger('DebateEngine');

const DebateSchema = z.object({
  bull_case: z.string().min(10),
  bear_case: z.string().min(10),
  synthesis: z.string().min(10),
  conviction: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR']),
  confidence: z.number().min(0).max(100),
  dissent: z.string(),
  citations: z.array(z.string()).max(8),
});

export type MacroDebate = z.infer<typeof DebateSchema> & { generatedAt: number };

function buildDebatePrompt(
  surprise: SurpriseResult,
  market: MarketContext,
  corpus: CorpusAnswer | null,
): string {
  const analogBlock = corpus && corpus.analogs.length > 0
    ? corpus.analogs.slice(0, 6).map((a) =>
        `  ${a.date} ${a.eventType} ${a.direction} (z=${a.surpriseZ ?? '?'}): BTC +1d ${a.btcRet1d ?? '?'}%, +3d ${a.btcRet3d ?? '?'}%, +7d ${a.btcRet7d ?? '?'}% [regime ${a.regimeLabel ?? '?'}]`,
      ).join('\n') +
      `\n  Summary: n=${corpus.summary.n}, median +3d ${corpus.summary.medianBtc3d ?? '?'}%, hit-rate ${corpus.summary.hitRate3d ?? '?'}%`
    : '  (no corpus analogs available)';

  return `You are running MARA's three-role macro debate on a fresh economic print.

─── THE PRINT ───────────────────────────────────────────────
Event: ${surprise.event} | Actual ${surprise.actual} vs Forecast ${surprise.forecast} (prev ${surprise.previous ?? 'N/A'})
Surprise: ${surprise.surpriseScore.toFixed(2)}σ ${surprise.surpriseDirection} | Mapped crypto bias: ${surprise.cryptoBias}
BTC $${market.btcPrice.toLocaleString()} (${market.btcChange24h.toFixed(2)}% 24h) | ATR14 $${market.atr14.toFixed(0)} | ETF flows: ${market.etfFlowDirection}

─── HISTORICAL ANALOGS (MARA corpus — real prints, real forward returns) ────
${analogBlock}

─── DEBATE PROTOCOL ─────────────────────────────────────────
Role 1 BULL: strongest honest case BTC rises over 1-3 days. Cite specific numbers/analogs.
Role 2 BEAR: strongest honest case BTC falls. Cite specific numbers/analogs.
Role 3 SYNTHESISER: weigh both, issue the verdict, and state the strongest surviving counter-argument as "dissent".
Cite analogs by date (e.g. "2026-03-12 CPI"). If analogs contradict the mapping, say so.

RESPOND WITH VALID JSON ONLY:
{
  "bull_case": "<3-5 sentences>",
  "bear_case": "<3-5 sentences>",
  "synthesis": "<3-5 sentences, the verdict reasoning>",
  "conviction": "<STRONG_BULL|BULL|NEUTRAL|BEAR|STRONG_BEAR>",
  "confidence": <0-100>,
  "dissent": "<the strongest surviving counter-argument, 1-2 sentences>",
  "citations": ["<analog date + event>", ...]
}`;
}

export class DebateEngine {
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }

  async debate(
    surprise: SurpriseResult,
    market: MarketContext,
    corpus: CorpusAnswer | null,
  ): Promise<MacroDebate | null> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: config.gemini.model,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        } as Record<string, unknown>,
      });
      const result = await model.generateContent(buildDebatePrompt(surprise, market, corpus));
      const text = result.response.text().replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const parsed = DebateSchema.parse(JSON.parse(text));
      logger.info(`Debate verdict: ${parsed.conviction} (${parsed.confidence}%) with dissent`);
      return { ...parsed, generatedAt: Date.now() };
    } catch (err) {
      logger.warn('Debate engine failed (non-fatal, single-call verdict stands)', {
        error: String(err).slice(0, 160),
      });
      return null;
    }
  }
}
