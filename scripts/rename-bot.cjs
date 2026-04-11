#!/usr/bin/env node
/**
 * 改名脚本：更新软链接和配置
 */

const { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, symlinkSync } = require('fs');
const { resolve, dirname } = require('path');
const { homedir } = require('os');

const TARGET_DIR = resolve(homedir(), '.local/bin');
const RUNTIME_DIR = resolve(homedir(), '.omo_runtime');
const CONFIG_FILE = resolve(RUNTIME_DIR, 'config.json');
const SCRIPT_PATH = resolve(__dirname, 'omo-bot.ts');

const newName = process.argv[2];

if (!newName) {
  console.error('用法: npm run br <new-name>');
  console.error('示例: npm run br mybot');
  process.exit(1);
}

let oldName = 'omo-bot';
if (existsSync(CONFIG_FILE)) {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    oldName = config.commandName || 'omo-bot';
  } catch {
    // ignore
  }
}

const oldLink = resolve(TARGET_DIR, oldName);
const newLink = resolve(TARGET_DIR, newName);

console.log(`改名: ${oldName} -> ${newName}`);
console.log('================\n');

if (oldName === newName) {
  console.log(`✓ 命令名已经是 "${newName}"，无需更改`);
  process.exit(0);
}

if (existsSync(oldLink) || (lstatSync(oldLink).isSymbolicLink?.())) {
  try {
    unlinkSync(oldLink);
    console.log(`✓ 已删除旧链接: ${oldLink}`);
  } catch (err) {
    console.error(`❌ 删除旧链接失败: ${err.message}`);
    process.exit(1);
  }
}

if (!existsSync(TARGET_DIR)) {
  mkdirSync(TARGET_DIR, { recursive: true });
}

try {
  symlinkSync(SCRIPT_PATH, newLink, 'file');
  console.log(`✓ 已创建新链接: ${newLink}`);
} catch (err) {
  console.error(`❌ 创建新链接失败: ${err.message}`);
  process.exit(1);
}

if (!existsSync(RUNTIME_DIR)) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
}
writeFileSync(CONFIG_FILE, JSON.stringify({ commandName: newName }, null, 2), 'utf-8');
console.log(`✓ 已更新配置: ${CONFIG_FILE}\n`);

console.log('改名完成!');
console.log(`  新命令: ${newName}`);
