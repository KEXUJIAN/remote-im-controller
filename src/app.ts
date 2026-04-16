/**
 * Remote IM Controller - 主入口
 */

import 'dotenv/config';
import { join } from 'path';
import { createLogger, setupFileLogging, getLogFilePath } from './logger.js';
import { ensureLogDir } from './utils/misc.js';
import { acquireLock, releaseLock } from './utils/process_lock.js';
import { loadConfig } from './config.js';
import { createTmuxManager } from './tmux_manager.js';
import { createCommandRouter } from './command_router.js';
import { createFeishuBot } from './feishu_bot.js';
import { createStateManager } from './state_manager.js';
import { createCoreProcessor } from './core_processor.js';
import { createFeishuAdapter } from './adapters/feishu_adapter.js';
import { createTimeoutChecker } from './services/timeout_checker.js';

const logDir = ensureLogDir();

if (process.env.NODE_ENV === 'development') {
  setupFileLogging({ path: getLogFilePath('dev', logDir), console: true });
}

const logger = createLogger('app');

async function main(): Promise<void> {
  logger.info('main', 'Remote IM Controller 启动中...');

  // 获取进程锁，防止多实例并发启动
  const lockFile = join(logDir, 'remote-im-controller.pid');
  const lockResult = acquireLock(lockFile);
  if (!lockResult.acquired) {
    console.error(`Error: ${lockResult.message}`);
    process.exit(1);
  }

  const config = loadConfig(true);

  const tmuxManager = createTmuxManager(config.tmuxDefaultLines, config.tmuxDebug, config.streamLogDir);
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
      return feishuBot.sendMarkdown(chatId, message);
    },
    updateMessage: async (_chatId: string, messageId: string, message: string) => {
      await feishuBot.updateCard(messageId, {
        elements: [{ tag: 'markdown', content: message }],
      });
    },
    sendTemplateCard: async (chatId: string, templateId: string, variables: Record<string, unknown>) => {
      await feishuBot.sendTemplateCard(chatId, templateId, variables);
    },
    sendToUser: async (openId: string, message: string) => {
      await feishuBot.sendToUser(openId, message);
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

    releaseLock(lockFile);

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

  const timeoutChecker = createTimeoutChecker(
    stateManager,
    config.sessionTimeoutMs,
    (userId, sessionName) => {
      return feishuBot.sendToUser(
        userId,
        `⏰ 已超过 ${config.sessionTimeoutMs / 1000 / 60} 分钟无操作，自动退出会话模式：${sessionName}`
      );
    }
  );
  timeoutChecker.start();

  logger.info('main', '启动飞书适配器...');
  await adapter.start(coreProcessor);

  logger.info('main', 'Remote IM Controller 已启动，等待消息...');
}

main().catch((error) => {
  logger.error('main', '启动失败', error);
  process.exit(1);
});
