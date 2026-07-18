import 'dotenv/config';
import { z } from 'zod';
import { ethers } from 'ethers';

const EnvSchema = z.object({
  // SoSoValue
  SOSOVALUE_API_KEY: z.string().min(1, 'SOSOVALUE_API_KEY is required'),

  // SoDEX
  SODEX_ENDPOINT: z.string().url().default('https://testnet-gw.sodex.dev/api/v1'),
  SODEX_WS_ENDPOINT: z.string().default('wss://testnet-gw.sodex.dev/ws'),
  SODEX_CHAIN_ID: z.coerce.number().default(138565),
  SODEX_MASTER_ADDRESS: z.string().default(''),
  SODEX_API_KEY_NAME: z.string().default('macromind-agent'),
  SODEX_API_KEY_PRIVATE: z.string().default(''),
  SODEX_ACCOUNT_ID: z.coerce.number().default(0),

  // AI — up to two keys; the pool rotates on quota errors so runs never halt.
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_API_KEY2: z.string().default(''),
  // Tolerated legacy typo of GEMINI_API_KEY2 present in some .env files.
  GWMINI_API_KEY2: z.string().default(''),

  // App
  PORT: z.coerce.number().default(3001),
  DASHBOARD_PORT: z.coerce.number().default(5173),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Risk (overridable)
  MAX_RISK_PER_TRADE: z.coerce.number().default(0.02),
  MAX_LEVERAGE: z.coerce.number().default(5),
  MAX_DRAWDOWN: z.coerce.number().default(0.05),

  // On-chain attestation (ValueChain)
  VALUECHAIN_RPC: z.string().default(''),
  MARA_CONTRACT_ADDRESS: z.string().default(''),
  // Optional explicit operator key. If unset, the SoDEX execution key is reused
  // so the on-chain operator is ALWAYS the same wallet that signs trades.
  OPERATOR_PRIVATE_KEY: z.string().default(''),
});

/**
 * Detect master-key mode: if the API key private key derives to the same
 * address as masterAddress, clear apiKeyName (master-key auth = no X-API-Key header).
 */
function resolveApiKeyName(keyName: string, privateKey: string, masterAddr: string): string {
  if (!privateKey || !masterAddr) return keyName;
  try {
    const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const derived = new ethers.Wallet(pk).address;
    return derived.toLowerCase() === masterAddr.toLowerCase()
      ? ''    // master-key mode
      : keyName;
  } catch {
    return keyName;
  }
}

function loadConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `  ${e.path.join('.')}: ${e.message}`);
    console.error('❌ Configuration errors:\n' + errors.join('\n'));
    console.error('\n  Hint: copy .env.example to .env and fill in your keys\n');
    process.exit(1);
  }
  return result.data;
}

const env = loadConfig();

/**
 * Single Source of Truth — Operator Identity
 *
 * There is exactly ONE legitimate operator identity in MARA. Every trust
 * anchor (SoDEX execution, EIP-712 signing, on-chain attestation, contract
 * ownership) MUST resolve to this address: SODEX_MASTER_ADDRESS.
 *
 * The on-chain attestation key defaults to the SoDEX execution key precisely
 * so the chain operator and the trade signer can never diverge. We derive the
 * operator key's address here and assert it matches SODEX_MASTER_ADDRESS, so a
 * mis-keyed env (e.g. a Hardhat default account) is caught at startup, not
 * silently in production.
 */
