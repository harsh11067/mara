import { createLogger } from '../utils/logger.js';
import { appEvents } from '../utils/event-emitter.js';
import { EventStore } from '../store/event-store.js';
import { v4 as uuidv4 } from 'uuid';
import type { AppEvents } from '../utils/event-emitter.js';

const logger = createLogger('EventReconciler');

const DEDUP_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const MAX_NEWS_WAIT_MS = 5 * 60 * 1000;   // 5 min: give data path time to confirm news path

interface PendingEvent {
  eventName: string;
  eventId: string;
  firedAt: number;
  source: 'news' | 'data';
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  newsConfirmed: boolean;
  dataConfirmed: boolean;
}

export class EventReconciler {
  private pending = new Map<string, PendingEvent>();

  constructor() {
    // Listen to both detection paths
    appEvents.on('EVENT_DETECTED_VIA_NEWS', (e) => this.onNewsEvent(e));
    appEvents.on('EVENT_DETECTED_VIA_DATA', (e) => this.onDataEvent(e));
  }

  private async onNewsEvent(e: AppEvents['EVENT_DETECTED_VIA_NEWS']): Promise<void> {
    const key = this.dedupeKey(e.event);

    if (this.isDuplicate(key)) {
      logger.debug(`Duplicate news event suppressed: ${e.event}`);
      return;
    }

    const actual = typeof e.extractedActual === 'number' ? e.extractedActual : null;

    if (this.pending.has(key)) {
      // Data path already fired → confirm with news
      const pending = this.pending.get(key)!;
      pending.newsConfirmed = true;
      if (actual !== null) pending.actual = actual;
      logger.info(`NEWS confirms DATA path for ${e.event}`);
      return;
    }

    // News fires FIRST — start pipeline immediately
    const eventId = this.getOrCreateEventId(e.event);
    const pending: PendingEvent = {
      eventName: e.event,
      eventId,
      firedAt: Date.now(),
      source: 'news',
      actual,
      forecast: null,
      previous: null,
      newsConfirmed: true,
      dataConfirmed: false,
    };
    this.pending.set(key, pending);

    logger.info(`🔔 EVENT FIRED via NEWS (fast path): ${e.event}`, {
      actual,
      headline: e.headline.slice(0, 80),
    });

    // Fire immediately — data path will enrich if it arrives within 5 min
    await this.firePipeline(pending, 'news');

    // Wait for data confirmation (non-blocking)
    this.scheduleDataWait(key, e.event);
  }

  private async onDataEvent(e: AppEvents['EVENT_DETECTED_VIA_DATA']): Promise<void> {
    const key = this.dedupeKey(e.event);

    if (this.pending.has(key)) {
      // News path already fired — data path CONFIRMS and enriches
      const pending = this.pending.get(key)!;
      pending.dataConfirmed = true;
      pending.actual = e.actual;
      pending.forecast = e.forecast;
      pending.previous = e.previous;
      logger.info(`📊 DATA confirms NEWS path for ${e.event}`, {
        actual: e.actual,
        forecast: e.forecast,
      });

      // Update the DB event record with precise values
      EventStore.updateStatus(pending.eventId, 'FIRED', { actual: e.actual });
      return;
    }

    if (this.isDuplicate(key)) {
      logger.debug(`Duplicate data event suppressed: ${e.event}`);
      return;
    }

    // Data fires FIRST (no news match)
    const eventId = this.getOrCreateEventId(e.event);
    const pending: PendingEvent = {
      eventName: e.event,
      eventId,
      firedAt: Date.now(),
      source: 'data',
      actual: e.actual,
      forecast: e.forecast,
      previous: e.previous,
      newsConfirmed: false,
      dataConfirmed: true,
    };
    this.pending.set(key, pending);

    logger.info(`🔔 EVENT FIRED via DATA (reliable path): ${e.event}`, {
      actual: e.actual,
      forecast: e.forecast,
    });

    await this.firePipeline(pending, 'data');
  }

  private async firePipeline(pending: PendingEvent, source: 'news' | 'data'): Promise<void> {
    // Mark event as FIRED in DB
    EventStore.updateStatus(pending.eventId, 'FIRED', {
      actual: pending.actual ?? undefined,
    });

    // Determine confidence
    const confidence = pending.dataConfirmed
      ? 'high'
      : pending.newsConfirmed && !pending.dataConfirmed
        ? 'medium'
        : 'low';

    await appEvents.emit('EVENT_FIRED', {
      eventName: pending.eventName,
      actual: pending.actual,
      forecast: pending.forecast,
      previous: pending.previous,
      source,
      confidence,
      timestamp: Date.now(),
      eventId: pending.eventId,
    });
  }

  private scheduleDataWait(key: string, eventName: string): void {
    setTimeout(() => {
      const pending = this.pending.get(key);
      if (pending && !pending.dataConfirmed) {
        logger.warn(`Data path did not confirm news trigger for ${eventName} within 5 min. Proceeding with news-extracted values (medium confidence).`);
      }
    }, MAX_NEWS_WAIT_MS);
  }

  private isDuplicate(key: string): boolean {
    const pending = this.pending.get(key);
    if (!pending) return false;
    return Date.now() - pending.firedAt < DEDUP_WINDOW_MS;
  }

  private dedupeKey(eventName: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return `${eventName.toLowerCase()}_${today}`;
  }

  private getOrCreateEventId(eventName: string): string {
    const today = new Date().toISOString().slice(0, 10);
    const existing = EventStore.getByNameAndDate(eventName, today);
    if (existing) return existing.id;

    const created = EventStore.upsert({
      name: eventName,
      date: today,
      status: 'WATCHING',
      forecast: null,
      actual: null,
      previous: null,
      surpriseScore: null,
      cryptoBias: null,
    });
    return created.id;
  }

  /** Manually fire an event (for testing and manual triggers) */
  async manualTrigger(params: {
    eventName: string;
    actual: number;
    forecast: number;
    previous?: number;
  }): Promise<void> {
    const eventId = this.getOrCreateEventId(params.eventName);
    const key = this.dedupeKey(params.eventName);

    // Allow forced override for manual triggers
    this.pending.delete(key);

    const pending: PendingEvent = {
      eventName: params.eventName,
      eventId,
      firedAt: Date.now(),
      source: 'data',
      actual: params.actual,
      forecast: params.forecast,
      previous: params.previous ?? null,
      newsConfirmed: false,
      dataConfirmed: true,
    };
    this.pending.set(key, pending);

    logger.info(`🔧 Manual trigger: ${params.eventName}`, params);
    await this.firePipeline(pending, 'data');
  }
}
