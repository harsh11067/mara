/**
 * SoDEX WebSocket Client — Live Position & Order Updates
 *
 * Subscribes to SoDEX's private WebSocket feed for real-time position and
 * order status changes. This replaces the 10-second polling loop in
 * position-monitor.ts with sub-second push updates.
 *
 * Authentication: same EIP-712 signing as REST endpoints.
 * Feed types: position_update | order_update | balance_update
 *
 * Reference: SoDEX WebSocket docs at testnet-gw.sodex.dev/ws
 */

import WebSocket from 'ws';
import { createLogger } from '../utils/logger.js';
import { appEvents } from '../utils/event-emitter.js';
import { config } from '../config.js';
import { signSoDEXAction } from './sodex-signer.js';

const logger = createLogger('SoDEX-WS');

const RECONNECT_DELAY_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 10;

export interface PositionUpdate {
  symbol:           string;
  side:             'LONG' | 'SHORT';
  quantity:         number;
  entryPrice:       number;
  markPrice:        number;
  unrealizedPnl:    number;
  liquidationPrice: number;
  leverage:         number;
  marginUsed:       number;
  ts:               number;
}

export interface OrderUpdate {
  orderId:    string;
  clOrdId:    string;
  symbol:     string;
  side:       string;
  status:     'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED' | 'OPEN';
  filledQty:  number;
  avgPrice:   number;
  ts:         number;
}

export interface BalanceUpdate {
  totalEquity:      number;
  availableBalance: number;
  marginUsed:       number;
  unrealizedPnl:    number;
  ts:               number;
}

export class SoDEXWebSocketClient {
  private ws:               WebSocket | null = null;
  private heartbeatTimer:   ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private stopped          = false;

  private readonly wsUrl:       string;
  private readonly address:     string;
  private readonly privateKey:  string;
  private readonly chainId:     number;

  constructor() {
    // SoDEX WS lives at /ws/perps and /ws/spot — a bare /ws returns 404.
    // Normalize whatever the env provides to the perps feed.
    const base = (config.sodex.wsEndpoint ?? 'wss://testnet-gw.sodex.dev/ws').replace(/\/$/, '');
    this.wsUrl      = /\/ws\/(perps|spot)$/.test(base) ? base : `${base}/perps`;
    this.address    = config.sodex.masterAddress;
    this.privateKey = config.sodex.apiKeyPrivate;
    this.chainId    = config.sodex.chainId;
  }

  start(): void {
    if (this.stopped) return;
    logger.info('Starting SoDEX WebSocket client', { wsUrl: this.wsUrl });
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearHeartbeat();
    this.ws?.close(1000, 'client shutdown');
    this.ws = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    try {
      const authPayload = this.buildAuthPayload();
      const url = `${this.wsUrl}?address=${this.address}`;

      this.ws = new WebSocket(url, {
        headers: { 'X-API-Key': config.sodex.apiKeyName },
      });

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        logger.info('SoDEX WebSocket connected');
        // Authenticate immediately on open
        this.send(authPayload);
        // Subscribe to position and order feeds
        this.send({ action: 'subscribe', channels: ['positions', 'orders', 'balances'] });
        this.startHeartbeat();
      });

      this.ws.on('message', (raw) => this.handleMessage(raw.toString()));

      this.ws.on('error', (err) => {
        logger.error('SoDEX WebSocket error', { err: err.message });
      });

