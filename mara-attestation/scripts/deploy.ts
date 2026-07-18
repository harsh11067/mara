/**
 * MARA Attestation Deployment Script
 *
 * Deploys MARAAttestation so that its on-chain operator IS the real MARA
 * execution wallet — the single source of truth for the whole system.
 *
 * Single-source-of-truth enforcement:
 *   - The deployer MUST equal EXPECTED_OPERATOR (the SoDEX execution wallet).
 *   - The known Hardhat default account is rejected outright.
 *   - Artifacts are tagged with `environment` (production vs local-dev) so a
 *     local prototype can never masquerade as a real ValueChain deployment.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network valuechain_testnet
 *   npx hardhat run scripts/deploy.ts --network localhost      (dev only, still as operator)
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const INITIAL_VERSION = "1.0.0";

// ── The ONE legitimate operator identity ───────────────────────────────────────
// Every trust anchor in MARA resolves to this wallet. Override via env if needed.
const EXPECTED_OPERATOR = (
  process.env.EXPECTED_OPERATOR ??
  process.env.SODEX_MASTER_ADDRESS ??
  "0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC"
).toLowerCase();

// The synthetic identity that must never anchor authority.
const HARDHAT_DEFAULT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

const PRODUCTION_CHAINS = new Set([138565, 286623, 11155111]); // ValueChain testnet, mainnet, Sepolia

const EXPLORERS: Record<number, string> = {
  138565: "https://testnet.sodex.com/explorer",
  286623: "https://main-scan.valuechain.xyz",
  11155111: "https://sepolia.etherscan.io",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const chainId = Number(network.config.chainId ?? 0);
  const isProduction = PRODUCTION_CHAINS.has(chainId);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  MARA Attestation — Deployment");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Network:   ${network.name} (chainId ${chainId})`);
  console.log(`  Environment: ${isProduction ? "PRODUCTION (ValueChain)" : "local-dev"}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Expected:  ${EXPECTED_OPERATOR}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} (native)`);
  console.log(`  Version:   ${INITIAL_VERSION}`);
  console.log("═══════════════════════════════════════════════════════");

  // ── Guardrail #1: never deploy from the synthetic Hardhat identity ──────────
  if (deployer.address.toLowerCase() === HARDHAT_DEFAULT) {
    throw new Error(
      "REFUSING TO DEPLOY: deployer is the Hardhat default account (0xf39F…).\n" +
      "  This is the synthetic identity that caused the split-brain problem.\n" +
      "  Set DEPLOYER_PRIVATE_KEY in .env to the REAL operator key and ensure\n" +
      "  hardhat.config funds it on the local network.",
    );
  }

  // ── Guardrail #2: deployer must be the real operator ────────────────────────
  if (deployer.address.toLowerCase() !== EXPECTED_OPERATOR) {
    throw new Error(
      `REFUSING TO DEPLOY: deployer ${deployer.address} != expected operator ${EXPECTED_OPERATOR}.\n` +
      "  The on-chain operator must equal the SoDEX execution wallet.\n" +
      "  Fix DEPLOYER_PRIVATE_KEY (or EXPECTED_OPERATOR) so they match.",
    );
  }

  if (balance === 0n) {
    throw new Error(
      isProduction
        ? `Deployer ${deployer.address} has 0 gas on ${network.name}. Fund it from the ValueChain testnet faucet first.`
        : `Deployer has 0 gas. Ensure hardhat.config funds ${EXPECTED_OPERATOR} on the local network.`,
    );
  }

  // ── Deploy ──────────────────────────────────────────────────────────────────
  console.log("\n[1/3] Deploying MARAAttestation...");

  const Factory = await ethers.getContractFactory("MARAAttestation");
  const contract = await Factory.deploy(INITIAL_VERSION);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = await deployTx?.wait();

  console.log(`      ✓ Contract deployed at: ${contractAddress}`);
  console.log(`      ✓ Transaction hash:      ${deployTx?.hash}`);
  console.log(`      ✓ Gas used:              ${receipt?.gasUsed.toString()}`);
  console.log(`      ✓ Block number:          ${receipt?.blockNumber}`);

  // ── Verify deployment + operator coherence ──────────────────────────────────
  console.log("\n[2/3] Verifying deployment + operator identity...");

  const [projectName, version, operatorAddr, deployedAt] = await contract.agentSummary();

  console.log(`      ✓ PROJECT_NAME:  ${projectName}`);
  console.log(`      ✓ version:       ${version}`);
  console.log(`      ✓ operator:      ${operatorAddr}`);
  console.log(`      ✓ deployedAt:    ${new Date(Number(deployedAt) * 1000).toISOString()}`);

  if (operatorAddr.toLowerCase() !== EXPECTED_OPERATOR) {
    throw new Error(
      `POST-DEPLOY CHECK FAILED: contract.operator ${operatorAddr} != ${EXPECTED_OPERATOR}`,
    );
  }
  console.log(`      ✓ IDENTITY COHERENT: on-chain operator == execution wallet`);

  // ── Save deployment artifact ────────────────────────────────────────────────
  console.log("\n[3/3] Saving deployment artifact...");

  const artifact = {
    environment:     isProduction ? "valuechain" : "local-dev",
    network:         network.name,
    chainId,
    contractAddress,
    operator:        operatorAddr,
    deployedAt:      new Date().toISOString(),
    deployTxHash:    deployTx?.hash,
    version:         INITIAL_VERSION,
    deployer:        deployer.address,
    abi: [
      "function agentSummary() view returns (string,string,address,uint256,uint256,uint256,uint256,bool)",
      "function attestDecision(bytes32,bytes32,uint8,uint16,uint8) external",
      "function batchAttestDecisions(bytes32[],bytes32[],uint8[],uint16[],uint8[]) external",
      "function getAttestation(bytes32) view returns (tuple(bytes32,bytes32,uint8,uint16,uint8,uint64))",
      "function attestationCount() view returns (uint256)",
      "function recentAttestations(uint256) view returns (bytes32[])",
      "function computeDecisionHash(string,string,uint256,uint8,uint16) pure returns (bytes32)",
      "function computeEventHash(string,uint256) pure returns (bytes32)",
      "function upgradeStrategy(string,string) external",
      "function activateKillSwitch(string,uint256) external",
      "function resetKillSwitch() external",
      "function currentVersion() view returns (string)",
      "function totalDecisions() view returns (uint256)",
      "function totalTrades() view returns (uint256)",
      "function killSwitchActive() view returns (bool)",
      "event AgentDeployed(address indexed,string,string,uint256)",
      "event DecisionAttested(bytes32 indexed,bytes32 indexed,uint8,uint16,uint8,uint256,uint256)",
      "event StrategyUpgraded(string,string,string,uint256,uint256)",
      "event KillSwitchActivated(string,uint256,uint256)",
    ],
  };

  fs.writeFileSync(
    path.join(__dirname, "..", "deployment.json"),
    JSON.stringify(artifact, null, 2),
  );
  console.log("      ✓ Written → mara-attestation/deployment.json");

  const backendArtifactPath = path.join(
    __dirname, "..", "..", "macromind", "src", "services", "attestation-address.json",
  );
  if (fs.existsSync(path.dirname(backendArtifactPath))) {
    fs.writeFileSync(backendArtifactPath, JSON.stringify(artifact, null, 2));
    console.log("      ✓ Written → macromind/src/services/attestation-address.json");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const explorer = EXPLORERS[chainId];
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  DEPLOYMENT SUCCESSFUL");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`\n  Contract:  ${contractAddress}`);
  console.log(`  Operator:  ${operatorAddr}  (== execution wallet ✓)`);
  if (explorer) {
    console.log(`  Explorer:  ${explorer}/address/${contractAddress}`);
    console.log("\n  To verify on explorer, run:");
    console.log(`  npx hardhat verify --network ${network.name} ${contractAddress} "${INITIAL_VERSION}"`);
  }
  console.log("\n  Add to macromind/.env:");
  console.log(`  MARA_CONTRACT_ADDRESS=${contractAddress}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
