/**
 * Remote IM Controller - FeishuAdapter 模块测试
 */

import { createFeishuAdapter } from '../src/adapters/feishu_adapter.js';
import type { FeishuBot } from '../src/feishu_bot.js';
import type { CoreProcessor } from '../src/adapters/adapter.js';
import type { UnifiedMessage } from '../src/types.js';
import { createTestConfig } from './test_utils.js';

async function main() {
  console.log('=== 飞书适配器测试 ===');

  const mockBot: FeishuBot = {
    start: async () => console.log('Mock bot started'),
    stop: async () => console.log('Mock bot stopped'),
    sendMarkdown: async (chatId: string, text: string) => {
      console.log(`Mock send to ${chatId}: ${text}`);
      return 'mock_message_id';
    },
    sendCard: async () => 'mock_message_id',
    sendTemplateCard: async () => {},
    sendToUser: async (openId: string, message: string) => {
      console.log(`Mock sendToUser to ${openId}: ${message}`);
    },
    registerCardHandler: (_handler) => {
      console.log('Card handler registered');
    },
    registerMenuHandler: (_handler) => {
      console.log('Menu handler registered');
    },
    updateCard: async (messageId: string) => {
      console.log(`Mock updateCard: ${messageId}`);
    },
  };

  const testConfig = createTestConfig({
    adminOpenId: 'test_admin',
    tmuxDefaultLines: 100,
    logLevel: 'debug',
    logDir: './logs',
    streamLogDir: './logs/stream/',
  });

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

main().catch((error) => {
  console.error('测试异常:', error);
  process.exit(1);
});
