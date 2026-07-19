/**
 * MARA Accounts — Google Sign-In, wallet signature auth, guest passes.
 *
 * Real verification, no shortcuts:
 *   - Google: the client posts a GIS ID token; we verify it against Google's
 *     tokeninfo endpoint and check the audience === GOOGLE_CLIENT_ID.
 *   - Wallet: nonce → personal_sign → ethers.verifyMessage recovers the
 *     address server-side (EIP-191). No signature, no session.
 *   - Guest: instant pass so anyone can try the product — smaller grant.
 *
 * Credits (MARA credits) are an append-only ledger; the balance is SUM(delta).
 * New accounts get a signup grant so they can immediately run duels/triggers.
 */
import type { Hono, Context } from 'hono';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { getDb } from '../store/db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Auth');

const SESSION_TTL_MS = 30 * 24 * 3600_000; // 30 days
export const SIGNUP_GRANT = 1000;           // Google / wallet accounts
// Guests can browse everything but earn no credits — credits are the reward
// for a real (Google / wallet) login, which is what gates Signal Duel stakes.
export const GUEST_GRANT = 0;
// Telegram identities are real (chat id) but lighter than Google/wallet.
export const TELEGRAM_GRANT = 500;
export const REFERRAL_BONUS = 250;          // granted to BOTH sides on signup via ?ref=

export interface User {
  id: string;
  provider: 'google' | 'wallet' | 'guest' | 'telegram';
  provider_id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  wallet_address: string | null;
  created_at: number;
}

// ── Credits ledger ────────────────────────────────────────────────────────────

export function creditsBalance(userId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(delta),0) AS bal FROM credit_ledger WHERE user_id = ?')
    .get(userId) as { bal: number };
  return row.bal;
}

export function grantCredits(userId: string, amount: number, reason: string, ref?: string): void {
  getDb()
    .prepare('INSERT INTO credit_ledger (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)')
    .run(userId, Math.abs(Math.round(amount)), reason, ref ?? null, Date.now());
}

/** Atomic spend — throws if the balance is insufficient. */
export function spendCredits(userId: string, amount: number, reason: string, ref?: string): void {
  const amt = Math.abs(Math.round(amount));
  const db = getDb();
  const tx = db.transaction(() => {
    const bal = creditsBalance(userId);
    if (bal < amt) throw new Error(`Insufficient credits: have ${bal}, need ${amt}`);
    db.prepare('INSERT INTO credit_ledger (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)')
      .run(userId, -amt, reason, ref ?? null, Date.now());
  });
  tx();
}

// ── Users & sessions ──────────────────────────────────────────────────────────

export function findOrCreateUser(
  provider: User['provider'],
  providerId: string,
  fields: Partial<Pick<User, 'email' | 'name' | 'avatar' | 'wallet_address'>>,
): { user: User; created: boolean } {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
    .get(provider, providerId) as User | undefined;
  if (existing) {
    // keep profile fresh (name/avatar can change on Google)
    db.prepare('UPDATE users SET email = COALESCE(?, email), name = COALESCE(?, name), avatar = COALESCE(?, avatar) WHERE id = ?')
      .run(fields.email ?? null, fields.name ?? null, fields.avatar ?? null, existing.id);
    return { user: { ...existing, ...fields } as User, created: false };
  }
  const user: User = {
    id: uuidv4(),
    provider,
    provider_id: providerId,
    email: fields.email ?? null,
    name: fields.name ?? null,
    avatar: fields.avatar ?? null,
    wallet_address: fields.wallet_address ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    'INSERT INTO users (id, provider, provider_id, email, name, avatar, wallet_address, created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(user.id, user.provider, user.provider_id, user.email, user.name, user.avatar, user.wallet_address, user.created_at);
  const grant = provider === 'guest' ? GUEST_GRANT
    : provider === 'telegram' ? TELEGRAM_GRANT
    : SIGNUP_GRANT;
  if (grant > 0) grantCredits(user.id, grant, 'signup_grant');
  logger.info(`New ${provider} account ${user.id.slice(0, 8)} — granted ${grant} credits`);
  return { user, created: true };
}

/** Referral: on a fresh real signup carrying ?ref=<userId>, both sides get a bonus.
 *  One referral per invited user, no self-referrals, referrer must exist. */
export function applyReferral(newUserId: string, refCode: string | null | undefined): boolean {
  const ref = (refCode ?? '').trim();
  if (!ref || ref === newUserId) return false;
  const db = getDb();
  const referrer = db.prepare('SELECT id FROM users WHERE id = ?').get(ref) as { id: string } | undefined;
  if (!referrer) return false;
  const already = db.prepare('SELECT user_id FROM referrals WHERE user_id = ?').get(newUserId);
  if (already) return false;
  db.prepare('INSERT INTO referrals (user_id, referrer_id, created_at) VALUES (?,?,?)')
    .run(newUserId, referrer.id, Date.now());
  grantCredits(newUserId, REFERRAL_BONUS, 'referral_joined', referrer.id);
  grantCredits(referrer.id, REFERRAL_BONUS, 'referral_invited', newUserId);
  logger.info(`Referral: ${referrer.id.slice(0, 8)} invited ${newUserId.slice(0, 8)} — +${REFERRAL_BONUS} each`);
  return true;
}

function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex');
  getDb()
    .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, Date.now(), Date.now() + SESSION_TTL_MS);
  return token;
}

