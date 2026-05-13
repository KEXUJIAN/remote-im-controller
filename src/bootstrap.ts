/**
 * Remote IM Controller - 共享启动基础设施
 */

import { acquireLock, releaseLock } from './utils/process_lock.js';
import { createLogger } from './logger.js';
import type { TimeoutChecker } from './services/timeout_checker.js';
import type { Adapter } from './adapters/adapter.js';

const logger = createLogger('bootstrap');

/**
 * 获取进程锁，失败则直接退出
 * @param lockFile 锁文件路径
 */
export function acquireAppLock(lockFile: string): void {
  const lockResult = acquireLock(lockFile);
  if (!lockResult.acquired) {
    console.error(`Error: ${lockResult.message}`);
    process.exit(1);
  }
}

/** 创建关闭处理函数所需的依赖 */
export interface ShutdownDeps {
  /** 锁文件路径 */
  lockFile: string;
  /** 超时检查器 */
  timeoutChecker: TimeoutChecker;
  /** 适配器实例 */
  adapter: Adapter;
  /** 额外清理回调（如保存持久化状态） */
  extraCleanup?: () => void;
}

/**
 * 创建优雅关闭处理函数
 * @param deps 依赖对象
 * @returns 关闭处理函数，接收信号名称
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => void {
  let isShuttingDown = false;

  return (signal: string): void => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('shutdown', `收到信号: ${signal}，开始优雅退出`);

    deps.timeoutChecker.stop();

    // 额外清理（如持久化保存），失败不阻塞锁释放
    if (deps.extraCleanup) {
      try {
        deps.extraCleanup();
      } catch (err) {
        logger.warn('shutdown', '清理失败，继续释放锁', { error: err });
      }
    }

    releaseLock(deps.lockFile);

    deps.adapter.stop()
      .then(() => {
        logger.info('shutdown', '优雅退出完成');
        process.exit(0);
      })
      .catch((error) => {
        logger.error('shutdown', '退出时出错', error);
        process.exit(1);
      });
  };
}

/**
 * 注册系统信号处理函数
 * @param shutdown 关闭处理函数
 * @param includeUncaught 是否注册未捕获异常和未处理 Promise 拒绝（默认 true）
 */
export function registerSystemHandlers(shutdown: (signal: string) => void, includeUncaught = true): void {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  if (includeUncaught) {
    process.on('uncaughtException', (error) => {
      logger.error('uncaughtException', '未捕获异常', error);
      shutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('unhandledRejection', '未处理的 Promise 拒绝', reason);
      shutdown('unhandledRejection');
    });
  }
}
