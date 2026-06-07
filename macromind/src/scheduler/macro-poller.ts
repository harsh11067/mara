import { createLogger } from '../utils/logger.js';
import type { SoSoValueClient } from '../services/sosovalue-client.js';
import { EventStore } from '../store/event-store.js';
import type { HistoryWatcher } from './history-watcher.js';
import type { MacroEvent } from '../services/types.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('MacroPoller');

// Event names we care about (maps to EVENT_MAPPINGS)
const TRACKED_EVENT_KEYWORDS = [
  'CPI', 'Core CPI', 'Nonfarm Payrolls', 'NFP', 'Unemployment',
  'FOMC', 'Federal Reserve', 'PCE', 'PPI', 'GDP', 'Retail Sales',
  'ISM', 'Jobless Claims',
];

function isMacroEventTracked(name: string): boolean {
  const lower = name.toLowerCase();
  return TRACKED_EVENT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

export class MacroPoller {
  private readonly client: SoSoValueClient;
  private readonly historyWatcher: HistoryWatcher;

  constructor(client: SoSoValueClient, historyWatcher: HistoryWatcher) {
    this.client = client;
    this.historyWatcher = historyWatcher;
  }

  /**
   * Poll the macro calendar and sync to DB.
   * Registers upcoming events with the HistoryWatcher.
   */
  async poll(): Promise<void> {
    try {
      const events = await this.client.getUpcomingEvents();
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

      let newCount = 0;
      let watchedCount = 0;

      for (const event of events) {
        if (!isMacroEventTracked(event.name)) continue;

        // Find existing or create
        const existing = EventStore.getByNameAndDate(event.name, event.date);
        if (!existing) {
          EventStore.upsert({
            id: uuidv4(),
            name: event.name,
            date: event.date,
            status: 'UPCOMING',
            forecast: event.forecast ?? null,
            actual: event.actual ?? null,
            previous: event.previous ?? null,
            surpriseScore: null,
            cryptoBias: null,
          });
          newCount++;
        }

        // Register events happening today/tomorrow with HistoryWatcher (Path B)
        if (event.date === today || event.date === tomorrow) {
          this.historyWatcher.registerEvent(event);
          watchedCount++;

          // Transition UPCOMING → WATCHING for today's events
          if (event.date === today && existing?.status === 'UPCOMING') {
            EventStore.updateStatus(existing.id, 'WATCHING');
          }
        }
      }

      logger.info(`Macro calendar synced`, {
        total: events.length,
        tracked: events.filter((e) => isMacroEventTracked(e.name)).length,
        new: newCount,
        watching: watchedCount,
      });

    } catch (err) {
      logger.error('Failed to poll macro calendar', { error: err });
    }
  }
}
