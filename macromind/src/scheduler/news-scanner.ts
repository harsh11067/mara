import { createLogger } from '../utils/logger.js';
import { appEvents } from '../utils/event-emitter.js';

const logger = createLogger('NewsScanner');

// ── Macro event regex patterns ─────────────────────────────────────────────────
// Each pattern extracts the event name and optionally the actual value
// from a news headline.

interface PatternDef {
  event: string;
  // Matches the headline; capture group 1 = actual value (or special keyword)
  pattern: RegExp;
  // Extract actual from capture. Return null to signal "special" (e.g., FOMC hold)
  extract: (match: RegExpMatchArray) => number | 'hold' | null;
  // Must NOT match predictions/estimates
  negativePattern?: RegExp;
}

// Negative pattern: fire only when headline is clearly a PREDICTION (not a release).
// A prediction headline = analyst/economist as subject + expect/forecast/predict verb
// A release headline may mention "expected/forecast" as COMPARISON context ("vs 250K expected",
// "above 3.3% forecast") — those should NOT be blocked.
const PREDICTION_PATTERN = /(?:analysts?|economists?|markets?|consensus|survey)\s+(?:expect|fore?cast|predict|project|anticip)|(?:expect|fore?cast|predict)\w*\s+to\s+(?:come|be|print|show|report|hit|reach)/i;

const MACRO_PATTERNS: PatternDef[] = [
  // ── Core CPI (must come BEFORE generic CPI to avoid mis-classification) ──
  {
    event: 'Core CPI',
    pattern: /\bCore\s+CPI\b[^%\n]*?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },

  // ── CPI ──────────────────────────────────────────────────────────────────
  {
    event: 'CPI',
    // Matches: "CPI prints 3.1%", "CPI at 3.4%", "CPI comes in at 3.4%", "CPI 3.4%"
    // Also: "CPI rose 3.4%", "CPI fell 3.1%", "CPI below 3.3% forecast" (release headlines)
    pattern: /\bCPI\b[^%\n]*?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },
  {
    event: 'CPI',
    pattern: /\bConsumer\s+Price\s+Index\b[^%\n]*?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },

  // ── Nonfarm Payrolls ─────────────────────────────────────────────────────
  {
    event: 'NFP',
    // Matches: "Nonfarm Payrolls prints 275K", "Non-Farm Payrolls came in at 180K"
    // "Nonfarm Payrolls 275K vs 250K expected" — "expected" here is comparison, NOT prediction
    pattern: /\b(?:Nonfarm|Non-?Farm)\s+Payrolls?\b[^K\n]*?(\d[\d,]*)\s*[Kk]/i,
    extract: (m) => parseFloat(m[1].replace(/,/g, '')),
    negativePattern: PREDICTION_PATTERN,
  },
  {
    event: 'NFP',
    pattern: /\bNFP\b[^K\n]*?(\d[\d,]*)\s*[Kk]/i,
    extract: (m) => parseFloat(m[1].replace(/,/g, '')),
    negativePattern: PREDICTION_PATTERN,
  },
  {
    event: 'NFP',
    pattern: /\bJobs?\s+Report\b[^K\n]*?(?:adds?|added|created?|gained?)\s+(\d[\d,]*)\s*[Kk]/i,
    extract: (m) => parseFloat(m[1].replace(/,/g, '')),
  },

  // ── FOMC / Fed Rate ───────────────────────────────────────────────────────
  {
    event: 'FOMC',
    // Matches hike/cut/hold decisions from Fed/FOMC
    pattern: /\b(?:FOMC|Fed(?:eral\s+Reserve)?)\b.*?(?:(hikes?|raises?|lifts?|increases?|cuts?|lowers?|reduces?)\s+(?:interest\s+)?rates?|(holds?|keeps?|leaves?|maintains?|unchanged|on\s+hold)\s*(?:rates?|interest)?)/i,
    extract: (m) => {
      const full = m[0].toLowerCase();
      if (/cut|lower|reduc/.test(full)) return -1;
      if (/hike|raise|lift|increas/.test(full)) return 1;
      return 'hold';
    },
  },
  {
    event: 'FOMC',
    pattern: /\b(?:Fed|FOMC)\b.*?rate[s]?\s+(?:unchanged|steady|on\s+hold)/i,
    extract: () => 'hold',
  },
  {
    event: 'FOMC',
    pattern: /interest\s+rates?\s+(?:unchanged|held\s+steady|left\s+unchanged)/i,
    extract: () => 'hold',
  },

  // ── PCE ──────────────────────────────────────────────────────────────────
  {
    event: 'PCE',
    pattern: /\b(?:Core\s+)?PCE\b[^%\n]*?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },

  // ── Unemployment ─────────────────────────────────────────────────────────
  {
    event: 'Unemployment Rate',
    pattern: /\bUnemployment\s+(?:Rate\s+)?(?:falls?|drops?|rises?|climbs?|holds?|steady|at)\s+(?:to\s+)?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },

  // ── GDP ──────────────────────────────────────────────────────────────────
  {
    event: 'GDP',
    pattern: /\bGDP\b[^%\n]*?(?:grows?|grew|expanded?|contracted?|shrank?|fell?|climbed?|at|beats?|misses?)\s+(?:at\s+)?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },

  // ── PPI ──────────────────────────────────────────────────────────────────
  {
    event: 'PPI',
    pattern: /\bPPI\b[^%\n]*?(\d+\.?\d*)%/i,
    extract: (m) => parseFloat(m[1]),
    negativePattern: PREDICTION_PATTERN,
  },
];

