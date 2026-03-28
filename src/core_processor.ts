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

/** 初始延迟时间：500ms */
const INITIAL_DELAY_MS = 500;

/** 轮询结果 */
interface PollResult {
  /** 清洗后的输出 */
  cleaned: string;
  /** 是否超时 */
  timeout: boolean;
  /** 轮询次数 */
  pollCount: number;
  /** 总耗时 (ms) */
  elapsed: number;
  /** 超时时命令是否仍在运行 */
  stillRunning?: boolean;
}

/**
 * 轮询抓取屏幕直到命令完成
 * - 检测进程状态变化判断命令是否完成
 * - 超时后额外检测几次，避免刚结束时抓到不完整输出
 */
async function captureWithPoll(
  tmuxManager: TmuxManager,
  sessionName: string,
  lines: number,
  pollInterval: number,
  pollTimeout: number,
  originalCmd: string,
  finalDelay: number,
  timeoutCheckCount: number
): Promise<PollResult> {
  const startTime = Date.now();
  let pollCount = 0;

  await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));

  while (true) {
    pollCount++;
    const currentCmd = await tmuxManager.getPaneCommand(sessionName);

    if (currentCmd === originalCmd) {
      if (finalDelay > 0) {
        await new Promise((r) => setTimeout(r, finalDelay));
      }
      const result = await tmuxManager.captureScreen(sessionName, lines);
      logger.info('captureWithPoll', `命令完成`, { sessionName, pollCount, elapsed: Date.now() - startTime });
      return { cleaned: result.cleaned, timeout: false, pollCount, elapsed: Date.now() - startTime };
    }

    logger.debug('captureWithPoll', `命令执行中`, { currentCmd, originalCmd });

    const elapsed = Date.now() - startTime;
    if (elapsed >= pollTimeout) {
      logger.info('captureWithPoll', `超时，开始额外检测`, { sessionName, timeoutCheckCount });

      for (let i = 0; i < timeoutCheckCount; i++) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollCount++;
        const checkCmd = await tmuxManager.getPaneCommand(sessionName);

        if (checkCmd === originalCmd) {
          if (finalDelay > 0) {
            await new Promise((r) => setTimeout(r, finalDelay));
          }
          const result = await tmuxManager.captureScreen(sessionName, lines);
          logger.info('captureWithPoll', `超时后检测到命令完成`, { sessionName, pollCount, extraChecks: i + 1 });
          return { cleaned: result.cleaned, timeout: false, pollCount, elapsed: Date.now() - startTime };
        }
      }

      const result = await tmuxManager.captureScreen(sessionName, lines);
      logger.warn('captureWithPoll', '轮询超时，命令仍在运行', { sessionName, pollCount, elapsed: Date.now() - startTime, currentCmd });
      return {
        cleaned: result.cleaned,
        timeout: true,
        pollCount,
        elapsed: Date.now() - startTime,
        stillRunning: true
      };
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }
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

      // 检查会话是否存在
      const exists = await tmuxManager.sessionExists(sessionName);
      if (!exists) {
        stateManager.resetState(userId);
        await sendMessage(chatId, `❌ 会话 "${sessionName}" 已不存在，已退出会话模式`);
        return;
      }

      // 记录原始命令
      const originalCmd = await tmuxManager.getPaneCommand(sessionName);

      // 发送命令到 tmux
      logger.info('handleTextMessage', `SESSION 模式透传`, { chatId, sessionName, text });
      await tmuxManager.sendCommand(sessionName, text);

      // 轮询等待屏幕稳定
      const result = await captureWithPoll(
        tmuxManager,
        sessionName,
        config.tmuxDefaultLines,
        config.pollInterval,
        config.pollTimeout,
        originalCmd,
        config.pollFinalDelay,
        config.pollTimeoutCheckCount
      );

      let output = result.cleaned;
      if (result.timeout && result.stillRunning) {
        output = `⏱️ 等待超时 (${Math.round(result.elapsed / 1000)}s)\n⚠️ 命令可能仍在运行中\n💡 可调大 POLL_TIMEOUT 环境变量\n\n${output}`;
      }

      await sendMessage(chatId, `\`\`\`\n${output}\n\`\`\``);
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
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error('process', `消息处理失败`, error, { type, userId, chatId });
      await sendMessage(chatId, `❌ 处理失败: ${error.message}`);
    }
  }

  return { process };
}

// 内联测试
if (process.argv[2] === 'test') {
  console.log('=== CoreProcessor 测试 ===\n');

  interface SentMessage { chatId: string; message: string }
  interface SentUserMessage { userId: string; message: string }

  // 创建模拟依赖
  const mockStateMap = new Map<string, { mode: 'COMMAND' | 'SESSION'; activeSession: string | null; lastActivityTime: number }>();

  const mockStateManager: StateManager = {
    getState(userId: string) {
      let state = mockStateMap.get(userId);
      if (!state) {
        state = { mode: 'COMMAND', activeSession: null, lastActivityTime: Date.now() };
        mockStateMap.set(userId, state);
      }
      return state;
    },
    transition(userId: string, newState: Partial<{ mode: 'COMMAND' | 'SESSION'; activeSession: string | null }>) {
      const current = this.getState(userId);
      const updated = { ...current, ...newState, lastActivityTime: Date.now() };
      mockStateMap.set(userId, updated);
    },
    checkTimeout(_userId: string, _timeoutMs: number) {
      return false;
    },
    resetState(userId: string) {
      mockStateMap.set(userId, { mode: 'COMMAND', activeSession: null, lastActivityTime: Date.now() });
    },
    getAllStates() {
      return mockStateMap.keys();
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
  };

  const mockConfig: Config = {
    feishuAppId: 'test',
    feishuAppSecret: 'test',
    adminOpenId: 'test',
    tmuxDefaultLines: 50,
    tmuxDebug: false,
    pollInterval: 1000,
    pollTimeout: 30000,
    pollFinalDelay: 500,
    pollTimeoutCheckCount: 3,
    reconnectMaxRetries: 5,
    reconnectDelay: 1000,
    logLevel: 'debug',
    logDir: './logs',
    sessionTimeoutMs: 600000,
  };

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
    if (msg7 && msg7.message.includes('已超过 30 分钟')) {
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
