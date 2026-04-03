#!/usr/bin/env node
/**
 * 卸载 omo-bot
 * 删除 ~/.local/bin/omo-bot 软链接
 */

const { unlink, access } = require('fs/promises');
const { resolve } = require('path');
const { homedir } = require('os');

const LINK_PATH = resolve(homedir(), '.local/bin/omo-bot');

async function main() {
  try {
    await access(LINK_PATH);
    await unlink(LINK_PATH);
    console.log('✓ 已卸载 omo-bot');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('omo-bot 未安装');
    } else {
      console.error('卸载失败:', err.message);
      process.exit(1);
    }
  }
}

main();
