/**
 * Remote IM Controller - 杂项工具函数
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';

// ==================== 错误处理 ====================

/**
 * 将 unknown 类型的错误转换为 Error 实例
 */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 获取错误消息字符串
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ==================== 敏感信息脱敏 ====================

/**
 * 脱敏敏感字段，保留前缀和后缀
 */
export function maskSensitive(value: string, prefix: number = 4): string {
  if (value.length <= prefix * 2) {
    return `${value.slice(0, prefix)}****`;
  }
  return `${value.slice(0, prefix)}****${value.slice(-prefix)}`;
}

// ==================== 日志目录 ====================

/**
 * 确保日志目录存在，并设置 TMUX_TMPDIR 环境变量
 */
export function ensureLogDir(): string {
  const logDir = resolve(process.env.LOG_DIR || './logs');
  const tmuxTmpDir = resolve(process.env.TMUX_TMPDIR || logDir);
  process.env.TMUX_TMPDIR = tmuxTmpDir;
  mkdirSync(tmuxTmpDir, { recursive: true });
  return tmuxTmpDir;
}
