/**
 * Remote IM Controller - 指令路由模块
 */

import type { CommandContext, CommandResult, CommandHandler } from './types.js';
import type { TmuxManager } from './tmux_manager.js';
import { ensureSessionExists } from './tmux_manager.js';
import { createLogger } from './logger.js';
import { SessionNotFoundError } from './errors.js';
import { toError } from './utils/error.js';

const logger = createLogger('command_router');

export interface CommandRouter {
  route(ctx: CommandContext): Promise<CommandResult>;
}

export interface CommandRouterDeps {
  tmuxManager: TmuxManager;
}

/** 帮助文本 */
const HELP_TEXT = `指令说明:
help - 显示帮助
list - 列出所有会话
create <name> - 创建会话（返回可点击卡片）
kill <name> - 终止会话
status [name] - 查看会话状态
<session> <command> - 在会话中执行命令（自动进入会话模式）

示例:
  create opencode
  opencode ls -la
  kill opencode`;

/**
 * 创建 CommandRouter 实例
 */
export function createCommandRouter(deps: CommandRouterDeps): CommandRouter {
  const { tmuxManager } = deps;

  /** 处理 exec 动作 - 在会话中执行命令 */
  async function handleExec(ctx: CommandContext): Promise<CommandResult> {
    const { parsed, lastSession } = ctx;
    const session = parsed.session ?? lastSession;

    if (!session) {
      return {
        success: false,
        message: '请指定会话名称，或先执行过某个会话操作',
        hint: '用法: <session> <command>',
      };
    }

    if (!parsed.command) {
      return {
        success: false,
        message: '请指定要执行的命令',
        hint: '用法: <session> <command>',
      };
    }

    // 检查会话是否存在
    await ensureSessionExists(tmuxManager, session);

    // 发送命令
    logger.info('exec', `在会话 ${session} 执行命令: ${parsed.command}`);
    await tmuxManager.sendCommand(session, parsed.command);

    return {
      success: true,
      message: `命令已发送到会话 "${session}"`,
      lastSession: session,
    };
  }

  /** 处理 list 动作 - 列出所有会话 */
  async function handleList(_ctx: CommandContext): Promise<CommandResult> {
    logger.debug('list', '列出所有会话');

    const sessions = await tmuxManager.listSessions();

    if (sessions.length === 0) {
      return {
        success: true,
        message: '当前没有活跃的 tmux 会话',
      };
    }

    const formatted = sessions.map((s) => `  - ${s}`).join('\n');
    return {
      success: true,
      message: `当前会话 (${sessions.length}):\n${formatted}`,
      cardVariables: { session_list: sessions.map(name => ({ name })) },
    };
  }

  /** 处理 create 动作 - 创建新会话 */
  async function handleCreate(ctx: CommandContext): Promise<CommandResult> {
    const { parsed } = ctx;
    const session = parsed.session ?? parsed.args[0];

    if (!session) {
      return {
        success: false,
        message: '请指定会话名称',
        hint: '用法: create <name>',
      };
    }

    // 检查会话是否已存在
    const exists = await tmuxManager.sessionExists(session);
    if (exists) {
      return {
        success: false,
        message: `会话 "${session}" 已存在`,
        hint: '请使用不同的名称，或先终止现有会话',
      };
    }

    logger.info('create', `创建会话: ${session}`);
    await tmuxManager.createSession(session);

    return {
      success: true,
      message: `会话 "${session}" 创建成功`,
      lastSession: session,
      cardVariables: { session_list: [{ name: session }] },
    };
  }

  /** 处理 kill 动作 - 终止会话 */
  async function handleKill(ctx: CommandContext): Promise<CommandResult> {
    const { parsed, lastSession } = ctx;
    const session = parsed.session ?? parsed.args[0] ?? lastSession;

    if (!session) {
      return {
        success: false,
        message: '请指定会话名称',
        hint: '用法: kill <name>',
      };
    }

    // 检查会话是否存在
    await ensureSessionExists(tmuxManager, session);

    logger.info('kill', `终止会话: ${session}`);
    await tmuxManager.killSession(session);

    return {
      success: true,
      message: `会话 "${session}" 已终止`,
    };
  }

  /** 处理 help 动作 - 显示帮助 */
  async function handleHelp(_ctx: CommandContext): Promise<CommandResult> {
    return {
      success: true,
      message: HELP_TEXT,
    };
  }

  /** 处理 status 动作 - 查看会话状态 */
  async function handleStatus(ctx: CommandContext): Promise<CommandResult> {
    const { parsed, lastSession } = ctx;
    const session = parsed.session ?? parsed.args[0] ?? lastSession;

    if (!session) {
      // 没有指定会话，显示所有会话状态
      const sessions = await tmuxManager.listSessions();
      if (sessions.length === 0) {
        return {
          success: true,
          message: '当前没有活跃的 tmux 会话',
        };
      }
      const formatted = sessions.map((s) => `  - ${s}: 存在`).join('\n');
      return {
        success: true,
        message: `会话状态:\n${formatted}`,
      };
    }

    // 检查指定会话
    const exists = await tmuxManager.sessionExists(session);

    return {
      success: true,
      message: `会话 "${session}": ${exists ? '存在' : '不存在'}`,
      lastSession: session,
    };
  }

  /** 处理未知动作 */
  async function handleUnknown(ctx: CommandContext): Promise<CommandResult> {
    const { parsed } = ctx;
    return {
      success: false,
      message: `未知指令: ${parsed.action}`,
      hint: '发送 help 查看可用指令',
    };
  }

  /** 路由到对应的处理器 */
  async function route(ctx: CommandContext): Promise<CommandResult> {
    const { parsed } = ctx;
    logger.debug('route', `路由指令: ${parsed.action}`, { parsed });

    let handler: CommandHandler;

    switch (parsed.action) {
      case 'exec':
        handler = handleExec;
        break;
      case 'list':
        handler = handleList;
        break;
      case 'create':
        handler = handleCreate;
        break;
      case 'kill':
        handler = handleKill;
        break;
      case 'help':
        handler = handleHelp;
        break;
      case 'status':
        handler = handleStatus;
        break;
      default:
        handler = handleUnknown;
    }

    try {
      return await handler(ctx);
    } catch (err) {
      const error = toError(err);
      logger.error('route', `处理指令失败: ${parsed.action}`, err, { parsed });

      // 如果是 SessionNotFoundError，返回友好提示
      if (err instanceof SessionNotFoundError) {
        const hint =
          err.availableSessions.length > 0
            ? `可用会话: ${err.availableSessions.join(', ')}`
            : '当前没有任何会话';
        return {
          success: false,
          message: `会话 "${err.sessionName}" 不存在`,
          hint,
          error: err,
        };
      }

      return {
        success: false,
        message: `执行失败: ${error.message}`,
        error,
      };
    }
  }

  return { route };
}

