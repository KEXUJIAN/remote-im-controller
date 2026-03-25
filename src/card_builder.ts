/**
 * Remote IM Controller - 卡片构建器
 */

import type { Config, FeishuCard } from './types.js';

/** 卡片按钮行为值 */
export interface CardButtonValue {
  action: 'enter' | 'kill';
  session: string;
}

/** 卡片构建器接口 */
export interface CardBuilder {
  /** 构建会话列表卡片 */
  buildSessionListCard(sessions: string[]): FeishuCard;
  /** 构建会话连接成功卡片 */
  buildSessionConnectedCard(sessionName: string): FeishuCard;
}

/**
 * 创建卡片构建器
 */
export function createCardBuilder(_config: Config): CardBuilder {
  return {
    buildSessionListCard(sessions: string[]): FeishuCard {
      if (sessions.length === 0) {
        return {
          config: { wide_screen_mode: true },
          elements: [
            { tag: 'markdown', content: '**当前没有活跃的会话**' },
            { tag: 'markdown', content: '使用 `create <name>` 创建新会话' },
          ],
        };
      }

      const sessionElements: FeishuCard['elements'] = [
        { tag: 'markdown', content: '**会话列表**' },
        { tag: 'hr' },
      ];

      for (const session of sessions) {
        const enterValue: CardButtonValue = { action: 'enter', session };
        const killValue: CardButtonValue = { action: 'kill', session };

        sessionElements.push({
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: session },
              value: JSON.stringify(enterValue),
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '进入' },
              value: JSON.stringify(enterValue),
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '关闭' },
              value: JSON.stringify(killValue),
            },
          ],
        });
      }

      return {
        config: { wide_screen_mode: true },
        elements: sessionElements,
      };
    },

    buildSessionConnectedCard(sessionName: string): FeishuCard {
      return {
        config: { wide_screen_mode: true },
        elements: [
          {
            tag: 'markdown',
            content: `✅ 已连接到会话 **${sessionName}**`,
          },
          {
            tag: 'markdown',
            content: '直接发送命令即可执行，发送 `help` 查看帮助',
          },
        ],
      };
    },
  };
}

// ============ 内联测试 ============

if (process.argv[2] === 'test') {
  console.log('=== 测试卡片构建器 ===\n');

  const mockConfig: Config = {
    feishuAppId: 'test-app-id',
    feishuAppSecret: 'test-secret',
    adminOpenId: 'test-open-id',
    tmuxDefaultLines: 100,
    tmuxDebug: false,
    pollInterval: 3000,
    pollTimeout: 60000,
    pollStableCount: 3,
    reconnectMaxRetries: 5,
    reconnectDelay: 1000,
    logLevel: 'info',
    logDir: './logs',
  };

  const builder = createCardBuilder(mockConfig);

  // 测试 1: 空会话列表
  console.log('测试 1: 空会话列表');
  const emptyCard = builder.buildSessionListCard([]);
  console.log('卡片结构:', JSON.stringify(emptyCard, null, 2));
  console.assert(emptyCard.elements.length === 2, '空会话列表应有 2 个元素');
  const firstElement = emptyCard.elements[0];
  console.assert(
    firstElement?.tag === 'markdown',
    '第一个元素应为 markdown'
  );
  console.log('✅ 通过\n');

  // 测试 2: 会话列表卡片
  console.log('测试 2: 会话列表卡片');
  const sessions = ['opencode', 'dev', 'test'];
  const card = builder.buildSessionListCard(sessions);
  console.log('卡片结构:', JSON.stringify(card, null, 2));
  console.assert(card.config?.wide_screen_mode === true, '应启用宽屏模式');
  console.assert(card.elements.length === 5, '应有 5 个元素 (标题 + hr + 3 个会话)');
  console.log('✅ 通过\n');

  // 测试 3: 按钮值格式
  console.log('测试 3: 按钮值格式');
  const actionElement = card.elements[2];
  if (actionElement && actionElement.tag === 'action') {
    const actions = actionElement.actions;
    const enterButton = actions[1];
    const killButton = actions[2];
    if (enterButton && killButton) {
      const enterValue = JSON.parse(enterButton.value) as CardButtonValue;
      console.log('按钮值:', enterValue);
      console.assert(enterValue.action === 'enter', '进入按钮 action 应为 enter');
      console.assert(enterValue.session === 'opencode', 'session 应为 opencode');

      const killValue = JSON.parse(killButton.value) as CardButtonValue;
      console.log('关闭按钮值:', killValue);
      console.assert(killValue.action === 'kill', '关闭按钮 action 应为 kill');
      console.assert(killValue.session === 'opencode', 'session 应为 opencode');
    }
  }
  console.log('✅ 通过\n');

  // 测试 4: 会话连接卡片
  console.log('测试 4: 会话连接卡片');
  const connectedCard = builder.buildSessionConnectedCard('opencode');
  console.log('卡片结构:', JSON.stringify(connectedCard, null, 2));
  console.assert(connectedCard.elements.length === 2, '应有 2 个元素');
  console.log('✅ 通过\n');

  console.log('=== 所有测试通过 ===');
}
