import chalk from 'chalk';
import type { LogLevel } from '../../config/types.js';

export interface LoggerOptions {
  level: LogLevel;
  colors: boolean;
  includeTimestamp: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export class Logger {
  private options: LoggerOptions;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = {
      level: options.level ?? 'info',
      colors: options.colors ?? true,
      includeTimestamp: options.includeTimestamp ?? false,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.options.level];
  }

  private formatTimestamp(): string {
    if (!this.options.includeTimestamp) return '';
    const now = new Date();
    return `[${now.toISOString()}] `;
  }

  private colorize(text: string, color: (text: string) => string): string {
    return this.options.colors ? color(text) : text;
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    const prefix = this.colorize('[DEBUG]', chalk.gray);
    console.log(`${this.formatTimestamp()}${prefix} ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    const prefix = this.colorize('[INFO]', chalk.blue);
    console.log(`${this.formatTimestamp()}${prefix} ${message}`, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    const prefix = this.colorize('✓', chalk.green);
    console.log(`${this.formatTimestamp()}${prefix} ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    const prefix = this.colorize('⚠', chalk.yellow);
    console.log(`${this.formatTimestamp()}${prefix} ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return;
    const prefix = this.colorize('✗', chalk.red);
    console.error(`${this.formatTimestamp()}${prefix} ${message}`, ...args);
  }

  agent(agentName: string, message: string): void {
    if (!this.shouldLog('info')) return;
    const agentLabel = this.colorize(`[${agentName}]`, chalk.cyan);
    console.log(`${this.formatTimestamp()}${agentLabel} ${message}`);
  }

  task(taskId: string, message: string): void {
    if (!this.shouldLog('info')) return;
    const taskLabel = this.colorize(`[Task ${taskId}]`, chalk.magenta);
    console.log(`${this.formatTimestamp()}${taskLabel} ${message}`);
  }

  handoff(from: string, to: string, reason: string): void {
    if (!this.shouldLog('info')) return;
    const arrow = this.colorize('→', chalk.yellow);
    const fromLabel = this.colorize(from, chalk.cyan);
    const toLabel = this.colorize(to, chalk.green);
    console.log(`${this.formatTimestamp()}${fromLabel} ${arrow} ${toLabel}: ${reason}`);
  }

  divider(): void {
    if (!this.shouldLog('info')) return;
    console.log(this.colorize('─'.repeat(50), chalk.gray));
  }

  blank(): void {
    if (!this.shouldLog('info')) return;
    console.log();
  }

  json(data: unknown): void {
    if (!this.shouldLog('info')) return;
    console.log(JSON.stringify(data, null, 2));
  }

  setLevel(level: LogLevel): void {
    this.options.level = level;
  }

  setColors(enabled: boolean): void {
    this.options.colors = enabled;
  }
}

export const logger = new Logger();
