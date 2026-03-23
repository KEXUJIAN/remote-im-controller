/**
 * Remote IM Controller - 主入口
 */

import { mkdirSync } from 'fs';
import { createLogger } from './logger.js';
import { createTmuxManager } from './tmux_manager.js';
import { createParser } from './parser.js';
import { parseCommand } from './command_parser.js';
import { createCommandRouter } from './command_router.js';
import { createFeishuBot } from './feishu_bot.js';
import type {
  CommandContext,
  Config,
  LogLevel,
  PollState,
  FeishuMessageEvent,
  FeishuMessageContent,
} from './types.js';

process.env.TMUX_TMPDIR = process.env.TMUX_TMPDIR || process.env.LOG_DIR || './logs';
mkdirSync(process.env.TMUX_TMPDIR, { recursive: true });

const logger = createLogger('app');

function loadConfig(): Config {
  const feishuAppId = process.env.FEISHU_APP_ID;
  const feishuAppSecret = process.env.FEISHU_APP_SECRET;
  const adminOpenId = process.env.ADMIN_OPEN_ID;

  if (!feishuAppId) throw new Error('缺少必填环境变量: FEISHU_APP_ID');
  if (!feishuAppSecret) throw new Error('缺少必填环境变量: FEISHU_APP_SECRET');
  if (!adminOpenId) throw new Error('缺少必填环境变量: ADMIN_OPEN_ID');

  const config: Config = {
    feishuAppId,
    feishuAppSecret,
    adminOpenId,
    tmuxDefaultLines: parseInt(process.env.TMUX_DEFAULT_LINES || '50', 10),
    pollInterval: parseInt(process.env.POLL_INTERVAL || '3000', 10),
    pollTimeout: parseInt(process.env.POLL_TIMEOUT || '60000', 10),
    pollStableCount: parseInt(process.env.POLL_STABLE_COUNT || '2', 10),
    reconnectMaxRetries: parseInt(process.env.RECONNECT_MAX_RETRIES || '5', 10),
    reconnectDelay: parseInt(process.env.RECONNECT_DELAY || '5000', 10),
    logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
    logDir: process.env.LOG_DIR || './logs',
  };

  logger.info('loadConfig', '配置加载完成', {
    feishuAppId,
    adminOpenId,
    tmuxDefaultLines: config.tmuxDefaultLines,
    pollInterval: config.pollInterval,
    pollTimeout: config.pollTimeout,
    pollStableCount: config.pollStableCount,
  });

  return config;
}

interface AppState {
  config: Config;
  tmuxManager: ReturnType<typeof createTmuxManager>;
  parser: ReturnType<typeof createParser>;
  commandRouter: ReturnType<typeof createCommandRouter>;
  feishuBot: ReturnType<typeof createFeishuBot>;
  lastSessionMap: Map<string, string>;
  pollStates: Map<string, PollState>;
  isShuttingDown: boolean;
}

