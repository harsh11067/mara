import { createLogger } from '../utils/logger.js';
import { appEvents } from '../utils/event-emitter.js';
import type { SoSoValueClient } from '../services/sosovalue-client.js';
import type { MacroEvent } from '../services/types.js';

const logger = createLogger('HistoryWatcher');

interface WatchState {
  eventName: string;
  lastActual: number | null;
  lastChecked: number;
}

export class HistoryWatcher {
  private watchStates = new Map<string, WatchState>();
  private readonly client: SoSoValueClient;

  constructor(client: SoSoValueClient) {
    this.client = client;
  }

  /**
   * Register a macro event for watching (Path B — data-first detection).
   * Call when an event is T-minus 24h (UPCOMING → WATCHING transition).
   */
  registerEvent(event: MacroEvent): void {
    if (!this.watchStates.has(event.name)) {
      this.watchStates.set(event.name, {
        eventName: event.name,
        lastActual: event.actual ?? null,
        lastChecked: Date.now(),
      });
      logger.info(`Watching history for: ${event.name}`);
    }
  }

  /**
   * Poll the history endpoint for all registered events.
   * Emit EVENT_DETECTED_VIA_DATA when actual value appears or changes.
   */
  async pollAll(): Promise<void> {
    if (this.watchStates.size === 0) return;

    for (const [name, state] of this.watchStates.entries()) {
      await this.pollEvent(name, state);
    }
  }

  private async pollEvent(name: string, state: WatchState): Promise<void> {
    try {
      const history = await this.client.getEventHistory(name, 1);
      if (!history || history.length === 0) return;

      const latest = history[0];
      state.lastChecked = Date.now();

      // Event fires when actual changes from null/previous to a new value
      const newActual = latest.actual;
      if (newActual === null || newActual === undefined) return;
      if (newActual === state.lastActual) return; // No change

      logger.info(`📊 History update detected for ${name}`, {
        previous: state.lastActual,
        newActual,
        forecast: latest.forecast,
        date: latest.date,
      });

      state.lastActual = newActual;

      await appEvents.emit('EVENT_DETECTED_VIA_DATA', {
        event: name,
        actual: newActual,
        forecast: latest.forecast ?? 0,
        previous: latest.previous ?? 0,
        date: latest.date,
        timestamp: Date.now(),
      });

    } catch (err) {
      logger.warn(`Failed to poll history for ${name}`, { error: err });
    }
  }

  /**
   * Stop watching a specific event (after it's been processed).
   */
  unwatch(eventName: string): void {
    this.watchStates.delete(eventName);
    logger.info(`Stopped watching: ${eventName}`);
  }

  getWatchedEvents(): string[] {
    return [...this.watchStates.keys()];
  }
}
