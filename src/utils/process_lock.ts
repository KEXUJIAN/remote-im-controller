/**
 * Remote IM Controller - 进程锁模块
 * 
 * 防止多实例并发启动，通过 PID 文件实现进程锁。
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs';
import { dirname } from 'path';
import { createLogger } from '../logger.js';

const logger = createLogger('process_lock');


/** 锁获取成功结果 */
export interface LockAcquired {
  acquired: true;
}

/** 锁获取失败结果 */
export interface LockFailed {
  acquired: false;
  message: string;
  pid: number;
}

/** 锁获取结果 */
export type LockResult = LockAcquired | LockFailed;


/**
 * 检查进程是否存活
 * @param pid 进程 ID
 * @returns 是否存活
 */
export function isProcessRunning(pid: number): boolean {
  if (pid === process.pid) {
    return true;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保锁文件所在目录存在
 * @param lockFile 锁文件路径
 */
function ensureLockDir(lockFile: string): void {
  const dir = dirname(lockFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 读取锁文件中的 PID
 * @param lockFile 锁文件路径
 * @returns PID 或 null
 */
function readLockPid(lockFile: string): number | null {
  if (!existsSync(lockFile)) {
    return null;
  }

  try {
    const content = readFileSync(lockFile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}


/**
 * 获取进程锁
 * 
 * 使用原子文件创建防止竞态条件：
 * - 如果锁文件不存在，创建并写入当前 PID
 * - 如果锁文件存在，检查持有者进程是否存活
 * - 如果持有者已死，清理锁文件并重新获取
 * - 如果持有者存活，返回失败
 * 
 * @param lockFile 锁文件路径
 * @returns 锁获取结果
 */
export function acquireLock(lockFile: string): LockResult {
  ensureLockDir(lockFile);

  let fd: number;
  try {
    fd = openSync(lockFile, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      const existingPid = readLockPid(lockFile);
      
      if (existingPid === null) {
        // 无法读取 PID，文件可能损坏，尝试清理
        try {
          unlinkSync(lockFile);
          return acquireLock(lockFile);
        } catch {
          return { acquired: false, message: '无法读取或清理锁文件', pid: 0 };
        }
      }

      if (isProcessRunning(existingPid)) {
        return {
          acquired: false,
          message: `Another instance is already running (PID: ${existingPid})`,
          pid: existingPid,
        };
      }

      try {
        unlinkSync(lockFile);
      } catch {
        // 清理失败，可能被其他进程抢占
        return { acquired: false, message: '无法清理过期锁文件', pid: existingPid };
      }

      return acquireLock(lockFile);
    }

    throw err;
  }

  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }

  return { acquired: true };
}

/**
 * 释放进程锁
 * 
 * 删除锁文件。如果文件不存在则静默处理。
 * 
 * @param lockFile 锁文件路径
 */
export function releaseLock(lockFile: string): void {
  try {
    if (existsSync(lockFile)) {
      unlinkSync(lockFile);
    }
  } catch (err) {
    logger.debug('releaseLock', '释放锁失败（忽略）', { error: String(err) });
  }
}