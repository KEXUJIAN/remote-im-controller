/**
 * Remote IM Controller - 核心处理器
 */

import { createLogger } from './logger.js';
import type {
  UnifiedMessage,
  CardEventPayload,
  MenuEventPayload,
  Config,
  CommandContext,
} from './types.js';
import type { StateManager } from './state_manager.js';
import type { CommandRouter } from './command_router.js';
import type { TmuxManager } from './tmux_manager.js';
import type { CoreProcessor } from './adapters/adapter.js';
import { parseCommand } from './command_parser.js';

const logger = createLogger('core_processor');

/** 超时时间：30 分钟 */
const TIMEOUT_MS = 30 * 60 * 1000;

/** 透传延迟时间：300ms */
const PASS_THROUGH_DELAY_MS = 300;

/** 核心处理器依赖 */
export interface CoreProcessorDeps {
  /** 状态管理器 */
  stateManager: StateManager;
  /** 指令路由器 */
  commandRouter: CommandRouter;
  /** tmux 管理器 */
  tmuxManager: TmuxManager;
  /** 配置 */
  config: Config;
  /** 发送消息函数 */
  sendMessage: (chatId: string, message: string) => Promise<void>;
  /** 最后操作会话映射（可选） */
  lastSessionMap?: Map<string, string>;
}

/**
 * 创建核心处理器
 */
