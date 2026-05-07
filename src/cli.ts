/**
 * Remote IM Controller - 本地 CLI 入口
 */

import 'dotenv/config';
import { createLogger, setupFileLogging, getLogFilePath } from './logger.js';
import { ensureLogDir } from './utils/misc.js';
import { acquireLock, releaseLock } from './utils/process_lock.js';
import { loadConfig } from './config.js';
import { createTmuxManager } from './tmux_manager.js';
import { createCommandRouter } from './command_router.js';
import { createStateManager } from './state_manager.js';
import { createCoreProcessor } from './core_processor.js';
import { createLocalAdapter } from './adapters/local_adapter.js';
import { createTimeoutChecker } from './services/timeout_checker.js';

const logDir = ensureLogDir();

setupFileLogging({ path: getLogFilePath('cli', logDir), console: false });

const logger = createLogger('cli');
const config = loadConfig(false);
const lockFile = config.lockFile;

async function main(): Promise<void> {
  // 获取进程锁，防止多实例并发启动
  const lockResult = acquireLock(lockFile);
  if (!lockResult.acquired) {
    console.error(`Error: ${lockResult.message}`);
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Remote IM Controller - Local CLI');
  console.log("  Type 'help' for commands");
  console.log("  Type 'exit' to quit");
  console.log('========================================');
  console.log();

  const stateManager = createStateManager();
  const tmuxManager = createTmuxManager(config.tmuxDefaultLines, config.tmuxDebug, config.streamLogDir, config.instanceId);
  const commandRouter = createCommandRouter({ tmuxManager });
  const lastSessionMap = new Map<string, string>();
  const adapter = createLocalAdapter();
  const processor = createCoreProcessor({
    stateManager,
    commandRouter,
    tmuxManager,
    config,
    sendMessage: async (_chatId: string, message: string) => {
      return adapter.sendMessage(_chatId, message);
    },
    updateMessage: async (chatId: string, messageId: string, message: string) => {
      await adapter.updateMessage(chatId, messageId, message);
    },
    sendToUser: async (_openId: string, message: string) => {
      console.log(message);
    },
    lastSessionMap,
  });

  logger.info('main', '检查 tmux 可用性...');
  await tmuxManager.checkAvailable();

  const timeoutChecker = createTimeoutChecker(
    stateManager,
    config.sessionTimeoutMs,
    (_userId, sessionName) => {
      console.log(`⏰ 已超过 ${config.sessionTimeoutMs / 1000 / 60} 分钟无操作，自动退出会话模式：${sessionName}`);
    }
  );
  timeoutChecker.start();

  // 优雅退出处理
  let isShuttingDown = false;

  const gracefulShutdown = (signal: string): void => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    logger.info('shutdown', `收到信号: ${signal}，开始优雅退出`);

    timeoutChecker.stop();
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

  logger.info('main', '启动本地适配器...');
  await adapter.start(processor);

  logger.info('main', 'Local CLI 已启动');
}

main().catch((error) => {
  logger.error('main', '启动失败', error);
  releaseLock(lockFile);
  process.exit(1);
});