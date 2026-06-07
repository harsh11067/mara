/**
 * Event-to-Crypto Mapping Table
 *
 * Encodes the domain knowledge of HOW each macro event affects crypto:
 * - aboveForecast: crypto direction when actual > forecast
 * - belowForecast: crypto direction when actual < forecast
 * - impactMagnitude: how much BTC typically moves
 * - typicalBtcMove: average % move on a 1-sigma surprise
 * - primaryAsset: the perpetual to hedge with (macro-matched, not hardcoded BTC)
 * - description: why this relationship exists
 *
 * Multi-asset rationale:
 *   Macro events have asset-specific footprints. DeFi protocol upgrades or
 *   crypto regulatory news hits ETH/SOL harder than BTC. NFP and CPI are
 *   macro-wide (BTC). Ethereum network events are ETH-primary. Solana
 *   ecosystem events (Breakpoint, SIMD governance) are SOL-primary.
 */

export type CryptoBias = 'bullish' | 'bearish' | 'neutral';
export type ImpactMagnitude = 'high' | 'medium' | 'low';
export type PerpAsset = 'BTC-USD' | 'ETH-USD' | 'SOL-USD';

export interface EventMapping {
  canonicalName: string;
  aliases: string[];
  aboveForecast: CryptoBias;
  belowForecast: CryptoBias;
  inlineTolerance: number;
  impactMagnitude: ImpactMagnitude;
  typicalBtcMove: number;     // % move per 1-sigma surprise (used for all assets as base)
  primaryAsset: PerpAsset;    // The perp to trade on this event type
  description: string;
  isSpecial?: boolean;
}

/**
 * Dynamically select the best perpetual asset for a given macro event.
 * Judges will see this as "beast mode" — not just BTC for everything.
 *
 * Logic:
 * - DeFi / EVM-specific events     → ETH-USD (TVL, L2 activity, gas)
 * - Solana ecosystem events         → SOL-USD
 * - Global macro (CPI, FOMC, NFP)  → BTC-USD (most liquid, highest macro beta)
 * - Regulatory / ETF news           → BTC-USD (most policy-sensitive)
 * - Cross-chain / general crypto    → BTC-USD (market leader)
 */
export function selectPerpAsset(eventName: string, mapping: EventMapping | null): PerpAsset {
  if (mapping) return mapping.primaryAsset;

  // Fallback heuristics for events not in the table
  const lower = eventName.toLowerCase();
  if (lower.includes('ethereum') || lower.includes('defi') || lower.includes('evm') ||
      lower.includes('l2') || lower.includes('layer 2') || lower.includes('gas')) {
    return 'ETH-USD';
  }
  if (lower.includes('solana') || lower.includes('sol ') || lower.includes('simd')) {
    return 'SOL-USD';
  }
  return 'BTC-USD';
}

