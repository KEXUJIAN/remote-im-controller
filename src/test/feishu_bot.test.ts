/**
 * Remote IM Controller - FeishuBot 模块测试
 */

import { createFeishuBot } from '../feishu_bot.js';
import type { FeishuMessageEvent, FeishuMessageContent } from '../types.js';
import { createTestConfig } from './test_utils.js';

async function main() {
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

main().catch((error) => {
  console.error('测试异常:', error);
  process.exit(1);
});
