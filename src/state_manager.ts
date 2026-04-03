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

if (process.argv[2] === 'test') {
  console.log('=== StateManager 测试 ===\n');

  const manager = createStateManager();
  const testChatId = 'test-chat-001';

  // 1. 测试默认状态为 COMMAND 模式
  console.log('1. 测试默认状态...');
  const defaultState = manager.getState(testChatId);
  console.log(`   模式: ${defaultState.mode}`);
  console.log(`   activeSession: ${defaultState.activeSession}`);
  console.log(`   lastActivityTime: ${defaultState.lastActivityTime}`);
  if (defaultState.mode === 'COMMAND' && defaultState.activeSession === null) {
    console.log('   ✓ 默认状态正确\n');
  } else {
    console.log('   ✗ 默认状态错误\n');
    process.exit(1);
  }

  // 2. 测试状态切换到 SESSION 模式
  console.log('2. 测试切换到 SESSION 模式...');
  manager.transition(testChatId, { mode: 'SESSION', activeSession: 'my-session' });
  const sessionState = manager.getState(testChatId);
  console.log(`   模式: ${sessionState.mode}`);
  console.log(`   activeSession: ${sessionState.activeSession}`);
  if (sessionState.mode === 'SESSION' && sessionState.activeSession === 'my-session') {
    console.log('   ✓ 切换成功\n');
  } else {
    console.log('   ✗ 切换失败\n');
    process.exit(1);
  }

  // 3. 测试状态切换回 COMMAND 模式
  console.log('3. 测试切换回 COMMAND 模式...');
  manager.transition(testChatId, { mode: 'COMMAND', activeSession: null });
  const commandState = manager.getState(testChatId);
  console.log(`   模式: ${commandState.mode}`);
  console.log(`   activeSession: ${commandState.activeSession}`);
  if (commandState.mode === 'COMMAND' && commandState.activeSession === null) {
    console.log('   ✓ 切换成功\n');
  } else {
    console.log('   ✗ 切换失败\n');
    process.exit(1);
  }

  // 4. 测试 lastActivityTime 更新
  console.log('4. 测试 lastActivityTime 更新...');
  const beforeTime = manager.getState(testChatId).lastActivityTime;
  // 等待 10ms 确保时间有差异
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  wait(10).then(() => {
    manager.transition(testChatId, { mode: 'SESSION' });
    const afterTime = manager.getState(testChatId).lastActivityTime;
    console.log(`   之前时间: ${beforeTime}`);
    console.log(`   之后时间: ${afterTime}`);
    if (afterTime > beforeTime) {
      console.log('   ✓ lastActivityTime 已更新\n');
    } else {
      console.log('   ✗ lastActivityTime 未更新\n');
      process.exit(1);
    }

    // 5. 测试超时检查
    console.log('5. 测试超时检查...');
    // 未超时场景
    const notTimeout = manager.checkTimeout(testChatId, 60000); // 60 秒超时
    console.log(`   检查 60 秒超时（应该未超时）: ${notTimeout ? '超时' : '未超时'}`);
    if (!notTimeout) {
      console.log('   ✓ 超时检查正确\n');
    } else {
      console.log('   ✗ 超时检查错误\n');
      process.exit(1);
    }

    // 6. 测试 resetState
    console.log('6. 测试 resetState...');
    manager.transition(testChatId, { mode: 'SESSION', activeSession: 'test-session' });
    console.log(`   重置前模式: ${manager.getState(testChatId).mode}`);
    manager.resetState(testChatId);
    const resetState = manager.getState(testChatId);
    console.log(`   重置后模式: ${resetState.mode}`);
    console.log(`   重置后 activeSession: ${resetState.activeSession}`);
    if (resetState.mode === 'COMMAND' && resetState.activeSession === null) {
      console.log('   ✓ 重置成功\n');
    } else {
      console.log('   ✗ 重置失败\n');
      process.exit(1);
    }

    // 7. 测试不存在的 chatId
    console.log('7. 测试不存在的 chatId...');
    const newChatId = 'new-chat-002';
    const newState = manager.getState(newChatId);
    if (newState.mode === 'COMMAND' && newState.activeSession === null) {
      console.log('   ✓ 自动创建默认状态\n');
    } else {
      console.log('   ✗ 状态创建错误\n');
      process.exit(1);
    }

    // 8. 测试 renewActivity 方法
    console.log('8. 测试 renewActivity 方法...');
    const renewChatId = 'renew-chat-001';
    manager.transition(renewChatId, { mode: 'SESSION', activeSession: 'test-session' });
    const beforeRenewTime = manager.getState(renewChatId).lastActivityTime;
    wait(10).then(() => {
      manager.renewActivity(renewChatId);
      const afterRenewTime = manager.getState(renewChatId).lastActivityTime;
      const afterRenewState = manager.getState(renewChatId);
      console.log(`   续期前时间: ${beforeRenewTime}`);
      console.log(`   续期后时间: ${afterRenewTime}`);
      console.log(`   续期后模式: ${afterRenewState.mode}`);
      console.log(`   续期后会话: ${afterRenewState.activeSession}`);
      if (afterRenewTime > beforeRenewTime && afterRenewState.mode === 'SESSION' && afterRenewState.activeSession === 'test-session') {
        console.log('   ✓ renewActivity 成功更新时间，状态未改变\n');
      } else {
        console.log('   ✗ renewActivity 失败\n');
        process.exit(1);
      }

      // 9. 测试 renewActivity 对不存在的 chatId 无操作
      console.log('9. 测试 renewActivity 对不存在的 chatId...');
      manager.renewActivity('nonexistent-chat');
      console.log('   ✓ 无报错\n');

      // 10. 测试 setBusy 方法
      console.log('10. 测试 setBusy 方法...');
      const busyChatId = 'busy-chat-001';
      manager.setBusy(busyChatId, 'npm run build');
      const busyState = manager.getState(busyChatId);
      console.log(`   isBusy: ${busyState.isBusy}`);
      console.log(`   busyCommand: ${busyState.busyCommand}`);
      console.log(`   busySince: ${busyState.busySince}`);
      if (
        busyState.isBusy === true &&
        busyState.busyCommand === 'npm run build' &&
        busyState.busySince !== undefined &&
        busyState.mode === 'COMMAND' &&
        busyState.activeSession === null
      ) {
        console.log('   ✓ setBusy 正确设置忙碌状态\n');
      } else {
        console.log('   ✗ setBusy 失败\n');
        process.exit(1);
      }

      // 11. 测试 isBusy 方法
      console.log('11. 测试 isBusy 方法...');
      const isBusyResult = manager.isBusy(busyChatId);
      const isNotBusy = manager.isBusy('non-busy-chat');
      console.log(`   busyChatId isBusy: ${isBusyResult}`);
      console.log(`   non-busy-chat isBusy: ${isNotBusy}`);
      if (isBusyResult === true && isNotBusy === false) {
        console.log('   ✓ isBusy 返回正确\n');
      } else {
        console.log('   ✗ isBusy 返回错误\n');
        process.exit(1);
      }

      // 12. 测试 clearBusy 方法
      console.log('12. 测试 clearBusy 方法...');
      manager.clearBusy(busyChatId);
      const clearedState = manager.getState(busyChatId);
      console.log(`   isBusy: ${clearedState.isBusy}`);
      console.log(`   busyCommand: ${clearedState.busyCommand}`);
      console.log(`   busySince: ${clearedState.busySince}`);
      if (
        clearedState.isBusy === false &&
        clearedState.busyCommand === undefined &&
        clearedState.busySince === undefined
      ) {
        console.log('   ✓ clearBusy 正确清除忙碌状态\n');
      } else {
        console.log('   ✗ clearBusy 失败\n');
        process.exit(1);
      }

      // 13. 测试 clearBusy 对不存在的 chatId 无报错
      console.log('13. 测试 clearBusy 对不存在的 chatId...');
      manager.clearBusy('nonexistent-busy-chat');
      console.log('   ✓ 无报错\n');

      // 14. 测试忙碌状态不影响模式切换
      console.log('14. 测试忙碌状态不影响模式切换...');
      const modeChatId = 'mode-test-chat';
      manager.setBusy(modeChatId, 'long command');
      manager.transition(modeChatId, { mode: 'SESSION', activeSession: 'test-session' });
      const modeState = manager.getState(modeChatId);
      console.log(`   mode: ${modeState.mode}`);
      console.log(`   isBusy: ${modeState.isBusy}`);
      if (modeState.mode === 'SESSION' && modeState.isBusy === true) {
        console.log('   ✓ 忙碌状态与模式切换互不影响\n');
      } else {
        console.log('   ✗ 状态干扰\n');
        process.exit(1);
      }

      console.log('=== 所有测试完成 ===');
    });
  });
}
