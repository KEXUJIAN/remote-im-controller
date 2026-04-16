/**
 * Remote IM Controller - 进程锁模块
 * 
 * 防止多实例并发启动，通过 PID 文件实现进程锁。
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs';
import { dirname } from 'path';

// ==================== 类型定义 ====================

/** 锁获取成功结果 */
export interface LockAcquired {
  acquired: true;
}

/** 锁获取失败结果 */
export interface LockFailed {
  acquired: false;
  message: string;
  pid: number;
}

/** 锁获取结果 */
export type LockResult = LockAcquired | LockFailed;

// ==================== 辅助函数 ====================

/**
 * 检查进程是否存活
 * @param pid 进程 ID
 * @returns 是否存活
 */
export function isProcessRunning(pid: number): boolean {
  // 如果是当前进程，直接返回 true
  if (pid === process.pid) {
    return true;
  }

  try {
    process.kill(pid, 0);
    // Linux 下进一步验证进程名，防止 PID 复用
    if (process.platform === 'linux') {
      try {
        const comm = readFileSync(`/proc/${pid}/comm`, 'utf-8').trim();
        // 检查是否为 node 相关进程
        return comm.includes('node');
      } catch {
        // 无法读取 /proc 文件，可能进程已退出或权限不足
        // 回退到仅依赖 process.kill 检测
        return true;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 确保锁文件所在目录存在
 * @param lockFile 锁文件路径
 */
function ensureLockDir(lockFile: string): void {
  const dir = dirname(lockFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 读取锁文件中的 PID
 * @param lockFile 锁文件路径
 * @returns PID 或 null
 */
function readLockPid(lockFile: string): number | null {
  if (!existsSync(lockFile)) {
    return null;
  }

  try {
    const content = readFileSync(lockFile, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// ==================== 主要函数 ====================

/**
 * 获取进程锁
 * 
 * 使用原子文件创建防止竞态条件：
 * - 如果锁文件不存在，创建并写入当前 PID
 * - 如果锁文件存在，检查持有者进程是否存活
 * - 如果持有者已死，清理锁文件并重新获取
 * - 如果持有者存活，返回失败
 * 
 * @param lockFile 锁文件路径
 * @returns 锁获取结果
 */
export function acquireLock(lockFile: string): LockResult {
  // 确保目录存在
  ensureLockDir(lockFile);

  // 尝试原子创建文件
  let fd: number;
  try {
    fd = openSync(lockFile, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // 文件已存在，检查持有者进程
      const existingPid = readLockPid(lockFile);
      
      if (existingPid === null) {
        // 无法读取 PID，文件可能损坏，尝试清理
        try {
          unlinkSync(lockFile);
          // 重试获取
          return acquireLock(lockFile);
        } catch {
          return { acquired: false, message: '无法读取或清理锁文件', pid: 0 };
        }
      }

      // 检查进程是否存活
      if (isProcessRunning(existingPid)) {
        return {
          acquired: false,
          message: `Another instance is already running (PID: ${existingPid})`,
          pid: existingPid,
        };
      }

      // 进程已死，清理锁文件并重试
      try {
        unlinkSync(lockFile);
      } catch {
        // 清理失败，可能被其他进程抢占
        return { acquired: false, message: '无法清理过期锁文件', pid: existingPid };
      }

      // 重试获取
      return acquireLock(lockFile);
    }

    // 其他错误
    throw err;
  }

  // 成功创建文件，写入当前 PID
  try {
    writeSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }

  return { acquired: true };
}

/**
 * 释放进程锁
 * 
 * 删除锁文件。如果文件不存在则静默处理。
 * 
 * @param lockFile 锁文件路径
 */
export function releaseLock(lockFile: string): void {
  try {
    if (existsSync(lockFile)) {
      unlinkSync(lockFile);
    }
  } catch {
    // 忽略删除失败
  }
}

// ==================== 内联测试 ====================

if (process.argv[2] === 'test') {
  const { join } = await import('path');
  const { tmpdir } = await import('os');
  
  // 创建测试用的临时目录
  const testDir = join(tmpdir(), 'process-lock-test', String(Date.now()));
  const testLockFile = join(testDir, 'test.pid');
  const staleLockFile = join(testDir, 'stale.pid');
  const noDirLockFile = join(testDir, 'nested', 'dir', 'nested.pid');
  
  console.log('=== 进程锁模块测试 ===\n');
  console.log(`测试目录: ${testDir}`);
  console.log(`当前 PID: ${process.pid}\n`);

  // 测试 1: acquireLock() 成功获取锁
  console.log('1. 测试 acquireLock() 成功获取锁...');
  const result1 = acquireLock(testLockFile);
  if (result1.acquired) {
    console.log('   ✓ 成功获取锁');
    console.log(`   ✓ 锁文件内容: ${readFileSync(testLockFile, 'utf-8').trim()}`);
  } else {
    console.log(`   ✗ 获取锁失败: ${result1.message}`);
    process.exit(1);
  }

  // 测试 2: acquireLock() 拒绝重复获取
  console.log('\n2. 测试 acquireLock() 拒绝重复获取...');
  const result2 = acquireLock(testLockFile);
  if (!result2.acquired && result2.pid === process.pid) {
    console.log(`   ✓ 正确拒绝重复获取: ${result2.message}`);
  } else {
    console.log('   ✗ 未正确拒绝重复获取');
    process.exit(1);
  }

  // 测试 3: releaseLock() 成功释放锁
  console.log('\n3. 测试 releaseLock() 成功释放锁...');
  releaseLock(testLockFile);
  if (!existsSync(testLockFile)) {
    console.log('   ✓ 锁文件已删除');
  } else {
    console.log('   ✗ 锁文件未删除');
    process.exit(1);
  }

  // 再次获取确认释放成功
  const result3 = acquireLock(testLockFile);
  if (result3.acquired) {
    console.log('   ✓ 释放后可重新获取');
    releaseLock(testLockFile);
  } else {
    console.log('   ✗ 释放后无法重新获取');
    process.exit(1);
  }

  // 测试 4: stale PID 清理（使用不存在的 PID）
  console.log('\n4. 测试 stale PID 清理...');
  // 手动创建一个包含不存在 PID 的锁文件
  ensureLockDir(staleLockFile);
  const stalePid = 99999;
  const { writeFileSync } = await import('fs');
  writeFileSync(staleLockFile, String(stalePid), 'utf-8');
  console.log(`   创建了 stale 锁文件 (PID: ${stalePid})`);
  
  const result4 = acquireLock(staleLockFile);
  if (result4.acquired) {
    console.log('   ✓ 成功清理 stale PID 并获取锁');
    releaseLock(staleLockFile);
  } else {
    console.log(`   ✗ 清理 stale PID 失败: ${result4.message}`);
    process.exit(1);
  }

  // 测试 5: 目录不存在时自动创建
  console.log('\n5. 测试目录不存在时自动创建...');
  const result5 = acquireLock(noDirLockFile);
  if (result5.acquired) {
    console.log('   ✓ 自动创建嵌套目录并获取锁');
    const content = readFileSync(noDirLockFile, 'utf-8').trim();
    console.log(`   ✓ 锁文件内容: ${content}`);
    releaseLock(noDirLockFile);
  } else {
    console.log(`   ✗ 自动创建目录失败: ${result5.message}`);
    process.exit(1);
  }

  // 测试 6: isProcessRunning() 函数
  console.log('\n6. 测试 isProcessRunning() 函数...');
  // 当前进程应该存活
  if (isProcessRunning(process.pid)) {
    console.log(`   ✓ 当前进程 ${process.pid} 存活`);
  } else {
    console.log(`   ✗ 当前进程 ${process.pid} 未检测到存活`);
    process.exit(1);
  }
  
  // 不存在的 PID 应该不存活
  if (!isProcessRunning(99999)) {
    console.log('   ✓ PID 99999 检测为不存在');
  } else {
    console.log('   ✗ PID 99999 错误检测为存活');
    process.exit(1);
  }

  // 清理测试目录
  console.log('\n7. 清理测试目录...');
  try {
    const { rmSync } = await import('fs');
    rmSync(join(tmpdir(), 'process-lock-test'), { recursive: true, force: true });
    console.log('   ✓ 测试目录已清理');
  } catch (err) {
    console.log(`   ! 清理测试目录失败: ${err}`);
  }

  console.log('\n=== 所有测试通过 ===');
}