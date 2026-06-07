import type { SurpriseResult, MarketContext } from './types.js';

/**
 * Build the conviction analysis prompt for Claude.
 * Returns a prompt requesting structured JSON output — no markdown wrapping.
 */
export function buildConvictionPrompt(
  surprise: SurpriseResult,
  market: MarketContext,
  recentNews: string[],
): string {
  const newsBlock = recentNews.length > 0
    ? recentNews.map((h, i) => `  ${i + 1}. ${h}`).join('\n')
    : '  (no recent macro news available)';

  const etfBlock = market.etfFlowDirection === 'unknown'
    ? '  ETF flow data unavailable'
    : `  Direction: ${market.etfFlowDirection} | Magnitude: $${(market.etfFlowMagnitude / 1e6).toFixed(1)}M`;

  return `You are a macro-crypto trading analyst for an autonomous agent called MARA.
Your job: analyze a macro economic event surprise and determine directional conviction for BTC.

─── MACRO EVENT ──────────────────────────────────────────────────────────────
Event:            ${surprise.event}
Actual:           ${surprise.actual}
Forecast:         ${surprise.forecast}
Previous:         ${surprise.previous ?? 'N/A'}
Surprise Score:   ${surprise.surpriseScore.toFixed(2)} stddevs from consensus
Direction:        ${surprise.surpriseDirection.toUpperCase()} forecast
Crypto Bias:      ${surprise.cryptoBias.toUpperCase()} (domain mapping)
Impact Magnitude: ${surprise.impactMagnitude.toUpperCase()}
Historical Count: ${surprise.historicalCount} data points used for stddev
Confidence:       ${surprise.confidence.toUpperCase()}

─── MARKET CONTEXT ───────────────────────────────────────────────────────────
BTC Price:        $${market.btcPrice.toLocaleString()}
1h Change:        ${market.btcChange1h.toFixed(2)}%
24h Volume:       $${(market.btcVolume24h / 1e9).toFixed(1)}B
ATR(14):          $${market.atr14.toFixed(0)}

─── ETF FLOWS (last 7 days) ──────────────────────────────────────────────────
${etfBlock}

─── RECENT MACRO NEWS (last 30 min) ──────────────────────────────────────────
${newsBlock}

─── YOUR TASK ────────────────────────────────────────────────────────────────
Provide directional conviction for BTC over the next 2-6 hours.
Consider: macro impact, market reaction, ETF flows, news sentiment.
Be specific — reference the actual numbers, not generic statements.

RESPOND WITH VALID JSON ONLY (no markdown, no code fences, no extra text):
{
  "conviction": "<STRONG_BULL|BULL|NEUTRAL|BEAR|STRONG_BEAR>",
  "confidence": <integer 0-100>,
  "reasoning": "<2-3 sentence explanation referencing actual numbers>",
  "key_factors": ["<factor1>", "<factor2>", "<factor3>"],
  "risk_flags": ["<concern1>"]
}

Rules:
- conviction STRONG_BULL/STRONG_BEAR requires confidence >= 70
- Use NEUTRAL if signals contradict each other significantly
- reasoning MUST reference: the actual surprise number, at least one news headline (if any)
- risk_flags can be empty array [] if none
- Output ONLY the JSON object, nothing else`;
}

/**
 * Fallback prompt if structured JSON parse fails — stricter instructions.
 */
export function buildStrictConvictionPrompt(
  surprise: SurpriseResult,
  market: MarketContext,
  recentNews: string[],
): string {
  return buildConvictionPrompt(surprise, market, recentNews) + `

IMPORTANT: Your ENTIRE response must be parseable by JSON.parse().
Start with { and end with }. No text before or after.`;
}

/**
 * Build a news sentiment context for the dashboard reasoning card.
 */
export function buildSentimentSummary(headlines: string[], event: string): string {
  if (headlines.length === 0) return `No specific news found for ${event}.`;
  const listed = headlines.slice(0, 5).map((h, i) => `${i + 1}. "${h}"`).join('\n');
  return `Top news related to ${event}:\n${listed}`;
}
