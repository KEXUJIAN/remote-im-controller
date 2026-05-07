/**
 * Remote IM Controller - 配置加载模块
 */

import type { Config, LogLevel } from './types.js';
import { createLogger } from './logger.js';
import { maskSensitive } from './utils/misc.js';

const logger = createLogger('config');

/**
 * 解析日志级别
 * @param value 环境变量值
 * @returns 有效的日志级别，无效值返回 'info'
 */
function parseLogLevel(value: string | undefined): LogLevel {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return 'info';
}

/**
 * 从环境变量加载配置
 * @param requireFeishu 是否要求飞书配置（CLI 模式为 false）
 * @returns 配置对象
 */
export function loadConfig(requireFeishu: boolean = true): Config {
  const feishuAppId = process.env.FEISHU_APP_ID;
  const feishuAppSecret = process.env.FEISHU_APP_SECRET;
  const adminOpenId = process.env.ADMIN_OPEN_ID;

  if (requireFeishu) {
    if (!feishuAppId) throw new Error('缺少必填环境变量: FEISHU_APP_ID');
    if (!feishuAppSecret) throw new Error('缺少必填环境变量: FEISHU_APP_SECRET');
    if (!adminOpenId) throw new Error('缺少必填环境变量: ADMIN_OPEN_ID');
  }

  // 确定 INSTANCE_ID（优先级：INSTANCE_ID 环境变量 > NODE_ENV > 默认 'cli'）
  const instanceId = process.env.INSTANCE_ID 
    || (process.env.NODE_ENV === 'development' ? 'dev' 
      : process.env.NODE_ENV === 'production' ? 'prod' 
      : 'cli');

  const config: Config = {
    feishuAppId: feishuAppId || 'local-cli',
    feishuAppSecret: feishuAppSecret || 'local-cli',
    adminOpenId: adminOpenId || 'local-cli',
    tmuxDefaultLines: parseInt(process.env.TMUX_DEFAULT_LINES || '50', 10),
    tmuxDebug: process.env.TMUX_DEBUG === 'true',
    pollInterval: parseInt(process.env.POLL_INTERVAL || '3000', 10),
    pollTimeout: parseInt(process.env.POLL_TIMEOUT || '60000', 10),
    pollFinalDelay: parseInt(process.env.POLL_FINAL_DELAY || '500', 10),
    pollTimeoutCheckCount: parseInt(process.env.POLL_TIMEOUT_CHECK_COUNT || '3', 10),
    reconnectMaxRetries: parseInt(process.env.RECONNECT_MAX_RETRIES || '5', 10),
    reconnectDelay: parseInt(process.env.RECONNECT_DELAY || '5000', 10),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    logDir: process.env.LOG_DIR || './logs',
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '600000', 10),
    ...(process.env.CARD_TEMPLATE_ID ? { cardTemplateId: process.env.CARD_TEMPLATE_ID } : {}),
    streamLogDir: `./logs/stream-${instanceId}/`,
    streamPushIntervalMs: parseInt(process.env.STREAM_PUSH_INTERVAL_MS || '2000', 10),
    streamPushMinIntervalMs: parseInt(process.env.STREAM_PUSH_MIN_INTERVAL_MS || '500', 10),
    instanceId,
    stateFile: `./logs/state-${instanceId}.json`,
    lockFile: `./logs/remote-im-controller-${instanceId}.pid`,
  };

  if (requireFeishu) {
    logger.info('loadConfig', '配置加载完成', {
      feishuAppId: maskSensitive(feishuAppId || ''),
      adminOpenId: maskSensitive(adminOpenId || ''),
      tmuxDefaultLines: config.tmuxDefaultLines,
      pollInterval: config.pollInterval,
      pollTimeout: config.pollTimeout,
      pollFinalDelay: config.pollFinalDelay,
      pollTimeoutCheckCount: config.pollTimeoutCheckCount,
    });
  } else {
    logger.info('loadConfig', '配置加载完成', {
      tmuxDefaultLines: config.tmuxDefaultLines,
      logLevel: config.logLevel,
    });
  }

  return config;
}
