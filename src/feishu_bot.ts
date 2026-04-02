/**
 * Remote IM Controller - 飞书通信模块
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type {
  Config,
  FeishuMessageEvent,
  FeishuCard,
  FeishuMessageContent,
  CardActionTriggerEvent,
  BotMenuEvent,
} from './types.js';
import { ReconnectLimitExceededError } from './errors.js';
import { createLogger } from './logger.js';

const logger = createLogger('feishu_bot');

/** 消息 ID 缓存大小（用于去重） */
const MESSAGE_ID_CACHE_SIZE = 100;

/** 卡片事件处理响应 */
export interface CardHandlerResponse {
  toast?: {
    type: 'info' | 'success' | 'error';
    content: string;
  };
}

/** 飞书机器人接口 */
export interface FeishuBot {
  /** 启动机器人，注册消息处理器 */
  start(onMessage: (event: FeishuMessageEvent) => Promise<void>): Promise<void>;
  /** 停止机器人 */
  stop(): Promise<void>;
  /** 发送 Markdown 消息（使用卡片格式） */
  sendMarkdown(chatId: string, text: string, title?: string): Promise<void>;
  /** 发送自定义卡片消息 */
  sendCard(chatId: string, card: FeishuCard): Promise<void>;
  /** 发送模板卡片消息 */
  sendTemplateCard(
    chatId: string,
    templateId: string,
    variables: Record<string, unknown>
  ): Promise<void>;
  /** 注册卡片事件处理器 */
  registerCardHandler(handler: (data: CardActionTriggerEvent) => Promise<CardHandlerResponse>): void;
  /** 注册菜单事件处理器 */
  registerMenuHandler(handler: (data: BotMenuEvent) => Promise<void>): void;
  /** 发送 Markdown 消息给指定用户（使用 open_id） */
  sendToUser(openId: string, message: string): Promise<void>;
}

/** 内部状态 */
interface BotState {
  wsClient: lark.WSClient | null;
  client: lark.Client;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  isRunning: boolean;
  cardHandler: ((data: CardActionTriggerEvent) => Promise<CardHandlerResponse>) | null;
  menuHandler: ((data: BotMenuEvent) => Promise<void>) | null;
  /** 已处理的消息 ID 缓存（去重用） */
  processedMessageIds: Set<string>;
}

/**
 * 创建飞书机器人实例
 */
