/**
 * Remote IM Controller - 测试工具函数
 */

import type { Config, LogLevel } from '../types.js';

/**
 * 创建测试用的配置对象
 * @param overrides 覆盖默认值的配置项
 * @returns 测试配置对象
 */
export function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    feishuAppId: 'test_app_id',
    feishuAppSecret: 'test_secret',
    adminOpenId: 'test_admin_open_id',
    logLevel: 'info' as LogLevel,
    logDir: './logs/test',
    tmuxDefaultLines: 50,
    tmuxDebug: false,
    pollInterval: 100,
    pollTimeout: 1000,
    pollFinalDelay: 50,
    pollTimeoutCheckCount: 2,
    reconnectMaxRetries: 2,
    reconnectDelay: 100,
    sessionTimeoutMs: 5000,
    streamLogDir: './logs/stream_test/',
    streamPushIntervalMs: 100,
    streamPushMinIntervalMs: 50,
    instanceId: 'test-instance',
    stateFile: './logs/test/state-test.json',
    lockFile: './logs/test/remote-im-controller-test.pid',
    ...overrides,
  };
}