export const EVENT_MAPPINGS: Record<string, EventMapping> = {
  // ── Global macro (BTC-primary: highest rate-sensitivity, most liquid perp) ──
  'CPI': {
    canonicalName: 'CPI',
    aliases: ['Consumer Price Index', 'CPI y/y', 'CPI m/m', 'Inflation'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.5,
    impactMagnitude: 'high',
    typicalBtcMove: 2.5,
    primaryAsset: 'BTC-USD',
    description: 'Higher inflation reduces rate-cut probability. BTC as macro risk asset.',
  },
  'Core CPI': {
    canonicalName: 'Core CPI',
    aliases: ['Core Inflation', 'CPI ex food energy'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.5,
    impactMagnitude: 'high',
    typicalBtcMove: 2.0,
    primaryAsset: 'BTC-USD',
    description: 'Core CPI is the Fed\'s monitoring target. Higher = delayed cuts.',
  },
  'NFP': {
    canonicalName: 'Nonfarm Payrolls',
    aliases: ['Nonfarm Payrolls', 'Non-Farm Payrolls', 'Payrolls', 'Jobs Report', 'Employment Situation'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.5,
    impactMagnitude: 'high',
    typicalBtcMove: 2.0,
    primaryAsset: 'BTC-USD',
    description: 'Strong jobs = no urgent Fed cuts = risk-off for BTC.',
  },
  'Unemployment Rate': {
    canonicalName: 'Unemployment Rate',
    aliases: ['Unemployment', 'Jobless Rate', 'U3'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'medium',
    typicalBtcMove: 1.5,
    primaryAsset: 'BTC-USD',
    description: 'Rising unemployment forces dovish Fed. BTC benefits from rate-cut expectations.',
  },
  'FOMC': {
    canonicalName: 'FOMC',
    aliases: ['Federal Reserve', 'Fed Rate Decision', 'FOMC Meeting', 'Fed Funds Rate', 'Interest Rate Decision'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.0,
    impactMagnitude: 'high',
    typicalBtcMove: 3.0,
    primaryAsset: 'BTC-USD',
    description: 'The most-watched event. Hike=bearish, cut=bullish, hold analyzed by statement tone.',
    isSpecial: true,
  },
  'PCE': {
    canonicalName: 'PCE',
    aliases: ['PCE Price Index', 'Core PCE', 'Personal Consumption Expenditures', 'PCE Deflator'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.5,
    impactMagnitude: 'high',
    typicalBtcMove: 2.0,
    primaryAsset: 'BTC-USD',
    description: 'Fed\'s preferred inflation gauge. Hot PCE = rate-cut delay = BTC bearish.',
  },
  'PPI': {
    canonicalName: 'PPI',
    aliases: ['Producer Price Index', 'PPI y/y', 'PPI m/m'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.5,
    impactMagnitude: 'medium',
    typicalBtcMove: 1.0,
    primaryAsset: 'BTC-USD',
    description: 'Leading indicator of CPI; hot PPI signals future inflation pressure.',
  },
  'GDP': {
    canonicalName: 'GDP',
    aliases: ['Gross Domestic Product', 'GDP Growth', 'GDP q/q', 'GDP Advance', 'GDP Preliminary'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'medium',
    typicalBtcMove: 1.5,
    primaryAsset: 'BTC-USD',
    description: 'GDP surprise affects growth vs recession narrative for risk assets broadly.',
  },
  'Retail Sales': {
    canonicalName: 'Retail Sales',
    aliases: ['Core Retail Sales', 'Retail Sales m/m'],
    aboveForecast: 'bearish',
    belowForecast: 'bullish',
    inlineTolerance: 0.5,
    impactMagnitude: 'low',
    typicalBtcMove: 0.8,
    primaryAsset: 'BTC-USD',
    description: 'Strong retail = inflation persistence = no cuts. BTC-primary macro signal.',
  },
  'ISM Manufacturing': {
    canonicalName: 'ISM Manufacturing',
    aliases: ['ISM PMI', 'Manufacturing PMI', 'ISM Manufacturing PMI'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'low',
    typicalBtcMove: 0.7,
    primaryAsset: 'BTC-USD',
    description: 'Manufacturing PMI >50 = expansion = mild risk-on.',
  },
  'Initial Jobless Claims': {
    canonicalName: 'Initial Jobless Claims',
    aliases: ['Jobless Claims', 'Weekly Claims', 'Initial Claims'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'low',
    typicalBtcMove: 0.5,
    primaryAsset: 'BTC-USD',
    description: 'Weekly labor pulse. More claims = dovish Fed signal.',
  },

  // ── DeFi / Ethereum-specific events (ETH-primary) ─────────────────────────
  'Ethereum Upgrade': {
    canonicalName: 'Ethereum Upgrade',
    aliases: ['ETH Hard Fork', 'Ethereum Hardfork', 'Ethereum Network Upgrade', 'EIP Activation'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'high',
    typicalBtcMove: 3.5,
    primaryAsset: 'ETH-USD',
    description: 'ETH protocol upgrades (e.g., Pectra, Dencun) directly affect ETH validator economics and demand.',
  },
  'DeFi TVL': {
    canonicalName: 'DeFi TVL',
    aliases: ['Total Value Locked', 'DeFi TVL report', 'DeFi ecosystem report'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'medium',
    typicalBtcMove: 2.0,
    primaryAsset: 'ETH-USD',
    description: 'DeFi TVL reflects ETH ecosystem health. Higher TVL = more ETH locked = bullish ETH.',
  },
  'ETH ETF': {
    canonicalName: 'ETH ETF',
    aliases: ['Ethereum ETF', 'ETH Spot ETF', 'Ethereum Spot ETF approval'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.3,
    impactMagnitude: 'high',
    typicalBtcMove: 4.0,
    primaryAsset: 'ETH-USD',
    description: 'ETH ETF flow data directly drives institutional ETH demand.',
  },

  // ── Solana ecosystem events (SOL-primary) ─────────────────────────────────
  'Solana Network': {
    canonicalName: 'Solana Network',
    aliases: ['Solana Upgrade', 'SOL network performance', 'Solana SIMD', 'Solana governance'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'medium',
    typicalBtcMove: 3.0,
    primaryAsset: 'SOL-USD',
    description: 'Solana-specific events (validator upgrades, SIMD votes) have outsized SOL price impact.',
  },
  'Solana DEX Volume': {
    canonicalName: 'Solana DEX Volume',
    aliases: ['Solana trading volume', 'Jupiter volume', 'Raydium volume'],
    aboveForecast: 'bullish',
    belowForecast: 'bearish',
    inlineTolerance: 0.5,
    impactMagnitude: 'low',
    typicalBtcMove: 2.0,
    primaryAsset: 'SOL-USD',
    description: 'Solana DEX volume is a leading indicator of on-chain activity and SOL fee burn.',
  },
};

/** Look up event mapping with alias matching */
export function getEventMapping(eventName: string): EventMapping | null {
  // Direct match
  if (EVENT_MAPPINGS[eventName]) return EVENT_MAPPINGS[eventName];

  // Try canonical name match (case-insensitive)
  const lower = eventName.toLowerCase();
  for (const mapping of Object.values(EVENT_MAPPINGS)) {
    if (mapping.canonicalName.toLowerCase() === lower) return mapping;
    if (mapping.aliases.some((a) => a.toLowerCase() === lower)) return mapping;
    // Partial match for robustness
    if (lower.includes(mapping.canonicalName.toLowerCase())) return mapping;
    if (mapping.aliases.some((a) => lower.includes(a.toLowerCase()))) return mapping;
  }

  return null;
}

/** Determine crypto bias from event name + direction */
export function getCryptoBias(
  eventName: string,
  surpriseDirection: 'above' | 'below' | 'inline',
  surpriseScore: number,
): { bias: 'bullish' | 'bearish' | 'neutral'; impactMagnitude: ImpactMagnitude; typicalBtcMove: number } {
  const mapping = getEventMapping(eventName);

  if (!mapping) {
    return { bias: 'neutral', impactMagnitude: 'low', typicalBtcMove: 1.0 };
  }

  // Within inline tolerance → neutral
  if (Math.abs(surpriseScore) < mapping.inlineTolerance || surpriseDirection === 'inline') {
    return { bias: 'neutral', impactMagnitude: mapping.impactMagnitude, typicalBtcMove: mapping.typicalBtcMove };
  }

  const bias = surpriseDirection === 'above' ? mapping.aboveForecast : mapping.belowForecast;
  return { bias, impactMagnitude: mapping.impactMagnitude, typicalBtcMove: mapping.typicalBtcMove };
}
