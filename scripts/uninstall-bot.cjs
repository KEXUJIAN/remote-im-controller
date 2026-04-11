#!/usr/bin/env node
/**
 * 卸载 omo
 */

const { lstatSync, readlinkSync, unlinkSync, existsSync, readFileSync } = require('fs');
const { resolve, dirname } = require('path');
const { homedir } = require('os');

const TARGET_DIR = resolve(homedir(), '.local/bin');
const RUNTIME_DIR = resolve(homedir(), '.omo_runtime');
const CONFIG_FILE = resolve(RUNTIME_DIR, 'config.json');
const SCRIPT_PATH = resolve(__dirname, 'omo-bot.ts');

let commandName = 'omo';
if (existsSync(CONFIG_FILE)) {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    commandName = config.commandName || 'omo';
  } catch {
    // ignore
  }
}

const LINK_PATH = resolve(TARGET_DIR, commandName);

function main() {
  console.log(`卸载 ${commandName}`);
  console.log('================\n');

  if (existsSync(LINK_PATH)) {
    const stats = lstatSync(LINK_PATH);
    if (!stats.isSymbolicLink()) {
      console.error(`⚠ 拒绝删除：${LINK_PATH} 不是软链接`);
      console.error('  如果确定要删除，请手动执行');
      process.exit(1);
    }

    const linkTarget = readlinkSync(LINK_PATH);
    const resolvedTarget = resolve(dirname(LINK_PATH), linkTarget);

    if (resolvedTarget !== SCRIPT_PATH) {
      console.error(`⚠ 拒绝删除：${LINK_PATH} 指向其他文件`);
      console.error('  如果确定要删除，请手动执行');
      process.exit(1);
    }

    unlinkSync(LINK_PATH);
    console.log(`✓ 已删除软链接: ${LINK_PATH}`);
  } else {
    console.log(`✓ ${commandName} 未安装`);
  }

  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
    console.log(`✓ 已删除配置: ${CONFIG_FILE}`);
  }

  console.log('\n卸载完成!');
}

main();
