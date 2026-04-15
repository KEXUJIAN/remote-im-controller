/**
 * Remote IM Controller - 本地 CLI 入口
 */

import 'dotenv/config';
import { createLogger, setupFileLogging, getLogFilePath } from './logger.js';
import { ensureLogDir } from './utils/misc.js';
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

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  Remote IM Controller - Local CLI');
  console.log("  Type 'help' for commands");
  console.log("  Type 'exit' to quit");
  console.log('========================================');
  console.log();

  const config = loadConfig(false);

  const stateManager = createStateManager();
  const tmuxManager = createTmuxManager(config.tmuxDefaultLines, config.tmuxDebug, config.streamLogDir);
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

  logger.info('main', '启动本地适配器...');
  await adapter.start(processor);

  logger.info('main', 'Local CLI 已启动');
}

main().catch((error) => {
  logger.error('main', '启动失败', error);
  process.exit(1);
});