const PROMPT_PATTERN = /[\w.-]+@[\w.-]+:[^$\n]*[$#]\s*$/;

function hasPrompt(text: string): boolean {
  return PROMPT_PATTERN.test(text.trim());
}

function startPolling(state: AppState, session: string, chatId: string): void {
  const existingPoll = state.pollStates.get(session);
  if (existingPoll) {
    clearTimeout(existingPoll.timerId);
    state.pollStates.delete(session);
  }

  logger.info('startPolling', `开始轮询会话: ${session}`, { chatId });

  const pollState: PollState = {
    session,
    timerId: setTimeout(() => pollTick(state, session), state.config.pollInterval),
    lastHash: '',
    stableCount: 0,
    startTime: Date.now(),
    chatId,
  };

  state.pollStates.set(session, pollState);
}

async function pollTick(state: AppState, session: string): Promise<void> {
  const pollState = state.pollStates.get(session);
  if (!pollState || state.isShuttingDown) return;

  const { config, tmuxManager, feishuBot } = state;

  try {
    const result = await tmuxManager.captureScreen(session, config.tmuxDefaultLines);
    const currentHash = result.hash;

    if (currentHash === pollState.lastHash) {
      pollState.stableCount++;
      logger.debug('pollTick', `输出稳定: ${session}`, {
        stableCount: pollState.stableCount,
        targetCount: config.pollStableCount,
      });
    } else {
      pollState.stableCount = 0;
      pollState.lastHash = currentHash;
    }

    const elapsed = Date.now() - pollState.startTime;
    const isTimeout = elapsed >= config.pollTimeout;
    // 稳定计数达标且末尾有提示符才算稳定完成
    const isStable = pollState.stableCount >= config.pollStableCount && hasPrompt(result.cleaned);

    if (isStable || isTimeout) {
      state.pollStates.delete(session);

      if (isTimeout) {
        logger.warn('pollTick', `轮询超时: ${session}`, { elapsed });
      } else {
        logger.info('pollTick', `输出稳定: ${session}`, { stableCount: pollState.stableCount });
      }

      await feishuBot.sendMarkdown(pollState.chatId, `**${session}** 输出:\n\`\`\`\n${result.cleaned}\n\`\`\``);
      return;
    }

    pollState.timerId = setTimeout(() => pollTick(state, session), config.pollInterval);
  } catch (error) {
    logger.error('pollTick', `轮询失败: ${session}`, error instanceof Error ? error : new Error(String(error)));
    state.pollStates.delete(session);
  }
}

function stopAllPolling(state: AppState): void {
  for (const [session, pollState] of state.pollStates) {
    clearTimeout(pollState.timerId);
    logger.info('stopPolling', `停止轮询: ${session}`);
  }
  state.pollStates.clear();
}

async function handleMessage(state: AppState, event: FeishuMessageEvent): Promise<void> {
  const { config, commandRouter, feishuBot, lastSessionMap } = state;
  const { message, sender } = event.event;
  const chatId = message.chat_id;
  const messageId = message.message_id;

  try {
    const content: FeishuMessageContent = JSON.parse(message.content);
    const text = content.text?.trim() || '';

    logger.debug('handleMessage', '收到消息', {
      chatId,
      messageId,
      text,
      sender: sender.sender_id.open_id,
    });

    const parsed = parseCommand(text);
    if (!parsed) {
      logger.debug('handleMessage', '非指令格式，忽略');
      return;
    }

    const lastSession = lastSessionMap.get(chatId);

    const ctx: CommandContext = {
      parsed,
      chatId,
      messageId,
      config,
    };
    if (lastSession !== undefined) {
      ctx.lastSession = lastSession;
    }

    const result = await commandRouter.route(ctx);

    if (result.lastSession) {
      lastSessionMap.set(chatId, result.lastSession);
    }

    let replyText = result.message;
    if (result.hint) {
      replyText += `\n\n💡 ${result.hint}`;
    }

    await feishuBot.sendMarkdown(chatId, replyText);

    if (result.success && parsed.action === 'exec' && result.lastSession) {
      startPolling(state, result.lastSession, chatId);
    }
  } catch (error) {
    logger.error('handleMessage', '消息处理失败', error instanceof Error ? error : new Error(String(error)), {
      chatId,
      messageId,
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    await feishuBot.sendMarkdown(chatId, `❌ 处理失败: ${errorMessage}`);
  }
}

function gracefulShutdown(state: AppState, signal: string): void {
  if (state.isShuttingDown) return;

  state.isShuttingDown = true;
  logger.info('shutdown', `收到信号: ${signal}，开始优雅退出`);

  stopAllPolling(state);

  state.feishuBot.stop()
    .then(() => {
      logger.info('shutdown', '优雅退出完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('shutdown', '退出时出错', error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    });
}

async function main(): Promise<void> {
  logger.info('main', 'Remote IM Controller 启动中...');

  const config = loadConfig();

  const tmuxManager = createTmuxManager(config.tmuxDefaultLines);
  const parser = createParser();
  const commandRouter = createCommandRouter({ tmuxManager, parser });
  const feishuBot = createFeishuBot(config);

  const state: AppState = {
    config,
    tmuxManager,
    parser,
    commandRouter,
    feishuBot,
    lastSessionMap: new Map(),
    pollStates: new Map(),
    isShuttingDown: false,
  };

  logger.info('main', '检查 tmux 可用性...');
  await tmuxManager.checkAvailable();

  process.on('SIGINT', () => gracefulShutdown(state, 'SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown(state, 'SIGTERM'));

  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', '未捕获异常', error);
    gracefulShutdown(state, 'uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('unhandledRejection', '未处理的 Promise 拒绝', error);
    gracefulShutdown(state, 'unhandledRejection');
  });

  logger.info('main', '启动飞书机器人...');
  await feishuBot.start((event) => handleMessage(state, event));

  logger.info('main', 'Remote IM Controller 已启动，等待消息...');
}

main().catch((error) => {
  logger.error('main', '启动失败', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
