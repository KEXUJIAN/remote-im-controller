/**
 * Remote IM Controller - 核心处理器
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { createLogger } from './logger.js';
import { toError } from './utils/misc.js';
import type {
  UnifiedMessage,
  CardEventPayload,
  MenuEventPayload,
  Config,
  CommandContext,
  ChatState,
} from './types.js';
import type { StateManager } from './state_manager.js';
import type { CommandRouter } from './command_router.js';
import type { TmuxManager } from './tmux_manager.js';
import type { CoreProcessor } from './adapters/adapter.js';
import { parseCommand } from './command_parser.js';
import { createMarkerDetector } from './marker_detector.js';

const logger = createLogger('core_processor');

const RUNTIME_DIR = join(homedir(), '.omo_runtime');
const CONFIG_FILE = join(RUNTIME_DIR, 'config.json');

function getCommandName(): string {
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as { commandName?: string };
      return config.commandName || 'omo-bot';
    }
  } catch (err) {
    logger.debug('getCommandName', '读取配置失败，使用默认值', { error: toError(err).message });
  }
  return 'omo-bot';
}

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
  /** 发送消息函数（使用 chatId） */
  sendMessage: (chatId: string, message: string) => Promise<void>;
  /** 发送私聊消息函数（使用 openId） */
  sendToUser: (openId: string, message: string) => Promise<void>;
  /** 发送模板卡片函数（可选） */
  sendTemplateCard?: (
    chatId: string,
    templateId: string,
    variables: Record<string, unknown>
  ) => Promise<void>;
  /** 最后操作会话映射（可选，key 为 userId） */
  lastSessionMap?: Map<string, string>;
}

/**
 * 创建核心处理器
 */