export function createCoreProcessor(deps: CoreProcessorDeps): CoreProcessor {
  const { stateManager, commandRouter, tmuxManager, config, sendMessage, lastSessionMap } = deps;

  /**
   * 处理 TEXT 消息
   */
  async function handleTextMessage(chatId: string, text: string): Promise<void> {
    const state = stateManager.getState(chatId);

    // 检查超时
    if (stateManager.checkTimeout(chatId, TIMEOUT_MS)) {
      stateManager.resetState(chatId);
      await sendMessage(chatId, '⏰ 已超过 30 分钟无操作，自动退出会话模式');
      return;
    }

    // COMMAND 模式：调用指令路由器
    if (state.mode === 'COMMAND') {
      const parsed = parseCommand(text);
      if (!parsed) {
        logger.debug('handleTextMessage', '非指令格式，忽略', { chatId, text });
        return;
      }

      const ctx: CommandContext = {
        parsed,
        chatId,
        messageId: '',
        config,
      };

      // 添加 lastSession
      if (lastSessionMap) {
        const lastSession = lastSessionMap.get(chatId);
        if (lastSession !== undefined) {
          ctx.lastSession = lastSession;
        }
      }

      const result = await commandRouter.route(ctx);

      // 更新 lastSession
      if (result.lastSession && lastSessionMap) {
        lastSessionMap.set(chatId, result.lastSession);
      }

      // 构建回复消息
      let replyText = result.message;
      if (result.hint) {
        replyText += `\n\n💡 ${result.hint}`;
      }

      await sendMessage(chatId, replyText);
      return;
    }

    // SESSION 模式：透传到 tmux
    if (state.activeSession) {
      const sessionName = state.activeSession;
      logger.info('handleTextMessage', `SESSION 模式透传`, { chatId, sessionName, text });

      // 检查会话是否存在
      const exists = await tmuxManager.sessionExists(sessionName);
      if (!exists) {
        stateManager.resetState(chatId);
        await sendMessage(chatId, `❌ 会话 "${sessionName}" 已不存在，已退出会话模式`);
        return;
      }

      // 发送命令到 tmux
      await tmuxManager.sendCommand(sessionName, text);

      // 延迟后抓取屏幕
      await new Promise((r) => setTimeout(r, PASS_THROUGH_DELAY_MS));
      const result = await tmuxManager.captureScreen(sessionName, config.tmuxDefaultLines);
      await sendMessage(chatId, result.cleaned);
    }
  }

  /**
   * 处理 CARD_EVENT 消息
   */
  async function handleCardEvent(chatId: string, payload: CardEventPayload): Promise<void> {
    const state = stateManager.getState(chatId);

    // 如果已在 SESSION 模式，拒绝进入
    if (state.mode === 'SESSION') {
      await sendMessage(chatId, `❌ 当前已在会话模式（${state.activeSession}），请先退出`);
      return;
    }

    const { action, sessionName } = payload;

    if (action === 'enter') {
      // 检查会话是否存在
      const exists = await tmuxManager.sessionExists(sessionName);
      if (!exists) {
        await sendMessage(chatId, `❌ 会话 "${sessionName}" 不存在`);
        return;
      }

      // 切换到 SESSION 模式
      stateManager.transition(chatId, { mode: 'SESSION', activeSession: sessionName });
      logger.info('handleCardEvent', `进入 SESSION 模式`, { chatId, sessionName });

      // 抓取当前屏幕
      const result = await tmuxManager.captureScreen(sessionName, config.tmuxDefaultLines);
      await sendMessage(chatId, `✅ 已进入会话模式：${sessionName}\n\n\`\`\`\n${result.cleaned}\n\`\`\``);
    } else if (action === 'kill') {
      // 终止会话
      logger.info('handleCardEvent', `终止会话`, { chatId, sessionName });

      const exists = await tmuxManager.sessionExists(sessionName);
      if (!exists) {
        await sendMessage(chatId, `❌ 会话 "${sessionName}" 不存在`);
        return;
      }

      await tmuxManager.killSession(sessionName);
      await sendMessage(chatId, `✅ 会话 "${sessionName}" 已终止`);
    }
  }

  /**
   * 处理 MENU_EVENT 消息
   */
  async function handleMenuEvent(chatId: string, payload: MenuEventPayload): Promise<void> {
    const state = stateManager.getState(chatId);

    // 如果在 SESSION 模式，退出
    if (state.mode === 'SESSION' && state.activeSession) {
      const sessionName = state.activeSession;
      stateManager.resetState(chatId);
      logger.info('handleMenuEvent', `退出 SESSION 模式`, { chatId, sessionName });
      await sendMessage(chatId, `✅ 已退出会话模式：${sessionName}`);
      return;
    }

    // 其他菜单事件
    logger.debug('handleMenuEvent', `菜单事件`, { chatId, eventKey: payload.eventKey });
  }

  /**
   * 处理统一消息
   */
  async function process(message: UnifiedMessage): Promise<void> {
    const { type, chatId, payload } = message;

    logger.debug('process', `处理消息`, { type, chatId });

    try {
      switch (type) {
        case 'TEXT': {
          const textPayload = payload as { text: string };
          await handleTextMessage(chatId, textPayload.text);
          break;
        }
        case 'CARD_EVENT':
          await handleCardEvent(chatId, payload as CardEventPayload);
          break;
        case 'MENU_EVENT':
          await handleMenuEvent(chatId, payload as MenuEventPayload);
          break;
        default:
          logger.warn('process', `未知消息类型: ${type}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('process', `消息处理失败`, error, { type, chatId });
      await sendMessage(chatId, `❌ 处理失败: ${error.message}`);
    }
  }

  return { process };
}

// 内联测试
if (process.argv[2] === 'test') {
  console.log('=== CoreProcessor 测试 ===\n');

  interface SentMessage { chatId: string; message: string }

  // 创建模拟依赖
  const mockStateMap = new Map<string, { mode: 'COMMAND' | 'SESSION'; activeSession: string | null; lastActivityTime: number }>();

  const mockStateManager: StateManager = {
    getState(chatId: string) {
      let state = mockStateMap.get(chatId);
      if (!state) {
        state = { mode: 'COMMAND', activeSession: null, lastActivityTime: Date.now() };
        mockStateMap.set(chatId, state);
      }
      return state;
    },
    transition(chatId: string, newState: Partial<{ mode: 'COMMAND' | 'SESSION'; activeSession: string | null }>) {
      const current = this.getState(chatId);
      const updated = { ...current, ...newState, lastActivityTime: Date.now() };
      mockStateMap.set(chatId, updated);
    },
    checkTimeout(_chatId: string, _timeoutMs: number) {
      return false;
    },
    resetState(chatId: string) {
      mockStateMap.set(chatId, { mode: 'COMMAND', activeSession: null, lastActivityTime: Date.now() });
    },
    getAllStates() {
      return mockStateMap.keys();
    },
  };

  const sentMessages: SentMessage[] = [];

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
  };

  const mockConfig: Config = {
    feishuAppId: 'test',
    feishuAppSecret: 'test',
    adminOpenId: 'test',
    tmuxDefaultLines: 50,
    tmuxDebug: false,
    pollInterval: 1000,
    pollTimeout: 30000,
    pollStableCount: 2,
    reconnectMaxRetries: 5,
    reconnectDelay: 1000,
    logLevel: 'debug',
    logDir: './logs',
  };

  const processor = createCoreProcessor({
    stateManager: mockStateManager,
    commandRouter: mockCommandRouter,
    tmuxManager: mockTmuxManager,
    config: mockConfig,
    sendMessage: async (chatId, message) => {
      sentMessages.push({ chatId, message });
    },
  });

  function getLastMessage(): SentMessage | undefined {
    return sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : undefined;
  }

  const runTests = async () => {
    const testChatId = 'test-chat-001';

    // 测试 1: TEXT 消息在 COMMAND 模式下调用指令路由器
    console.log('1. 测试 TEXT 消息在 COMMAND 模式下调用指令路由器...');
    sentMessages.length = 0;
    await processor.process({
      type: 'TEXT',
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
      chatId: testChatId,
      payload: { action: 'enter', sessionName: 'test-session' },
      timestamp: Date.now(),
    });
    const stateAfterEnter = mockStateManager.getState(testChatId);
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
      chatId: testChatId,
      payload: { text: 'ls -la' },
      timestamp: Date.now(),
    });
    const msg3 = getLastMessage();
    if (msg3 && msg3.message === 'test output') {
      console.log('   ✓ 透传成功\n');
    } else {
      console.log('   ✗ 透传失败\n');
      process.exit(1);
    }

    // 测试 4: CARD_EVENT 在 SESSION 模式下拒绝进入
    console.log('4. 测试 CARD_EVENT 在 SESSION 模式下拒绝进入...');
    sentMessages.length = 0;
    await processor.process({
      type: 'CARD_EVENT',
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
    await processor.process({
      type: 'MENU_EVENT',
      chatId: testChatId,
      payload: { eventKey: 'exit_session' },
      timestamp: Date.now(),
    });
    const stateAfterExit = mockStateManager.getState(testChatId);
    const msg5 = getLastMessage();
    if (stateAfterExit.mode === 'COMMAND' && msg5 && msg5.message.includes('已退出会话模式')) {
      console.log('   ✓ 退出成功\n');
    } else {
      console.log('   ✗ 退出失败\n');
      process.exit(1);
    }

    // 测试 6: CARD_EVENT (kill) 终止会话
    console.log('6. 测试 CARD_EVENT (kill) 终止会话...');
    sentMessages.length = 0;
    await processor.process({
      type: 'CARD_EVENT',
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
    mockStateMap.set(testChatId, {
      mode: 'SESSION',
      activeSession: 'test-session',
      lastActivityTime: Date.now() - (31 * 60 * 1000), // 31 分钟前
    });
    // 重写 checkTimeout 返回 true
    mockStateManager.checkTimeout = () => true;
    sentMessages.length = 0;
    await processor.process({
      type: 'TEXT',
      chatId: testChatId,
      payload: { text: 'ls' },
      timestamp: Date.now(),
    });
    const msg7 = getLastMessage();
    if (msg7 && msg7.message.includes('已超过 30 分钟')) {
      console.log('   ✓ 超时检查正确\n');
    } else {
      console.log('   ✗ 超时检查失败\n');
      process.exit(1);
    }

    // 测试 8: 会话不存在时退出 SESSION 模式
    console.log('8. 测试会话不存在时退出 SESSION 模式...');
    mockStateManager.checkTimeout = () => false;
    mockStateMap.set(testChatId, {
      mode: 'SESSION',
      activeSession: 'nonexistent-session',
      lastActivityTime: Date.now(),
    });
    sentMessages.length = 0;
    await processor.process({
      type: 'TEXT',
      chatId: testChatId,
      payload: { text: 'ls' },
      timestamp: Date.now(),
    });
    const stateAfterNonexistent = mockStateManager.getState(testChatId);
    const msg8 = getLastMessage();
    if (stateAfterNonexistent.mode === 'COMMAND' && msg8 && msg8.message.includes('已不存在')) {
      console.log('   ✓ 自动退出成功\n');
    } else {
      console.log('   ✗ 自动退出失败\n');
      process.exit(1);
    }

    console.log('=== 所有测试完成 ===');
  };

  runTests().catch((err) => {
    console.error('测试失败:', err);
    process.exit(1);
  });
}
