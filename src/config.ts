/**
 * Remote IM Controller - 配置加载模块
 */

import type { Config, LogLevel } from './types.js';
import { createLogger } from './logger.js';

const logger = createLogger('config');

/**
 * 从环境变量加载配置
 * @param requireFeishu 是否验证飞书配置（飞书模式需要，CLI 模式不需要）
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
    logLevel: (process.env.LOG_LEVEL as LogLevel) || 'info',
    logDir: process.env.LOG_DIR || './logs',
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '600000', 10),
    ...(process.env.CARD_TEMPLATE_ID ? { cardTemplateId: process.env.CARD_TEMPLATE_ID } : {}),
    streamLogDir: process.env.STREAM_LOG_DIR || './logs/stream/',
    streamPushIntervalMs: parseInt(process.env.STREAM_PUSH_INTERVAL_MS || '2000', 10),
    streamPushMinIntervalMs: parseInt(process.env.STREAM_PUSH_MIN_INTERVAL_MS || '500', 10),
  };

  if (requireFeishu) {
    logger.info('loadConfig', '配置加载完成', {
      feishuAppId,
      adminOpenId,
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
