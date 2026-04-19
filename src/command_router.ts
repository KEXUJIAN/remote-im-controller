/**
 * Remote IM Controller - 指令路由模块
 */

import type { CommandContext, CommandResult, CommandHandler } from './types.js';
import type { TmuxManager } from './tmux_manager.js';
import { ensureSessionExists } from './tmux_manager.js';
import { createLogger } from './logger.js';
import { SessionNotFoundError } from './errors.js';
import { toError } from './utils/misc.js';

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
