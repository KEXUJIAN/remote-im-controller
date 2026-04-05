#!/usr/bin/env node
/**
 * 卸载 omo-bot
 * 仅删除指向当前项目 scripts/omo-bot.ts 的软链接
 */

const { lstatSync, readlinkSync, unlinkSync, existsSync } = require('fs');
const { resolve, dirname } = require('path');
const { homedir } = require('os');

const LINK_PATH = resolve(homedir(), '.local/bin/omo-bot');
const SCRIPT_PATH = resolve(__dirname, 'omo-bot.ts');

function main() {
  // 场景 1: 目标不存在 → 返回成功
  if (!existsSync(LINK_PATH)) {
    console.log('omo-bot 未安装');
    return;
  }

  // 场景 2: 目标不是符号链接 → 拒绝删除
  const stats = lstatSync(LINK_PATH);
  if (!stats.isSymbolicLink()) {
    console.error('⚠ 拒绝删除：~/.local/bin/omo-bot 不是软链接');
    console.error('  如果确定要删除，请手动执行：rm ~/.local/bin/omo-bot');
    process.exit(1);
  }

  // 场景 3: 符号链接指向其他文件 → 拒绝删除
  const linkTarget = readlinkSync(LINK_PATH);
  const resolvedTarget = resolve(dirname(LINK_PATH), linkTarget);

  if (resolvedTarget !== SCRIPT_PATH) {
    console.error('⚠ 拒绝删除：~/.local/bin/omo-bot 指向其他文件');
    console.error(`  当前指向: ${resolvedTarget}`);
    console.error(`  预期指向: ${SCRIPT_PATH}`);
    console.error('  如果确定要删除，请手动执行：rm ~/.local/bin/omo-bot');
    process.exit(1);
  }

  // 场景 4: 正确的符号链接 → 删除
  unlinkSync(LINK_PATH);
  console.log('✓ 已卸载 omo-bot');
}

main();
