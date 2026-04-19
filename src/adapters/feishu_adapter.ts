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
  FeishuCard,
} from '../types.js';
import type { FeishuBot, CardHandlerResponse } from '../feishu_bot.js';
import type { Adapter, CoreProcessor } from './adapter.js';
import { createLogger } from '../logger.js';

const logger = createLogger('feishu_adapter');

export interface FeishuAdapter extends Adapter {
  start(processor: CoreProcessor): Promise<void>;
  stop(): Promise<void>;
}

export function createFeishuAdapter(_config: Config, bot: FeishuBot): FeishuAdapter {
  let processor: CoreProcessor | null = null;

  /**
   * 检查处理器是否可用，记录警告日志
   */
  function requireProcessor(): CoreProcessor | null {
    if (!processor) {
      logger.warn('handle', '处理器未初始化');
      return null;
    }
    return processor;
  }

  async function handleTextMessage(event: FeishuMessageEvent): Promise<void> {
    const proc = requireProcessor();
    if (!proc) {
      return;
    }

    const content: FeishuMessageContent = JSON.parse(event.message.content);
    const message: UnifiedMessage = {
      type: 'TEXT',
      userId: event.sender?.sender_id?.open_id || '',
      chatId: event.message.chat_id,
      payload: {
        text: content.text,
        messageId: event.message.message_id,
      },
      timestamp: Date.now(),
    };

    await proc.process(message);
  }

  function handleCardEvent(data: CardActionTriggerEvent): Promise<CardHandlerResponse> {
    const proc = requireProcessor();
    if (!proc) {
      return Promise.resolve({ toast: { type: 'error', content: '处理器未就绪' } });
    }

    const { action, context } = data;
    const value = typeof action.value === 'string'
      ? JSON.parse(action.value)
      : action.value;

    const message: UnifiedMessage = {
      type: 'CARD_EVENT',
      userId: data.operator.open_id,
      chatId: context?.open_chat_id || '',
      payload: {
        action: value.action,
        sessionName: value.session,
        messageId: context?.open_message_id,
      } as CardEventPayload,
      timestamp: Date.now(),
    };

    proc.process(message).catch((error) => {
      logger.error('card', '卡片事件处理失败', error);
    });

    return Promise.resolve({ toast: { type: 'info', content: '处理中...' } });
  }

  async function handleMenuEvent(data: BotMenuEvent): Promise<void> {
    const proc = requireProcessor();
    if (!proc) {
      return;
    }

    const openId = data.operator?.operator_id?.open_id || '';
    const message: UnifiedMessage = {
      type: 'MENU_EVENT',
      userId: openId,
      chatId: openId,  // MENU 事件没有 chat_id，私聊回复
      payload: {
        eventKey: data.event_key,
      } as MenuEventPayload,
      timestamp: Date.now(),
    };

    await proc.process(message);
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

    async sendMessage(chatId: string, message: string): Promise<string> {
      const messageId = await bot.sendMarkdown(chatId, message);
      logger.debug('send', '消息已发送', { chatId, messageId });
      return messageId;
    },

    async updateMessage(_chatId: string, messageId: string, message: string): Promise<void> {
      const card: FeishuCard = {
        config: { wide_screen_mode: true, enable_forward: true },
        elements: [{ tag: 'markdown', content: message }],
      };
      await bot.updateCard(messageId, card);
      logger.debug('update', '消息已更新', { messageId });
    },
  };
}
