/**
 * Remote IM Controller - 状态持久化模块测试
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createStatePersistence } from '../src/state_persistence.js';
import { StatePersistenceError } from '../src/errors.js';
import type { PersistedState, SessionStateData } from '../src/state_persistence.js';
import type { ChatState } from '../src/types.js';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 创建测试用的 PersistedState */
function createTestState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    version: 1,
    instanceId: 'test-instance',
    chatStates: {},
    lastSessionMap: {},
    sessionStates: {},
    savedAt: Date.now(),
    ...overrides,
  };
}

/** 创建测试用的 ChatState */
function createTestChatState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    mode: 'COMMAND',
    activeSession: null,
    lastActivityTime: Date.now(),
    isBusy: false,
    ...overrides,
  };
}

/** 创建测试用的 SessionStateData */
function createTestSessionState(overrides: Partial<SessionStateData> = {}): SessionStateData {
  return {
    offset: 0,
    lineBuffer: '',
    logPath: '/tmp/test.log',
    ...overrides,
  };
}

async function main() {
  console.log('=== StatePersistence 测试 ===\n');

  const testDir = mkdtempSync(join(tmpdir(), 'state-persistence-test-'));
  const stateFile = join(testDir, 'state.json');

  try {
    const instanceId = 'test-instance';
    const debounceMs = 50;

    // 1. 测试 load - 文件不存在
    console.log('1. 测试 load - 文件不存在...');
    {
      const persistence = createStatePersistence(stateFile, instanceId, debounceMs);
      const result = persistence.load();
      if (result === null) {
        console.log('   ✓ 文件不存在时返回 null\n');
      } else {
        console.log('   ✗ 期望 null，实际非 null\n');
        process.exit(1);
      }
    }

    // 2. 测试 load - 正常加载
    console.log('2. 测试 load - 正常加载...');
    {
      const chatState = createTestChatState({ mode: 'SESSION', activeSession: 'my-session' });
      const sessionState = createTestSessionState({ offset: 100, lineBuffer: 'partial' });
      const state = createTestState({
        instanceId,
        chatStates: { 'chat-001': chatState },
        lastSessionMap: { 'chat-001': 'my-session' },
        sessionStates: { 'my-session': sessionState },
      });

      writeFileSync(stateFile, JSON.stringify(state), 'utf8');

      const persistence = createStatePersistence(stateFile, instanceId, debounceMs);
      const result = persistence.load();
      if (
        result !== null &&
        result.version === 1 &&
        result.instanceId === instanceId &&
        result.chatStates['chat-001']?.mode === 'SESSION' &&
        result.chatStates['chat-001']?.activeSession === 'my-session' &&
        result.lastSessionMap['chat-001'] === 'my-session' &&
        result.sessionStates['my-session']?.offset === 100 &&
        result.sessionStates['my-session']?.lineBuffer === 'partial'
      ) {
        console.log('   ✓ 正常加载返回正确数据\n');
      } else {
        console.log('   ✗ 加载数据不匹配\n');
        process.exit(1);
      }
    }

    // 3. 测试 load - instanceId 不匹配
    console.log('3. 测试 load - instanceId 不匹配...');
    {
      const state = createTestState({ instanceId: 'other-instance' });
      writeFileSync(stateFile, JSON.stringify(state), 'utf8');

      const persistence = createStatePersistence(stateFile, instanceId, debounceMs);
      const result = persistence.load();
      if (result === null) {
        console.log('   ✓ instanceId 不匹配时返回 null\n');
      } else {
        console.log('   ✗ 期望 null，实际非 null\n');
        process.exit(1);
      }
    }

    // 4. 测试 load - 版本不匹配
    console.log('4. 测试 load - 版本不匹配...');
    {
      const state = createTestState({ version: 999, instanceId });
      writeFileSync(stateFile, JSON.stringify(state), 'utf8');

      const persistence = createStatePersistence(stateFile, instanceId, debounceMs);
      const result = persistence.load();
      if (result === null) {
        console.log('   ✓ 版本不匹配时返回 null\n');
      } else {
        console.log('   ✗ 期望 null，实际非 null\n');
        process.exit(1);
      }
    }

    // 5. 测试 load - 损坏文件
    console.log('5. 测试 load - 损坏文件...');
    {
      writeFileSync(stateFile, '{ invalid json !!!', 'utf8');

      const persistence = createStatePersistence(stateFile, instanceId, debounceMs);
      try {
        persistence.load();
        console.log('   ✗ 期望抛出 StatePersistenceError\n');
        process.exit(1);
      } catch (err) {
        if (err instanceof StatePersistenceError && err.operation === 'load') {
          console.log('   ✓ 损坏文件抛出 StatePersistenceError (operation=load)\n');
        } else {
          console.log(`   ✗ 错误类型不匹配: ${(err as Error).constructor.name}\n`);
          process.exit(1);
        }
      }
    }

    // 6. 测试 scheduleSave - 防抖
    console.log('6. 测试 scheduleSave - 防抖...');
    {
      // 使用新的文件路径，避免受之前测试影响
      const debounceFile = join(testDir, 'debounce.json');
      const persistence = createStatePersistence(debounceFile, instanceId, debounceMs);

      let callCount = 0;
      const stateGetter = () => {
        callCount++;
        return createTestState({ instanceId });
      };

      // 连续调用 3 次，应只触发 1 次实际写入
      persistence.scheduleSave(stateGetter);
      persistence.scheduleSave(stateGetter);
      persistence.scheduleSave(stateGetter);

      // 等待防抖时间后检查
      await wait(debounceMs + 20);

      if (callCount === 1 && existsSync(debounceFile)) {
        const saved = JSON.parse(readFileSync(debounceFile, 'utf8')) as PersistedState;
        if (saved.instanceId === instanceId) {
          console.log('   ✓ 多次 scheduleSave 只触发一次写入\n');
        } else {
          console.log('   ✗ 写入内容不正确\n');
          process.exit(1);
        }
      } else {
        console.log(`   ✗ 期望 callCount=1 且文件存在，实际 callCount=${callCount}, exists=${existsSync(debounceFile)}\n`);
        process.exit(1);
      }
    }

    // 7. 测试 forceFlush - 立即写入
    console.log('7. 测试 forceFlush - 立即写入...');
    {
      const flushFile = join(testDir, 'flush.json');
      const persistence = createStatePersistence(flushFile, instanceId, debounceMs);

      const state = createTestState({
        instanceId,
        chatStates: { 'chat-002': createTestChatState({ mode: 'SESSION' }) },
      });

      persistence.scheduleSave(() => state);

      // 不等待防抖，直接 forceFlush
      persistence.forceFlush();

      if (existsSync(flushFile)) {
        const saved = JSON.parse(readFileSync(flushFile, 'utf8')) as PersistedState;
        if (saved.instanceId === instanceId && saved.chatStates['chat-002']?.mode === 'SESSION') {
          console.log('   ✓ forceFlush 立即写入文件\n');
        } else {
          console.log('   ✗ 写入内容不正确\n');
          process.exit(1);
        }
      } else {
        console.log('   ✗ 文件未写入\n');
        process.exit(1);
      }
    }

    // 8. 测试 forceFlush - 无待保存数据
    console.log('8. 测试 forceFlush - 无待保存数据...');
    {
      const emptyFlushFile = join(testDir, 'empty-flush.json');
      const persistence = createStatePersistence(emptyFlushFile, instanceId, debounceMs);

      try {
        persistence.forceFlush();
        console.log('   ✓ 无待保存数据时 forceFlush 不报错\n');
      } catch {
        console.log('   ✗ 不应抛出错误\n');
        process.exit(1);
      }
    }

    console.log('=== 所有测试完成 ===');
  } finally {
    // 清理临时目录
    rmSync(testDir, { recursive: true, force: true });
  }
}

main().catch(console.error);
