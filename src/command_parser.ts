/**
 * Remote IM Controller - 指令解析模块
 */

import type { ParsedCommand, CommandAction } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('command_parser');

const BUILTIN_ACTIONS: CommandAction[] = ['list', 'create', 'kill', 'help', 'status'];

/**
 * 分词函数 - 处理引号包裹的参数
 * @param body 输入字符串
 * @returns 分词后的字符串数组
 */
export function tokenize(body: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < body.length; i++) {
    const char = body[i];

    if (inQuotes) {
      // 在引号内
      if (char === quoteChar) {
        // 遇到结束引号
        inQuotes = false;
        quoteChar = '';
      } else {
        current += char;
      }
    } else {
      // 不在引号内
      if (char === '"' || char === "'") {
        // 开始引号
        inQuotes = true;
        quoteChar = char;
      } else if (char === ' ' || char === '\t') {
        // 空格分隔
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
  }

  // 处理最后一个 token
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * 解析指令
 * @param input 输入字符串
 * @returns 解析后的指令对象，非指令格式返回 null
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();

  // 空字符串
  if (!trimmed) {
    return null;
  }

  // 不以 /cmd 开头
  if (!trimmed.startsWith('/cmd ')) {
    // 特殊情况: 只有 "/cmd" 的情况
    if (trimmed === '/cmd') {
      logger.warn('parse', 'Empty command after /cmd');
      return null;
    }
    return null;
  }

  // 提取 /cmd 后面的内容
  const body = trimmed.slice(5).trim();

  // 只有 /cmd 没有后续内容
  if (!body) {
    logger.warn('parse', 'Empty command after /cmd');
    return null;
  }

  // 分词
  const tokens = tokenize(body);

  if (tokens.length === 0) {
    logger.warn('parse', 'No tokens after tokenization');
    return null;
  }

  const firstToken = tokens[0]!.toLowerCase();

  // 检查是否是内置动作
  if (BUILTIN_ACTIONS.includes(firstToken as CommandAction)) {
    return parseBuiltinAction(firstToken as CommandAction, tokens.slice(1));
  }

  // 否则视为 exec 动作: /cmd <session> <command...>
  return parseExecAction(tokens);
}

/**
 * 解析内置动作
 */
function parseBuiltinAction(action: CommandAction, args: string[]): ParsedCommand {
  const result: ParsedCommand = {
    action,
    args,
    options: {},
  };

  switch (action) {
    case 'list':
    case 'help':
      // 无参数
      break;

    case 'create':
    case 'kill':
      // 需要一个会话名参数
      if (args.length > 0 && args[0]) {
        result.session = args[0];
      }
      break;

    case 'status':
      // 可选会话名参数
      if (args.length > 0 && args[0]) {
        result.session = args[0];
      }
      break;
  }

  logger.debug('parse_builtin', `Parsed builtin action: ${action}`, { action, session: result.session });
  return result;
}

/**
 * 解析 exec 动作
 */
function parseExecAction(tokens: string[]): ParsedCommand | null {
  // 第一个 token 是 session 名
  const session = tokens[0];
  if (!session) {
    return null;
  }
  // 剩余的是要执行的命令
  const commandTokens = tokens.slice(1);

  const result: ParsedCommand = {
    action: 'exec',
    session,
    args: commandTokens,
    command: commandTokens.join(' '),
    options: {},
  };

  logger.debug('parse_exec', `Parsed exec action for session: ${session}`, {
    session,
    command: result.command,
  });

  return result;
}
