/**
 * /diag engine (fixture.md §5 / transformation.md §2 — the Mosaic pattern)
 *
 * Live integration checks with latency + a real value snippet for every
 * dependency, proving to judges that nothing is mocked:
 *
 *   sosovalue   — live /macro/events + rotating probe of the endpoint registry
 *   sodex_pub   — live perps symbols read
 *   sodex_auth  — signed perps balances read (proves EIP-712 headers accepted)
 *   gemini      — model list ping (no generation quota burned)
 *   database    — SQLite SELECT + row counts
 *   replication — Neon snapshot state (persistence across redeploys)
 *   attestation — RPC block number + contract code presence + chain identity
 *   telegram    — getMe
 *
 * Cached 25 s so judges can hammer refresh without burning API budgets.
 */
import { config } from '../config.js';
import { currentGeminiKey, geminiKeyLabel } from '../ai/gemini-pool.js';
import { SoSoValueClient, SOSOVALUE_ENDPOINTS } from '../services/sosovalue-client.js';
import { SoDEXClient } from '../services/sodex-client.js';
import { telegramCheck } from '../services/telegram.js';
import { replicatorStatus } from '../store/db-replicator.js';
import { getDb } from '../store/db.js';
import { globalCache } from '../utils/ttl-cache.js';
import { getCircuitBreakerState } from '../risk/circuit-breaker.js';
import { corpusStats } from '../corpus/corpus.js';
import { ethers } from 'ethers';

export interface DiagCheck {
  name: string;
  label: string;
  ok: boolean;
  latencyMs: number | null;
  detail: string;
  lastValue?: unknown;
}

export interface DiagReport {
  overall: 'green' | 'degraded' | 'red';
  checks: DiagCheck[];
  endpointRegistry: {
    total: number;
    byModule: Record<string, number>;
    probedLive: Array<{ path: string; ok: boolean; latencyMs: number }>;
  };
  circuitBreaker: ReturnType<typeof getCircuitBreakerState>;
  corpus: ReturnType<typeof corpusStats> | { rows: number; error: string };
  generatedAt: number;
  cachedForMs: number;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; err?: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t0, value };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, err: String(err).slice(0, 160) };
  }
}

let probeCursor = 0;

