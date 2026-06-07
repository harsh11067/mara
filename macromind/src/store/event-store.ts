import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';

export type EventStatus = 'UPCOMING' | 'WATCHING' | 'FIRED' | 'PROCESSED';

export interface StoredEvent {
  id: string;
  name: string;
  date: string;
  status: EventStatus;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surpriseScore: number | null;
  cryptoBias: 'bullish' | 'bearish' | 'neutral' | null;
  createdAt: number;
  updatedAt: number;
}

interface DbEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  forecast: number | null;
  actual: number | null;
  previous: number | null;
  surprise_score: number | null;
  crypto_bias: string | null;
  created_at: number;
  updated_at: number;
}

function toStored(row: DbEvent): StoredEvent {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    status: row.status as EventStatus,
    forecast: row.forecast,
    actual: row.actual,
    previous: row.previous,
    surpriseScore: row.surprise_score,
    cryptoBias: row.crypto_bias as StoredEvent['cryptoBias'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const EventStore = {
  upsert(event: Omit<StoredEvent, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): StoredEvent {
    const db = getDb();
    const now = Date.now();
    const id = event.id ?? uuidv4();

    db.prepare(`
      INSERT INTO events (id, name, date, status, forecast, actual, previous, surprise_score, crypto_bias, created_at, updated_at)
      VALUES (@id, @name, @date, @status, @forecast, @actual, @previous, @surprise_score, @crypto_bias, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        forecast = excluded.forecast,
        actual = excluded.actual,
        previous = excluded.previous,
        surprise_score = excluded.surprise_score,
        crypto_bias = excluded.crypto_bias,
        updated_at = excluded.updated_at
    `).run({
      id,
      name: event.name,
      date: event.date,
      status: event.status,
      forecast: event.forecast,
      actual: event.actual,
      previous: event.previous,
      surprise_score: event.surpriseScore,
      crypto_bias: event.cryptoBias,
      created_at: now,
      updated_at: now,
    });

    return this.getById(id)!;
  },

  updateStatus(id: string, status: EventStatus, extra?: Partial<Pick<StoredEvent, 'actual' | 'surpriseScore' | 'cryptoBias'>>): void {
    const db = getDb();
    const sets = ['status = @status', 'updated_at = @now'];
    const params: Record<string, unknown> = { id, status, now: Date.now() };

    if (extra?.actual !== undefined) { sets.push('actual = @actual'); params.actual = extra.actual; }
    if (extra?.surpriseScore !== undefined) { sets.push('surprise_score = @surprise_score'); params.surprise_score = extra.surpriseScore; }
    if (extra?.cryptoBias !== undefined) { sets.push('crypto_bias = @crypto_bias'); params.crypto_bias = extra.cryptoBias; }

    db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = @id`).run(params);
  },

  getById(id: string): StoredEvent | null {
    const row = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as DbEvent | undefined;
    return row ? toStored(row) : null;
  },

  getByNameAndDate(name: string, date: string): StoredEvent | null {
    const row = getDb().prepare('SELECT * FROM events WHERE name = ? AND date = ?').get(name, date) as DbEvent | undefined;
    return row ? toStored(row) : null;
  },

  getByStatus(status: EventStatus): StoredEvent[] {
    return (getDb().prepare('SELECT * FROM events WHERE status = ? ORDER BY date DESC').all(status) as DbEvent[]).map(toStored);
  },

  getTodaysEvents(): StoredEvent[] {
    const today = new Date().toISOString().slice(0, 10);
    return (getDb().prepare("SELECT * FROM events WHERE date = ? ORDER BY created_at DESC").all(today) as DbEvent[]).map(toStored);
  },

  getRecent(limit = 20): StoredEvent[] {
    return (getDb().prepare('SELECT * FROM events ORDER BY updated_at DESC LIMIT ?').all(limit) as DbEvent[]).map(toStored);
  },
};
