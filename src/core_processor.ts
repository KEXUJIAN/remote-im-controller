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
} from './types.js';
import type { StateManager } from './state_manager.js';
import type { CommandRouter } from './command_router.js';
import type { TmuxManager } from './tmux_manager.js';
import type { CoreProcessor } from './adapters/adapter.js';
import { parseCommand } from './command_parser.js';
import { createMarkerDetector } from './marker_detector.js';
import { createStreamingSession } from './streaming_session.js';

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
  /** 发送消息函数（使用 chatId），返回 message_id */
  sendMessage: (chatId: string, message: string) => Promise<string>;
  /** 更新消息函数 */
  updateMessage: (chatId: string, messageId: string, message: string) => Promise<void>;
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
  const { stateManager, commandRouter, tmuxManager, config, sendMessage, updateMessage, sendToUser, sendTemplateCard, lastSessionMap } = deps;

  /**
   * 处理 TEXT 消息
   */
  async function handleTextMessage(userId: string, chatId: string, text: string): Promise<void> {
    const state = stateManager.getState(userId);

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

      if (lastSessionMap) {
        const lastSession = lastSessionMap.get(userId);
        if (lastSession !== undefined) {
          ctx.lastSession = lastSession;
        }
      }

      const result = await commandRouter.route(ctx);

      if (result.lastSession && lastSessionMap) {
        lastSessionMap.set(userId, result.lastSession);
      }

      // 如果是 exec 动作且成功，自动进入 SESSION 模式
      if (result.success && parsed.action === 'exec' && result.lastSession) {
        stateManager.transition(userId, { mode: 'SESSION', activeSession: result.lastSession });
        logger.info('handleTextMessage', 'exec 后自动进入 SESSION 模式', { userId, session: result.lastSession });
      }

      if (result.cardVariables && config.cardTemplateId && sendTemplateCard) {
        await sendTemplateCard(chatId, config.cardTemplateId, result.cardVariables);
        return;
      }

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

      let commandToSend = text.replace(/[\r\n]+/g, ' ');
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

        const session = createStreamingSession({
          chatId,
          sessionName,
          sendMessage,
          updateMessage,
        });
        await session.run(outputManager, markerDetector, config.streamPushIntervalMs);
        stateManager.clearBusy(userId);
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

    if (state.mode === 'SESSION') {
      await sendMessage(chatId, `❌ 当前已在会话模式（${state.activeSession}），请先退出`);
      return;
    }

    const { action, sessionName } = payload;

    if (action === 'enter') {
      const exists = await tmuxManager.sessionExists(sessionName);
      if (!exists) {
        await sendMessage(chatId, `❌ 会话 "${sessionName}" 不存在`);
        return;
      }

      stateManager.transition(userId, { mode: 'SESSION', activeSession: sessionName });
      logger.info('handleCardEvent', `进入 SESSION 模式`, { chatId, sessionName });

      await sendMessage(chatId, `✅ 已进入会话模式：${sessionName}`);
    } else if (action === 'kill') {
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
    logger.debug('handleMenuEvent', `菜单事件`, { userId, eventKey: payload.eventKey });

    if (payload.eventKey !== 'exit_wsl_session_mode') {
      logger.debug('handleMenuEvent', '忽略非退出菜单事件', { eventKey: payload.eventKey });
      return;
    }

    const state = stateManager.getState(userId);

    if (state.mode === 'SESSION' && state.activeSession) {
      const sessionName = state.activeSession;
      stateManager.resetState(userId);
      logger.info('handleMenuEvent', `退出 SESSION 模式`, { userId, sessionName });
      await sendToUser(userId, `✅ 已退出会话模式：${sessionName}`);
    } else {
      await sendToUser(userId, '⚠️ 当前不在会话模式');
    }

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
