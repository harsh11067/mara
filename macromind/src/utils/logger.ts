import { config } from '../config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function formatMessage(level: LogLevel, module: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const dataStr = data !== undefined ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}${dataStr}`;
}

export function createLogger(module: string) {
  const minLevel = LEVELS[config.logLevel as LogLevel] ?? LEVELS.info;

  return {
    debug: (msg: string, data?: unknown) => {
      if (minLevel <= LEVELS.debug) console.debug(formatMessage('debug', module, msg, data));
    },
    info: (msg: string, data?: unknown) => {
      if (minLevel <= LEVELS.info) console.info(formatMessage('info', module, msg, data));
    },
    warn: (msg: string, data?: unknown) => {
      if (minLevel <= LEVELS.warn) console.warn(formatMessage('warn', module, msg, data));
    },
    error: (msg: string, data?: unknown) => {
      if (minLevel <= LEVELS.error) console.error(formatMessage('error', module, msg, data));
    },
  };
}
