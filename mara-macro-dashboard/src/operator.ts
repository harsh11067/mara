/**
 * Single Source of Truth — Operator Identity (frontend)
 *
 * The dashboard must never invent a wallet. When MetaMask is unavailable, the
 * "demo" wallet shown is the REAL MARA operator — the same address that signs
 * SoDEX trades and owns the MARAAttestation contract on ValueChain.
 *
 * Override at build time with VITE_OPERATOR_ADDRESS if the operator changes.
 */
export const OPERATOR_ADDRESS: string =
  (import.meta.env.VITE_OPERATOR_ADDRESS as string | undefined) ??
  "0x2633a0d83a2aA43449DAd7a304a0EE71F5Bfa8eC";