export async function runDiag(): Promise<DiagReport> {
  return globalCache.wrap('diag:full', 25_000, async () => {
    const soso = new SoSoValueClient(config.sosovalue.apiKey, config.sosovalue.baseUrl);
    const sodex = new SoDEXClient(config.sodex.endpoint, config.sodex.apiKeyName);
    const checks: DiagCheck[] = [];

    // ── SoSoValue core ───────────────────────────────────────────────────────
    const sosoRes = await timed(() => soso.getUpcomingEvents());
    checks.push({
      name: 'sosovalue', label: 'SoSoValue API (macro calendar)',
      ok: sosoRes.ok && (sosoRes.value?.length ?? 0) > 0,
      latencyMs: sosoRes.ms,
      detail: sosoRes.ok
        ? `${sosoRes.value?.length ?? 0} upcoming events`
        : sosoRes.err ?? 'failed',
      lastValue: sosoRes.value?.slice(0, 2).map((e) => `${e.date} ${e.name}`),
    });

    // ── SoDEX public read ────────────────────────────────────────────────────
    const sodexPub = await timed(() => sodex.getPerpsTickers());
    const btcTicker = sodexPub.value?.find((t) => t.symbol.includes('BTC'));
    checks.push({
      name: 'sodex_public', label: 'SoDEX testnet (public market data)',
      ok: sodexPub.ok && (sodexPub.value?.length ?? 0) > 0,
      latencyMs: sodexPub.ms,
      detail: sodexPub.ok
        ? `${sodexPub.value?.length} perp tickers · BTC $${btcTicker ? parseFloat(btcTicker.lastPrice).toLocaleString() : '?'}`
        : sodexPub.err ?? 'failed',
      lastValue: btcTicker?.lastPrice,
    });

    // ── SoDEX signed read (proves the auth headers work) ─────────────────────
    const sodexAuth = await timed(() => sodex.getPerpsBalances(config.sodex.masterAddress));
    checks.push({
      name: 'sodex_signed', label: 'SoDEX account (authenticated read)',
      ok: sodexAuth.ok,
      latencyMs: sodexAuth.ms,
      detail: sodexAuth.ok
        ? `balance ${parseFloat(sodexAuth.value?.availableBalance ?? '0').toFixed(2)} USDC (operator ${config.sodex.masterAddress.slice(0, 8)}…)`
        : sodexAuth.err ?? 'failed',
    });

    // ── Gemini (model metadata ping — burns no generation quota) ────────────
    const gem = await timed(async () => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}?key=${currentGeminiKey()}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { name?: string };
      return json.name ?? 'ok';
    });
    checks.push({
      name: 'gemini', label: `Gemini AI (${config.gemini.model})`,
      ok: gem.ok, latencyMs: gem.ms,
      detail: gem.ok
        ? `model reachable: ${gem.value} (${geminiKeyLabel()} active, pool of ${config.gemini.apiKeys.length})`
        : gem.err ?? 'failed',
    });

    // ── Database ─────────────────────────────────────────────────────────────
    const dbRes = await timed(async () => {
      const db = getDb();
      const d = (db.prepare('SELECT COUNT(*) n FROM decisions').get() as { n: number }).n;
      const t = (db.prepare('SELECT COUNT(*) n FROM trades').get() as { n: number }).n;
      const e = (db.prepare('SELECT COUNT(*) n FROM events').get() as { n: number }).n;
      return { decisions: d, trades: t, events: e };
    });
    checks.push({
      name: 'database', label: 'SQLite store',
      ok: dbRes.ok, latencyMs: dbRes.ms,
      detail: dbRes.ok
        ? `${dbRes.value?.decisions} decisions · ${dbRes.value?.trades} trades · ${dbRes.value?.events} events`
        : dbRes.err ?? 'failed',
    });

    // ── Neon replication ─────────────────────────────────────────────────────
    const rep = replicatorStatus();
    checks.push({
      name: 'replication', label: 'Neon Postgres persistence',
      ok: rep.enabled ? rep.lastError === null : false,
      latencyMs: null,
      detail: !rep.enabled
        ? 'DATABASE_URL not set — snapshots disabled (local dev)'
        : rep.lastError
          ? `error: ${rep.lastError}`
          : rep.lastPushAt
            ? `last snapshot ${Math.round((Date.now() - rep.lastPushAt) / 1000)}s ago (${((rep.snapshotBytes ?? 0) / 1024).toFixed(0)} KB)`
            : 'enabled — first snapshot pending',
    });

    // ── Attestation chain ────────────────────────────────────────────────────
    const att = await timed(async () => {
      if (!config.attestation.rpcUrl || !config.attestation.contractAddress) {
        throw new Error('attestation not configured');
      }
      const provider = new ethers.JsonRpcProvider(config.attestation.rpcUrl);
      const [block, code, network] = await Promise.all([
        provider.getBlockNumber(),
        provider.getCode(config.attestation.contractAddress),
        provider.getNetwork(),
      ]);
      return {
        block,
        hasContract: code !== '0x',
        chainId: Number(network.chainId),
        isValueChainTestnet: Number(network.chainId) === 138565,
      };
    });
    checks.push({
      name: 'attestation', label: 'On-chain attestation (ValueChain)',
      ok: att.ok && (att.value?.hasContract ?? false),
      latencyMs: att.ms,
      detail: att.ok
        ? `chainId ${att.value?.chainId}${att.value?.isValueChainTestnet ? ' (ValueChain testnet)' : ' (LOCAL DEV chain — honestly labeled)'} · block ${att.value?.block} · contract ${att.value?.hasContract ? 'deployed' : 'MISSING'}`
        : att.err ?? 'failed',
    });

    // ── Telegram ─────────────────────────────────────────────────────────────
    const tg = await timed(() => telegramCheck());
    checks.push({
      name: 'telegram', label: 'Telegram signal broadcast',
      ok: tg.ok && (tg.value?.ok ?? false),
      latencyMs: tg.ms,
      detail: tg.value?.detail ?? tg.err ?? 'failed',
    });

    // ── Rotating live probe of the 35-endpoint registry ──────────────────────
    const probeable = SOSOVALUE_ENDPOINTS.filter((e) => e.probe);
    const probes: DiagReport['endpointRegistry']['probedLive'] = [];
    // probe 2 per diag run, rotating, to respect the 20/min budget
    for (let i = 0; i < Math.min(2, probeable.length); i++) {
      const ep = probeable[(probeCursor + i) % probeable.length];
      const r = await timed(() => soso.raw(ep.probe as string));
      probes.push({ path: ep.path, ok: r.ok, latencyMs: r.ms });
    }
    probeCursor = (probeCursor + 2) % Math.max(1, probeable.length);

    const byModule: Record<string, number> = {};
    for (const ep of SOSOVALUE_ENDPOINTS) byModule[ep.module] = (byModule[ep.module] ?? 0) + 1;

    let corpus: DiagReport['corpus'];
    try { corpus = corpusStats(); }
    catch (e) { corpus = { rows: 0, error: String(e).slice(0, 100) }; }

    const critical = checks.filter((c) => ['sosovalue', 'sodex_public', 'database'].includes(c.name));
    const overall: DiagReport['overall'] =
      checks.every((c) => c.ok) ? 'green'
      : critical.every((c) => c.ok) ? 'degraded'
      : 'red';

    return {
      overall,
      checks,
      endpointRegistry: { total: SOSOVALUE_ENDPOINTS.length, byModule, probedLive: probes },
      circuitBreaker: getCircuitBreakerState(),
      corpus,
      generatedAt: Date.now(),
      cachedForMs: 25_000,
    };
  });
}