export function createCoreProcessor(deps: CoreProcessorDeps): CoreProcessor {
  const { stateManager, commandRouter, tmuxManager, config, sendMessage, sendToUser, sendTemplateCard, lastSessionMap } = deps;

  /**
   * 处理 TEXT 消息
   */
  async function handleTextMessage(userId: string, chatId: string, text: string): Promise<void> {
    const state = stateManager.getState(userId);

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
        const lastSession = lastSessionMap.get(userId);
        if (lastSession !== undefined) {
          ctx.lastSession = lastSession;
        }
      }

      const result = await commandRouter.route(ctx);

      // 更新 lastSession
      if (result.lastSession && lastSessionMap) {
        lastSessionMap.set(userId, result.lastSession);
      }

      // 如果是 exec 动作且成功，自动进入 SESSION 模式
      if (result.success && parsed.action === 'exec' && result.lastSession) {
        stateManager.transition(userId, { mode: 'SESSION', activeSession: result.lastSession });
        logger.info('handleTextMessage', 'exec 后自动进入 SESSION 模式', { userId, session: result.lastSession });
      }

      // 优先发送模板卡片
      if (result.cardVariables && config.cardTemplateId && sendTemplateCard) {
        await sendTemplateCard(chatId, config.cardTemplateId, result.cardVariables);
        return;
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

      if (stateManager.isBusy(userId)) {
        await sendMessage(chatId, '⏳ 请等待当前命令完成...');
        return;
      }

      if (stateManager.checkTimeout(userId, config.sessionTimeoutMs)) {
        stateManager.resetState(userId);
        await sendMessage(chatId, `⏰ 会话已超过 ${Math.round(config.sessionTimeoutMs / 60000)} 分钟未活动，已退出会话模式`);
        return;
      }

      const exists = await tmuxManager.sessionExists(sessionName);
      if (!exists) {
        stateManager.resetState(userId);
        await sendMessage(chatId, `❌ 会话 "${sessionName}" 已不存在，已退出会话模式`);
        return;
      }

      const trimmedText = text.trim();
      const commandName = getCommandName();

      let commandToSend = text;
      if (trimmedText.startsWith(`${commandName} `)) {
        commandToSend = `OMO_CHAT_ID=${chatId} ${trimmedText}`;
        logger.info('handleTextMessage', '转发 omo 命令', { chatId, commandName });
      }

      stateManager.setBusy(userId, text);

      // 即时响应，防止飞书超时
      await sendMessage(chatId, `⏳ 正在执行: ${text}`);

      try {
        const outputManager = tmuxManager.getOutputManager();
        const markerDetector = createMarkerDetector();

        outputManager.resetOffset(sessionName);

        logger.info('handleTextMessage', `SESSION 模式透传`, { chatId, sessionName, commandToSend });
        await tmuxManager.sendCommand(sessionName, commandToSend);

        let finalOutput = '';
        const streamComplete = new Promise<void>((resolve) => {
          outputManager.startStreaming(sessionName, {
            intervalMs: config.streamPushIntervalMs,
            onChunk: async (chunk) => {
              finalOutput += chunk;
              logger.debug('handleTextMessage', '流式推送 chunk', { chunkLength: chunk.length });
            },
            onComplete: () => {
              stateManager.clearBusy(userId);
              logger.info('handleTextMessage', '流式推送完成', { sessionName });
              resolve();
            },
            markerDetector,
          });
        });

        await streamComplete;

        if (finalOutput) {
          await sendMessage(chatId, `\`\`\`\n${finalOutput}\n\`\`\``);
        } else {
          await sendMessage(chatId, '✅ 命令执行完成（无输出）');
        }

        stateManager.renewActivity(userId);
      } catch (err) {
        stateManager.clearBusy(userId);
        throw err;
      }
    }
  }

  /**
   * 处理 CARD_EVENT 消息
   */
  async function handleCardEvent(userId: string, chatId: string, payload: CardEventPayload): Promise<void> {
    const state = stateManager.getState(userId);

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
      stateManager.transition(userId, { mode: 'SESSION', activeSession: sessionName });
      logger.info('handleCardEvent', `进入 SESSION 模式`, { chatId, sessionName });

      await sendMessage(chatId, `✅ 已进入会话模式：${sessionName}`);
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
  async function handleMenuEvent(userId: string, payload: MenuEventPayload): Promise<void> {
    const state = stateManager.getState(userId);

    // 如果在 SESSION 模式，退出
    if (state.mode === 'SESSION' && state.activeSession) {
      const sessionName = state.activeSession;
      stateManager.resetState(userId);
      logger.info('handleMenuEvent', `退出 SESSION 模式`, { userId, sessionName });
      await sendToUser(userId, `✅ 已退出会话模式：${sessionName}`);
      return;
    }

    // 其他菜单事件
    logger.debug('handleMenuEvent', `菜单事件`, { userId, eventKey: payload.eventKey });
  }

  /**
   * 处理统一消息
   */
  async function process(message: UnifiedMessage): Promise<void> {
    const { type, userId, chatId, payload } = message;

    logger.debug('process', `处理消息`, { type, userId, chatId });

    try {
      switch (type) {
        case 'TEXT': {
          const textPayload = payload as { text: string };
          await handleTextMessage(userId, chatId, textPayload.text);
          break;
        }
        case 'CARD_EVENT':
          await handleCardEvent(userId, chatId, payload as CardEventPayload);
          break;
        case 'MENU_EVENT':
          await handleMenuEvent(userId, payload as MenuEventPayload);
          break;
        default:
          logger.warn('process', `未知消息类型: ${type}`);
      }
    } catch (err) {
      const error = toError(err);
      logger.error('process', `消息处理失败`, error, { type, userId, chatId });
      await sendMessage(chatId, `❌ 处理失败: ${error.message}`);
    }
  }

  return { process };
}

// 内联测试
if (process.argv[2] === 'test') {
  const { createTestConfig } = await import('./test_utils.js');
  console.log('=== CoreProcessor 测试 ===\n');

  interface SentMessage { chatId: string; message: string }
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
        startStreaming: async (_sessionName: string, options: { onChunk: (chunk: string) => Promise<void>; onComplete?: () => void }) => {
          await options.onChunk('test output');
          setTimeout(() => {
            options.onComplete?.();
          }, 10);
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

  const runTests = async () => {
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
    if (msg3 && msg3.message === '```\ntest output\n```') {
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
      payload: { eventKey: 'exit_session' },
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
  };

  runTests().catch((err) => {
    console.error('测试失败:', err);
    process.exit(1);
  });
}
