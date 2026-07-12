/**
 * Session store + wallet connection layer.
 *
 * Wallets: EIP-6963 multi-wallet discovery (MetaMask, Rabby, Coinbase, …)
 * with window.ethereum fallback, then a signature-verified login:
 *   nonce → personal_sign → backend recovers the address (EIP-191).
 * Connecting is authentication here, not just address display.
 *
 * Google: GIS (Google Identity Services) ID token → backend verification.
 * Guest: one click, instant credits grant.
 */
import { useSyncExternalStore } from 'react';
import { authApi, getToken, setToken, type SessionPayload } from './api';

// ── EIP-1193 / EIP-6963 types ────────────────────────────────────────────────

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

export interface DiscoveredWallet {
  uuid: string;
  name: string;
  icon: string; // data: URI per EIP-6963
  provider: Eip1193Provider;
}

declare global {
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: Eip1193Provider }>;
  }
  interface Window {
    ethereum?: Eip1193Provider;
    google?: {
      accounts: {
        id: {
          initialize: (cfg: { client_id: string; callback: (res: { credential: string }) => void }) => void;
          prompt: () => void;
          renderButton: (el: HTMLElement, cfg: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** Collect EIP-6963 announcements (wallets reply synchronously to the request event). */
export function discoverWallets(): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (e: WindowEventMap['eip6963:announceProvider']) => {
      const { info, provider } = e.detail;
      found.set(info.uuid, { uuid: info.uuid, name: info.name, icon: info.icon, provider });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const list = [...found.values()];
      if (list.length === 0 && window.ethereum) {
        list.push({ uuid: 'injected', name: 'Injected Wallet', icon: '', provider: window.ethereum });
      }
      resolve(list);
    }, 120);
  });
}

// ── Session store (module singleton + useSyncExternalStore) ─────────────────

export interface SessionState {
  user: SessionPayload['user'] | null;
  credits: number;
  loading: boolean;
}

let state: SessionState = { user: null, credits: 0, loading: !!getToken() };
const listeners = new Set<() => void>();

function emit(next: Partial<SessionState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useSession(): SessionState {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
  );
}

export function setCredits(credits: number): void { emit({ credits }); }

function applySession(payload: SessionPayload): void {
  if (payload.error || !payload.token) throw new Error(payload.error ?? 'Auth failed');
  setToken(payload.token);
  emit({ user: payload.user, credits: payload.credits, loading: false });
}

/** Restore a persisted session on boot. */
export async function restoreSession(): Promise<void> {
  if (!getToken()) { emit({ loading: false }); return; }
  try {
    const me = await authApi.me();
    emit({ user: me.user, credits: me.credits, loading: false });
  } catch {
    setToken(null);
    emit({ user: null, credits: 0, loading: false });
  }
}

export async function refreshCredits(): Promise<void> {
  if (!getToken()) return;
  try {
    const me = await authApi.me();
    emit({ credits: me.credits, user: me.user });
  } catch { /* keep last */ }
}

export async function loginGuest(name?: string): Promise<void> {
  applySession(await authApi.guest(name));
}

export async function loginGoogleCredential(credential: string): Promise<void> {
  applySession(await authApi.google(credential));
}

export async function loginWallet(wallet: DiscoveredWallet): Promise<void> {
  const accounts = (await wallet.provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.length) throw new Error('No account authorized');
  const address = accounts[0];

  const { message, error } = await authApi.walletNonce(address);
  if (error || !message) throw new Error(error ?? 'Nonce failed');

  const signature = (await wallet.provider.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;

  applySession(await authApi.walletVerify(address, signature));

  // React to wallet-side account switches: our session is bound to the signed
  // address, so a switch means the session no longer matches — sign out.
  wallet.provider.on?.('accountsChanged', (...args: unknown[]) => {
    const next = args[0] as string[];
    if (!next?.length || next[0].toLowerCase() !== address.toLowerCase()) void logout();
  });
}

export async function logout(): Promise<void> {
  try { await authApi.logout(); } catch { /* best effort */ }
  setToken(null);
  emit({ user: null, credits: 0, loading: false });
}

// ── Google Identity Services loader ─────────────────────────────────────────

export const GOOGLE_CLIENT_ID: string = (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

let gisLoading: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Google Sign-In'));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}
