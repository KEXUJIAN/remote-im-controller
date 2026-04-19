/**
 * Remote IM Controller - CoreProcessor 模块测试
 */

import { createCoreProcessor } from '../src/core_processor.js';
import { createTestConfig } from './test_utils.js';
import type { StateManager } from '../src/state_manager.js';
import type { CommandRouter } from '../src/command_router.js';
import type { TmuxManager } from '../src/tmux_manager.js';
import type { ChatState } from '../src/types.js';
import type { StreamingOptions } from '../src/session_output_manager.js';

async function main() {
  console.log('=== CoreProcessor 测试 ===\n');

  interface SentMessage { chatId: string; message: string; messageId?: string }
  interface SentUserMessage { userId: string; message: string }

  // 创建模拟依赖
  const mockStateMap = new Map<string, ChatState>();

  const mockStateManager: StateManager = {
    getState(userId: string) {
      let state = mockStateMap.get(userId);
      if (!state) {
        state = { mode: 'COMMAND', activeSession: null, lastActivityTime: Date.now(), isBusy: false };
        mockStateMap.set(userId, state);
      }
      return state;
    },
    transition(userId: string, newState: Partial<ChatState>) {
      const current = this.getState(userId);
      const updated = { ...current, ...newState, lastActivityTime: Date.now() };
      mockStateMap.set(userId, updated);
    },
    renewActivity(userId: string) {
      const state = mockStateMap.get(userId);
      if (state) {
        mockStateMap.set(userId, { ...state, lastActivityTime: Date.now() });
      }
    },
    checkTimeout(_userId: string, _timeoutMs: number) {
      return false;
    },
    resetState(userId: string) {
      mockStateMap.set(userId, { mode: 'COMMAND', activeSession: null, lastActivityTime: Date.now(), isBusy: false });
    },
    getAllStates() {
      return mockStateMap.keys();
    },
    setBusy(userId: string, command: string) {
      const state = this.getState(userId);
      mockStateMap.set(userId, { ...state, isBusy: true, busyCommand: command, busySince: Date.now() });
    },
    clearBusy(userId: string) {
      const state = mockStateMap.get(userId);
      if (state) {
        const updated = { ...state, isBusy: false };
        delete updated.busyCommand;
        delete updated.busySince;
        mockStateMap.set(userId, updated);
      }
    },
    isBusy(userId: string) {
      return this.getState(userId).isBusy;
    },
  };

  const sentMessages: SentMessage[] = [];
  const sentUserMessages: SentUserMessage[] = [];

  const mockCommandRouter: CommandRouter = {
    async route(ctx) {
      if (ctx.parsed.action === 'help') {
        return { success: true, message: '帮助信息' };
      }
      if (ctx.parsed.action === 'list') {
        return { success: true, message: '会话列表: test-session' };
      }
      return { success: false, message: `未知动作: ${ctx.parsed.action}` };
    },
  };

  const mockTmuxManager: TmuxManager = {
    async checkAvailable() {},
    async createSession() {},
    async killSession() {},
    async listSessions() { return ['test-session']; },
    async sendCommand() {},
    async captureScreen() { return { raw: 'test output', cleaned: 'test output', lines: 1, hash: 'abc123' }; },
    async sessionExists(name: string) { return name === 'test-session'; },
    async getPaneCommand() { return 'zsh'; },
    getPipeLogPath() { return undefined; },
    getOutputManager() { 
      return {
        initOffset: () => {},
        resetOffset: () => 0,
        readNewOutput: () => ({ content: 'test output', markerFound: false, markerPosition: 0 }),
        clearOffset: () => {},
        hasOffset: () => false,
        startStreaming: (_sessionName: string, options: StreamingOptions) => {
          options.onChunk('test output').then(() => {
            setTimeout(() => {
              options.onComplete?.();
            }, 10);
          });
        },
        stopStreaming: () => {},
        isStreaming: () => false,
      };
    },
  };

  const mockConfig = createTestConfig({
    logLevel: 'debug',
    logDir: './logs',
    streamLogDir: './logs/stream/',
  });

  const processor = createCoreProcessor({
    stateManager: mockStateManager,
    commandRouter: mockCommandRouter,
    tmuxManager: mockTmuxManager,
    config: mockConfig,
    sendMessage: async (chatId, message) => {
      sentMessages.push({ chatId, message });
      return `msg-${sentMessages.length}`;
    },
    updateMessage: async (chatId, messageId, message) => {
      const idx = sentMessages.findIndex(m => m.chatId === chatId && m.messageId === messageId);
      if (idx >= 0) {
        sentMessages[idx] = { chatId, message, messageId };
      } else {
        sentMessages.push({ chatId, message, messageId });
      }
    },
    sendToUser: async (userId, message) => {
      sentUserMessages.push({ userId, message });
    },
  });

  function getLastMessage(): SentMessage | undefined {
    return sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : undefined;
  }

  function getLastUserMessage(): SentUserMessage | undefined {
    return sentUserMessages.length > 0 ? sentUserMessages[sentUserMessages.length - 1] : undefined;
  }

  const testUserId = 'test-user-001';
  const testChatId = 'test-chat-001';

  // 测试 1: TEXT 消息在 COMMAND 模式下调用指令路由器
  console.log('1. 测试 TEXT 消息在 COMMAND 模式下调用指令路由器...');
  sentMessages.length = 0;
  await processor.process({
    type: 'TEXT',
    userId: testUserId,
    chatId: testChatId,
    payload: { text: 'help' },
    timestamp: Date.now(),
  });
  const msg1 = getLastMessage();
  if (msg1 && msg1.message === '帮助信息') {
    console.log('   ✓ 正确调用指令路由器\n');
  } else {
    console.log('   ✗ 失败\n');
    process.exit(1);
  }

  // 测试 2: CARD_EVENT (enter) 切换状态
  console.log('2. 测试 CARD_EVENT (enter) 切换状态...');
  sentMessages.length = 0;
  await processor.process({
    type: 'CARD_EVENT',
    userId: testUserId,
    chatId: testChatId,
    payload: { action: 'enter', sessionName: 'test-session' },
    timestamp: Date.now(),
  });
  const stateAfterEnter = mockStateManager.getState(testUserId);
  if (stateAfterEnter.mode === 'SESSION' && stateAfterEnter.activeSession === 'test-session') {
    console.log('   ✓ 状态切换成功\n');
  } else {
    console.log('   ✗ 状态切换失败\n');
    process.exit(1);
  }

  // 测试 3: TEXT 消息在 SESSION 模式下透传到 tmux
  console.log('3. 测试 TEXT 消息在 SESSION 模式下透传到 tmux...');
  sentMessages.length = 0;
  await processor.process({
    type: 'TEXT',
    userId: testUserId,
    chatId: testChatId,
    payload: { text: 'ls -la' },
    timestamp: Date.now(),
  });
  const msg3 = getLastMessage();
  if (msg3 && msg3.message.includes('test output') && msg3.message.includes('✅ 命令执行完成')) {
    console.log('   ✓ 透传成功\n');
  } else {
    console.log('   ✗ 透传失败，收到:', msg3?.message);
    process.exit(1);
  }

  // 测试 4: CARD_EVENT 在 SESSION 模式下拒绝进入
  console.log('4. 测试 CARD_EVENT 在 SESSION 模式下拒绝进入...');
  sentMessages.length = 0;
  await processor.process({
    type: 'CARD_EVENT',
    userId: testUserId,
    chatId: testChatId,
    payload: { action: 'enter', sessionName: 'another-session' },
    timestamp: Date.now(),
  });
  const msg4 = getLastMessage();
  if (msg4 && msg4.message.includes('当前已在会话模式')) {
    console.log('   ✓ 正确拒绝\n');
  } else {
    console.log('   ✗ 未拒绝\n');
    process.exit(1);
  }

  // 测试 5: MENU_EVENT 退出会话模式
  console.log('5. 测试 MENU_EVENT 退出会话模式...');
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  await processor.process({
    type: 'MENU_EVENT',
    userId: testUserId,
    chatId: testChatId,
    payload: { eventKey: 'exit_wsl_session_mode' },
    timestamp: Date.now(),
  });
  const stateAfterExit = mockStateManager.getState(testUserId);
  const msg5 = getLastUserMessage();
  if (stateAfterExit.mode === 'COMMAND' && msg5 && msg5.message.includes('已退出会话模式')) {
    console.log('   ✓ 退出成功\n');
  } else {
    console.log('   ✗ 退出失败\n');
    process.exit(1);
  }

  // 测试 5.5: MENU_EVENT 忽略非 exit_wsl_session_mode 事件
  console.log('5.5. 测试 MENU_EVENT 忽略非 exit_wsl_session_mode 事件...');
  mockStateMap.set(testUserId, {
    mode: 'SESSION',
    activeSession: 'test-session',
    lastActivityTime: Date.now(),
    isBusy: false,
  });
  sentMessages.length = 0;
  sentUserMessages.length = 0;
  await processor.process({
    type: 'MENU_EVENT',
    userId: testUserId,
    chatId: testChatId,
    payload: { eventKey: 'other_menu_item' },
    timestamp: Date.now(),
  });
  const stateAfterOther = mockStateManager.getState(testUserId);
  const msg55 = getLastUserMessage();
  if (stateAfterOther.mode === 'SESSION' && stateAfterOther.activeSession === 'test-session' && !msg55) {
    console.log('   ✓ 正确忽略非退出菜单事件\n');
  } else {
    console.log('   ✗ 应忽略但未忽略\n');
    process.exit(1);
  }
  // 重置状态以便后续测试
  mockStateManager.resetState(testUserId);

  // 测试 5.6: 非 SESSION 模式下点击退出菜单返回提示
  console.log('5.6. 测试非 SESSION 模式下点击退出菜单返回提示...');
  // 用户当前在 COMMAND 模式（状态已被 resetState 重置）
  sentUserMessages.length = 0;
  await processor.process({
    type: 'MENU_EVENT',
    userId: testUserId,
    chatId: testChatId,
    payload: { eventKey: 'exit_wsl_session_mode' },
    timestamp: Date.now(),
  });
  const stateAfterExitInCommand = mockStateManager.getState(testUserId);
  const msg56 = getLastUserMessage();
  if (stateAfterExitInCommand.mode === 'COMMAND' && msg56 && msg56.message === '⚠️ 当前不在会话模式') {
    console.log('   ✓ 正确返回提示\n');
  } else {
    console.log('   ✗ 提示消息错误\n');
    process.exit(1);
  }

  // 测试 6: CARD_EVENT (kill) 终止会话
  console.log('6. 测试 CARD_EVENT (kill) 终止会话...');
  sentMessages.length = 0;
  await processor.process({
    type: 'CARD_EVENT',
    userId: testUserId,
    chatId: testChatId,
    payload: { action: 'kill', sessionName: 'test-session' },
    timestamp: Date.now(),
  });
  const msg6 = getLastMessage();
  if (msg6 && msg6.message.includes('已终止')) {
    console.log('   ✓ 终止成功\n');
  } else {
    console.log('   ✗ 终止失败\n');
    process.exit(1);
  }

  // 测试 7: 超时检查逻辑
  console.log('7. 测试超时检查逻辑...');
  // 手动设置超时状态
  mockStateMap.set(testUserId, {
    mode: 'SESSION',
    activeSession: 'test-session',
    lastActivityTime: Date.now() - (31 * 60 * 1000), // 31 分钟前
    isBusy: false,
  });
  // 重写 checkTimeout 返回 true
  mockStateManager.checkTimeout = () => true;
  sentMessages.length = 0;
  await processor.process({
    type: 'TEXT',
    userId: testUserId,
    chatId: testChatId,
    payload: { text: 'ls' },
    timestamp: Date.now(),
  });
  const msg7 = getLastMessage();
  if (msg7 && msg7.message.includes('已退出会话模式') && msg7.message.includes('未活动')) {
    console.log('   ✓ 超时检查正确\n');
  } else {
    console.log('   ✗ 超时检查失败\n');
    process.exit(1);
  }

  // 测试 8: 会话不存在时退出 SESSION 模式
  console.log('8. 测试会话不存在时退出 SESSION 模式...');
  mockStateManager.checkTimeout = () => false;
  mockStateMap.set(testUserId, {
    mode: 'SESSION',
    activeSession: 'nonexistent-session',
    lastActivityTime: Date.now(),
    isBusy: false,
  });
  sentMessages.length = 0;
  await processor.process({
    type: 'TEXT',
    userId: testUserId,
    chatId: testChatId,
    payload: { text: 'ls' },
    timestamp: Date.now(),
  });
  const stateAfterNonexistent = mockStateManager.getState(testUserId);
  const msg8 = getLastMessage();
  if (stateAfterNonexistent.mode === 'COMMAND' && msg8 && msg8.message.includes('已不存在')) {
    console.log('   ✓ 自动退出成功\n');
  } else {
    console.log('   ✗ 自动退出失败\n');
    process.exit(1);
  }

  console.log('=== 所有测试完成 ===');
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
