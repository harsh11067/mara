/**
 * Withdraw SOSO (spot coin: WSOSO) from the SoDEX Spot account to the
 * ValueChain EVM wallet, so the operator has native gas to deploy
 * MARAAttestation.sol.
 *
 * Per docs (sodex.com/documentation/trading-api/rest-v1/sodex-rest-spot-api):
 *   POST ${SODEX_ENDPOINT}/spot/accounts/transfers   (signed write)
 *   toAccountID = 999, type = EVM_WITHDRAW (2)
 *
 * Signing reuses the project's existing SoDEXSigner (EIP-712, spot domain,
 * action "transferAsset" — verified against sodex-go-sdk-public:
 * common/types/transfer_asset_request.go, field order id/fromAccountID/
 * toAccountID/coinID/amount/type).
 *
 * Run:  cd macromind && npx tsx scripts/withdraw-soso-to-evm.ts [amount|all]
 */
import 'dotenv/config';
import { config } from '../src/config.js';
import { SoDEXSigner, TransferAssetType, type TransferAssetRequest } from '../src/services/sodex-signer.js';

const EVM_ACCOUNT_ID = 999;           // documented destination for EVM withdrawals
const DEFAULT_AMOUNT = '100';

interface SpotCoin { id: number; name: string; precision: number }
interface Envelope<T> { code: number; message?: string; msg?: string; data?: T }

function fmtAmount(raw: string, precision: number): string {
  // canonical DecimalString: respect coin precision, strip trailing zeros
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid amount: ${raw}`);
  const fixed = n.toFixed(Math.min(precision, 18));
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

async function main(): Promise<void> {
  const base = config.sodex.endpoint;
  const fromAccountID = config.sodex.accountId;
  if (!fromAccountID) throw new Error('SODEX_ACCOUNT_ID is not set');
  if (!config.sodex.apiKeyPrivate) throw new Error('SODEX_API_KEY_PRIVATE is not set');

  // ── 1. Discover the SOSO coinID from the live coin registry ────────────────
  const coinsRes = await fetch(`${base}/spot/markets/coins`, { headers: { Accept: 'application/json' } });
  const coins = (await coinsRes.json()) as Envelope<SpotCoin[]>;
  if (coins.code !== 0 || !coins.data) throw new Error(`coins query failed: ${JSON.stringify(coins).slice(0, 200)}`);
  const soso = coins.data.find((c) => c.name === 'WSOSO')
    ?? coins.data.find((c) => /SOSO/i.test(c.name));
  if (!soso) throw new Error(`No SOSO coin in registry: ${coins.data.map((c) => c.name).join(', ')}`);
  console.log(`SOSO coin discovered: name=${soso.name} coinID=${soso.id} precision=${soso.precision}`);

  // ── 2. Resolve amount ("all" = current free spot balance) ──────────────────
  let requested = process.argv[2] ?? DEFAULT_AMOUNT;
  if (requested === 'all') {
    const balRes = await fetch(`${base}/spot/accounts/${config.sodex.masterAddress}/balances`, { headers: { Accept: 'application/json' } });
    const bal = (await balRes.json()) as Envelope<{ balances?: Array<{ asset: string; free: string }> } | Array<{ asset: string; free: string }>>;
    const list = Array.isArray(bal.data) ? bal.data : bal.data?.balances ?? [];
    const row = list.find((b) => b.asset === soso.name);
    if (!row) throw new Error(`No ${soso.name} balance found`);
    requested = row.free;
    console.log(`Withdrawing full free balance: ${requested}`);
  }
  const amount = fmtAmount(requested, soso.precision);

  // ── 3. Build + sign TransferAssetRequest (existing signer, spot domain) ─────
  const transferId = Date.now();  // unique uint64, same ms-clock family as order nonces
  const req: TransferAssetRequest = {
    id: transferId,
    fromAccountID,
    toAccountID: EVM_ACCOUNT_ID,
    coinID: soso.id,
    amount,
    type: TransferAssetType.EvmWithdraw,
  };

  const send = async (apiKeyName: string) => {
    const signer = new SoDEXSigner(config.sodex.apiKeyPrivate, config.sodex.chainId, apiKeyName);
    const { headers, body } = signer.signTransferAsset(req);
    const res = await fetch(`${base}/spot/accounts/transfers`, {
      method: 'POST',
      headers: { ...headers, Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json: json as Envelope<{ id?: number }> };
  };

  // ── 4. POST — named API key first, master-key mode fallback ─────────────────
  console.log(`Transfer: ${amount} ${soso.name} (coinID ${soso.id}) acct ${fromAccountID} → EVM (999), id=${transferId}`);
  let { res, json } = await send(config.sodex.apiKeyName);
  if (json.code !== 0) {
    console.warn(`Named-key attempt returned code=${json.code} (${json.message ?? json.msg ?? 'no message'}) — retrying in master-key mode`);
    ({ res, json } = await send(''));
  }

  // ── 5. Report ───────────────────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`Transfer ID:  ${transferId}`);
  console.log(`HTTP status:  ${res.status}`);
  console.log(`Response:     ${JSON.stringify(json)}`);
  if (json.code === 0) {
    console.log(`✅ EVM withdrawal accepted — ${amount} ${soso.name} → ${config.sodex.masterAddress} on ValueChain`);
  } else {
    process.exitCode = 1;
    console.log('❌ Transfer rejected — see response above');
  }
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
