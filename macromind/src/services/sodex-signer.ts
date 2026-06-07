/**
 * SoDEX EIP-712 Signer
 *
 * Implements the two-level signing pipeline required by SoDEX:
 *
 *   ActionPayload{type, params}
 *     └─▶ compact JSON ──▶ keccak256 ──▶ payloadHash
 *   ExchangeAction{payloadHash, nonce}
 *     └─▶ StructHash ──▶ EIP-712 Hash(domain) ──▶ digest
 *   ECDSA-sign(digest) ──▶ [0x01 | r | s | v]  (66 bytes)
 *
 * CRITICAL: JSON field order MUST match the Go struct field order exactly.
 * Go's json.Marshal serializes in struct declaration order, so our JSON
 * must produce byte-identical output.
 *
 * Reference: github.com/sodex-tech/sodex-go-sdk-public
 */
import { ethers } from 'ethers';

// ── Domain constants ──────────────────────────────────────────────────────────

/** EIP-712 domain name for the Bolt (perps) engine */
export const PERPS_DOMAIN_NAME = 'futures';

/** EIP-712 domain name for the Spark (spot) engine */
export const SPOT_DOMAIN_NAME = 'spot';

/** ExchangeAction type hash — keccak256("ExchangeAction(bytes32 payloadHash,uint64 nonce)") */
const EXCHANGE_ACTION_TYPE_HASH = ethers.keccak256(
  ethers.toUtf8Bytes('ExchangeAction(bytes32 payloadHash,uint64 nonce)'),
);

/** EIP712Domain type hash */
const DOMAIN_TYPE_HASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)',
  ),
);

// ── Enum values matching Go SDK ───────────────────────────────────────────────

export const OrderSide = { Buy: 1, Sell: 2 } as const;
export const OrderType = { Limit: 1, Market: 2 } as const;
export const TimeInForce = { GTC: 1, FOK: 2, IOC: 3, GTX: 4 } as const;
export const PositionSide = { Both: 1, Long: 2, Short: 3 } as const;
export const OrderModifier = { Normal: 1, Stop: 2, Bracket: 3, AttachedStop: 4 } as const;

// ── Order payload types ───────────────────────────────────────────────────────

/** Single order item — field order MUST match RawOrder Go struct declaration */
export interface RawOrder {
  clOrdID: string;
  modifier: number;
  side: number;
  type: number;
  timeInForce: number;
  price?: string;        // omitempty — must be string decimal, no trailing zeros
  quantity?: string;     // omitempty
  funds?: string;        // omitempty
  stopPrice?: string;    // omitempty
  stopType?: number;     // omitempty
  triggerType?: number;  // omitempty
  reduceOnly: boolean;
  positionSide: number;
}

/** Perps new order request — field order MUST match NewOrderRequest Go struct */
export interface NewOrderRequest {
  accountID: number;
  symbolID: number;
  orders: RawOrder[];
}

/** Perps cancel order item */
export interface CancelOrder {
  symbolID: number;
  orderID?: number;
  clOrdID?: string;
}

/** Perps cancel order request */
export interface CancelOrderRequest {
  accountID: number;
  cancels: CancelOrder[];
}

/** Spot order item — field order matches BatchNewOrderItem Go struct */
export interface BatchNewOrderItem {
  symbolID: number;
  clOrdID: string;
  side: number;
  type: number;
  timeInForce: number;
  price?: string;    // omitempty
  quantity?: string; // omitempty
  funds?: string;    // omitempty
}

/** Spot batch order request */
export interface BatchNewOrderRequest {
  accountID: number;
  orders: BatchNewOrderItem[];
}

/** Schedule cancel (cancel-all) request */
export interface ScheduleCancelRequest {
  accountID: number;
  scheduledTimestamp?: number;  // omitempty
}

/** Update leverage request */
export interface UpdateLeverageRequest {
  accountID: number;
  symbolID: number;
  leverage: number;
  marginMode: number;
}