export function createFeishuBot(config: Config): FeishuBot {
  const state: BotState = {
    wsClient: null,
    client: new lark.Client({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    }),
    reconnectAttempts: 0,
    reconnectTimer: null,
    isRunning: false,
    cardHandler: null,
    menuHandler: null,
    processedMessageIds: new Set<string>(),
  };

  /**
   * 清除重连定时器
   */
  function clearReconnectTimer(): void {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  /**
   * 检查操作者是否为管理员
   * @param operatorOpenId 操作者 Open ID
   * @param context 上下文描述（用于日志）
   * @returns 是否为管理员
   */
  function checkAdminPermission(operatorOpenId: string | undefined, context: string): boolean {
    if (operatorOpenId !== config.adminOpenId) {
      logger.debug('auth', `非管理员${context}，已丢弃`, { operatorOpenId });
      return false;
    }
    return true;
  }

  /**
   * 尝试重连
   */
  async function attemptReconnect(
    onMessage: (event: FeishuMessageEvent) => Promise<void>
  ): Promise<void> {
    if (!state.isRunning) return;

    state.reconnectAttempts++;
    logger.warn('reconnect', `尝试重连 (${state.reconnectAttempts}/${config.reconnectMaxRetries})`);

    if (state.reconnectAttempts > config.reconnectMaxRetries) {
      logger.error('reconnect', '重连次数超限', undefined, {
        attempts: state.reconnectAttempts,
        maxRetries: config.reconnectMaxRetries,
      });
      throw new ReconnectLimitExceededError(state.reconnectAttempts, config.reconnectMaxRetries);
    }

    await new Promise<void>((resolve) => {
      state.reconnectTimer = setTimeout(resolve, config.reconnectDelay);
    });

    await startInternal(onMessage);
  }

  /**
   * 内部启动逻辑
   */
  async function startInternal(
    onMessage: (event: FeishuMessageEvent) => Promise<void>
  ): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: FeishuMessageEvent) => {
        try {
          const messageId = data.message.message_id;

          // 去重检查（同步，快速返回）
          if (state.processedMessageIds.has(messageId)) {
            logger.warn('dedup', '消息重复，已跳过', {
              messageId,
              chatId: data.message.chat_id,
            });
            return;
          }
          state.processedMessageIds.add(messageId);
          logger.info('dedup', '消息已记录', { messageId });

          // 清理旧缓存
          if (state.processedMessageIds.size > MESSAGE_ID_CACHE_SIZE) {
            const arr = Array.from(state.processedMessageIds);
            const removed = arr.slice(0, arr.length - MESSAGE_ID_CACHE_SIZE);
            state.processedMessageIds = new Set(arr.slice(-MESSAGE_ID_CACHE_SIZE));
            logger.debug('dedup', '清理旧缓存', { removedCount: removed.length });
          }

          // 权限检查
          const senderOpenId = data.sender?.sender_id?.open_id;
          if (!checkAdminPermission(senderOpenId, '消息')) {
            return;
          }

          logger.info('message', '收到消息', {
            chatId: data.message.chat_id,
            messageId: data.message.message_id,
            messageType: data.message.message_type,
          });

          // 异步处理（不阻塞响应）
          setImmediate(() => onMessage(data));
        } catch (error) {
          logger.error('message', '消息处理失败', error);
        }
      },
      'card.action.trigger': async (data: CardActionTriggerEvent) => {
        try {
          if (!state.cardHandler) {
            logger.warn('card', '卡片事件处理器未注册');
            return { toast: { type: 'error', content: '处理器未就绪' } };
          }

          const operatorOpenId = data.operator?.open_id;
          if (!checkAdminPermission(operatorOpenId, '卡片事件')) {
            return { toast: { type: 'error', content: '无权限' } };
          }

          return await state.cardHandler(data);
        } catch (error) {
          logger.error('card', '卡片事件处理失败', error);
          return { toast: { type: 'error', content: '处理失败' } };
        }
      },
      'application.bot.menu_v6': async (data: BotMenuEvent) => {
        try {
          if (!state.menuHandler) {
            logger.warn('menu', '菜单事件处理器未注册');
            return;
          }
          
          const operatorOpenId = data.operator?.operator_id?.open_id;
          if (!checkAdminPermission(operatorOpenId, '菜单事件')) {
            return;
          }

          await state.menuHandler(data);
        } catch (error) {
          logger.error('menu', '菜单事件处理失败', error);
        }
      },
    });

    state.wsClient = new lark.WSClient({
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      loggerLevel: lark.LoggerLevel.warn,
    });

    try {
      await state.wsClient.start({ eventDispatcher });
      state.reconnectAttempts = 0; // 重置重连计数
      logger.info('start', 'WebSocket 连接已建立');
    } catch (error) {
      logger.error('start', 'WebSocket 连接失败', error);
      await attemptReconnect(onMessage);
    }
  }

  async function sendCardWithType(
    receiveId: string,
    card: FeishuCard,
    receiveIdType: 'chat_id' | 'open_id'
  ): Promise<void> {
    try {
      const response = await state.client.im.v1.message.create({
        params: {
          receive_id_type: receiveIdType,
        },
        data: {
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });

      if (response.code !== 0) {
        throw new Error(`发送失败: ${response.msg || `code ${response.code}`}`);
      }

      logger.debug('send', '消息发送成功', {
        receiveId,
        receiveIdType,
        messageId: response.data?.message_id,
      });
    } catch (error) {
      logger.error('send', '发送消息失败', error, { receiveId, receiveIdType });
      throw error;
    }
  }

  return {
    async start(onMessage: (event: FeishuMessageEvent) => Promise<void>): Promise<void> {
      if (state.isRunning) {
        logger.warn('start', '机器人已在运行');
        return;
      }

      state.isRunning = true;
      logger.info('start', '启动飞书机器人', {
        appId: config.feishuAppId,
        adminOpenId: config.adminOpenId,
      });

      await startInternal(onMessage);
    },

    async stop(): Promise<void> {
      state.isRunning = false;
      clearReconnectTimer();

      if (state.wsClient) {
        try {
          state.wsClient.close();
          logger.info('stop', 'WebSocket 连接已关闭');
        } catch (error) {
          logger.error('stop', '关闭连接失败', error);
        }
        state.wsClient = null;
      }
    },

    async sendMarkdown(chatId: string, text: string, title?: string): Promise<void> {
      const card: FeishuCard = title
        ? {
            config: {
              wide_screen_mode: true,
              enable_forward: true,
            },
            header: {
              title: {
                tag: 'plain_text',
                content: title,
              },
            },
            elements: [
              {
                tag: 'markdown',
                content: text,
              },
            ],
          }
        : {
            config: {
              wide_screen_mode: true,
              enable_forward: true,
            },
            elements: [
              {
                tag: 'markdown',
                content: text,
              },
            ],
          };

      await this.sendCard(chatId, card);
    },

    async sendCard(chatId: string, card: FeishuCard): Promise<void> {
      await sendCardWithType(chatId, card, 'chat_id');
    },

    async sendTemplateCard(
      chatId: string,
      templateId: string,
      variables: Record<string, unknown>
    ): Promise<void> {
      const content = JSON.stringify({
        type: 'template',
        data: {
          template_id: templateId,
          template_variable: variables,
        },
      });

      try {
        const response = await state.client.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            msg_type: 'interactive',
            content,
          },
        });

        if (response.code !== 0) {
          throw new Error(`发送模板卡片失败: ${response.msg || `code ${response.code}`}`);
        }

        logger.debug('sendTemplate', '模板卡片发送成功', {
          chatId,
          templateId,
          messageId: response.data?.message_id,
        });
      } catch (error) {
        logger.error('sendTemplate', '发送模板卡片失败', error, { chatId, templateId });
        throw error;
      }
    },

    registerCardHandler(handler: (data: CardActionTriggerEvent) => Promise<CardHandlerResponse>): void {
      state.cardHandler = handler;
      logger.debug('register', '卡片事件处理器已注册');
    },

    registerMenuHandler(handler: (data: BotMenuEvent) => Promise<void>): void {
      state.menuHandler = handler;
      logger.debug('register', '菜单事件处理器已注册');
    },

    async sendToUser(openId: string, message: string): Promise<void> {
      const card: FeishuCard = {
        config: {
          wide_screen_mode: true,
          enable_forward: true,
        },
        elements: [
          {
            tag: 'markdown',
            content: message,
          },
        ],
      };

      await sendCardWithType(openId, card, 'open_id');
    },
  };
}

