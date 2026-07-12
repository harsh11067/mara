import { createLogger } from '../utils/logger.js';
import { SoSoValueClient, BTC_CURRENCY_ID } from '../services/sosovalue-client.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { computeSurprise } from './surprise-calculator.js';
import { ConvictionEngine, finalizeDecision } from './conviction-engine.js';
import { AgenticAnalyzer } from './agentic-analyzer.js';
import { DebateEngine } from './debate-engine.js';
import { selectPerpAsset, getEventMapping } from './event-mappings.js';
import { attestationService } from '../services/attestation-service.js';
import { classifyRegime } from '../risk/regime.js';
import { getCircuitBreakerState } from '../risk/circuit-breaker.js';
import { queryCorpus } from '../corpus/corpus.js';
import type { SurpriseResult, MarketContext, TradeDecision } from './types.js';
import type { EventDataPoint } from '../services/types.js';
import { config } from '../config.js';

const logger = createLogger('Analyzer');

export class Analyzer {
  private readonly sosoClient: SoSoValueClient;
  private readonly sodexClient: SoDEXClient;
  private readonly convictionEngine: ConvictionEngine;
  private readonly agenticAnalyzer: AgenticAnalyzer;
  private readonly debateEngine: DebateEngine;

  constructor() {
    this.sosoClient = new SoSoValueClient(config.sosovalue.apiKey, config.sosovalue.baseUrl);
    this.sodexClient = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    this.convictionEngine = new ConvictionEngine();
    this.agenticAnalyzer = new AgenticAnalyzer();
    this.debateEngine = new DebateEngine();
  }

