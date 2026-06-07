import cron from 'node-cron';
import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import type { SoSoValueClient } from '../services/sosovalue-client.js';
import { NewsScanner } from './news-scanner.js';
import { HistoryWatcher } from './history-watcher.js';
import { MacroPoller } from './macro-poller.js';

const logger = createLogger('CronManager');

export class CronManager {
  private tasks: cron.ScheduledTask[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];

  private readonly sosoClient: SoSoValueClient;
  private readonly newsScanner: NewsScanner;
  private readonly historyWatcher: HistoryWatcher;
  private readonly macroPoller: MacroPoller;

  constructor(sosoClient: SoSoValueClient) {
    this.sosoClient = sosoClient;
    this.newsScanner = new NewsScanner();
    this.historyWatcher = new HistoryWatcher(sosoClient);
    this.macroPoller = new MacroPoller(sosoClient, this.historyWatcher);
  }

  /** Start all polling intervals */
  start(): void {
    // ── News Scanner: every 30 seconds ────────────────────────────────────
    const newsTimer = setInterval(async () => {
      try {
        const news = await this.sosoClient.getLatestNews({ pageSize: 20 });
        const matches = this.newsScanner.scan(news);
        if (matches.length > 0) {
          await this.newsScanner.emitMatches(matches);
        }
      } catch (err) {
        logger.error('News scan error', { error: err });
      }
    }, config.polling.newsIntervalMs);
    this.timers.push(newsTimer);

    // ── History Watcher: every 60 seconds ─────────────────────────────────
    const historyTimer = setInterval(async () => {
      try {
        await this.historyWatcher.pollAll();
      } catch (err) {
        logger.error('History watcher error', { error: err });
      }
    }, config.polling.historyIntervalMs);
    this.timers.push(historyTimer);

    // ── Macro Calendar: every 5 minutes ───────────────────────────────────
    const calendarTimer = setInterval(async () => {
      try {
        await this.macroPoller.poll();
      } catch (err) {
        logger.error('Macro calendar poll error', { error: err });
      }
    }, config.polling.macroCalendarIntervalMs);
    this.timers.push(calendarTimer);

    // Initial runs immediately
    this.macroPoller.poll().catch((err) => logger.error('Initial macro poll failed', { error: err }));
    this.historyWatcher.pollAll().catch((err) => logger.error('Initial history poll failed', { error: err }));

    logger.info('CronManager started', {
      newsInterval: `${config.polling.newsIntervalMs / 1000}s`,
      historyInterval: `${config.polling.historyIntervalMs / 1000}s`,
      calendarInterval: `${config.polling.macroCalendarIntervalMs / 1000}s`,
    });
  }

  /** Stop all polling */
  stop(): void {
    this.timers.forEach(clearInterval);
    this.tasks.forEach((t) => t.stop());
    this.timers = [];
    this.tasks = [];
    logger.info('CronManager stopped');
  }

  getNewsScanner(): NewsScanner {
    return this.newsScanner;
  }

  getHistoryWatcher(): HistoryWatcher {
    return this.historyWatcher;
  }
}