/** Signed result ready to attach as HTTP headers */
export type SignedHeaders = Record<string, string> & {
  'X-API-Sign': string;
  'X-API-Nonce': string;
  'X-API-Chain': string;
  'Content-Type': string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip trailing zeros from a decimal string.
 * SoDEX rejects "0.1000" but accepts "0.1".
 * Integers like "70000" are returned as-is.
 */
export function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  const stripped = s.replace(/\.?0+$/, '');
  return stripped === '' ? '0' : stripped;
}

/**
 * Build a compact JSON string for a RawOrder with fields in Go struct order.
 * omitempty fields are omitted when undefined.
 */
function buildOrderJson(order: RawOrder): Record<string, unknown> {
  // Build object in strict field-declaration order matching RawOrder Go struct
  // JavaScript objects preserve insertion order for string keys (ES2015+)
  const obj: Record<string, unknown> = {};

  obj['clOrdID'] = order.clOrdID;
  obj['modifier'] = order.modifier;
  obj['side'] = order.side;
  obj['type'] = order.type;
  obj['timeInForce'] = order.timeInForce;

  if (order.price !== undefined)       obj['price']     = order.price;
  if (order.quantity !== undefined)    obj['quantity']  = order.quantity;
  if (order.funds !== undefined)       obj['funds']     = order.funds;
  if (order.stopPrice !== undefined)   obj['stopPrice'] = order.stopPrice;
  if (order.stopType !== undefined)    obj['stopType']  = order.stopType;
  if (order.triggerType !== undefined) obj['triggerType'] = order.triggerType;

  obj['reduceOnly']   = order.reduceOnly;
  obj['positionSide'] = order.positionSide;

  return obj;
}

/**
 * Build a compact JSON params object for a NewOrderRequest with fields in Go struct order.
 */
function buildNewOrderParams(req: NewOrderRequest): Record<string, unknown> {
  return {
    accountID: req.accountID,
    symbolID:  req.symbolID,
    orders:    req.orders.map(buildOrderJson),
  };
}

function buildCancelParams(req: CancelOrderRequest): Record<string, unknown> {
  return {
    accountID: req.accountID,
    cancels: req.cancels.map((c) => {
      const obj: Record<string, unknown> = { symbolID: c.symbolID };
      if (c.orderID !== undefined) obj['orderID'] = c.orderID;
      if (c.clOrdID !== undefined) obj['clOrdID'] = c.clOrdID;
      return obj;
    }),
  };
}

function buildBatchNewOrderParams(req: BatchNewOrderRequest): Record<string, unknown> {
  return {
    accountID: req.accountID,
    orders: req.orders.map((item) => {
      const obj: Record<string, unknown> = {
        symbolID: item.symbolID,
        clOrdID: item.clOrdID,
        side: item.side,
        type: item.type,
        timeInForce: item.timeInForce,
      };
      if (item.price !== undefined)    obj['price']    = item.price;
      if (item.quantity !== undefined) obj['quantity'] = item.quantity;
      if (item.funds !== undefined)    obj['funds']    = item.funds;
      return obj;
    }),
  };
}

function buildScheduleCancelParams(req: ScheduleCancelRequest): Record<string, unknown> {
  const obj: Record<string, unknown> = { accountID: req.accountID };
  if (req.scheduledTimestamp !== undefined) obj['scheduledTimestamp'] = req.scheduledTimestamp;
  return obj;
}

function buildUpdateLeverageParams(req: UpdateLeverageRequest): Record<string, unknown> {
  return {
    accountID:  req.accountID,
    symbolID:   req.symbolID,
    leverage:   req.leverage,
    marginMode: req.marginMode,
  };
}

// ── Core signing logic ────────────────────────────────────────────────────────

/**
 * Compute the domain separator for a SoDEX engine.
 * domainName: 'futures' for perps, 'spot' for spot
 */
function computeDomainSeparator(domainName: string, chainId: number): string {
  return ethers.keccak256(
    ethers.concat([
      DOMAIN_TYPE_HASH,
      ethers.keccak256(ethers.toUtf8Bytes(domainName)),
      ethers.keccak256(ethers.toUtf8Bytes('1')),
      ethers.zeroPadValue(ethers.toBeHex(chainId), 32),
      ethers.zeroPadValue('0x0000000000000000000000000000000000000000', 32),
    ]),
  );
}

