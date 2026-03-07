/**
 * Structured Logger
 *
 * OpenPilot-aligned logging with:
 *   - Structured JSON output (production)
 *   - Human-readable output (development)
 *   - Sensitive data masking
 *   - Log levels: error, warn, info, debug
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-[A-Za-z0-9]{20,}/g, replacement: 'sk-[MASKED]' },
  { pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g, replacement: 'sk-ant-[MASKED]' },
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer [MASKED]' },
  { pattern: /(api[_-]?key["']?\s*[:=]\s*["']?)[A-Za-z0-9\-._]{10,}/gi, replacement: '$1[MASKED]' },
];

function maskSensitive(text: string): string {
  let masked = text;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  module?: string;
  [key: string]: any;
}

export class Logger {
  private module: string;
  private level: LogLevel;
  private jsonMode: boolean;

  constructor(module: string, level: LogLevel = 'info', jsonMode = false) {
    this.module = module;
    this.level = level;
    this.jsonMode = jsonMode;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.level];
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, any>): void {
    if (!this.shouldLog(level)) return;

    const masked = maskSensitive(message);
    const timestamp = new Date().toISOString();

    if (this.jsonMode) {
      const entry: LogEntry = { level, message: masked, timestamp, module: this.module, ...meta };
      const line = JSON.stringify(entry);
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    } else {
      const prefix = `[${timestamp}] [${this.module}]`;
      const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
      const line = `${prefix} ${level.toUpperCase()}: ${masked}${metaStr}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    }
  }

  error(message: string, meta?: Record<string, any>): void { this.emit('error', message, meta); }
  warn(message: string, meta?: Record<string, any>): void { this.emit('warn', message, meta); }
  info(message: string, meta?: Record<string, any>): void { this.emit('info', message, meta); }
  debug(message: string, meta?: Record<string, any>): void { this.emit('debug', message, meta); }

  child(module: string): Logger {
    return new Logger(`${this.module}:${module}`, this.level, this.jsonMode);
  }
}

/** Global logger factory */
let globalLevel: LogLevel = 'info';
let globalJsonMode = false;

export function configureLogging(level: LogLevel, jsonMode = false): void {
  globalLevel = level;
  globalJsonMode = jsonMode;
}

export function createLogger(module: string): Logger {
  return new Logger(module, globalLevel, globalJsonMode);
}
