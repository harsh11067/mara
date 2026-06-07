/**
 * MARA Attestation — Live Demo Script
 *
 * Proves the full attestation round-trip against the deployed contract:
 *   1. Reads agentSummary() — shows operator == real execution wallet.
 *   2. Computes a decision hash off-chain (same formula as the backend).
 *   3. Attests the decision on-chain.
 *   4. Reads it back and verifies the stored hash matches.
 *
 * Usage:
 *   npx hardhat run scripts/attest-demo.ts --network localhost
 *   npx hardhat run scripts/attest-demo.ts --network valuechain_testnet
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

function loadAddress(): string {
  if (process.env.MARA_CONTRACT_ADDRESS) return process.env.MARA_CONTRACT_ADDRESS;
  const artifact = path.join(__dirname, "..", "deployment.json");
  if (fs.existsSync(artifact)) {
    return JSON.parse(fs.readFileSync(artifact, "utf8")).contractAddress;
  }
  throw new Error("No contract address — set MARA_CONTRACT_ADDRESS or deploy first.");
}

const CONV = ["STRONG_BEAR", "BEAR", "NEUTRAL", "BULL", "STRONG_BULL"];
const ACT  = ["NO_TRADE", "LONG", "SHORT"];

async function main() {
  const address = loadAddress();
  const [signer] = await ethers.getSigners();
  const c = await ethers.getContractAt("MARAAttestation", address, signer);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  MARA Attestation — Live Round-Trip Demo");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`  Contract: ${address}`);
  console.log(`  Signer:   ${signer.address}`);

  // ── 1. Agent summary ────────────────────────────────────────────────────────
  const [name, version, operator, deployedAt, dCount, tCount, uCount, killed] =
    await c.agentSummary();
  console.log("\n[1] agentSummary()");
  console.log(`    project=${name} version=${version}`);
  console.log(`    operator=${operator}`);
  console.log(`    operator == signer: ${operator.toLowerCase() === signer.address.toLowerCase() ? "YES ✓" : "NO ✗"}`);
  console.log(`    deployedAt=${new Date(Number(deployedAt) * 1000).toISOString()}`);
  console.log(`    decisions=${dCount} trades=${tCount} upgrades=${uCount} killed=${killed}`);

  // ── 2. Build a sample decision (mirrors backend TradeDecision) ───────────────
  const decision = {
    id:         `demo-${Date.now()}`,
    event:      "CPI",
    timestamp:  Date.now(),
    conviction: 0, // STRONG_BEAR
    confidence: 82,
    action:     2, // SHORT
  };
  const releaseTs = Math.floor(Date.now() / 1000);

  // Hash computed the SAME way as macromind/src/services/attestation-service.ts
  const decisionHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "string", "uint256", "uint8", "uint16"],
      [decision.id, decision.event, decision.timestamp, decision.conviction, decision.confidence],
    ),
  );
  const eventHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "uint256"],
      [decision.event, releaseTs],
    ),
  );

  console.log("\n[2] Sample decision");
  console.log(`    id=${decision.id} event=${decision.event}`);
  console.log(`    conviction=${CONV[decision.conviction]} confidence=${decision.confidence} action=${ACT[decision.action]}`);
  console.log(`    decisionHash=${decisionHash}`);

  // ── 3. Attest on-chain ──────────────────────────────────────────────────────
  console.log("\n[3] attestDecision() …");
  const tx = await c.attestDecision(
    decisionHash, eventHash,
    decision.conviction, decision.confidence, decision.action,
  );
  const rcpt = await tx.wait();
  console.log(`    ✓ tx ${tx.hash} (gas ${rcpt?.gasUsed})`);

  // ── 4. Read back + verify ───────────────────────────────────────────────────
  const stored = await c.getAttestation(decisionHash);
  const ok =
    stored.decisionHash.toLowerCase() === decisionHash.toLowerCase() &&
    Number(stored.conviction) === decision.conviction &&
    Number(stored.confidence) === decision.confidence &&
    Number(stored.action) === decision.action &&
    Number(stored.attestedAt) > 0;

  console.log("\n[4] getAttestation() read-back");
  console.log(`    stored conviction=${CONV[Number(stored.conviction)]} confidence=${stored.confidence} action=${ACT[Number(stored.action)]}`);
  console.log(`    attestedAt=${new Date(Number(stored.attestedAt) * 1000).toISOString()}`);
  console.log(`    HASH MATCH + DATA INTACT: ${ok ? "YES ✓" : "NO ✗"}`);

  const newCount = await c.attestationCount();
  console.log(`\n  Total on-chain attestations now: ${newCount}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