// Cache domain separators to avoid recomputing
const domainSeparatorCache = new Map<string, string>();

function getDomainSeparator(domainName: string, chainId: number): string {
  const key = `${domainName}:${chainId}`;
  let sep = domainSeparatorCache.get(key);
  if (!sep) {
    sep = computeDomainSeparator(domainName, chainId);
    domainSeparatorCache.set(key, sep);
  }
  return sep;
}

/**
 * Sign a SoDEX action using EIP-712.
 *
 * @param actionType - the action name ("newOrder", "cancelOrder", etc.)
 * @param params     - the params object with fields in correct Go struct order
 * @param privateKey - EVM private key hex string (with or without 0x prefix)
 * @param nonce      - uint64 millisecond timestamp nonce
 * @param domainName - 'futures' for perps, 'spot' for spot
 * @param chainId    - EVM chain ID (138565 testnet, 286623 mainnet)
 * @returns 66-byte wire signature as hex string: 0x01 | r | s | v
 */
export function signSoDEXAction(
  actionType: string,
  params: Record<string, unknown>,
  privateKey: string,
  nonce: bigint,
  domainName: string,
  chainId: number,
): string {
  // ── Step 1: Build ActionPayload JSON and compute payloadHash ────────────────
  // Field order: {"type":"...","params":{...}} — matches ActionPayload Go struct
  const actionPayload = { type: actionType, params };
  const compactJson = JSON.stringify(actionPayload);
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(compactJson));

  // ── Step 2: Compute ExchangeAction struct hash ───────────────────────────────
  // StructHash = keccak256(typeHash | payloadHash | nonce_as_uint64_in_32bytes)
  // nonce is uint64: placed in the last 8 bytes of a 32-byte big-endian word
  const nonceBytes = new Uint8Array(32);
  const nonceView = new DataView(nonceBytes.buffer);
  // Write nonce as big-endian uint64 at offset 24 (last 8 bytes of 32-byte word)
  const nonceHigh = Number(nonce >> 32n);
  const nonceLow  = Number(nonce & 0xFFFFFFFFn);
  nonceView.setUint32(24, nonceHigh, false); // big-endian
  nonceView.setUint32(28, nonceLow,  false);

  const structHash = ethers.keccak256(
    ethers.concat([
      EXCHANGE_ACTION_TYPE_HASH,
      payloadHash,
      nonceBytes,
    ]),
  );

  // ── Step 3: Compute final EIP-712 digest ─────────────────────────────────────
  // digest = keccak256(0x19 | 0x01 | domainSeparator | structHash)
  const domainSeparator = getDomainSeparator(domainName, chainId);
  const digest = ethers.keccak256(
    ethers.concat([
      new Uint8Array([0x19, 0x01]),
      domainSeparator,
      structHash,
    ]),
  );

  // ── Step 4: ECDSA sign the digest ────────────────────────────────────────────
  const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const signingKey = new ethers.SigningKey(pk);
  const sig = signingKey.sign(digest);

  // sig.r, sig.s are 32-byte hex strings; sig.v is 27 or 28
  const r = ethers.getBytes(sig.r);
  const s = ethers.getBytes(sig.s);
  const v = sig.v >= 27 ? sig.v - 27 : sig.v; // normalize to 0 or 1

  // ── Step 5: Build 66-byte wire signature: 0x01 | r(32) | s(32) | v(1) ───────
  const wireSig = new Uint8Array(66);
  wireSig[0] = 0x01;  // SignatureTypeEIP712
  wireSig.set(r, 1);
  wireSig.set(s, 33);
  wireSig[65] = v;

  return ethers.hexlify(wireSig);
}

// ── SoDEXSigner class ─────────────────────────────────────────────────────────

/**
 * Stateful signer that generates monotonically increasing nonces
 * and produces the HTTP headers needed for authenticated SoDEX requests.
 */