      this.ws.on('close', (code, reason) => {
        this.clearHeartbeat();
        logger.warn('SoDEX WebSocket closed', { code, reason: reason.toString() });
        if (!this.stopped) this.scheduleReconnect();
      });

    } catch (err) {
      logger.error('SoDEX WebSocket connect failed', { err });
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  private buildAuthPayload(): object {
    const nonce = BigInt(Date.now());
    const signature = signSoDEXAction(
      'authenticate',
      { address: this.address },
      this.privateKey,
      nonce,
      'futures',
      this.chainId,
    );
    return {
      action:    'auth',
      address:   this.address,
      nonce:     nonce.toString(),
      signature,
    };
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed frames
    }

    const type = msg.type ?? msg.channel;

    switch (type) {
      case 'auth_success':
        logger.info('SoDEX WebSocket authenticated');
        break;

      case 'position_update':
      case 'positions': {
        const update = this.parsePositionUpdate(msg);
        if (update) {
          appEvents.emit('WS_POSITION_UPDATE', update);
          logger.debug('Position update', { symbol: update.symbol, pnl: update.unrealizedPnl });
        }
        break;
      }

      case 'order_update':
      case 'orders': {
        const update = this.parseOrderUpdate(msg);
        if (update) {
          appEvents.emit('WS_ORDER_UPDATE', update);
          if (update.status === 'FILLED') {
            logger.info('Order filled via WS', { orderId: update.orderId, avgPrice: update.avgPrice });
          }
        }
        break;
      }

      case 'balance_update':
      case 'balances': {
        const update = this.parseBalanceUpdate(msg);
        if (update) {
          appEvents.emit('WS_BALANCE_UPDATE', update);
        }
        break;
      }

      case 'pong':
        break; // heartbeat ack, ignore

      case 'error':
        logger.error('SoDEX WebSocket server error', { msg });
        break;
    }
  }

  private parsePositionUpdate(msg: Record<string, unknown>): PositionUpdate | null {
    try {
      const d = (msg.data ?? msg) as Record<string, unknown>;
      return {
        symbol:           String(d.symbol ?? d.symbolId ?? ''),
        side:             d.side === 'LONG' || d.positionSide === 1 ? 'LONG' : 'SHORT',
        quantity:         parseFloat(String(d.quantity ?? d.qty ?? 0)),
        entryPrice:       parseFloat(String(d.entryPrice ?? d.avgEntryPrice ?? 0)),
        markPrice:        parseFloat(String(d.markPrice ?? 0)),
        unrealizedPnl:    parseFloat(String(d.unrealizedPnl ?? d.pnl ?? 0)),
        liquidationPrice: parseFloat(String(d.liquidationPrice ?? d.liqPrice ?? 0)),
        leverage:         parseInt(String(d.leverage ?? 1), 10),
        marginUsed:       parseFloat(String(d.margin ?? d.marginUsed ?? 0)),
        ts:               Date.now(),
      };
    } catch {
      return null;
    }
  }

  private parseOrderUpdate(msg: Record<string, unknown>): OrderUpdate | null {
    try {
      const d = (msg.data ?? msg) as Record<string, unknown>;
      return {
        orderId:   String(d.orderId ?? d.id ?? ''),
        clOrdId:   String(d.clOrdId ?? d.clOrdID ?? ''),
        symbol:    String(d.symbol ?? ''),
        side:      String(d.side ?? ''),
        status:    String(d.status ?? 'OPEN') as OrderUpdate['status'],
        filledQty: parseFloat(String(d.filledQty ?? d.executedQty ?? 0)),
        avgPrice:  parseFloat(String(d.avgPrice ?? d.avgFillPrice ?? 0)),
        ts:        Date.now(),
      };
    } catch {
      return null;
    }
  }

  private parseBalanceUpdate(msg: Record<string, unknown>): BalanceUpdate | null {
    try {
      const d = (msg.data ?? msg) as Record<string, unknown>;
      return {
        totalEquity:      parseFloat(String(d.totalEquity ?? d.equity ?? 0)),
        availableBalance: parseFloat(String(d.availableBalance ?? d.available ?? 0)),
        marginUsed:       parseFloat(String(d.marginUsed ?? d.usedMargin ?? 0)),
        unrealizedPnl:    parseFloat(String(d.unrealizedPnl ?? 0)),
        ts:               Date.now(),
      };
    } catch {
      return null;
    }
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ action: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('SoDEX WebSocket max reconnect attempts reached — giving up');
      return;
    }
    const delay = RECONNECT_DELAY_MS * Math.min(2 ** this.reconnectAttempts, 16);
    this.reconnectAttempts++;
    logger.info(`SoDEX WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect(), delay);
  }
}

// Singleton
export const sodexWsClient = new SoDEXWebSocketClient();
