/**
 * Agentic Tool-Use Analyzer (transformation.md §5 — "make the AI the core")
 *
 * Replaces the one-shot Gemini call with a transparent function-calling loop:
 * Gemini is handed real tools; every number it cites is backed by a tool call
 * (the Edgework anti-hallucination rule). Each step is traced and streamed to
 * the dashboard over WebSocket (AGENT_TRACE), so judges watch the AI *decide*:
 *
 *   AI → get_macro_surprise → +2.1σ → query_macro_corpus → 8 analogs, median
 *   -1.8% 3d → get_etf_flows → outflow → verdict STRONG_BEAR 78%
 *
 * Deterministic surprise math, regime state, and risk gates are tools the AI
 * MUST consult — the AI orchestrates, hard risk rules still bind.
 *
 * Failure mode: any error/quota issue → returns null → the caller falls back
 * to the single-call ConvictionEngine (never trades blind).
 */
import {
  SchemaType,
  type FunctionDeclaration, type Part,
} from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import { geminiClient, isQuotaError, rotateGeminiKey } from './gemini-pool.js';
import { z } from 'zod';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { appEvents } from '../utils/event-emitter.js';
import { queryCorpus } from '../corpus/corpus.js';
import { getCircuitBreakerState } from '../risk/circuit-breaker.js';
import { isKillSwitchActive } from '../executor/kill-switch.js';
import type { SurpriseResult, MarketContext, AIDecisionRaw } from './types.js';
import type { RegimeState } from '../risk/regime.js';

const logger = createLogger('AgenticAnalyzer');

const MAX_ITERATIONS = 6;

const FinalSchema = z.object({
  conviction: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR']),
  confidence: z.number().min(0).max(100),
  reasoning: z.string().min(10),
  key_factors: z.array(z.string()).max(5),
  risk_flags: z.array(z.string()),
});

export interface AgentTraceStep {
  runId: string;
  step: number;
  kind: 'thinking' | 'tool_call' | 'tool_result' | 'final' | 'error';
  tool?: string;
  args?: Record<string, unknown>;
  summary: string;
  ts: number;
}

// ── Tool declarations (the docstrings ARE the interface the LLM reads) ────────

const TOOL_DECLS: FunctionDeclaration[] = [
  {
    name: 'get_macro_surprise',
    description: 'The deterministic surprise engine output for the triggering event: actual, forecast, rolling-window z-score, mapped crypto bias, and data confidence. Always consult this first.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'get_market_snapshot',
    description: 'Live BTC market state at decision time: price, 24h change, volume, ATR(14) volatility.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'get_etf_flows',
    description: 'US spot-ETF net flows over the last week (institutional confirmation signal). Direction and USD magnitude. Note: end-of-day data, not intraday.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'get_recent_news',
    description: 'Recent macro headlines from SoSoValue feeds at decision time.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'get_regime',
    description: 'Current BTC market regime (BULL_QUIET/BULL_VOLATILE/RANGING/BEAR_VOLATILE/CRASH) with regime-conditional risk parameters. You MUST consult this before a final verdict.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'get_risk_state',
    description: 'Hard risk gates that bind regardless of your verdict: kill-switch status, macro circuit breaker, conviction floor. You MUST consult this before a final verdict.',
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: 'query_macro_corpus',
    description: 'MARA\'s hand-built macro-catalyst corpus: historical analogs of this surprise with real BTC forward returns (+1d/+3d/+7d/+30d), median moves and hit rate. Cite analog dates in your reasoning.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        direction: { type: SchemaType.STRING, description: "'above' or 'below' — the surprise direction to match" },
        min_abs_z: { type: SchemaType.NUMBER, description: 'minimum |z| of analogs (default 0.5)' },
      },
      required: [],
    },
  },
];

export interface AgenticResult {
  raw: AIDecisionRaw;
  trace: AgentTraceStep[];
  toolCallCount: number;
}

export class AgenticAnalyzer {

