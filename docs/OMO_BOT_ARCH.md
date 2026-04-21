# omo 架构文档

## 概述

`omo` 是 OpenCode CLI 的远程调度工具，支持本地命令行和飞书 SESSION 模式下的远程调用，实现会话隔离和生命周期管理。

## 命令集

### 服务管理

```
omo start     启动 opencode serve
omo stop      停止服务并清理会话
```

### 会话管理

```
omo new                    创建新会话（空）
omo new:exec <prompt>      创建会话并执行
omo new:plan <prompt>      创建会话并规划
omo new:deep <prompt>      创建会话并深度研究
omo new:explore <prompt>   创建会话并只读探索
```

### 继续对话

```
omo exec <prompt>          继续当前会话并执行
omo plan <prompt>          继续当前会话并规划
omo deep <prompt>          继续当前会话并深度研究
omo explore <prompt>       继续当前会话并只读探索
```

## 模式前缀

| 模式 | 前缀 |
|------|------|
| plan | `【仅规划】请仅输出计划，不要修改代码：` |
| deep | `【深度研究】请深入分析：` |
| explore | `【只读探索】请只读取和分析，不要修改代码：` |

## 生命周期

```
start → new → exec/plan/deep/explore → new → ... → stop（清理）
```

### 状态说明

| 阶段 | 状态 |
|------|------|
| start | serve 运行中 |
| new | 新 session 创建，旧 session 被替换 |
| exec/plan/deep/explore | 当前 session 继续对话 |
| stop | serve 停止，所有 session 文件被清理 |

## 存储

### 目录结构

```
~/.omo_runtime/
  ├── config.json              # 命令名配置
  ├── omo_server.pid           # serve 进程 ID
  ├── omo_server.log           # serve 日志
  ├── default.session          # 独立运行的 session ID
  └── chat_<chatId>.session    # 飞书场景的 session ID
```

### 配置文件

```json
{
  "commandName": "omo"
}
```

## 技术实现

### 本地运行

```
omo <command>
    ↓
scripts/omo-bot.ts
    ↓
POST /session (创建会话时)
    ↓
opencode run -s <sessionId> <prompt>
    ↓
输出到控制台
```

### 飞书集成

```
飞书消息: omo exec 修复bug
    ↓
Node.js core_processor.ts 检测前缀
    ↓
注入环境变量: OMO_CHAT_ID=<chatId> omo exec 修复bug
    ↓
tmux send-keys (透传到终端)
    ↓
scripts/omo-bot.ts 读取 OMO_CHAT_ID
    ↓
读取 ~/.omo_runtime/chat_<chatId>.session
    ↓
opencode run -s <sessionId> 修复bug
```

### 会话隔离

飞书场景下，每个 chatId 对应独立的 session 文件：

- chatId `oc_123` → `~/.omo_runtime/chat_oc_123.session`
- chatId `oc_456` → `~/.omo_runtime/chat_oc_456.session`

## 安装管理

### 安装

```bash
npm run bi [name]    # 默认 omo
```

创建软链接 `~/.local/bin/<name>` → `scripts/omo-bot.ts`

写入配置到 `~/.omo_runtime/config.json`

### 改名

```bash
npm run br <name>
```

删除旧软链接，创建新软链接，更新配置。

### 卸载

```bash
npm run bu
```

删除软链接和配置文件。

## 错误处理

| 错误 | 原因 | 解决 |
|------|------|------|
| `omo-server 未运行` | serve 未启动 | 执行 `omo start` |
| `没有活跃会话` | 未执行过 new | 执行 `omo new` 或 `omo new:xxx` |
| `缺少 prompt 参数` | 命令未带 prompt | 添加 prompt 参数 |

## 文件清单

| 文件 | 说明 |
|------|------|
| `scripts/omo-bot.ts` | 主脚本 |
| `scripts/install-bot.cjs` | 安装脚本 |
| `scripts/rename-bot.cjs` | 改名脚本 |
| `scripts/uninstall-bot.cjs` | 卸载脚本 |
| `src/core_processor.ts` | Node.js 端命令检测 |
