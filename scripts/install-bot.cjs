#!/usr/bin/env node
/**
 * 安装 omo 到用户 bin 目录
 * 创建软链接到 ~/.local/bin/<name>
 */

const { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } = require('fs');
const { resolve, dirname } = require('path');
const { homedir } = require('os');
const { execSync } = require('child_process');

const TARGET_DIR = resolve(homedir(), '.local/bin');
const RUNTIME_DIR = resolve(homedir(), '.omo_runtime');
const SCRIPT_PATH = resolve(__dirname, 'omo-bot.ts');
const CONFIG_FILE = resolve(RUNTIME_DIR, 'config.json');

const commandName = process.argv[2] || 'omo';
const LINK_PATH = resolve(TARGET_DIR, commandName);

function checkBun() {
  try {
    execSync('bun --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkExistingInstallation() {
  let stat;
  try {
    stat = lstatSync(LINK_PATH);
  } catch {
    return { installed: false, reason: 'not_exists' };
  }

  if (!stat.isSymbolicLink()) {
    return { installed: false, reason: 'not_symlink' };
  }

  let linkTarget;
  try {
    linkTarget = readlinkSync(LINK_PATH);
  } catch {
    return { installed: false, reason: 'readlink_failed' };
  }

  const resolvedTarget = resolve(dirname(LINK_PATH), linkTarget);

  if (resolvedTarget === SCRIPT_PATH) {
    return { installed: true, reason: 'correct_symlink' };
  } else {
    return { installed: false, reason: 'wrong_target' };
  }
}

function checkInPath() {
  try {
    const result = execSync(`command -v ${commandName} 2>/dev/null || echo ""`, {
      encoding: 'utf-8',
      shell: '/bin/bash'
    }).trim();
    return result !== '';
  } catch {
    return false;
  }
}

function writeConfig() {
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify({ commandName }, null, 2), 'utf-8');
}

function main() {
  console.log(`omo 安装脚本 (命令名: ${commandName})`);
  console.log('================\n');

  console.log('检查 Bun...');
  if (!checkBun()) {
    console.error('❌ 错误: Bun 未安装或不在 PATH 中');
    console.error('   请先安装 Bun: curl -fsSL https://bun.sh/install | bash');
    process.exit(1);
  }
  console.log('✓ Bun 已安装\n');

  console.log('检查目标目录...');
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
    console.log(`✓ 已创建目录: ${TARGET_DIR}\n`);
  } else {
    console.log(`✓ 目录已存在: ${TARGET_DIR}\n`);
  }

  console.log('检查现有安装...');
  const { installed, reason } = checkExistingInstallation();

  if (installed) {
    console.log(`✓ ${commandName} 已正确安装`);
    console.log(`  链接: ${LINK_PATH} -> ${SCRIPT_PATH}\n`);
  } else {
    switch (reason) {
      case 'not_exists':
        console.log('  未找到现有安装，正在创建软链接...');
        try {
          symlinkSync(SCRIPT_PATH, LINK_PATH, 'file');
          console.log(`✓ 已安装 ${commandName} 到 ${LINK_PATH}`);
          console.log(`  链接: ${LINK_PATH} -> ${SCRIPT_PATH}\n`);
        } catch (err) {
          console.error('❌ 创建软链接失败:', err.message);
          process.exit(1);
        }
        break;

      case 'not_symlink':
        console.error('❌ 错误: 文件已存在但不是软链接');
        console.error(`   路径: ${LINK_PATH}`);
        console.error('   解决方法: 先删除该文件，再重新运行安装脚本');
        process.exit(1);
        break;

      case 'wrong_target':
        console.error('❌ 错误: 软链接指向错误的目标');
        console.error('   解决方法: 先卸载 (npm run bu)，再重新安装');
        process.exit(1);
        break;

      case 'readlink_failed':
        console.error('❌ 错误: 无法读取现有软链接');
        console.error('   解决方法: 先卸载 (npm run bu)，再重新安装');
        process.exit(1);
        break;
    }
  }

  console.log('写入配置...');
  writeConfig();
  console.log(`✓ 配置已写入: ${CONFIG_FILE}\n`);

  console.log('PATH 检查');
  console.log('---------');
  if (checkInPath()) {
    console.log(`✓ ${commandName} 已在 PATH 中`);
    console.log(`  运行 \`${commandName} --help\` 查看使用说明\n`);
  } else {
    console.log(`⚠ ${commandName} 不在 PATH 中`);
    console.log(`  安装位置: ${TARGET_DIR}`);
    console.log('');
    console.log('  请确保 ~/.local/bin 在你的 PATH 中:');
    console.log('    export PATH="$HOME/.local/bin:$PATH"');
    console.log('');
  }

  console.log('安装完成!');
}

main();