  async run(
    surprise: SurpriseResult,
    market: MarketContext,
    regime: RegimeState,
  ): Promise<AgenticResult | null> {
    const runId = uuidv4().slice(0, 8);
    const trace: AgentTraceStep[] = [];
    let step = 0;

    const push = (t: Omit<AgentTraceStep, 'runId' | 'step' | 'ts'>) => {
      const entry: AgentTraceStep = { runId, step: ++step, ts: Date.now(), ...t };
      trace.push(entry);
      void appEvents.emit('AGENT_TRACE', entry);
    };

    // local tool executors — every one returns REAL state
    const tools: Record<string, (args: Record<string, unknown>) => unknown> = {
      get_macro_surprise: () => ({
        event: surprise.event, actual: surprise.actual, forecast: surprise.forecast,
        previous: surprise.previous, surprise_z: surprise.surpriseScore,
        direction: surprise.surpriseDirection, mapped_crypto_bias: surprise.cryptoBias,
        impact: surprise.impactMagnitude, historical_points: surprise.historicalCount,
        data_confidence: surprise.confidence,
      }),
      get_market_snapshot: () => ({
        btc_price: market.btcPrice, change_24h_pct: market.btcChange24h,
        change_1d_pct: market.btcChange1h, volume_24h_usd: market.btcVolume24h,
        atr14_usd: market.atr14,
      }),
      get_etf_flows: () => ({
        direction: market.etfFlowDirection,
        magnitude_usd: market.etfFlowMagnitude,
        latency_note: 'end-of-day data',
      }),
      get_recent_news: () => ({ headlines: market.recentHeadlines.slice(0, 10) }),
      get_regime: () => ({
        regime: regime.regime, trend_pct: regime.trendPct,
        realized_vol_annual_pct: regime.realizedVolAnnual,
        size_multiplier: regime.risk.sizeMultiplier,
        conviction_floor: regime.risk.convictionFloor,
        explanation: regime.explanation,
      }),
      get_risk_state: () => {
        const cb = getCircuitBreakerState();
        return {
          kill_switch_active: isKillSwitchActive(),
          circuit_breaker: cb.active ? cb.reason : 'inactive',
          conviction_floor: Math.max(config.risk.minConvictionScore, regime.risk.convictionFloor),
          max_leverage: config.risk.maxLeverage,
          max_drawdown_pct: config.risk.maxDrawdown * 100,
        };
      },
      query_macro_corpus: (args) => {
        const answer = queryCorpus({
          eventType: matchCorpusType(surprise.event),
          direction: (args.direction as 'above' | 'below' | undefined) ?? surprise.surpriseDirection as 'above' | 'below',
          minAbsZ: (args.min_abs_z as number | undefined) ?? 0.5,
          limit: 10,
        });
        return {
          n: answer.summary.n,
          median_btc_1d: answer.summary.medianBtc1d, median_btc_3d: answer.summary.medianBtc3d,
          median_btc_7d: answer.summary.medianBtc7d, hit_rate_3d_pct: answer.summary.hitRate3d,
          analogs: answer.analogs.slice(0, 6).map((a) => ({
            date: a.date, event: a.eventType, z: a.surpriseZ, regime: a.regimeLabel,
            btc_1d: a.btcRet1d, btc_3d: a.btcRet3d, btc_7d: a.btcRet7d,
          })),
          caveat: answer.caveat,
        };
      },
    };

    try {
      const model = geminiClient().getGenerativeModel({
        model: config.gemini.model,
        tools: [{ functionDeclarations: TOOL_DECLS }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        } as Record<string, unknown>,
      });

      const chat = model.startChat();
      push({ kind: 'thinking', summary: `Agent run started for ${surprise.event} (${surprise.surpriseScore.toFixed(2)}σ ${surprise.surpriseDirection})` });

      let result = await chat.sendMessage(
        `A macro event just fired: ${surprise.event} printed ${surprise.actual} vs forecast ${surprise.forecast}.
You are MARA's decision agent. Investigate using your tools — consult the surprise engine, the corpus analogs, ETF flows, the regime, and the hard risk gates. Every number in your final reasoning must come from a tool result (cite corpus analog dates).
When you have enough evidence, respond with your FINAL VERDICT as VALID JSON ONLY (no markdown):
{"conviction":"<STRONG_BULL|BULL|NEUTRAL|BEAR|STRONG_BEAR>","confidence":<0-100>,"reasoning":"<3-4 sentences citing tool-sourced numbers>","key_factors":["..."],"risk_flags":["..."]}`,
      );

      let toolCallCount = 0;
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const calls = result.response.functionCalls();
        if (!calls || calls.length === 0) break;

        const responses: Part[] = [];
        for (const call of calls) {
          toolCallCount++;
          const args = (call.args ?? {}) as Record<string, unknown>;
          push({ kind: 'tool_call', tool: call.name, args, summary: `→ ${call.name}(${JSON.stringify(args)})` });
          const executor = tools[call.name];
          const output = executor ? executor(args) : { error: `unknown tool ${call.name}` };
          push({
            kind: 'tool_result', tool: call.name,
            summary: `← ${call.name}: ${JSON.stringify(output).slice(0, 180)}`,
          });
          responses.push({ functionResponse: { name: call.name, response: { result: output } } });
        }
        result = await chat.sendMessage(responses);
      }

      const text = result.response.text().replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error(`No JSON verdict in agent output: ${text.slice(0, 120)}`);
      const parsed = FinalSchema.parse(JSON.parse(text.slice(jsonStart, jsonEnd + 1)));

      if (toolCallCount === 0) {
        // No tool was consulted — violates the grounding rule; reject the run.
        throw new Error('Agent issued a verdict without consulting any tool');
      }

      push({ kind: 'final', summary: `VERDICT ${parsed.conviction} (${parsed.confidence}%) after ${toolCallCount} tool calls` });
      logger.info(`Agentic verdict: ${parsed.conviction} (${parsed.confidence}%) — ${toolCallCount} tool calls`);

      return {
        raw: {
          conviction: parsed.conviction,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
          key_factors: parsed.key_factors,
          risk_flags: parsed.risk_flags,
        },
        trace,
        toolCallCount,
      };
    } catch (err) {
      const msg = String(err).slice(0, 200);
      // On quota errors, rotate so the fallback engines run on the sibling key.
      if (isQuotaError(msg)) rotateGeminiKey(msg);
      push({ kind: 'error', summary: `Agentic loop failed: ${msg} — falling back to single-call engine` });
      logger.warn('Agentic loop failed, falling back', { error: msg });
      return null;
    }
  }
}

/** Map a live event name onto a corpus event_type. */
function matchCorpusType(eventName: string): string | undefined {
  const n = eventName.toLowerCase();
  if (n.includes('core cpi')) return 'Core CPI';
  if (n.includes('cpi')) return 'CPI';
  if (n.includes('payroll') || n.includes('nfp')) return 'NFP';
  if (n.includes('pce')) return 'PCE';
  if (n.includes('ppi')) return 'PPI';
  if (n.includes('fomc') || n.includes('rate decision') || n.includes('interest rate')) return 'FOMC';
  if (n.includes('unemployment')) return 'Unemployment';
  return undefined;
}
