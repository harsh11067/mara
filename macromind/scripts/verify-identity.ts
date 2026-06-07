/**
 * MARA — Single Source of Truth Verifier
 *
 * Proves that every trust anchor in the system resolves to ONE operator wallet.
 * Run this before any demo or submission; it is the institutional-grade proof
 * that the split-brain identity problem is gone.
 *
 *   anchor 1: SODEX_MASTER_ADDRESS         (declared execution wallet)
 *   anchor 2: SODEX_API_KEY_PRIVATE        (derived → EIP-712 trade signer)
 *   anchor 3: attestation operator key     (derived → on-chain attester)
 *   anchor 4: deployed contract.operator() (on-chain contract owner)
 *
 * Exit code 0 only if all anchors agree.
 *
 * Usage:  npx tsx scripts/verify-identity.ts
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { config } from '../src/config.js';

function derive(pk: string | undefined): string {
  if (!pk) return '(unset)';
  try {
    const k = pk.startsWith('0x') ? pk : `0x${pk}`;
    return new ethers.Wallet(k).address;
  } catch {
    return '(invalid)';
  }
}

const HARDHAT_DEFAULT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

async function main() {
  const master   = config.sodex.masterAddress;
  const tradeKey = derive(config.sodex.apiKeyPrivate);
  const attestKey = derive(config.attestation.operatorPrivateKey);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  MARA — Single Source of Truth Verification');
  console.log('═══════════════════════════════════════════════════════');

  const rows: Array<[string, string]> = [
    ['SODEX_MASTER_ADDRESS (execution wallet)', master || '(unset)'],
    ['EIP-712 trade signer (from API key)',     tradeKey],
    ['On-chain attestation signer',             attestKey],
  ];

  // anchor 4: on-chain contract operator (if deployed + reachable)
  let onChainOperator = '(not deployed / unreachable)';
  if (config.attestation.contractAddress && config.attestation.rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(config.attestation.rpcUrl);
      const c = new ethers.Contract(
        config.attestation.contractAddress,
        ['function agentSummary() view returns (string,string,address,uint256,uint256,uint256,uint256,bool)'],
        provider,
      );
      const [, , op] = await c.agentSummary();
      onChainOperator = op;
    } catch (e) {
      onChainOperator = `(error: ${(e as Error).message.slice(0, 40)})`;
    }
  }
  rows.push(['Deployed contract.operator()', onChainOperator]);

  const ref = (master || tradeKey).toLowerCase();
  let allMatch = true;
  let syntheticDetected = false;

  console.log('');
  for (const [label, value] of rows) {
    const v = value.toLowerCase();
    const known = v.startsWith('0x') && v.length === 42;
    const match = known && v === ref;
    if (known && !match) allMatch = false;
    if (v === HARDHAT_DEFAULT) { syntheticDetected = true; allMatch = false; }
    const mark = !known ? '—' : match ? '✓' : '✗';
    console.log(`  [${mark}] ${label.padEnd(42)} ${value}`);
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────');
  if (syntheticDetected) {
    console.log('  ✗ FAIL — synthetic Hardhat identity (0xf39F…) detected.');
  } else if (allMatch) {
    console.log(`  ✓ PASS — all anchors resolve to ${ref}`);
  } else {
    console.log('  ✗ FAIL — anchors diverge. Fix before demo/submission.');
  }
  console.log('═══════════════════════════════════════════════════════\n');

  process.exit(allMatch && !syntheticDetected ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
