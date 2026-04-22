/**
 * Remote IM Controller - 主入口
 */

import 'dotenv/config';
import { createLogger, setupFileLogging, getLogFilePath } from './logger.js';
import { ensureLogDir } from './utils/misc.js';
import { acquireLock, releaseLock } from './utils/process_lock.js';
import { loadConfig } from './config.js';
import { createTmuxManager } from './tmux_manager.js';
import { createCommandRouter } from './command_router.js';
import { createFeishuBot } from './feishu_bot.js';
import { createStateManager } from './state_manager.js';
import { createStatePersistence, type PersistedState } from './state_persistence.js';
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

  const config = loadConfig(true);

  // 获取进程锁，防止多实例并发启动
  const lockFile = config.lockFile;
  const lockResult = acquireLock(lockFile);
  if (!lockResult.acquired) {
    console.error(`Error: ${lockResult.message}`);
    process.exit(1);
  }

  const tmuxManager = createTmuxManager(config.tmuxDefaultLines, config.tmuxDebug, config.streamLogDir);
  const commandRouter = createCommandRouter({ tmuxManager });
  const feishuBot = createFeishuBot(config);

  const stateManager = createStateManager();
  const statePersistence = createStatePersistence(config.stateFile, config.instanceId);
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

  // 加载持久化状态
  let persistedState: PersistedState | null = null;
  try {
    persistedState = statePersistence.load();
  } catch (err) {
    logger.warn('main', '状态文件加载失败，将继续使用干净状态', { error: err });
  }

  if (persistedState) {
    // 恢复聊天状态
    stateManager.loadStates(persistedState.chatStates);

    // 恢复 lastSessionMap
    for (const [userId, session] of Object.entries(persistedState.lastSessionMap)) {
      lastSessionMap.set(userId, session);
    }

    logger.info('main', '状态恢复完成', {
      chatStates: Object.keys(persistedState.chatStates).length,
      lastSessionMap: Object.keys(persistedState.lastSessionMap).length,
    });
  }

  logger.info('main', '检查 tmux 可用性...');
  await tmuxManager.checkAvailable();

  // 恢复会话 pipe-pane
  if (persistedState && Object.keys(persistedState.sessionStates).length > 0) {
    const recovered = await tmuxManager.recoverSessions(persistedState.sessionStates);

    // 加载恢复的会话输出状态
    const outputManager = tmuxManager.getOutputManager();
    outputManager.loadSessionStates(persistedState.sessionStates);

    // 处理 SESSION 状态的积压输出
    for (const chatId of stateManager.getAllStates()) {
      const state = stateManager.getState(chatId);
      if (state.mode === 'SESSION' && state.activeSession) {
        const sessionName = state.activeSession;

        if (!recovered.includes(sessionName)) {
          // 会话不存在，重置状态
          stateManager.resetState(chatId);
          await feishuBot.sendToUser(
            chatId,
            `⚠️ 服务已重启，但会话 "${sessionName}" 已不存在，已退出会话模式`
          );
          continue;
        }

        // 读取积压输出并推送
        const logPath = tmuxManager.getPipeLogPath(sessionName);
        if (logPath) {
          const result = outputManager.readNewOutput(sessionName, 0);
          if (result.content) {
            await feishuBot.sendToUser(
              chatId,
              `⚠️ 服务已重启，以下是重启前的输出：\n\`\`\`\n${result.content}\n\`\`\``
            );
          }
        }

        // 清除忙碌状态（命令可能已执行完）
        if (state.isBusy) {
          stateManager.clearBusy(chatId);
        }

        // 重置活动时间
        stateManager.renewActivity(chatId);
      }
    }

    logger.info('main', '会话恢复完成', { recoveredCount: recovered.length });
  }

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

  let isShuttingDown = false;

  const gracefulShutdown = (signal: string): void => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    logger.info('shutdown', `收到信号: ${signal}，开始优雅退出`);

    timeoutChecker.stop();

    // 强制保存状态
    const stateGetter = () => ({
      version: 1,
      instanceId: config.instanceId,
      chatStates: stateManager.getAllStatesData(),
      lastSessionMap: Object.fromEntries(lastSessionMap.entries()),
      sessionStates: (() => {
        const data: Record<string, { offset: number; lineBuffer: string; logPath: string }> = {};
        const outputManager = tmuxManager.getOutputManager();
        const activePipes = tmuxManager.getActivePipes();
        const sessionStatesData = outputManager.getAllSessionStatesData();
        for (const [session, state] of Object.entries(sessionStatesData)) {
          data[session] = {
            ...state,
            logPath: activePipes[session] || '',
          };
        }
        return data;
      })(),
      savedAt: Date.now(),
    });
    statePersistence.scheduleSave(stateGetter);
    statePersistence.forceFlush();

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

  logger.info('main', '启动飞书适配器...');
  await adapter.start(coreProcessor);

  logger.info('main', 'Remote IM Controller 已启动，等待消息...');
}

main().catch((error) => {
  logger.error('main', '启动失败', error);
  process.exit(1);
});
