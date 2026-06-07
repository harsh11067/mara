// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MARAAttestation
 * @notice On-chain identity and decision audit trail for the MARA autonomous
 *         macro trading agent (Macro-Aware Research Agent).
 *
 * Purpose:
 *   - Proves MARA exists and is operated by a specific wallet.
 *   - Records immutable keccak256 hashes of trading decisions, creating an
 *     auditable trail without exposing strategy details or private keys.
 *   - Logs strategy version upgrades for judging transparency.
 *   - Emits kill-switch events matching the off-chain kill-switch mechanism.
 *
 * Design goals:
 *   - Zero external dependencies (no OpenZeppelin to keep deployment cheap).
 *   - All sensitive data stays off-chain; only hashes land on-chain.
 *   - Single-owner: the deploying wallet is permanently the operator.
 *   - Gas cost per attestation: ~50,000 gas (cheap on ValueChain testnet).
 */
contract MARAAttestation {

    // ─── Constants ──────────────────────────────────────────────────────────

    string public constant PROJECT_NAME    = "MARA";
    string public constant FULL_NAME       = "Macro-Aware Research Agent";
    string public constant HACKATHON       = "SoSoValue x SoDEX Buildathon 2026";

    // Conviction enum values (mirrors off-chain TradeDecision.conviction)
    uint8 public constant CONV_STRONG_BEAR = 0;
    uint8 public constant CONV_BEAR        = 1;
    uint8 public constant CONV_NEUTRAL     = 2;
    uint8 public constant CONV_BULL        = 3;
    uint8 public constant CONV_STRONG_BULL = 4;

    // Action enum values
    uint8 public constant ACTION_NO_TRADE  = 0;
    uint8 public constant ACTION_LONG      = 1;
    uint8 public constant ACTION_SHORT     = 2;

    // ─── Immutable state ────────────────────────────────────────────────────

    address public immutable operator;
    uint256 public immutable deployedAt;

    // ─── Mutable state ──────────────────────────────────────────────────────

    string  public currentVersion;
    uint256 public strategyUpgradeCount;
    uint256 public totalDecisions;
    uint256 public totalTrades;
    bool    public killSwitchActive;

    // ─── Decision audit trail ───────────────────────────────────────────────

    struct DecisionAttestation {
        bytes32 decisionHash;  // keccak256(decisionId, eventName, timestamp, conviction, confidence)
        bytes32 eventHash;     // keccak256(eventName, releaseTimestamp)
        uint8   conviction;    // 0-4 (STRONG_BEAR → STRONG_BULL)
        uint16  confidence;    // 0-100
        uint8   action;        // 0=NO_TRADE, 1=LONG, 2=SHORT
        uint64  attestedAt;    // block.timestamp (fits in uint64 until year 2554)
    }

    // decisionHash → attestation record
    mapping(bytes32 => DecisionAttestation) private _attestations;

    // ordered index for enumeration
    bytes32[] private _attestationIndex;

    // ─── Events ─────────────────────────────────────────────────────────────

    event AgentDeployed(
        address indexed operator,
        string  version,
        string  projectName,
        uint256 timestamp
    );

    event StrategyUpgraded(
        string  fromVersion,
        string  toVersion,
        string  reason,
        uint256 upgradeNumber,
        uint256 timestamp
    );

    event DecisionAttested(
        bytes32 indexed decisionHash,
        bytes32 indexed eventHash,
        uint8           conviction,
        uint16          confidence,
        uint8           action,
        uint256         totalDecisions,
        uint256         timestamp
    );

    event KillSwitchActivated(
        string  reason,
        uint256 openPositions,
        uint256 timestamp
    );

    event KillSwitchReset(
        uint256 timestamp
    );

    // ─── Errors ─────────────────────────────────────────────────────────────

    error NotOperator();
    error AlreadyAttested(bytes32 decisionHash);
    error InvalidConviction(uint8 conviction);
    error InvalidConfidence(uint16 confidence);
    error InvalidAction(uint8 action);
    error KillSwitchIsActive();

    // ─── Modifiers ──────────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenNotKilled() {
        if (killSwitchActive) revert KillSwitchIsActive();
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(string memory _version) {
        operator    = msg.sender;
        deployedAt  = block.timestamp;
        currentVersion = _version;

        emit AgentDeployed(msg.sender, _version, PROJECT_NAME, block.timestamp);
    }

    // ─── Strategy management ────────────────────────────────────────────────

    /**
     * @notice Record a strategy or model version change.
     * @param newVersion   Semver string e.g. "1.1.0"
     * @param reason       Human-readable description of what changed
     */
    function upgradeStrategy(
        string calldata newVersion,
        string calldata reason
    ) external onlyOperator {
        string memory old = currentVersion;
        currentVersion = newVersion;
        unchecked { ++strategyUpgradeCount; }

        emit StrategyUpgraded(old, newVersion, reason, strategyUpgradeCount, block.timestamp);
    }

    // ─── Decision attestation ───────────────────────────────────────────────

    /**
     * @notice Record a single MARA trading decision on-chain.
     *
     * The decisionHash must be computed off-chain as:
     *   keccak256(abi.encodePacked(decisionId, eventName, timestamp, conviction, confidence))
     *
     * This allows anyone to verify a specific decision by recomputing the hash
     * from the raw decision data (available via GET /api/decisions).
     *
     * @param decisionHash  Hash of the decision (computed by verifyDecisionHash)
     * @param eventHash     Hash of the triggering macro event
     * @param conviction    0=STRONG_BEAR … 4=STRONG_BULL
     * @param confidence    0–100
     * @param action        0=NO_TRADE, 1=LONG, 2=SHORT
     */
    function attestDecision(
        bytes32 decisionHash,
        bytes32 eventHash,
        uint8   conviction,
        uint16  confidence,
        uint8   action
    ) external onlyOperator whenNotKilled {
        if (_attestations[decisionHash].attestedAt != 0)
            revert AlreadyAttested(decisionHash);
        if (conviction > 4)   revert InvalidConviction(conviction);
        if (confidence > 100) revert InvalidConfidence(confidence);
        if (action > 2)       revert InvalidAction(action);

        _attestations[decisionHash] = DecisionAttestation({
            decisionHash: decisionHash,
            eventHash:    eventHash,
            conviction:   conviction,
            confidence:   confidence,
            action:       action,
            attestedAt:   uint64(block.timestamp)
        });

        _attestationIndex.push(decisionHash);
        unchecked { ++totalDecisions; }
        if (action != ACTION_NO_TRADE) {
            unchecked { ++totalTrades; }
        }

        emit DecisionAttested(
            decisionHash, eventHash,
            conviction, confidence, action,
            totalDecisions, block.timestamp
        );
    }

    /**
     * @notice Batch-attest multiple decisions in one tx to save gas.
     *         Use this to catch up when recording several decisions at once.
     */
    function batchAttestDecisions(
        bytes32[] calldata decisionHashes,
        bytes32[] calldata eventHashes,
        uint8[]   calldata convictions,
        uint16[]  calldata confidences,
        uint8[]   calldata actions
    ) external onlyOperator whenNotKilled {
        uint256 n = decisionHashes.length;
        require(
            eventHashes.length == n &&
            convictions.length == n &&
            confidences.length == n &&
            actions.length == n,
            "MARA: array length mismatch"
        );

        for (uint256 i = 0; i < n; ) {
            bytes32 dh = decisionHashes[i];
            if (_attestations[dh].attestedAt == 0) {
                uint8  conv  = convictions[i];
                uint16 conf  = confidences[i];
                uint8  act   = actions[i];

                if (conv > 4 || conf > 100 || act > 2) {
                    unchecked { ++i; }
                    continue; // skip invalid entries, don't revert whole batch
                }

                _attestations[dh] = DecisionAttestation({
                    decisionHash: dh,
                    eventHash:    eventHashes[i],
                    conviction:   conv,
                    confidence:   conf,
                    action:       act,
                    attestedAt:   uint64(block.timestamp)
                });

                _attestationIndex.push(dh);
                unchecked { ++totalDecisions; }
                if (act != ACTION_NO_TRADE) {
                    unchecked { ++totalTrades; }
                }

                emit DecisionAttested(
                    dh, eventHashes[i], conv, conf, act,
                    totalDecisions, block.timestamp
                );
            }
            unchecked { ++i; }
        }
    }

    // ─── Kill switch mirroring ───────────────────────────────────────────────

    /**
     * @notice Record an on-chain kill switch activation.
     *         Mirrors the off-chain kill switch — attestation cannot proceed
     *         while kill switch is active (prevents false audit trail).
     */
    function activateKillSwitch(
        string calldata reason,
        uint256 openPositions
    ) external onlyOperator {
        killSwitchActive = true;
        emit KillSwitchActivated(reason, openPositions, block.timestamp);
    }

    /**
     * @notice Reset kill switch after manual review.
     */
    function resetKillSwitch() external onlyOperator {
        killSwitchActive = false;
        emit KillSwitchReset(block.timestamp);
    }

    // ─── View functions ──────────────────────────────────────────────────────

    /**
     * @notice Fetch a single decision attestation by its hash.
     */
    function getAttestation(bytes32 decisionHash)
        external view
        returns (DecisionAttestation memory)
    {
        return _attestations[decisionHash];
    }

    /**
     * @notice Total number of attested decisions.
     */
    function attestationCount() external view returns (uint256) {
        return _attestationIndex.length;
    }

    /**
     * @notice Fetch the N most recent decision hashes (reverse-chronological).
     */
    function recentAttestations(uint256 count)
        external view
        returns (bytes32[] memory)
    {
        uint256 len  = _attestationIndex.length;
        uint256 take = count > len ? len : count;
        bytes32[] memory out = new bytes32[](take);
        for (uint256 i = 0; i < take; ) {
            out[i] = _attestationIndex[len - take + i];
            unchecked { ++i; }
        }
        return out;
    }

    /**
     * @notice Pure helper: recompute a decision hash from raw inputs.
     *         Judges can use this to verify any decision from GET /api/decisions.
     *
     * @param decisionId   UUID from the decisions table
     * @param eventName    e.g. "CPI"
     * @param timestamp    Unix ms from decisions.timestamp
     * @param conviction   0-4
     * @param confidence   0-100
     */
    function computeDecisionHash(
        string  calldata decisionId,
        string  calldata eventName,
        uint256          timestamp,
        uint8            conviction,
        uint16           confidence
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            decisionId, eventName, timestamp, conviction, confidence
        ));
    }

    /**
     * @notice Pure helper: compute the event hash from event name + release time.
     */
    function computeEventHash(
        string  calldata eventName,
        uint256          releaseTimestamp
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(eventName, releaseTimestamp));
    }

    /**
     * @notice Summary view for dashboard display.
     */
    function agentSummary() external view returns (
        string  memory projectName,
        string  memory version,
        address        operatorAddr,
        uint256        deployedTimestamp,
        uint256        decisions,
        uint256        trades,
        uint256        upgrades,
        bool           isKilled
    ) {
        return (
            PROJECT_NAME,
            currentVersion,
            operator,
            deployedAt,
            totalDecisions,
            totalTrades,
            strategyUpgradeCount,
            killSwitchActive
        );
    }
}
