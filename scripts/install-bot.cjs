#!/usr/bin/env node
/**
 * 安装 omo-bot 到用户 bin 目录
 * 创建软链接到 ~/.local/bin/omo-bot
 */

const { symlink, mkdir, access } = require('fs/promises');
const { resolve, dirname } = require('path');
const { homedir } = require('os');

const TARGET_DIR = resolve(homedir(), '.local/bin');
const SCRIPT_PATH = resolve(__dirname, 'omo-bot.ts');
const LINK_PATH = resolve(TARGET_DIR, 'omo-bot');

async function main() {
  try {
    // 确保 ~/.local/bin 存在
    await mkdir(TARGET_DIR, { recursive: true });
    
    // 检查是否已存在
    try {
      await access(LINK_PATH);
      console.log('omo-bot 已安装，跳过');
      return;
    } catch {
      // 不存在，继续安装
    }
    
    // 创建软链接
    await symlink(SCRIPT_PATH, LINK_PATH, 'file');
    console.log(`✓ 已安装 omo-bot 到 ${LINK_PATH}`);
    console.log('请确保 ~/.local/bin 在 PATH 中');
  } catch (err) {
    console.error('安装失败:', err.message);
    process.exit(1);
  }
}

main();