export interface NewsEventMatch {
  event: string;
  extractedActual: number | 'hold' | null;
  headline: string;
  newsId: string;
  timestamp: number;
}

export class NewsScanner {
  private seenNewsIds = new Set<string>();

  /**
   * Scan a list of news headlines for macro event triggers.
   * Returns matched events (deduped by newsId).
   */
  scan(newsItems: Array<{ id: string; title: string; releaseTime?: number; publishTime?: number }>): NewsEventMatch[] {
    const matches: NewsEventMatch[] = [];

    for (const item of newsItems) {
      if (this.seenNewsIds.has(item.id)) continue;
      this.seenNewsIds.add(item.id);

      const match = this.matchHeadline(item.title);
      if (match) {
        const timestamp = item.releaseTime ?? item.publishTime ?? Date.now();
        logger.info(`📰 News match: ${match.event} from headline`, {
          headline: item.title.slice(0, 80),
          extracted: match.actual,
        });

        matches.push({
          event: match.event,
          extractedActual: match.actual,
          headline: item.title,
          newsId: item.id,
          timestamp,
        });
      }
    }

    return matches;
  }

  /**
   * Test a single headline against all patterns.
   * Returns { event, actual } on match, null otherwise.
   */
  matchHeadline(headline: string): { event: string; actual: number | 'hold' | null } | null {
    for (const def of MACRO_PATTERNS) {
      // Skip if negative pattern matches (prediction, not release)
      if (def.negativePattern && def.negativePattern.test(headline)) continue;

      const m = headline.match(def.pattern);
      if (m) {
        const actual = def.extract(m);
        return { event: def.event, actual };
      }
    }
    return null;
  }

  /** Emit detected events through the global event bus */
  async emitMatches(matches: NewsEventMatch[]): Promise<void> {
    for (const match of matches) {
      await appEvents.emit('EVENT_DETECTED_VIA_NEWS', {
        event: match.event,
        extractedActual: match.extractedActual,
        headline: match.headline,
        newsId: match.newsId,
        timestamp: match.timestamp,
      });
    }
  }

  /** Clear seen IDs (for testing) */
  reset(): void {
    this.seenNewsIds.clear();
  }
}
