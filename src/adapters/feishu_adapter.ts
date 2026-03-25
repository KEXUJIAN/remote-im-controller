/**
 * Remote IM Controller - 飞书适配器
 */

import type { Config } from '../types.js';
import type {
  UnifiedMessage,
  CardEventPayload,
  MenuEventPayload,
  FeishuMessageEvent,
  FeishuMessageContent,
  CardActionTriggerEvent,
  BotMenuEvent,
} from '../types.js';
import type { FeishuBot, CardHandlerResponse } from '../feishu_bot.js';
import type { Adapter, CoreProcessor } from './adapter.js';
import { createLogger } from '../logger.js';

const logger = createLogger('feishu_adapter');

export interface FeishuAdapter extends Adapter {
  start(processor: CoreProcessor): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: string, message: string): Promise<void>;
}

export function createFeishuAdapter(_config: Config, bot: FeishuBot): FeishuAdapter {
  let processor: CoreProcessor | null = null;

  async function handleTextMessage(event: FeishuMessageEvent): Promise<void> {
    if (!processor) {
      logger.warn('handle', '处理器未初始化');
      return;
    }

    const content: FeishuMessageContent = JSON.parse(event.message.content);
    const message: UnifiedMessage = {
      type: 'TEXT',
      chatId: event.message.chat_id,
      payload: {
        text: content.text,
        messageId: event.message.message_id,
      },
      timestamp: Date.now(),
    };

    await processor.process(message);
  }

  function handleCardEvent(data: CardActionTriggerEvent): Promise<CardHandlerResponse> {
    if (!processor) {
      logger.warn('handle', '处理器未初始化');
      return Promise.resolve({ toast: { type: 'error', content: '处理器未就绪' } });
    }

    const { action, context } = data.event;
    const value = typeof action.value === 'string' 
      ? JSON.parse(action.value) 
      : action.value;

    const message: UnifiedMessage = {
      type: 'CARD_EVENT',
      chatId: context.open_chat_id || '',
      payload: {
        action: value.action,
        sessionName: value.session,
        messageId: context.open_message_id,
      } as CardEventPayload,
      timestamp: Date.now(),
    };

    processor.process(message).catch((error) => {
      logger.error('card', '卡片事件处理失败', error);
    });

    return Promise.resolve({ toast: { type: 'info', content: '处理中...' } });
  }

  async function handleMenuEvent(data: BotMenuEvent): Promise<void> {
    if (!processor) {
      logger.warn('handle', '处理器未初始化');
      return;
    }

    const chatId = data.operator?.operator_id?.open_id || '';
    const message: UnifiedMessage = {
      type: 'MENU_EVENT',
      chatId,
      payload: {
        eventKey: data.event_key,
      } as MenuEventPayload,
      timestamp: Date.now(),
    };

    await processor.process(message);
  }

  return {
    async start(p: CoreProcessor): Promise<void> {
      processor = p;
      
      bot.registerCardHandler(handleCardEvent);
      bot.registerMenuHandler(handleMenuEvent);

      await bot.start(handleTextMessage);
      logger.info('start', '飞书适配器已启动');
    },

    async stop(): Promise<void> {
      await bot.stop();
      processor = null;
      logger.info('stop', '飞书适配器已停止');
    },

    async sendMessage(chatId: string, message: string): Promise<void> {
      await bot.sendMarkdown(chatId, message);
      logger.debug('send', '消息已发送', { chatId });
    },
  };
}

// ==================== 内联测试 ====================

async function runTest(): Promise<void> {
  console.log('=== 飞书适配器测试 ===');

  const mockBot: FeishuBot = {
    start: async () => console.log('Mock bot started'),
    stop: async () => console.log('Mock bot stopped'),
    sendMarkdown: async (chatId: string, text: string) => {
      console.log(`Mock send to ${chatId}: ${text}`);
    },
    sendCard: async () => {},
    sendTemplateCard: async () => {},
    registerCardHandler: (_handler) => {
      console.log('Card handler registered');
    },
    registerMenuHandler: (_handler) => {
      console.log('Menu handler registered');
    },
  };

  const testConfig: Config = {
    feishuAppId: 'test',
    feishuAppSecret: 'test',
    adminOpenId: 'test_admin',
    tmuxDefaultLines: 100,
    tmuxDebug: false,
    pollInterval: 1000,
    pollTimeout: 30000,
    pollStableCount: 3,
    reconnectMaxRetries: 5,
    reconnectDelay: 3000,
    logLevel: 'debug',
    logDir: './logs',
  };

  const adapter = createFeishuAdapter(testConfig, mockBot);

  const mockProcessor: CoreProcessor = {
    process: async (message: UnifiedMessage) => {
      console.log('Processing message:', message);
    },
  };

  await adapter.start(mockProcessor);
  await adapter.sendMessage('test_chat', 'Hello');
  await adapter.stop();

  console.log('\n测试完成');
}

if (process.argv[2] === 'test') {
  runTest().catch((error) => {
    console.error('测试异常:', error);
    process.exit(1);
  });
}