export class SoDEXSigner {
  private readonly privateKey: string;
  private readonly chainId: number;
  private readonly apiKeyName: string;
  private lastNonce = 0n;

  constructor(privateKey: string, chainId: number, apiKeyName: string) {
    this.privateKey = privateKey;
    this.chainId = chainId;
    this.apiKeyName = apiKeyName;
  }

  /** Generate a strictly-increasing uint64 nonce (ms timestamp) */
  private nextNonce(): bigint {
    const ts = BigInt(Date.now());
    if (ts > this.lastNonce) {
      this.lastNonce = ts;
    } else {
      this.lastNonce++;
    }
    return this.lastNonce;
  }

  /**
   * Sign a perps NewOrderRequest and return HTTP headers + nonce.
   */
  signNewOrder(req: NewOrderRequest): { headers: SignedHeaders; body: Record<string, unknown> } {
    const nonce = this.nextNonce();
    const params = buildNewOrderParams(req);
    const sig = signSoDEXAction('newOrder', params, this.privateKey, nonce, PERPS_DOMAIN_NAME, this.chainId);
    return {
      headers: this.buildHeaders(sig, nonce),
      body: params,
    };
  }

  /**
   * Sign a perps CancelOrderRequest.
   */
  signCancelOrder(req: CancelOrderRequest): { headers: SignedHeaders; body: Record<string, unknown> } {
    const nonce = this.nextNonce();
    const params = buildCancelParams(req);
    const sig = signSoDEXAction('cancelOrder', params, this.privateKey, nonce, PERPS_DOMAIN_NAME, this.chainId);
    return {
      headers: this.buildHeaders(sig, nonce),
      body: params,
    };
  }

  /**
   * Sign a perps ScheduleCancelRequest (cancel-all).
   */
  signScheduleCancel(req: ScheduleCancelRequest): { headers: SignedHeaders; body: Record<string, unknown> } {
    const nonce = this.nextNonce();
    const params = buildScheduleCancelParams(req);
    const sig = signSoDEXAction('scheduleCancel', params, this.privateKey, nonce, PERPS_DOMAIN_NAME, this.chainId);
    return {
      headers: this.buildHeaders(sig, nonce),
      body: params,
    };
  }

  /**
   * Sign a perps UpdateLeverageRequest.
   */
  signUpdateLeverage(req: UpdateLeverageRequest): { headers: SignedHeaders; body: Record<string, unknown> } {
    const nonce = this.nextNonce();
    const params = buildUpdateLeverageParams(req);
    const sig = signSoDEXAction('updateLeverage', params, this.privateKey, nonce, PERPS_DOMAIN_NAME, this.chainId);
    return {
      headers: this.buildHeaders(sig, nonce),
      body: params,
    };
  }

  /**
   * Sign a spot BatchNewOrderRequest.
   */
  signSpotBatchNewOrder(req: BatchNewOrderRequest): { headers: SignedHeaders; body: Record<string, unknown> } {
    const nonce = this.nextNonce();
    const params = buildBatchNewOrderParams(req);
    const sig = signSoDEXAction('batchNewOrder', params, this.privateKey, nonce, SPOT_DOMAIN_NAME, this.chainId);
    return {
      headers: this.buildHeaders(sig, nonce),
      body: params,
    };
  }

  private buildHeaders(sig: string, nonce: bigint): SignedHeaders {
    const headers: SignedHeaders = {
      'X-API-Sign':   sig,
      'X-API-Nonce':  nonce.toString(),
      'X-API-Chain':  this.chainId.toString(),
      'X-API-Key':    this.apiKeyName,
      'Content-Type': 'application/json',
    };
    // If no API key name is set, this is master-key auth — omit the header
    if (!this.apiKeyName) {
      delete headers['X-API-Key'];
    }
    return headers;
  }

  /**
   * True when signing with the master wallet key directly (no sub-API-key).
   * In this mode, X-API-Key header must NOT be sent.
   */
  get isMasterKeyMode(): boolean {
    return !this.apiKeyName;
  }
}
