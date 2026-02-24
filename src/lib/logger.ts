enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogConfig {
  level: LogLevel;
  enableTimestamp: boolean;
  enableModule: boolean;
  enableColor: boolean;
}

class Logger {
  private config: LogConfig;
  private module: string;

  constructor(module: string, config?: Partial<LogConfig>) {
    this.module = module;
    this.config = {
      level: this.getLogLevelFromEnv(),
      enableTimestamp: true,
      enableModule: true,
      enableColor: true,
      ...config,
    };
  }

  private getLogLevelFromEnv(): LogLevel {
    const env = import.meta.env.VITE_LOG_LEVEL || 'INFO';
    return LogLevel[env as keyof typeof LogLevel] || LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = this.config.enableTimestamp
      ? `[${new Date().toISOString()}] `
      : '';
    const module = this.config.enableModule ? `[${this.module}] ` : '';
    const levelStr = LogLevel[level];
    return `${timestamp}${module}[${levelStr}] ${message}`;
  }

  private colorize(level: LogLevel, message: string): string {
    if (!this.config.enableColor) return message;

    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m',     // Cyan
      [LogLevel.INFO]: '\x1b[32m',      // Green
      [LogLevel.WARN]: '\x1b[33m',      // Yellow
      [LogLevel.ERROR]: '\x1b[31m',     // Red
    };
    const reset = '\x1b[0m';

    return `${colors[level]}${message}${reset}`;
  }

  debug(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      const formatted = this.format(LogLevel.DEBUG, message);
      console.debug(this.colorize(LogLevel.DEBUG, formatted), ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.INFO)) {
      const formatted = this.format(LogLevel.INFO, message);
      console.info(this.colorize(LogLevel.INFO, formatted), ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.WARN)) {
      const formatted = this.format(LogLevel.WARN, message);
      console.warn(this.colorize(LogLevel.WARN, formatted), ...args);
    }
  }

  error(message: string, ...args: any[]) {
    if (this.shouldLog(LogLevel.ERROR)) {
      const formatted = this.format(LogLevel.ERROR, message);
      console.error(this.colorize(LogLevel.ERROR, formatted), ...args);
    }
  }
}

export const createLogger = (module: string) => new Logger(module);
