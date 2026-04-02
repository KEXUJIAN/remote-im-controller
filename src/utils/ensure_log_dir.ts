/**
 * 确保日志目录存在
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * 确保日志目录存在，并设置 TMUX_TMPDIR 环境变量
 * @returns 日志目录的绝对路径
 */
export function ensureLogDir(): string {
  const logDir = resolve(process.env.LOG_DIR || './logs');
  const tmuxTmpDir = resolve(process.env.TMUX_TMPDIR || logDir);
  process.env.TMUX_TMPDIR = tmuxTmpDir;
  mkdirSync(tmuxTmpDir, { recursive: true });
  return tmuxTmpDir;
}
