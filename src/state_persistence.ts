/**
 * Remote IM Controller - 状态持久化模块
 */

import { existsSync, writeFileSync, readFileSync, renameSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { createLogger } from './logger.js';
import { StatePersistenceError } from './errors.js';
import type { ChatState } from './types.js';

const logger = createLogger('state_persistence');

/** 持久化状态版本号 */
const STATE_VERSION = 1;

/** 会话状态（用于持久化） */
export interface SessionStateData {
  /** 文件读取偏移量 */
  offset: number;
  /** 行缓冲（不完整的行） */
  lineBuffer: string;
  /** 日志文件路径 */
  logPath: string;
}

/** 持久化状态结构 */
export interface PersistedState {
  /** 版本号，用于未来迁移 */
  version: number;
  /** 实例 ID，防止跨实例加载 */
  instanceId: string;
  /** 聊天状态映射 */
  chatStates: Record<string, ChatState>;
  /** 最后操作会话映射 */
  lastSessionMap: Record<string, string>;
  /** 会话输出状态映射 */
  sessionStates: Record<string, SessionStateData>;
  /** 保存时间戳 */
  savedAt: number;
}

/** 状态持久化器接口 */
export interface StatePersistence {
  /** 加载持久化状态 */
  load(): PersistedState | null;
  /** 保存状态（防抖） */
  scheduleSave(stateGetter: () => PersistedState): void;
  /** 强制刷新（关闭时调用） */
  forceFlush(): void;
}

/**
 * 创建状态持久化器
 * @param stateFile 状态文件路径
 * @param instanceId 实例 ID
 * @param debounceMs 防抖延迟（默认 500ms）
 */
export function createStatePersistence(
  stateFile: string,
  instanceId: string,
  debounceMs: number = 500
): StatePersistence {
  const absolutePath = resolve(stateFile);
  let saveTimer: NodeJS.Timeout | null = null;
  let pendingStateGetter: (() => PersistedState) | null = null;

  /**
   * 确保状态文件目录存在
   */
  function ensureDir(): void {
    const dir = dirname(absolutePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 原子写入文件
   * 使用 write-then-rename 模式确保原子性
   */
  function atomicWrite(data: string): void {
    ensureDir();
    const tempPath = `${absolutePath}.tmp`;
    writeFileSync(tempPath, data, 'utf8');
    renameSync(tempPath, absolutePath);
  }

  /**
   * 加载持久化状态
   */
  function load(): PersistedState | null {
    if (!existsSync(absolutePath)) {
      logger.debug('load', '状态文件不存在，跳过加载', { path: absolutePath });
      return null;
    }

    try {
      const content = readFileSync(absolutePath, 'utf8');
      const state = JSON.parse(content) as PersistedState;

      // 版本检查
      if (state.version !== STATE_VERSION) {
        logger.warn('load', '状态文件版本不匹配，跳过加载', {
          expected: STATE_VERSION,
          actual: state.version,
        });
        return null;
      }

      // 实例 ID 检查
      if (state.instanceId !== instanceId) {
        logger.warn('load', '实例 ID 不匹配，跳过加载（防止跨实例加载）', {
          expected: instanceId,
          actual: state.instanceId,
        });
        return null;
      }

      logger.info('load', '状态加载成功', {
        chatStates: Object.keys(state.chatStates).length,
        lastSessionMap: Object.keys(state.lastSessionMap).length,
        sessionStates: Object.keys(state.sessionStates).length,
        savedAt: new Date(state.savedAt).toISOString(),
      });

      return state;
    } catch (err) {
      logger.error('load', '状态文件加载失败', err, { path: absolutePath });
      throw new StatePersistenceError('load', `Failed to load state file: ${absolutePath}`, err);
    }
  }

  /**
   * 执行保存
   */
  function doSave(state: PersistedState): void {
    try {
      const content = JSON.stringify(state, null, 2);
      atomicWrite(content);
      logger.debug('doSave', '状态保存成功', {
        path: absolutePath,
        size: content.length,
        chatStates: Object.keys(state.chatStates).length,
      });
    } catch (err) {
      logger.error('doSave', '状态保存失败', err, { path: absolutePath });
      throw new StatePersistenceError('save', `Failed to save state file: ${absolutePath}`, err);
    }
  }

  /**
   * 调度保存（防抖）
   */
  function scheduleSave(stateGetter: () => PersistedState): void {
    pendingStateGetter = stateGetter;

    if (saveTimer) {
      // 已有定时器，等待触发
      return;
    }

    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (pendingStateGetter) {
        const state = pendingStateGetter();
        pendingStateGetter = null;
        doSave(state);
      }
    }, debounceMs);
  }

  /**
   * 强制刷新
   */
  function forceFlush(): void {
    // 取消待处理的定时器
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    // 如果有待保存的状态，立即保存
    if (pendingStateGetter) {
      const state = pendingStateGetter();
      pendingStateGetter = null;
      doSave(state);
      logger.info('forceFlush', '状态已强制刷新');
    }
  }

  return {
    load,
    scheduleSave,
    forceFlush,
  };
}
