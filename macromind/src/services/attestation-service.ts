/**
 * AttestationService
 *
 * Bridges MARA's off-chain decisions to the MARAAttestation contract on ValueChain.
 * After each conviction decision (including NO_TRADE), this service computes the
 * deterministic decision hash and writes it on-chain, creating an immutable audit trail.
 *
 * Key properties:
 * - Non-blocking: attestation happens asynchronously; trade execution is NOT gated on it.
 * - Batched: decisions accumulate in a queue and are flushed every 60s (saves gas).
 * - Idempotent: duplicate hashes are rejected by the contract — safe to retry.
 * - Zero sensitive data on-chain: only keccak256 hashes of public decision metadata.
 */

import { ethers } from 'ethers';
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import type { TradeDecision } from '../ai/types.js';

const logger = createLogger('Attestation');

// Minimal ABI — only the functions we call
const ABI = [
  'function attestDecision(bytes32 decisionHash, bytes32 eventHash, uint8 conviction, uint16 confidence, uint8 action) external',
  'function batchAttestDecisions(bytes32[] decisionHashes, bytes32[] eventHashes, uint8[] convictions, uint16[] confidences, uint8[] actions) external',
  'function activateKillSwitch(string reason, uint256 openPositions) external',
  'function resetKillSwitch() external',
  'function upgradeStrategy(string newVersion, string reason) external',
  'function agentSummary() view returns (string projectName, string version, address operatorAddr, uint256 deployedAt, uint256 decisions, uint256 trades, uint256 upgrades, bool isKilled)',
  'function totalDecisions() view returns (uint256)',
  'function attestationCount() view returns (uint256)',
  'function currentVersion() view returns (string)',
  'function killSwitchActive() view returns (bool)',
] as const;

// Maps conviction string → uint8 matching the contract constants
const CONVICTION_MAP: Record<string, number> = {
  STRONG_BEAR: 0,
  BEAR:        1,
  NEUTRAL:     2,
  BULL:        3,
  STRONG_BULL: 4,
};

const ACTION_MAP: Record<string, number> = {
  NO_TRADE: 0,
  LONG:     1,
  SHORT:    2,
};

interface PendingAttestation {
  decisionHash: string;
  eventHash:    string;
  conviction:   number;
  confidence:   number;
  action:       number;
}

