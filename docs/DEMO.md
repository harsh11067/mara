# MARA — Terminal Demo Runbook

Commands to run on screen, in order. Each one is copy-paste ready and produces
clean, judge-facing output. A local ValueChain node is already running and the
contract is already deployed as the real operator `0x2633…`.

---

## 0. (Only if the local node is NOT running)

```bash
cd ~/soso/mara-attestation
npm run node            # leave this running in its own terminal/tab
# then in another tab:
npm run deploy:local    # deploys MARAAttestation AS 0x2633…
```

Copy the printed `MARA_CONTRACT_ADDRESS=` into `macromind/.env`.

---

## 1. The headline: ONE identity across the whole system

```bash
cd ~/soso/macromind && npm run verify:identity
```

Expected — all four anchors equal `0x2633…`, `PASS`:

```
[✓] SODEX_MASTER_ADDRESS (execution wallet)    0x2633…a8eC
[✓] EIP-712 trade signer (from API key)        0x2633…a8eC
[✓] On-chain attestation signer                0x2633…a8eC
[✓] Deployed contract.operator()               0x2633…a8eC
✓ PASS — all anchors resolve to 0x2633…
```

> Talking point: "Execution, signing, on-chain ownership, and the audit trail
> all resolve to the same wallet. One operator, one source of truth."

---

## 2. The on-chain audit trail is real — full round-trip

```bash
cd ~/soso/mara-attestation && npm run attest:demo
```

Shows: `agentSummary()` (operator == signer ✓) → compute decision hash →
`attestDecision()` tx → read back → **HASH MATCH + DATA INTACT: YES ✓**.

> Talking point: "Every MARA decision is hashed and written on-chain. Anyone can
> recompute the hash from `/api/decisions` and find it in the contract. The agent
> can't rewrite its own history."

---

## 3. The guardrail: the synthetic identity is structurally blocked

```bash
cd ~/soso/mara-attestation
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  npx hardhat run scripts/deploy.ts --network localhost
```

Expected — the deploy **refuses** the Hardhat default account:

```
REFUSING TO DEPLOY: deployer is the Hardhat default account (0xf39F…).
  This is the synthetic identity that caused the split-brain problem.
```

> Talking point: "The exact mistake that caused the split-brain can't happen
> again — the deploy script rejects any non-operator deployer."

---

## 4. Full app (optional, if showing the dashboard)

```bash
# terminal A
cd ~/soso/macromind && npm start
# terminal B
cd ~/soso/mara-macro-dashboard && npm run dev
```

In the dashboard, the **ON-CHAIN ATTESTATION** panel shows the contract address,
operator `0x2633…`, and live decision/trade counts. Trigger an event in the
Agent Feed → the on-chain decision counter increments.

```bash
# quick API check of the on-chain summary the panel consumes:
curl -s http://localhost:3001/api/attestation | jq
```

---

## Reset / re-run cleanly

```bash
pkill -f "hardhat node"
cd ~/soso/mara-attestation && npm run node      # fresh node (as 0x2633)
npm run deploy:local                            # fresh contract
# update MARA_CONTRACT_ADDRESS in macromind/.env with the new address
```