  /**
   * Full analysis pipeline for a macro event.
   * Returns a TradeDecision.
   */
  async analyze(params: {
    eventName: string;
    actual: number;
    forecast: number;
    previous: number | null;
    eventId?: string;
    /** Macro release time (ms). Used for the on-chain event hash. */
    releaseTimestampMs?: number;
  }): Promise<{ surprise: SurpriseResult; market: MarketContext; decision: TradeDecision; perpAsset: string }> {
    const { eventName, actual, forecast, previous, eventId } = params;
    const releaseTimestampMs = params.releaseTimestampMs ?? Date.now();

    // Dynamically match the macro event to the most relevant perp (BTC/ETH/SOL)
    const perpAsset = selectPerpAsset(eventName, getEventMapping(eventName));

    logger.info(`Starting analysis pipeline for ${eventName}`, { actual, forecast, perpAsset });

    // ── Fetch all context in parallel ────────────────────────────────────────
    const [history, news, klines, etfHistory] = await Promise.allSettled([
      this.sosoClient.getEventHistory(eventName, 24),
      this.sosoClient.getLatestNews({ pageSize: 20 }),
      // SoSoValue free-tier only allows 1d klines; 30 bars serve ATR + regime
      this.sosoClient.getCurrencyKlines(BTC_CURRENCY_ID, { interval: '1d', limit: 30 }),
      this.sosoClient.getEtfSummaryHistory('BTC', 7),
    ]);

    const historyData: EventDataPoint[] = history.status === 'fulfilled' ? history.value : [];
    const newsItems = news.status === 'fulfilled' ? news.value : [];
    const klineData = klines.status === 'fulfilled' ? klines.value : [];
    const etfData = etfHistory.status === 'fulfilled' ? etfHistory.value : [];

    if (history.status === 'rejected') logger.warn('Could not fetch event history', { error: history.reason });
    if (news.status === 'rejected') logger.warn('Could not fetch news', { error: news.reason });
    if (klines.status === 'rejected') logger.warn('Could not fetch klines', { error: klines.reason });
    if (etfHistory.status === 'rejected') logger.warn('Could not fetch ETF history', { error: etfHistory.reason });

    // ── Surprise calculation ─────────────────────────────────────────────────
    const surprise = computeSurprise(eventName, actual, forecast, previous, historyData);

    // ── Market context ────────────────────────────────────────────────────────
    const atr14 = this.sodexClient.calcATR(klineData);

    // Price from SoSoValue snapshot (BTC), fallback to klines last close
    let btcPrice = 0;
    let btcChange24h = 0;
    let btcVolume24h = 0;
    try {
      const snap = await this.sosoClient.getCurrencySnapshot(BTC_CURRENCY_ID);
      btcPrice = snap.price;
      btcChange24h = (snap.priceChangePercent24h ?? 0) * 100;
      btcVolume24h = snap.volume24h ?? 0;
    } catch {
      // Fallback to klines
      if (klineData.length > 0) btcPrice = klineData[klineData.length - 1].close;
    }

    // 1d change from klines (best we have with free-tier)
    let btcChange1h = 0;
    if (klineData.length >= 2) {
      const last = klineData[klineData.length - 1];
      const prev = klineData[klineData.length - 2];
      btcChange1h = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;
    }

    // ETF flow summary
    let etfFlowDirection: MarketContext['etfFlowDirection'] = 'unknown';
    let etfFlowMagnitude = 0;
    if (etfData.length >= 3) {
      const recentFlows = etfData.slice(0, 3).map((e) => e.dailyNetFlow ?? e.totalNetFlow ?? 0);
      const totalFlow = recentFlows.reduce((s, f) => s + f, 0);
      etfFlowMagnitude = Math.abs(totalFlow);
      if (totalFlow > 0) etfFlowDirection = 'inflow';
      else if (totalFlow < 0) etfFlowDirection = 'outflow';
      else etfFlowDirection = 'neutral';
    }

    // Recent headlines (time-filtered ±30min from now if possible)
    const now = Date.now();
    const headlines = newsItems
      .filter((n) => {
        const t = n.releaseTime || n.publishTime || 0;
        return t > now - 30 * 60 * 1000; // last 30 min
      })
      .map((n) => n.title)
      .filter(Boolean)
      .slice(0, 10);

    // Fallback: use all recent news titles if nothing within 30 min
    const finalHeadlines = headlines.length > 0
      ? headlines
      : newsItems.slice(0, 10).map((n) => n.title).filter(Boolean) as string[];

    const market: MarketContext = {
      btcPrice,
      btcChange1h,
      btcChange24h,
      btcVolume24h,
      atr14,
      etfFlowDirection,
      etfFlowMagnitude,
      recentHeadlines: finalHeadlines,
    };

    // ── Regime + circuit breaker (regime-conditional risk) ───────────────────
    const regime = classifyRegime(klineData);
    const circuitBreaker = getCircuitBreakerState();
    logger.info(`Regime: ${regime.regime} | Circuit breaker: ${circuitBreaker.active ? 'ACTIVE' : 'inactive'}`);

    // ── Data-quality flags (mocks.md B2 — record what was live vs degraded) ──
    const dataQuality = {
      eventHistory: history.status === 'fulfilled' && historyData.length > 0 ? 'live' : 'missing',
      news: news.status === 'fulfilled' && newsItems.length > 0 ? 'live' : 'missing',
      klines: klines.status === 'fulfilled' && klineData.length > 0 ? 'live' : 'missing',
      etfFlows: etfHistory.status === 'fulfilled' && etfData.length > 0 ? 'live' : 'missing',
      btcPriceSource: btcPrice > 0 ? (btcChange24h !== 0 || btcVolume24h > 0 ? 'snapshot' : 'klines_fallback') : 'unavailable',
    };

    // ── AI decision: agentic tool-use loop first, single-call fallback ───────
    let decision: TradeDecision;
    const agentic = await this.agenticAnalyzer.run(surprise, market, regime);

    // Bull/bear/synthesiser debate (grounded in real corpus analogs) — enriches
    // the decision record; non-fatal if quota-limited.
    let corpusAnswer = null;
    try {
      corpusAnswer = queryCorpus({
        direction: surprise.surpriseDirection === 'inline' ? undefined : surprise.surpriseDirection,
        minAbsZ: 0.5, limit: 8,
      });
    } catch { /* corpus optional */ }
    const debate = await this.debateEngine.debate(surprise, market, corpusAnswer);

    if (agentic) {
      decision = finalizeDecision({
        raw: agentic.raw,
        surprise, market, eventId,
        convictionFloor: Math.max(config.risk.minConvictionScore, regime.risk.convictionFloor),
        extraContext: {
          engine: 'agentic_tool_use',
          agentTrace: agentic.trace,
          toolCallCount: agentic.toolCallCount,
          regime: { label: regime.regime, trendPct: regime.trendPct, volAnnual: regime.realizedVolAnnual, risk: regime.risk },
          circuitBreaker: { active: circuitBreaker.active, reason: circuitBreaker.reason },
          debate,
          dataQuality,
        },
      });
    } else {
      // Fallback path: single-call engine (persists via the same finalizer)
      decision = await this.convictionEngine.analyze(surprise, market, eventId);
    }

    // ── On-chain attestation ───────────────────────────────────────────────────
    // Hash this decision and queue it for the immutable ValueChain audit trail.
    // Non-blocking: trade execution never waits on the chain. Covers both the
    // live EVENT_FIRED pipeline and the manual /api/trigger demo path, since both
    // run through analyze().
    attestationService.enqueueDecision(decision, releaseTimestampMs);

    return { surprise, market, decision, perpAsset };
  }
}
