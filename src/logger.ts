/**
 * Remote IM Controller - 日志模块
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import type { LogLevel, LogEntry } from './types.js';
import { toErrorMessage } from './utils/misc.js';

/** 日志级别优先级映射 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 文件日志配置 */
export interface FileLogConfig {
  /** 日志文件路径 */
  path: string;
  /** 是否同时输出到控制台 */
  console: boolean;
}

/** 全局文件日志配置 */
let fileConfig: FileLogConfig | null = null;

/**
 * 设置文件日志输出
 * @param config 文件日志配置
 */
export function setupFileLogging(config: FileLogConfig): void {
  const logDir = dirname(config.path);
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  fileConfig = config;
}

/**
 * 获取日志文件路径（用于 CLI 和 dev 模式）
 * @param mode 模式名称 (cli, dev)
 * @param logDir 日志目录
 */
export function getLogFilePath(mode: string, logDir: string): string {
  return resolve(logDir, `${mode}.log`);
}

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

/** 输出日志 */
function output(entry: LogEntry): void {
  const json = JSON.stringify(entry) + '\n';

  if (fileConfig) {
    try {
      appendFileSync(fileConfig.path, json, 'utf-8');
    } catch (err) {
      // 文件写入失败（磁盘满、权限不足等），降级到控制台输出
      const errorMsg = toErrorMessage(err);
      process.stderr.write(`[WARN] 日志文件写入失败: ${errorMsg}\n`);
    }
  }

  if (!fileConfig || fileConfig.console) {
    process.stdout.write(json);
  }
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