// CLI 测试入口
if (process.argv[2] === 'test') {
  import('./tmux_manager.js')
    .then(async ({ createTmuxManager }) => {
      const { createTestConfig } = await import('./test_utils.js');
      const tmuxManager = createTmuxManager(50, false, './logs/stream/');
      const router = createCommandRouter({ tmuxManager });

      const mockConfig = createTestConfig({
        logLevel: 'debug',
        logDir: './logs',
        streamLogDir: './logs/stream/',
      });

      const runTests = async () => {
    console.log('=== CommandRouter 测试 ===\n');

    // 测试 1: help
    console.log('1. 测试 help 指令...');
    const helpResult = await router.route({
      parsed: { action: 'help', args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${helpResult.success ? '✓' : '✗'}`);
    console.log(`   消息:\n${helpResult.message.split('\n').map((l) => `     ${l}`).join('\n')}\n`);

    // 测试 2: list
    console.log('2. 测试 list 指令...');
    const listResult = await router.route({
      parsed: { action: 'list', args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${listResult.success ? '✓' : '✗'}`);
    console.log(`   消息: ${listResult.message}\n`);

    // 测试 3: create
    const testSession = `test-router-${Date.now()}`;
    console.log(`3. 测试 create 指令 (${testSession})...`);
    const createResult = await router.route({
      parsed: { action: 'create', session: testSession, args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${createResult.success ? '✓' : '✗'}`);
    console.log(`   消息: ${createResult.message}\n`);

    // 测试 4: status
    console.log(`4. 测试 status 指令 (${testSession})...`);
    const statusResult = await router.route({
      parsed: { action: 'status', session: testSession, args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${statusResult.success ? '✓' : '✗'}`);
    console.log(`   消息: ${statusResult.message}\n`);

    // 测试 5: exec
    console.log(`5. 测试 exec 指令 (${testSession})...`);
    const execResult = await router.route({
      parsed: { action: 'exec', session: testSession, command: 'echo hello', args: ['echo', 'hello'], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${execResult.success ? '✓' : '✗'}`);
    console.log(`   消息: ${execResult.message}\n`);

    // 测试 6: kill
    console.log(`6. 测试 kill 指令 (${testSession})...`);
    const killResult = await router.route({
      parsed: { action: 'kill', session: testSession, args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${killResult.success ? '✓' : '✗'}`);
    console.log(`   消息: ${killResult.message}\n`);

    // 测试 7: status 不存在的会话
    console.log('7. 测试 status 指令 (不存在的会话)...');
    const statusNotFoundResult = await router.route({
      parsed: { action: 'status', session: 'nonexistent-session', args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${statusNotFoundResult.success ? '✓' : '✗'}`);
    console.log(`   消息: ${statusNotFoundResult.message}\n`);

    // 测试 8: 未知动作
    console.log('8. 测试未知动作...');
    const unknownResult = await router.route({
      parsed: { action: 'unknown' as never, args: [], options: {} },
      chatId: 'test-chat',
      messageId: 'test-msg',
      config: mockConfig,
    });
    console.log(`   结果: ${unknownResult.success ? '✗ (预期失败)' : '✓ (预期失败)'}`);
    console.log(`   消息: ${unknownResult.message}\n`);

    console.log('=== 所有测试完成 ===');
      };

      runTests().catch((err) => {
        console.error('测试失败:', err);
        process.exit(1);
      });
    })
    .catch((err) => {
      console.error('导入模块失败:', err);
      process.exit(1);
    });
}