// ==================== CLI 测试入口 ====================

async function runTest(): Promise<void> {
  const { createTestConfig } = await import('./test_utils.js');
  const testConfig = createTestConfig({
    feishuAppId: process.env.FEISHU_APP_ID || 'test_app_id',
    feishuAppSecret: process.env.FEISHU_APP_SECRET || 'test_app_secret',
    adminOpenId: process.env.ADMIN_OPEN_ID || 'test_admin_open_id',
    tmuxDefaultLines: 100,
    tmuxDebug: process.env.TMUX_DEBUG === 'true',
    logLevel: 'debug',
    logDir: './logs',
    streamLogDir: './logs/stream/',
  });

  console.log('=== 飞书机器人测试 ===');
  console.log('配置:', {
    appId: testConfig.feishuAppId,
    adminOpenId: testConfig.adminOpenId,
  });

  const bot = createFeishuBot(testConfig);

  // 模拟消息处理器
  const onMessage = async (event: FeishuMessageEvent): Promise<void> => {
    console.log('收到消息:', {
      chatId: event.message.chat_id,
      content: event.message.content,
      sender: event.sender.sender_id?.open_id,
    });

    // 解析消息内容
    const content: FeishuMessageContent = JSON.parse(event.message.content);
    console.log('消息文本:', content.text);

    // 回复
    await bot.sendMarkdown(
      event.message.chat_id,
      `收到消息: ${content.text}`,
      '测试回复'
    );
  };

  try {
    console.log('\n启动机器人...');
    await bot.start(onMessage);
    console.log('机器人已启动，按 Ctrl+C 停止');

    // 保持进程运行
    process.on('SIGINT', async () => {
      console.log('\n正在停止...');
      await bot.stop();
      console.log('已停止');
      process.exit(0);
    });

    // 模拟测试: 5秒后自动停止（如果没有环境变量配置真实连接）
    if (!process.env.FEISHU_APP_ID) {
      console.log('\n模拟模式: 5秒后自动停止...');
      setTimeout(async () => {
        console.log('模拟测试完成');
        await bot.stop();
        process.exit(0);
      }, 5000);
    }
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

// CLI 入口
if (process.argv[2] === 'test') {
  runTest().catch((error) => {
    console.error('测试异常:', error);
    process.exit(1);
  });
}
