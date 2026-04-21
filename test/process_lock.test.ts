/**
 * Remote IM Controller - 进程锁模块测试
 */

import {
  acquireLock,
  releaseLock,
  isProcessRunning,
} from '../src/utils/process_lock.js';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

async function main() {
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
  mkdirSync(dirname(staleLockFile), { recursive: true });
  const stalePid = 99999;
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
    rmSync(join(tmpdir(), 'process-lock-test'), { recursive: true, force: true });
    console.log('   ✓ 测试目录已清理');
  } catch (err) {
    console.log(`   ! 清理测试目录失败: ${err}`);
  }

  console.log('\n=== 所有测试通过 ===');
}

main().catch(console.error);
