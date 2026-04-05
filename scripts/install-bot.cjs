#!/usr/bin/env node
/**
 * 安装 omo-bot 到用户 bin 目录
 * 创建软链接到 ~/.local/bin/omo-bot
 * 
 * 功能：
 * - 检查 Bun 是否可执行
 * - 幂等安装：正确 symlink 存在时返回成功
 * - 冲突处理：错误目标或普通文件时报错退出
 */

const { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } = require('fs');
const { resolve, dirname } = require('path');
const { homedir } = require('os');
const { execSync } = require('child_process');

const TARGET_DIR = resolve(homedir(), '.local/bin');
const SCRIPT_PATH = resolve(__dirname, 'omo-bot.ts');
const LINK_PATH = resolve(TARGET_DIR, 'omo-bot');

/**
 * 检查 Bun 是否可执行
 */
function checkBun() {
  try {
    execSync('bun --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查 omo-bot 是否已正确安装
 * 注意：使用 lstatSync 而非 existsSync，因为后者会跟随 symlink
 * @returns {{ installed: boolean; reason: string }}
 */
function checkExistingInstallation() {
  // 使用 lstatSync 检查链接本身（不跟随 symlink）
  let stat;
  try {
    stat = lstatSync(LINK_PATH);
  } catch (err) {
    // 文件不存在
    return { installed: false, reason: 'not_exists' };
  }
  
  // 检查是否为 symlink
  if (!stat.isSymbolicLink()) {
    return { installed: false, reason: 'not_symlink' };
  }

  // 读取 symlink 目标
  let linkTarget;
  try {
    linkTarget = readlinkSync(LINK_PATH);
  } catch (err) {
    return { installed: false, reason: 'readlink_failed' };
  }

  // 解析为绝对路径进行比较
  const resolvedTarget = resolve(dirname(LINK_PATH), linkTarget);
  
  if (resolvedTarget === SCRIPT_PATH) {
    return { installed: true, reason: 'correct_symlink' };
  } else {
    return { installed: false, reason: 'wrong_target' };
  }
}

/**
 * 检查 omo-bot 是否在 PATH 中
 */
function checkInPath() {
  try {
    const result = execSync('command -v omo-bot 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      shell: '/bin/bash'
    }).trim();
    return result !== '';
  } catch {
    return false;
  }
}

function main() {
  console.log('omo-bot 安装脚本');
  console.log('================\n');

  // 1. 检查 Bun
  console.log('检查 Bun...');
  if (!checkBun()) {
    console.error('❌ 错误: Bun 未安装或不在 PATH 中');
    console.error('   请先安装 Bun: curl -fsSL https://bun.sh/install | bash');
    process.exit(1);
  }
  console.log('✓ Bun 已安装\n');

  // 2. 确保 ~/.local/bin 存在
  console.log('检查目标目录...');
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
    console.log(`✓ 已创建目录: ${TARGET_DIR}\n`);
  } else {
    console.log(`✓ 目录已存在: ${TARGET_DIR}\n`);
  }

  // 3. 检查现有安装
  console.log('检查现有安装...');
  const { installed, reason } = checkExistingInstallation();

  if (installed) {
    console.log('✓ omo-bot 已正确安装');
    console.log(`  链接: ${LINK_PATH} -> ${SCRIPT_PATH}\n`);
  } else {
    switch (reason) {
      case 'not_exists':
        // 不存在，创建 symlink
        console.log('  未找到现有安装，正在创建软链接...');
        try {
          symlinkSync(SCRIPT_PATH, LINK_PATH, 'file');
          console.log(`✓ 已安装 omo-bot 到 ${LINK_PATH}`);
          console.log(`  链接: ${LINK_PATH} -> ${SCRIPT_PATH}\n`);
        } catch (err) {
          console.error('❌ 创建软链接失败:', err.message);
          process.exit(1);
        }
        break;

      case 'not_symlink':
        console.error('❌ 错误: 文件已存在但不是软链接');
        console.error(`   路径: ${LINK_PATH}`);
        console.error('');
        console.error('   解决方法:');
        console.error('   1. 如果这是你手动创建的文件，请先删除:');
        console.error(`      rm "${LINK_PATH}"`);
        console.error('   2. 然后重新运行安装脚本');
        process.exit(1);
        break;

      case 'wrong_target':
        const wrongTarget = readlinkSync(LINK_PATH);
        console.error('❌ 错误: 软链接指向错误的目标');
        console.error(`   当前指向: ${wrongTarget}`);
        console.error(`   应该指向: ${SCRIPT_PATH}`);
        console.error('');
        console.error('   解决方法:');
        console.error('   1. 删除现有链接:');
        console.error(`      rm "${LINK_PATH}"`);
        console.error('   2. 重新运行安装脚本');
        process.exit(1);
        break;

      case 'readlink_failed':
        console.error('❌ 错误: 无法读取现有软链接');
        console.error(`   路径: ${LINK_PATH}`);
        console.error('');
        console.error('   解决方法:');
        console.error('   1. 删除现有链接:');
        console.error(`      rm "${LINK_PATH}"`);
        console.error('   2. 重新运行安装脚本');
        process.exit(1);
        break;
    }
  }

  // 4. PATH 检查提示
  console.log('PATH 检查');
  console.log('---------');
  if (checkInPath()) {
    console.log('✓ omo-bot 已在 PATH 中');
    console.log('  运行 `omo-bot --help` 查看使用说明\n');
  } else {
    console.log('⚠ omo-bot 不在 PATH 中');
    console.log(`  安装位置: ${TARGET_DIR}`);
    console.log('');
    console.log('  请确保 ~/.local/bin 在你的 PATH 中:');
    console.log('');
    console.log('  Bash 用户，添加到 ~/.bashrc:');
    console.log('    export PATH="$HOME/.local/bin:$PATH"');
    console.log('');
    console.log('  Zsh 用户，添加到 ~/.zshrc:');
    console.log('    export PATH="$HOME/.local/bin:$PATH"');
    console.log('');
    console.log('  添加后运行: source ~/.bashrc  或  source ~/.zshrc');
    console.log('');
  }

  console.log('安装完成!');
}

main();
