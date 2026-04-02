/**
 * Remote IM Controller - 会话超时检查服务
 */

import { createLogger } from '../logger.js';
import type { StateManager } from '../state_manager.js';

const logger = createLogger('timeout_checker');

/** 默认超时检查间隔（毫秒） */
const DEFAULT_CHECK_INTERVAL_MS = 10 * 1000;

/** 超时通知回调 */
export type TimeoutCallback = (userId: string, sessionName: string) => void | Promise<void>;

/** 超时检查器接口 */
export interface TimeoutChecker {
  /** 启动超时检查 */
  start(): void;
  /** 停止超时检查 */
  stop(): void;
}

/**
 * 创建超时检查器
 * @param stateManager 状态管理器
 * @param sessionTimeoutMs 会话超时时间（毫秒）
 * @param onTimeout 超时通知回调
 * @param checkIntervalMs 检查间隔（毫秒），默认 10 秒
 */
export function createTimeoutChecker(
  stateManager: StateManager,
  sessionTimeoutMs: number,
  onTimeout: TimeoutCallback,
  checkIntervalMs: number = DEFAULT_CHECK_INTERVAL_MS
): TimeoutChecker {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  return {
    start(): void {
      if (intervalId) {
        logger.warn('start', '超时检查器已在运行');
        return;
      }

      intervalId = setInterval(() => {
        for (const userId of stateManager.getAllStates()) {
          const state = stateManager.getState(userId);
          if (state.mode !== 'SESSION') {
            continue;
          }
          if (stateManager.checkTimeout(userId, sessionTimeoutMs)) {
            const sessionName = state.activeSession;
            stateManager.resetState(userId);
            logger.info('timeout', 'SESSION 模式超时退出', { userId, sessionName });
            // 异步调用回调，避免阻塞定时器
            Promise.resolve(onTimeout(userId, sessionName ?? '')).catch((error) => {
              logger.error('timeout', '发送超时通知失败', error, { userId });
            });
          }
        }
      }, checkIntervalMs);

      logger.info('start', '超时检查器已启动', {
        sessionTimeoutMs,
        checkIntervalMs,
      });
    },

    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info('stop', '超时检查器已停止');
      }
    },
  };
}
