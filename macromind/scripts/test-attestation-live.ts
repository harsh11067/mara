/**
 * Proves the live attestation path: enqueueDecision() → debounced flush →
 * on-chain counter increments. Run against the deployed contract.
 *   npx tsx scripts/test-attestation-live.ts
 */
import 'dotenv/config';
import { attestationService } from '../src/services/attestation-service.js';
import type { TradeDecision } from '../src/ai/types.js';

function fakeDecision(): TradeDecision {
  return {
    id: `live-test-${Date.now()}`,
    timestamp: Date.now(),
    trigger: { event: 'CPI', surpriseScore: 1.3, surpriseDirection: 'above', actual: 4.5, forecast: 3.2 },
    conviction: 'STRONG_BEAR',
    confidence: 82,
    reasoning: 'live test',
    keyFactors: [], riskFlags: [],
    newsHeadlines: [], etfFlowDirection: 'outflow',
    currentPrice: 68000, recentVolatility: 900,
    action: 'SHORT',
  };
}

async function main() {
  const before = await attestationService.getOnChainSummary();
  console.log('before:', { enabled: before.enabled, decisions: before.onChainDecisions, coherent: before.identityCoherent });
  if (!before.enabled) {
    console.error('Attestation disabled — check MARA_CONTRACT_ADDRESS / VALUECHAIN_RPC / operator key.');
    process.exit(1);
  }

  console.log('enqueueing a decision…');
  attestationService.enqueueDecision(fakeDecision(), Date.now());

  console.log('waiting for debounced on-chain flush (~5s)…');
  await new Promise((r) => setTimeout(r, 5500));

  const after = await attestationService.getOnChainSummary();
  console.log('after: ', { decisions: after.onChainDecisions });

  const ok = after.onChainDecisions === before.onChainDecisions + 1;
  console.log(ok ? '\n✓ PASS — on-chain decision counter incremented' : '\n✗ FAIL — counter did not move');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
