/**
 * Remote IM Controller - 状态机模块
 */

import { createLogger } from './logger.js';
import type { ChatState } from './types.js';

const logger = createLogger('state_manager');

/** 默认状态 */
const DEFAULT_STATE: ChatState = {
  mode: 'COMMAND',
  activeSession: null,
  lastActivityTime: Date.now(),
  isBusy: false,
};

/** 状态管理器接口 */
export interface StateManager {
  /** 获取聊天状态（不存在则创建默认状态） */
  getState(chatId: string): ChatState;
  /** 切换状态并更新最后活动时间 */
  transition(chatId: string, newState: Partial<ChatState>): void;
  /** 续期：仅更新最后活动时间 */
  renewActivity(chatId: string): void;
  /** 检查是否超时 */
  checkTimeout(chatId: string, timeoutMs: number): boolean;
  /** 重置状态为 COMMAND 模式 */
  resetState(chatId: string): void;
  /** 获取所有状态的 chatId 迭代器 */
  getAllStates(): IterableIterator<string>;
  /** 设置忙碌状态 */
  setBusy(chatId: string, command: string): void;
  /** 清除忙碌状态 */
  clearBusy(chatId: string): void;
  /** 检查是否忙碌 */
  isBusy(chatId: string): boolean;
}

/**
 * 创建状态管理器
 */
export function createStateManager(): StateManager {
  /** 状态存储 */
  const states = new Map<string, ChatState>();

  return {
    getState(chatId: string): ChatState {
      let state = states.get(chatId);
      if (!state) {
        state = { ...DEFAULT_STATE, lastActivityTime: Date.now() };
        states.set(chatId, state);
        logger.debug('getState', `创建新状态: ${chatId}`, { state });
      }
      return state;
    },

    transition(chatId: string, newState: Partial<ChatState>): void {
      const current = this.getState(chatId);
      const updated: ChatState = {
        ...current,
        ...newState,
        lastActivityTime: Date.now(),
      };
      states.set(chatId, updated);
      logger.info('transition', `状态切换: ${chatId}`, {
        from: current.mode,
        to: updated.mode,
        activeSession: updated.activeSession,
      });
    },

    renewActivity(chatId: string): void {
      const state = states.get(chatId);
      if (state) {
        states.set(chatId, { ...state, lastActivityTime: Date.now() });
        logger.debug('renewActivity', `续期: ${chatId}`);
      }
    },

    checkTimeout(chatId: string, timeoutMs: number): boolean {
      const state = states.get(chatId);
      if (!state) {
        return false;
      }
      const elapsed = Date.now() - state.lastActivityTime;
      const isTimeout = elapsed > timeoutMs;
      if (isTimeout) {
        logger.debug('checkTimeout', `状态超时: ${chatId}`, {
          elapsed,
          timeoutMs,
        });
      }
      return isTimeout;
    },

    resetState(chatId: string): void {
      const newState: ChatState = {
        ...DEFAULT_STATE,
        lastActivityTime: Date.now(),
      };
      states.set(chatId, newState);
      logger.info('resetState', `状态重置: ${chatId}`);
    },

    getAllStates(): IterableIterator<string> {
      return states.keys();
    },

    setBusy(chatId: string, command: string): void {
      const state = this.getState(chatId);
      const updated: ChatState = {
        ...state,
        isBusy: true,
        busyCommand: command,
        busySince: Date.now(),
      };
      states.set(chatId, updated);
      logger.info('setBusy', `设置忙碌状态: ${chatId}`, { command });
    },

    clearBusy(chatId: string): void {
      const state = states.get(chatId);
      if (state) {
        const updated: ChatState = {
          ...state,
          isBusy: false,
        };
        delete updated.busyCommand;
        delete updated.busySince;
        states.set(chatId, updated);
        logger.info('clearBusy', `清除忙碌状态: ${chatId}`);
      }
    },

    isBusy(chatId: string): boolean {
      return this.getState(chatId).isBusy;
    },
  };
}
