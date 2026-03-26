/**
 * Remote IM Controller - 类型定义
 */

import type { EventHandles } from '@larksuiteoapi/node-sdk';

// ============ 环境配置 ============

export interface Config {
  /** 飞书应用 ID */
  feishuAppId: string;
  /** 飞书应用密钥 */
  feishuAppSecret: string;
  /** 管理员 Open ID */
  adminOpenId: string;
  /** 默认抓取行数 */
  tmuxDefaultLines: number;
  /** tmux 详细日志模式 */
  tmuxDebug: boolean;
  /** 轮询间隔 (ms) */
  pollInterval: number;
  /** 轮询超时 (ms) */
  pollTimeout: number;
  /** 稳定计数 */
  pollStableCount: number;
  /** 最大重连次数 */
  reconnectMaxRetries: number;
  /** 重连延迟 (ms) */
  reconnectDelay: number;
  /** 日志级别 */
  logLevel: LogLevel;
  /** 日志目录 */
  logDir: string;
  /** 会话超时时间 (ms)，默认 10 分钟 */
  sessionTimeoutMs: number;
  /** 卡片模板 ID（可选） */
  cardTemplateId?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ============ tmux 管理 ============

export interface TmuxSession {
  /** 会话名称 */
  name: string;
  /** 是否已附加 */
  attached: boolean;
  /** 窗口数量 */
  windows: number;
  /** 创建时间 */
  created: Date;
}

export interface TmuxCaptureResult {
  /** 原始输出 */
  raw: string;
  /** 清洗后的输出 */
  cleaned: string;
  /** 行数 */
  lines: number;
  /** 哈希值 */
  hash: string;
}

// ============ 指令解析 ============

export type CommandAction = 'exec' | 'list' | 'create' | 'kill' | 'help' | 'status';

export interface ParsedCommand {
  /** 动作类型 */
  action: CommandAction;
  /** tmux 会话名 */
  session?: string;
  /** 参数列表 */
  args: string[];
  /** 要执行的命令（仅 exec 动作） */
  command?: string;
  /** 选项 */
  options: Record<string, string | boolean>;
}

// ============ 指令路由 ============

export interface CommandContext {
  /** 解析后的指令 */
  parsed: ParsedCommand;
  /** 聊天 ID */
  chatId: string;
  /** 消息 ID */
  messageId: string;
  /** 最后操作的会话 */
  lastSession?: string;
  /** 配置 */
  config: Config;
}

export interface CommandResult {
  /** 是否成功 */
  success: boolean;
  /** 消息内容 */
  message: string;
  /** 提示信息 */
  hint?: string;
  /** 错误对象 */
  error?: Error;
  /** 更新的会话状态 */
  lastSession?: string;
  /** 卡片模板变量 */
  cardVariables?: Record<string, unknown>;
}

export type CommandHandler = (ctx: CommandContext) => Promise<CommandResult>;

// ============ 飞书消息 ============

export type FeishuMessageEvent = Parameters<
  NonNullable<EventHandles['im.message.receive_v1']>
>[0];

export interface FeishuMessageContent {
  text: string;
}

export interface FeishuCard {
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
  };
  header?: {
    template?: string;
    title: {
      tag: 'plain_text' | 'lark_md';
      content: string;
    };
  };
  elements: FeishuCardElement[];
}

export type FeishuCardElement =
  | { tag: 'markdown'; content: string }
  | { tag: 'hr' }
  | { tag: 'plain_text'; content: string }
  | {
      tag: 'action';
      actions: Array<{
        tag: 'button';
        text: { tag: 'plain_text'; content: string };
        value: string;
      }>;
    };

// ============ 轮询状态 ============

export interface PollState {
  /** 会话名 */
  session: string;
  /** 定时器 ID */
  timerId: NodeJS.Timeout;
  /** 上次哈希 */
  lastHash: string;
  /** 稳定计数 */
  stableCount: number;
  /** 开始时间 */
  startTime: number;
  /** 聊天 ID */
  chatId: string;
}

// ============ 日志 ============

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  action?: string;
  message: string;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
  context?: Record<string, unknown>;
}

// ============ 错误类型 ============

export class SessionNotFoundError extends Error {
  constructor(
    public sessionName: string,
    public availableSessions: string[] = []
  ) {
    super(`tmux session '${sessionName}' not found`);
    this.name = 'SessionNotFoundError';
  }
}

export class ReconnectLimitExceededError extends Error {
  constructor(
    public attempts: number,
    public maxRetries: number
  ) {
    super(`Reconnect limit exceeded: ${attempts}/${maxRetries}`);
    this.name = 'ReconnectLimitExceededError';
  }
}

export class TmuxNotAvailableError extends Error {
  constructor(public reason: string = 'tmux command not found') {
    super(`tmux not available: ${reason}`);
    this.name = 'TmuxNotAvailableError';
  }
}

// ============ 状态机 ============

/** 聊天模式 */
export type ChatMode = 'COMMAND' | 'SESSION';

/** 聊天状态 */
export interface ChatState {
  /** 当前模式 */
  mode: ChatMode;
  /** 活跃会话名 */
  activeSession: string | null;
  /** 最后活动时间戳 */
  lastActivityTime: number;
}

// ============ 统一消息接口 ============

/** 消息类型 */
export type MessageType = 'TEXT' | 'CARD_EVENT' | 'MENU_EVENT';

/** 统一消息接口 */
export interface UnifiedMessage {
  /** 消息类型 */
  type: MessageType;
  /** 用户 ID */
  userId: string;
  /** 聊天 ID */
  chatId: string;
  /** 消息载荷 */
  payload: unknown;
  /** 时间戳 */
  timestamp: number;
}

/** 卡片事件载荷 */
export interface CardEventPayload {
  /** 动作类型 */
  action: 'enter' | 'kill';
  /** 会话名 */
  sessionName: string;
  /** 消息 ID（用于更新卡片） */
  messageId?: string;
}

/** 菜单事件载荷 */
export interface MenuEventPayload {
  /** 事件键 */
  eventKey: string;
}

/** 飞书卡片触发事件（新版 SDK 结构） */
export interface CardActionTriggerEvent {
  schema: string;
  event_id: string;
  token: string;
  create_time: string;
  event_type: string;
  tenant_key: string;
  app_id: string;
  operator: {
    tenant_key: string;
    user_id: string;
    open_id: string;
    union_id: string;
  };
  action: {
    value: { action: 'enter' | 'kill'; session: string } | string;
    tag: string;
  };
  host: string;
  context: {
    open_message_id?: string;
    open_chat_id?: string;
  };
}

/** 飞书菜单事件 */
export type BotMenuEvent = Parameters<
  NonNullable<EventHandles['application.bot.menu_v6']>
>[0];
