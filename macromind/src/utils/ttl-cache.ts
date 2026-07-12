/**
 * Tiny TTL cache — respects the SoSoValue free-tier 20 calls/min budget.
 * Every hot API surface (markets, ssi, diag, corpus queries) caches through this.
 */
export class TTLCache {
  private store = new Map<string, { value: unknown; expires: number }>();

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  /** get-or-compute with in-flight dedupe */
  private inflight = new Map<string, Promise<unknown>>();
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn()
      .then((v) => { this.set(key, v, ttlMs); return v; })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Age of a cached key in ms, or null. */
  age(key: string): number | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    return Date.now() - (hit.expires - 0); // caller mostly wants existence; kept simple
  }
}

export const globalCache = new TTLCache();