function resolveOperatorIdentity() {
  const expected = env.SODEX_MASTER_ADDRESS;
  // The operator key: explicit override, else the SoDEX execution key.
  const rawKey = env.OPERATOR_PRIVATE_KEY || env.SODEX_API_KEY_PRIVATE;
  let derivedAddress = '';
  if (rawKey) {
    try {
      const pk = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
      derivedAddress = new ethers.Wallet(pk).address;
    } catch {
      derivedAddress = '';
    }
  }
  const coherent =
    !!expected &&
    !!derivedAddress &&
    expected.toLowerCase() === derivedAddress.toLowerCase();

  // Known Hardhat default account #0 — the synthetic identity that must never
  // anchor authority in this project.
  const HARDHAT_DEFAULT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
  const usingSyntheticIdentity =
    derivedAddress.toLowerCase() === HARDHAT_DEFAULT;

  return {
    expectedAddress: expected,
    operatorPrivateKey: rawKey,
    derivedAddress,
    coherent,
    usingSyntheticIdentity,
  };
}

const operatorIdentity = resolveOperatorIdentity();

export const config = {
  // SoSoValue
  sosovalue: {
    apiKey: env.SOSOVALUE_API_KEY,
    baseUrl: 'https://openapi.sosovalue.com/openapi/v1',
  },

  // SoDEX
  sodex: {
    endpoint: env.SODEX_ENDPOINT,
    wsEndpoint: env.SODEX_WS_ENDPOINT,
    chainId: env.SODEX_CHAIN_ID,
    masterAddress: env.SODEX_MASTER_ADDRESS,
    // When the API key private key derives to the same address as masterAddress,
    // we are in "master-key auth" mode — X-API-Key header must be omitted.
    // Signal this by clearing apiKeyName so SoDEXSigner skips the header.
    apiKeyName: resolveApiKeyName(
      env.SODEX_API_KEY_NAME,
      env.SODEX_API_KEY_PRIVATE,
      env.SODEX_MASTER_ADDRESS,
    ),
    apiKeyPrivate: env.SODEX_API_KEY_PRIVATE,
    accountId: env.SODEX_ACCOUNT_ID,
  },

  // AI — gemini-2.0-flash-lite: fast, cost-efficient, higher free-tier quota
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    apiKeys: [env.GEMINI_API_KEY, env.GEMINI_API_KEY2 || env.GWMINI_API_KEY2]
      .filter((k) => k.length > 0),
    model: 'gemini-2.5-flash' as const,
  },

  // On-chain attestation — anchored to the SAME operator identity as execution
  attestation: {
    rpcUrl: env.VALUECHAIN_RPC,
    contractAddress: env.MARA_CONTRACT_ADDRESS,
    chainId: env.SODEX_CHAIN_ID,
    // The operator key used to sign attestations == the SoDEX execution key.
    operatorPrivateKey: operatorIdentity.operatorPrivateKey,
    // Identity coherence flags (single source of truth guardrails)
    expectedOperator: operatorIdentity.expectedAddress,
    derivedOperator: operatorIdentity.derivedAddress,
    identityCoherent: operatorIdentity.coherent,
    usingSyntheticIdentity: operatorIdentity.usingSyntheticIdentity,
  },

  // App
  port: env.PORT,
  dashboardPort: env.DASHBOARD_PORT,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,

  // Risk limits
  risk: {
    maxRiskPerTrade: env.MAX_RISK_PER_TRADE,
    maxOpenPositions: 3,
    maxLeverage: env.MAX_LEVERAGE,
    maxDrawdown: env.MAX_DRAWDOWN,
    minConvictionScore: 60,
    minOrderbookDepthUsd: 1000,
    minTimeBetweenTradesMs: 5 * 60 * 1000, // 5 minutes
    maxDailyTrades: 10,
    stopLossAtrMultiplier: 1.5,
    takeProfitAtrMultiplier: 3.0,
    ssiMaxRotationPercent: 0.20, // 20% max per event
  },

  // Polling intervals
  polling: {
    newsIntervalMs: 30_000,       // 30 seconds
    historyIntervalMs: 60_000,    // 1 minute
    macroCalendarIntervalMs: 5 * 60_000, // 5 minutes
    positionMonitorIntervalMs: 10_000,   // 10 seconds
    riskSnapshotIntervalMs: 5 * 60_000,  // 5 minutes
  },
} as const;

export type Config = typeof config;
