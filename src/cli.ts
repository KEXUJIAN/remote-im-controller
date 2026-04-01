/**
 * Remote IM Controller - 本地 CLI 入口
 */

import 'dotenv/config';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { createLogger, setupFileLogging, getLogFilePath } from './logger.js';
import { createTmuxManager } from './tmux_manager.js';
import { createCommandRouter } from './command_router.js';
import { createStateManager } from './state_manager.js';
import { createCoreProcessor } from './core_processor.js';
import { createLocalAdapter } from './adapters/local_adapter.js';
import type { Config, LogLevel } from './types.js';

const logDir = resolve(process.env.LOG_DIR || './logs');
process.env.TMUX_TMPDIR = resolve(process.env.TMUX_TMPDIR || logDir);
mkdirSync(process.env.TMUX_TMPDIR, { recursive: true });

setupFileLogging({ path: getLogFilePath('cli', logDir), console: false });

const logger = createLogger('cli');

/**
 * 加载配置（本地 CLI 版本，不需要飞书配置）
 */
function loadConfig(): Config {
  const config: Config = {
    feishuAppId: 'local-cli',
    feishuAppSecret: 'local-cli',
    adminOpenId: 'local-cli',
    tmuxDefaultLines: parseInt(process.env.TMUX_DEFAULT_LINES || '50', 10),
    tmuxDebug: process.env.TMUX_DEBUG === 'true',
    pollInterval: parseInt(process.env.POLL_INTERVAL || '3000', 10),
    pollTimeout: parseInt(process.env.POLL_TIMEOUT || '60000', 10),
    pollFinalDelay: parseInt(process.env.POLL_FINAL_DELAY || '500', 10),
    pollTimeoutCheckCount: parseInt(process.env.POLL_TIMEOUT_CHECK_COUNT || '3', 10),
    reconnectMaxRetries: parseInt(process.env.RECONNECT_MAX_RETRIES || '5', 10),
    reconnectDelay: parseInt(process.env.RECONNECT_DELAY || '5000', 10),
    logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
    logDir: process.env.LOG_DIR || './logs',
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '600000', 10),
    streamLogDir: process.env.STREAM_LOG_DIR || './logs/stream/',
    streamPushIntervalMs: parseInt(process.env.STREAM_PUSH_INTERVAL_MS || '2000', 10),
    streamPushMinIntervalMs: parseInt(process.env.STREAM_PUSH_MIN_INTERVAL_MS || '500', 10),
  };

  logger.info('loadConfig', '配置加载完成', {
    tmuxDefaultLines: config.tmuxDefaultLines,
    logLevel: config.logLevel,
  });

  return config;
}

async function main(): Promise<void> {
  console.log('========================================');
  console.log('  Remote IM Controller - Local CLI');
  console.log("  Type 'help' for commands");
  console.log("  Type 'exit' to quit");
  console.log('========================================');
  console.log();

  const config = loadConfig();

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
      await adapter.sendMessage(_chatId, message);
    },
    sendToUser: async (_openId: string, message: string) => {
      console.log(message);
    },
    lastSessionMap,
  });

  logger.info('main', '检查 tmux 可用性...');
  await tmuxManager.checkAvailable();

  setInterval(() => {
    for (const userId of stateManager.getAllStates()) {
      const state = stateManager.getState(userId);
      if (state.mode !== 'SESSION') {
        continue;
      }
      if (stateManager.checkTimeout(userId, config.sessionTimeoutMs)) {
        const sessionName = state.activeSession;
        stateManager.resetState(userId);
        logger.info('timeout', `SESSION 模式超时退出`, { userId, sessionName });
        console.log(`⏰ 已超过 ${config.sessionTimeoutMs / 1000 / 60} 分钟无操作，自动退出会话模式：${sessionName}`);
      }
    }
  }, 10 * 1000);

  logger.info('main', '启动本地适配器...');
  await adapter.start(processor);

  logger.info('main', 'Local CLI 已启动');
}

main().catch((error) => {
  logger.error('main', '启动失败', error);
  process.exit(1);
});