export function getUserFromRequest(c: Context): User | null {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as User | undefined;
  return row ?? null;
}

function sessionPayload(user: User, token: string) {
  return {
    token,
    user: {
      id: user.id,
      provider: user.provider,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      walletAddress: user.wallet_address,
    },
    credits: creditsBalance(user.id),
  };
}

// ── Wallet auth nonces (in-memory, 5 min TTL) ────────────────────────────────

const nonces = new Map<string, { nonce: string; expires: number }>();

function walletMessage(address: string, nonce: string): string {
  return [
    'MARA Terminal — wallet sign-in',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    '',
    'Signing proves you control this wallet. No transaction, no gas.',
  ].join('\n');
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function authRoutes(app: Hono): void {
  // Guest pass — zero-friction onboarding
  app.post('/api/auth/guest', async (c) => {
    let name = 'Guest Operator';
    try {
      const body = await c.req.json() as { name?: string };
      if (body.name && typeof body.name === 'string') name = body.name.slice(0, 40);
    } catch { /* empty body is fine */ }
    const { user } = findOrCreateUser('guest', uuidv4(), { name });
    return c.json(sessionPayload(user, createSession(user.id)));
  });

  // Google Sign-In (GIS credential = ID token JWT)
  app.post('/api/auth/google', async (c) => {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    if (!clientId) {
      return c.json({ error: 'Google Sign-In not configured — set GOOGLE_CLIENT_ID on the backend and VITE_GOOGLE_CLIENT_ID on the frontend.' }, 503);
    }
    let credential = '', refCode = '';
    try {
      const body = await c.req.json() as { credential?: string; ref?: string };
      credential = body.credential ?? '';
      refCode = body.ref ?? '';
    } catch { /* handled below */ }
    if (!credential) return c.json({ error: 'credential (Google ID token) is required' }, 400);

    // Verify with Google — signature + expiry checked server-side by Google
    let info: Record<string, string>;
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!res.ok) return c.json({ error: `Google rejected the token (${res.status})` }, 401);
      info = await res.json() as Record<string, string>;
    } catch (err) {
      return c.json({ error: `Token verification unreachable: ${String(err).slice(0, 80)}` }, 502);
    }
    if (info.aud !== clientId) return c.json({ error: 'Token audience mismatch — wrong Google client ID' }, 401);
    if (!info.sub) return c.json({ error: 'Token missing subject' }, 401);

    const { user, created } = findOrCreateUser('google', info.sub, {
      email: info.email ?? null,
      name: info.name ?? info.email ?? null,
      avatar: info.picture ?? null,
    });
    if (created) applyReferral(user.id, refCode);
    return c.json(sessionPayload(user, createSession(user.id)));
  });

  // Wallet auth step 1: get a nonce + the exact message to sign
  app.post('/api/auth/wallet/nonce', async (c) => {
    let address = '';
    try {
      const body = await c.req.json() as { address?: string };
      address = (body.address ?? '').trim();
    } catch { /* handled below */ }
    if (!ethers.isAddress(address)) return c.json({ error: 'A valid EVM address is required' }, 400);
    const checksummed = ethers.getAddress(address);
    const nonce = randomBytes(16).toString('hex');
    nonces.set(checksummed.toLowerCase(), { nonce, expires: Date.now() + 5 * 60_000 });
    return c.json({ address: checksummed, nonce, message: walletMessage(checksummed, nonce) });
  });

  // Wallet auth step 2: verify personal_sign — EIP-191 recovery via ethers
  app.post('/api/auth/wallet/verify', async (c) => {
    let address = '', signature = '', refCode = '';
    try {
      const body = await c.req.json() as { address?: string; signature?: string; ref?: string };
      address = (body.address ?? '').trim();
      signature = (body.signature ?? '').trim();
      refCode = body.ref ?? '';
    } catch { /* handled below */ }
    if (!ethers.isAddress(address) || !signature) {
      return c.json({ error: 'address and signature are required' }, 400);
    }
    const checksummed = ethers.getAddress(address);
    const entry = nonces.get(checksummed.toLowerCase());
    if (!entry || entry.expires < Date.now()) {
      return c.json({ error: 'Nonce expired or missing — request a new one' }, 401);
    }
    let recovered = '';
    try {
      recovered = ethers.verifyMessage(walletMessage(checksummed, entry.nonce), signature);
    } catch {
      return c.json({ error: 'Malformed signature' }, 401);
    }
    if (recovered.toLowerCase() !== checksummed.toLowerCase()) {
      return c.json({ error: 'Signature does not match the address' }, 401);
    }
    nonces.delete(checksummed.toLowerCase());

    const { user, created } = findOrCreateUser('wallet', checksummed.toLowerCase(), {
      name: `${checksummed.slice(0, 6)}…${checksummed.slice(-4)}`,
      wallet_address: checksummed,
    });
    if (created) applyReferral(user.id, refCode);
    return c.json(sessionPayload(user, createSession(user.id)));
  });

  // Session introspection + credits
  app.get('/api/auth/me', (c) => {
    const user = getUserFromRequest(c);
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    const ledger = getDb()
      .prepare('SELECT delta, reason, ref, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 15')
      .all(user.id);
    const token = (c.req.header('Authorization') ?? '').slice(7);
    return c.json({ ...sessionPayload(user, token), ledger });
  });

  app.post('/api/auth/logout', (c) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return c.json({ ok: true });
  });
}