export class AttestationService {
  private provider:  ethers.JsonRpcProvider | null = null;
  private signer:    ethers.Wallet | null = null;
  private contract:  ethers.Contract | null = null;
  private queue:     PendingAttestation[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled:   boolean = false;
  private identityVerified = false;
  private onChainOperator  = '';

  // Debounce window: write to chain ~3s after the last decision. Fast enough to
  // see the on-chain counter increment live in a demo, while still batching
  // bursts of decisions into a single transaction.
  private static readonly DEBOUNCE_MS = 3_000;

  constructor() {
    this.init();
  }

  private init(): void {
    const {
      contractAddress, rpcUrl, operatorPrivateKey,
      identityCoherent, usingSyntheticIdentity, expectedOperator,
    } = config.attestation;

    if (!contractAddress || !rpcUrl || !operatorPrivateKey) {
      logger.warn('Attestation service disabled — set MARA_CONTRACT_ADDRESS and VALUECHAIN_RPC in .env (operator key reuses SODEX_API_KEY_PRIVATE)');
      return;
    }

    // ── Single-source-of-truth guardrail #1: refuse the synthetic identity ────
    if (usingSyntheticIdentity) {
      logger.error(
        'ATTESTATION DISABLED — operator key derives to the Hardhat default account (0xf39F…). ' +
        'On-chain attestation MUST be signed by the real operator wallet. ' +
        'Set OPERATOR_PRIVATE_KEY / SODEX_API_KEY_PRIVATE to the key for ' + expectedOperator,
      );
      return;
    }

    // ── Single-source-of-truth guardrail #2: signer must equal execution wallet ─
    if (!identityCoherent) {
      logger.error(
        'ATTESTATION DISABLED — operator signing key does not match SODEX_MASTER_ADDRESS. ' +
        `expected=${config.attestation.expectedOperator} derived=${config.attestation.derivedOperator}. ` +
        'Refusing to attest under a divergent identity.',
      );
      return;
    }

    try {
      const pk = operatorPrivateKey.startsWith('0x') ? operatorPrivateKey : `0x${operatorPrivateKey}`;
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
      this.signer   = new ethers.Wallet(pk, this.provider);
      this.contract = new ethers.Contract(contractAddress, ABI, this.signer);
      this.enabled  = true;

      // Flush queue every 60 seconds (batch to save gas)
      this.flushTimer = setInterval(() => this.flush(), 60_000);

      logger.info('Attestation service enabled', {
        contractAddress,
        signer: this.signer.address,
        rpcUrl: rpcUrl.replace(/key=[^&]+/, 'key=***'),
      });

      // ── Guardrail #3: verify the DEPLOYED contract's operator matches us ──────
      void this.verifyOnChainOperator();
    } catch (err) {
      logger.error('Attestation service init failed', { err });
    }
  }

  /**
   * Reads operator() from the deployed contract and confirms it matches the
   * signing wallet. If the deployed contract is owned by a different address
   * (e.g. a stale Hardhat deploy), every attestDecision() would revert with
   * NotOperator() — so we disable proactively and log the divergence loudly.
   */
  private async verifyOnChainOperator(): Promise<void> {
    if (!this.contract || !this.signer) return;
    try {
      const [, , operatorAddr] = await this.contract.agentSummary();
      this.onChainOperator = operatorAddr;
      this.identityVerified =
        operatorAddr.toLowerCase() === this.signer.address.toLowerCase();

      if (this.identityVerified) {
        logger.info('On-chain operator verified — single source of truth intact', {
          operator: operatorAddr,
        });
      } else {
        this.enabled = false;
        logger.error(
          'IDENTITY DIVERGENCE — deployed contract operator does not match signer. ' +
          `contract.operator=${operatorAddr} signer=${this.signer.address}. ` +
          'Attestation disabled. Redeploy MARAAttestation from the real operator wallet.',
        );
      }
    } catch (err) {
      logger.warn('Could not verify on-chain operator (RPC/contract unreachable)', { err: (err as Error).message });
    }
  }

  /**
   * Compute the deterministic decision hash.
   * Must match computeDecisionHash() in the Solidity contract.
   */
  static computeDecisionHash(decision: TradeDecision): string {
    const convictionNum = CONVICTION_MAP[decision.conviction] ?? 2;
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'uint256', 'uint8', 'uint16'],
        [
          decision.id,
          decision.trigger.event,
          BigInt(decision.timestamp),
          convictionNum,
          decision.confidence,
        ]
      )
    );
  }

  /**
   * Compute the event hash.
   * Must match computeEventHash() in the Solidity contract.
   */
  static computeEventHash(eventName: string, releaseTimestampMs: number): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'uint256'],
        [eventName, BigInt(Math.floor(releaseTimestampMs / 1000))]
      )
    );
  }

  /**
   * Enqueue a decision for on-chain attestation.
   * Call this immediately after storing the decision in SQLite.
   * Non-blocking — returns immediately, attests in the background.
   */
  enqueueDecision(decision: TradeDecision, releaseTimestampMs: number): void {
    if (!this.enabled) return;

    const decisionHash = AttestationService.computeDecisionHash(decision);
    const eventHash    = AttestationService.computeEventHash(decision.trigger.event, releaseTimestampMs);

    this.queue.push({
      decisionHash,
      eventHash,
      conviction: CONVICTION_MAP[decision.conviction] ?? 2,
      confidence: Math.min(100, Math.max(0, decision.confidence)),
      action:     ACTION_MAP[decision.action] ?? 0,
    });

    logger.debug('Decision enqueued for attestation', {
      decisionId:   decision.id,
      decisionHash: decisionHash.slice(0, 10) + '…',
      queueLength:  this.queue.length,
    });

    // Burst of decisions → flush now to avoid an unbounded queue.
    if (this.queue.length >= 5) {
      void this.flush();
      return;
    }

    // Otherwise debounce: write ~3s after the last decision so a single
    // injected event still lands on-chain within seconds (good for live demos).
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.flush(), AttestationService.DEBOUNCE_MS);
  }

  /**
   * Flush the pending queue to the chain.
   * Batches all pending decisions into a single transaction.
   */
  async flush(): Promise<void> {
    if (!this.contract || this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);

    try {
      if (batch.length === 1) {
        const { decisionHash, eventHash, conviction, confidence, action } = batch[0];
        const tx = await this.contract.attestDecision(
          decisionHash, eventHash, conviction, confidence, action
        );
        await tx.wait();
        logger.info('Decision attested on-chain', { decisionHash: decisionHash.slice(0, 10) + '…', txHash: tx.hash });
      } else {
        const tx = await this.contract.batchAttestDecisions(
          batch.map(b => b.decisionHash),
          batch.map(b => b.eventHash),
          batch.map(b => b.conviction),
          batch.map(b => b.confidence),
          batch.map(b => b.action),
        );
        await tx.wait();
        logger.info(`Batch of ${batch.length} decisions attested on-chain`, { txHash: tx.hash });
      }
    } catch (err: any) {
      // Re-queue on failure (contract rejected duplicates are silently dropped by the contract itself)
      if (!err?.message?.includes('AlreadyAttested')) {
        logger.error('Attestation flush failed, re-queuing', { err: err?.message, count: batch.length });
        this.queue.unshift(...batch);
      }
    }
  }

  /**
   * Mirror the off-chain kill switch activation on-chain.
   */
  async attestKillSwitch(reason: string, openPositions: number): Promise<void> {
    if (!this.contract) return;
    try {
      const tx = await this.contract.activateKillSwitch(reason, BigInt(openPositions));
      await tx.wait();
      logger.info('Kill switch attested on-chain', { reason, txHash: tx.hash });
    } catch (err) {
      logger.error('Kill switch attestation failed', { err });
    }
  }

  /**
   * Mirror kill switch reset on-chain.
   */
  async attestKillSwitchReset(): Promise<void> {
    if (!this.contract) return;
    try {
      const tx = await this.contract.resetKillSwitch();
      await tx.wait();
      logger.info('Kill switch reset attested on-chain', { txHash: tx.hash });
    } catch (err) {
      logger.error('Kill switch reset attestation failed', { err });
    }
  }

  /**
   * Record a strategy upgrade on-chain (e.g., model change, risk parameter update).
   */
  async attestStrategyUpgrade(newVersion: string, reason: string): Promise<void> {
    if (!this.contract) return;
    try {
      const tx = await this.contract.upgradeStrategy(newVersion, reason);
      await tx.wait();
      logger.info('Strategy upgrade attested on-chain', { newVersion, txHash: tx.hash });
    } catch (err) {
      logger.error('Strategy upgrade attestation failed', { err });
    }
  }

  /**
   * Fetch on-chain summary for dashboard display.
   */
  async getOnChainSummary(): Promise<{
    contractAddress:  string;
    chainId:          number;
    version:          string;
    operator:         string;
    expectedOperator: string;
    identityCoherent: boolean;
    deployedAt:       string;
    onChainDecisions: number;
    onChainTrades:    number;
    onChainUpgrades:  number;
    killSwitchActive: boolean;
    enabled:          boolean;
  }> {
    const contractAddress = config.attestation.contractAddress;
    const expectedOperator = config.attestation.expectedOperator;
    const chainId = config.attestation.chainId;

    if (!this.contract || !this.enabled) {
      return {
        contractAddress, chainId, version: '—', operator: '—',
        expectedOperator,
        identityCoherent: config.attestation.identityCoherent,
        deployedAt: '—', onChainDecisions: 0, onChainTrades: 0,
        onChainUpgrades: 0, killSwitchActive: false, enabled: false,
      };
    }

    try {
      const [, version, operatorAddr, deployedAt, decisions, trades, upgrades, isKilled] =
        await this.contract.agentSummary();

      return {
        contractAddress,
        chainId,
        version,
        operator:         operatorAddr,
        expectedOperator,
        // True only when the deployed contract's operator IS the expected wallet.
        identityCoherent: operatorAddr.toLowerCase() === expectedOperator.toLowerCase(),
        deployedAt:       new Date(Number(deployedAt) * 1000).toISOString(),
        onChainDecisions: Number(decisions),
        onChainTrades:    Number(trades),
        onChainUpgrades:  Number(upgrades),
        killSwitchActive: isKilled,
        enabled:          true,
      };
    } catch (err) {
      logger.error('Failed to fetch on-chain summary', { err });
      return {
        contractAddress, chainId, version: 'error', operator: 'error',
        expectedOperator, identityCoherent: false,
        deployedAt: 'error', onChainDecisions: 0, onChainTrades: 0,
        onChainUpgrades: 0, killSwitchActive: false, enabled: this.enabled,
      };
    }
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    void this.flush(); // best-effort final flush on shutdown
  }
}

// Singleton — import this throughout the backend
export const attestationService = new AttestationService();
