/**
 * Remote IM Controller - 主入口
 */

import 'dotenv/config';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { createLogger, setupFileLogging, getLogFilePath } from './logger.js';
import { createTmuxManager } from './tmux_manager.js';
import { createCommandRouter } from './command_router.js';
import { createFeishuBot } from './feishu_bot.js';
import { createStateManager } from './state_manager.js';
import { createCoreProcessor } from './core_processor.js';
import { createFeishuAdapter } from './adapters/feishu_adapter.js';
import type { Config, LogLevel } from './types.js';

const logDir = resolve(process.env.LOG_DIR || './logs');
process.env.TMUX_TMPDIR = resolve(process.env.TMUX_TMPDIR || logDir);
mkdirSync(process.env.TMUX_TMPDIR, { recursive: true });

if (process.env.NODE_ENV === 'development') {
  setupFileLogging({ path: getLogFilePath('dev', logDir), console: true });
}

const logger = createLogger('app');

const TIMEOUT_MS = 30 * 60 * 1000;

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
    tmuxDebug: process.env.TMUX_DEBUG === 'true',
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

async function main(): Promise<void> {
  logger.info('main', 'Remote IM Controller 启动中...');

  const config = loadConfig();

  const tmuxManager = createTmuxManager(config.tmuxDefaultLines, config.tmuxDebug);
  const commandRouter = createCommandRouter({ tmuxManager });
  const feishuBot = createFeishuBot(config);

  const stateManager = createStateManager();
  const lastSessionMap = new Map<string, string>();

  const coreProcessor = createCoreProcessor({
    stateManager,
    commandRouter,
    tmuxManager,
    config,
    sendMessage: async (chatId: string, message: string) => {
      await feishuBot.sendMarkdown(chatId, message);
    },
    lastSessionMap,
  });

  const adapter = createFeishuAdapter(config, feishuBot);

  logger.info('main', '检查 tmux 可用性...');
  await tmuxManager.checkAvailable();

  let isShuttingDown = false;

  const gracefulShutdown = (signal: string): void => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    logger.info('shutdown', `收到信号: ${signal}，开始优雅退出`);

    adapter.stop()
      .then(() => {
        logger.info('shutdown', '优雅退出完成');
        process.exit(0);
      })
      .catch((error) => {
        logger.error('shutdown', '退出时出错', error);
        process.exit(1);
      });
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  process.on('uncaughtException', (error) => {
    logger.error('uncaughtException', '未捕获异常', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', '未处理的 Promise 拒绝', reason);
    gracefulShutdown('unhandledRejection');
  });

  setInterval(() => {
    for (const chatId of stateManager.getAllStates()) {
      if (stateManager.checkTimeout(chatId, TIMEOUT_MS)) {
        stateManager.resetState(chatId);
        adapter.sendMessage(chatId, '⏰ 已超过 30 分钟无操作，自动退出会话模式').catch((error) => {
          logger.error('timeout', '发送超时消息失败', error, { chatId });
        });
      }
    }
  }, 60 * 1000);

  logger.info('main', '启动飞书适配器...');
  await adapter.start(coreProcessor);

  logger.info('main', 'Remote IM Controller 已启动，等待消息...');
}

main().catch((error) => {
  logger.error('main', '启动失败', error);
  process.exit(1);
});
