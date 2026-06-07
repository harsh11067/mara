# MARA — Single Source of Truth (Operator Identity)

> Every trust anchor in MARA resolves to **one** operator wallet. There is no
> second identity. This document is the auditable record of that guarantee.

## The one identity

```
OPERATOR / EXECUTION WALLET:  0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC
```

This single wallet is, simultaneously:

| Trust anchor | Where it lives | Resolves to |
|---|---|---|
| SoDEX account / balances / trade history | `SODEX_MASTER_ADDRESS` | `0x2633…` |
| EIP-712 trade signer | `SODEX_API_KEY_PRIVATE` (derived) | `0x2633…` |
| On-chain attestation signer | reuses `SODEX_API_KEY_PRIVATE` | `0x2633…` |
| `MARAAttestation.operator` (contract owner) | constructor `msg.sender` at deploy | `0x2633…` |
| Dashboard wallet (MetaMask-absent fallback) | `OPERATOR_ADDRESS` in `src/operator.ts` | `0x2633…` |

Run the proof at any time:

```bash
cd macromind && npm run verify:identity     # exits 0 only if all anchors agree
```

## The problem that was fixed

During contract prototyping, a **second, synthetic identity** leaked in via the
default Hardhat development account:

```
SYNTHETIC (now purged):  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  private key 0xac09…ff80  ← publicly-known Hardhat test key (in every install)
```

It had contaminated:

1. `macromind/.env` → `DEPLOYER_PRIVATE_KEY` was the public Hardhat key; the
   contract was deployed to a **localhost** chain owned by `0xf39F…`.
2. `mara-attestation/deployment.json` + `macromind/.../attestation-address.json`
   → recorded `deployer: 0xf39F…`, `network: localhost`.
3. `macromind/.env` → `VALUECHAIN_RPC` pointed at `http://127.0.0.1:8545` and
   `MARA_CONTRACT_ADDRESS` was the deterministic localhost vanity contract.
4. Dashboard → a throwaway demo wallet `0x7F5A…` shown when MetaMask was absent.

This was not a code bug. It was **loss of architectural truth**: ownership,
execution, attestation, and audit no longer resolved to one operator — fatal to
credibility with judges and auditors. It was also a *live* functional bug: the
runtime attestation signer (`0x2633…`) ≠ the contract operator (`0xf39F…`), so
every `attestDecision()` would have reverted with `NotOperator()`.

## How divergence is now structurally prevented

The fix is not a one-time cleanup — guardrails make the synthetic identity
impossible to reintroduce silently:

- **`mara-attestation/scripts/deploy.ts`** asserts `deployer == EXPECTED_OPERATOR`
  and rejects the Hardhat default account outright; aborts the deploy otherwise.
  Artifacts are tagged `environment: production | local-dev` so a local
  prototype can never masquerade as a ValueChain deployment.
- **`mara-attestation/hardhat.config.ts`** funds the **real operator key** on the
  local network, so even local/dev deploys produce `operator == 0x2633…`. The
  Hardhat default account is never used.
- **`macromind/src/config.ts`** derives the operator address from the operator
  key and exposes `identityCoherent` / `usingSyntheticIdentity` flags.
- **`macromind/src/services/attestation-service.ts`** refuses to attest if
  (a) the key is the Hardhat default, (b) the signer ≠ `SODEX_MASTER_ADDRESS`,
  or (c) the deployed `contract.operator()` ≠ the signer. Loud error, disabled.
- **`npm run verify:identity`** is the green-light gate before any demo/submission.

## Going to real ValueChain testnet (production)

The demo currently runs on a local node deployed **as** `0x2633…` (identity
coherent; chain tagged `local-dev`). To move to ValueChain testnet:

```bash
# 1. Fund the operator on ValueChain testnet (chainId 138565) from the faucet.
#    Operator: 0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC

# 2. Deploy (deploy.ts enforces operator == 0x2633 before spending gas):
cd mara-attestation
npm run deploy:testnet

# 3. Point the backend at testnet:
#    macromind/.env →
#      VALUECHAIN_RPC=https://testnet.valuechain.xyz
#      MARA_CONTRACT_ADDRESS=<printed by deploy>

# 4. Verify + (optional) explorer source verification:
cd ../macromind && npm run verify:identity
cd ../mara-attestation && npm run verify:testnet <ADDRESS> "1.0.0"
```

Nothing else changes — the operator wallet, the signer, and the audit trail are
already the same identity. Only the chain endpoint moves.
