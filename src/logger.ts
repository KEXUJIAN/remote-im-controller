/**
 * Remote IM Controller - 日志模块
 */

import type { LogLevel, LogEntry } from './types.js';

/** 日志级别优先级映射 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 获取当前配置的日志级别 */
function getConfiguredLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel;
  }
  return 'info';
}

/** 判断是否应该输出该级别的日志 */
function shouldLog(level: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configuredLevel];
}

/** 输出日志到 stdout */
function output(entry: LogEntry): void {
  const json = JSON.stringify(entry);
  process.stdout.write(json + '\n');
}

function normalizeError(err: unknown): { name: string; message: string; stack: string } | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack || '' };
  }
  const message = typeof err === 'string' ? err : JSON.stringify(err);
  return { name: 'Error', message, stack: '' };
}

export interface Logger {
  debug(action: string, message: string, context?: Record<string, unknown>): void;
  info(action: string, message: string, context?: Record<string, unknown>): void;
  warn(action: string, message: string, context?: Record<string, unknown>): void;
  error(action: string, message: string, error?: unknown, context?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
  const configuredLevel = getConfiguredLevel();

  const log = (level: LogLevel, action: string, message: string, context?: Record<string, unknown>, normalizedError?: { name: string; message: string; stack: string }): void => {
    if (!shouldLog(level, configuredLevel)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      action,
      message,
    };

    if (normalizedError) {
      entry.error = normalizedError;
    }

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    output(entry);
  };

  return {
    debug(action: string, message: string, context?: Record<string, unknown>): void {
      log('debug', action, message, context);
    },

    info(action: string, message: string, context?: Record<string, unknown>): void {
      log('info', action, message, context);
    },

    warn(action: string, message: string, context?: Record<string, unknown>): void {
      log('warn', action, message, context);
    },

    error(action: string, message: string, error?: unknown, context?: Record<string, unknown>): void {
      log('error', action, message, context, normalizeError(error));
    },
  };
}
