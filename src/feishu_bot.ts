/**
 * Remote IM Controller - 飞书通信模块
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type {
  Config,
  FeishuMessageEvent,
  FeishuCard,
  FeishuMessageContent,
} from './types.js';
import { ReconnectLimitExceededError } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('feishu_bot');

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
}

/** 内部状态 */
interface BotState {
  wsClient: lark.WSClient | null;
  client: lark.Client;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  isRunning: boolean;
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
      // 消息接收事件
      'im.message.receive_v1': async (data: unknown) => {
        try {
          const event = data as FeishuMessageEvent;
          
          // 验证发送者身份
          const senderOpenId = event.event.sender.sender_id.open_id;
          if (senderOpenId !== config.adminOpenId) {
            logger.debug('auth', '非管理员消息，已丢弃', {
              senderOpenId,
              expectedOpenId: config.adminOpenId,
            });
            return;
          }

          logger.info('message', '收到消息', {
            chatId: event.event.message.chat_id,
            messageId: event.event.message.message_id,
            messageType: event.event.message.message_type,
          });

          await onMessage(event);
        } catch (error) {
          logger.error('message', '消息处理失败', error instanceof Error ? error : new Error(String(error)));
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
      logger.error('start', 'WebSocket 连接失败', error instanceof Error ? error : new Error(String(error)));
      await attemptReconnect(onMessage);
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
          logger.error('stop', '关闭连接失败', error instanceof Error ? error : new Error(String(error)));
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
      try {
        const response = await state.client.im.v1.message.create({
          params: {
            receive_id_type: 'chat_id',
          },
          data: {
            receive_id: chatId,
            msg_type: 'interactive',
            content: JSON.stringify(card),
          },
        });

        if (response.code !== 0) {
          throw new Error(`发送失败: ${response.msg || `code ${response.code}`}`);
        }

        logger.debug('send', '消息发送成功', {
          chatId,
          messageId: response.data?.message_id,
        });
      } catch (error) {
        logger.error('send', '发送消息失败', error instanceof Error ? error : new Error(String(error)), {
          chatId,
        });
        throw error;
      }
    },
  };
}

// ==================== CLI 测试入口 ====================

async function runTest(): Promise<void> {
  const testConfig: Config = {
    feishuAppId: process.env.FEISHU_APP_ID || 'test_app_id',
    feishuAppSecret: process.env.FEISHU_APP_SECRET || 'test_app_secret',
    adminOpenId: process.env.ADMIN_OPEN_ID || 'test_admin_open_id',
    tmuxDefaultLines: 100,
    pollInterval: 1000,
    pollTimeout: 30000,
    pollStableCount: 3,
    reconnectMaxRetries: 5,
    reconnectDelay: 3000,
    logLevel: 'debug',
    logDir: './logs',
  };

  console.log('=== 飞书机器人测试 ===');
  console.log('配置:', {
    appId: testConfig.feishuAppId,
    adminOpenId: testConfig.adminOpenId,
  });

  const bot = createFeishuBot(testConfig);

  // 模拟消息处理器
  const onMessage = async (event: FeishuMessageEvent): Promise<void> => {
    console.log('收到消息:', {
      chatId: event.event.message.chat_id,
      content: event.event.message.content,
      sender: event.event.sender.sender_id.open_id,
    });

    // 解析消息内容
    const content: FeishuMessageContent = JSON.parse(event.event.message.content);
    console.log('消息文本:', content.text);

    // 回复
    await bot.sendMarkdown(
      event.event.message.chat_id,
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
