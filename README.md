# Remote IM Controller

通过飞书 WebSocket 长连接远程控制 WSL 终端的 Node.js 守护进程。

## 功能特性

- 📱 通过飞书接收远程指令
- 💻 控制 tmux 会话执行命令
- 📺 流式推送终端输出回飞书
- 🔒 基于用户 ID 的鉴权机制
- 🔄 自动断线重连
- 🔐 忙碌状态锁定（防止并发命令冲突）
- 📝 详细日志记录
- 🎯 TypeScript 类型安全

## 前置条件

- Node.js >= 18.x
- tmux >= 3.0
- PM2（可选，用于生产部署）

```bash
# 安装 tmux
sudo apt install tmux    # Ubuntu/Debian
brew install tmux        # macOS

# 验证安装
tmux -V
node -v
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置飞书应用

请参考 [飞书配置说明书](docs/FEISHU_SETUP.md) 完成以下步骤：

1. 创建飞书企业自建应用
2. 启用机器人能力
3. 配置权限和事件订阅
4. 发布应用

### 3. 配置环境变量

```bash
# 复制模板
cp .env.example .env

# 编辑配置
vim .env
```

必填配置：
- `FEISHU_APP_ID` - 飞书应用 ID
- `FEISHU_APP_SECRET` - 飞书应用密钥
- `ADMIN_OPEN_ID` - 管理员 Open ID

可选配置：
- `LOG_DIR` - 日志目录（默认 `./logs`，tmux 临时文件也会放这里）
- `LOG_LEVEL` - 日志级别（默认 `info`）
- `TMUX_DEBUG` - 开启 tmux 详细日志（默认 `false`，设为 `true` 时日志写入 `LOG_DIR`）
- `SESSION_TIMEOUT_MS` - 会话超时时间 ms（默认 600000，即 10 分钟）
- `STREAM_PUSH_INTERVAL_MS` - 流式推送间隔 ms（默认 2000）
- `POLL_INTERVAL` - 轮询间隔 ms（默认 3000）
- `POLL_TIMEOUT` - 轮询超时 ms（默认 60000）
- `POLL_FINAL_DELAY` - 进程结束后等待时间 ms（默认 500）
- `POLL_TIMEOUT_CHECK_COUNT` - 超时后额外检测次数（默认 3）

### 4. 启动服务

**开发模式**（热重载）：
```bash
npm run dev
```

**生产模式**：
```bash
# 构建
npm run build

# 使用 PM2 启动
pm2 start ecosystem.config.cjs
```

### 5. 测试连接

给飞书机器人发送消息：
```
/cmd help
```

如果配置正确，机器人会回复帮助信息。

## 指令说明

| 指令 | 说明 | 示例 |
|------|------|------|
| `/cmd help` | 显示帮助 | `/cmd help` |
| `/cmd list` | 列出所有会话 | `/cmd list` |
| `/cmd create <name>` | 创建会话 | `/cmd create opencode` |
| `/cmd kill <name>` | 终止会话 | `/cmd kill opencode` |
| `/cmd <session> <command>` | 执行命令 | `/cmd opencode ls -la` |

## SESSION 模式流式推送机制

SESSION 模式下命令发送后，使用流式推送机制获取输出：

1. **PS1 边界标记**：会话创建时注入 OSC 标记 `\x1b]99;CMD_END\x07`
2. **流式推送**：定时读取 pipe-pane 日志增量输出
3. **完成检测**：检测到 PS1 标记时认为命令完成
4. **忙碌状态**：命令执行期间锁定，拒绝新命令

### PS1 标记注入

使用 `$'...'` ANSI-C quoting 语法确保转义序列正确解释：

**bash**:
```bash
export PS1=$'\e]99;CMD_END\a$ '
```

**zsh**:
```bash
unset zle_bracket_paste
export PS1=$'%{%f%b%k%}\e]99;CMD_END\a%# '
```

关键点：
- `\e` = ESC 字符 (0x1b)
- `\a` = BEL 字符 (0x07)
- zsh 需要先禁用 `zle_bracket_paste` 避免干扰

### 忙碌状态

当用户正在执行命令时，会话处于忙碌状态：
- 新命令会被拒绝，返回 "⏳ 请等待当前命令完成..."
- 忙碌状态通过 `StateManager.isBusy()` 检查

## 模块测试

每个模块可独立测试：

```bash
# 测试 tmux 控制模块
npm run test:tmux

# 测试飞书通信模块（模拟模式）
npm run test:feishu

# 测试状态机模块
npm run test:state

# 测试核心处理器
npm run test:core

# 测试 Session 输出管理模块
npm run test:output

# 类型检查
npm run typecheck
```

## 项目结构

```
remote-im-controller/
├── package.json
├── tsconfig.json           # TypeScript 配置
├── ecosystem.config.cjs    # PM2 配置
├── .env.example            # 环境变量模板
├── docs/
│   ├── FEISHU_SETUP.md     # 飞书配置说明书
│   ├── COMMAND_DESIGN.md   # 指令系统设计
│   └── ARCHITECTURE.md     # 架构说明
├── src/
│   ├── app.ts              # 主入口（飞书模式）
│   ├── cli.ts              # CLI 入口（本地测试）
│   ├── config.ts           # 配置加载模块
│   ├── types.ts            # 类型定义
│   ├── errors.ts           # 自定义错误类
│   ├── logger.ts           # 日志模块
│   ├── state_manager.ts    # 状态机模块
│   ├── core_processor.ts   # 核心处理器
│   ├── tmux_manager.ts     # tmux 控制
│   ├── command_parser.ts   # 指令解析
│   ├── command_router.ts   # 指令路由
│   ├── feishu_bot.ts       # 飞书通信
│   ├── session_output_manager.ts # Session 输出管理
│   ├── utils/              # 工具函数
│   │   ├── ensure_log_dir.ts     # 日志目录初始化
│   │   ├── error.ts              # 错误转换
│   │   └── terminal_cleaner.ts   # 终端序列清理
│   ├── services/           # 服务模块
│   │   └── timeout_checker.ts    # 超时检查
│   └── adapters/           # 适配器模块
├── dist/                   # 编译输出
└── logs/                   # 日志目录
```

## 文档

- [飞书配置说明书](docs/FEISHU_SETUP.md) - 详细的应用配置步骤
- [指令系统设计](docs/COMMAND_DESIGN.md) - 指令格式和解析方案
- [架构说明书](docs/ARCHITECTURE.md) - 技术架构和模块设计

## 故障排查

### 收不到消息

1. 检查飞书应用是否已发布
2. 检查事件订阅是否配置正确
3. 设置 `LOG_LEVEL=debug` 查看详细日志

### tmux 命令执行失败

1. 确认 tmux 已安装：`tmux -V`
2. 确认会话存在：`tmux ls`
3. 检查用户权限

### 连接断开

应用会自动重连，最多重试 5 次。如果持续失败，检查网络连接。

## WSL 调度脚本

项目提供 `omo-bot.ts` 脚本作为 OpenCode CLI 的远程调度包装器：

### 前置条件

- Bun 运行时
- OpenCode CLI (`npm install -g opencode`)
- `~/.local/bin` 在 PATH 中

### 安装

```bash
npm run install-bot
```

安装后会创建软链接 `~/.local/bin/omo-bot` -> 项目 `scripts/omo-bot.ts`。

### 使用

```bash
# 启动 omo-server
omo-bot start

# 创建任务计划（通过 prometheus agent）
omo-bot plan 修复登录模块bug

# 执行任务（通过 sisyphus agent）
omo-bot exec 实现用户认证功能

# 停止服务
omo-bot stop

# 查看帮助
omo-bot help
```

### 卸载

```bash
npm run uninstall-bot
```

### 路径说明

| 路径类型 | 路径 | 说明 |
|---------|------|------|
| 安装目录 | `~/.local/bin` | 软链接所在目录 |
| 软链接 | `~/.local/bin/omo-bot` | 指向 `scripts/omo-bot.ts` |
| 运行时目录 | `~/.omo_runtime` | 自动创建 |
| PID 文件 | `~/.omo_runtime/omo_server.pid` | 记录服务进程 ID |
| 日志文件 | `~/.omo_runtime/omo_server.log` | 服务输出日志 |
| 服务地址 | `http://127.0.0.1:4096` | OpenCode serve 监听地址 |

### 工作原理

`plan` 和 `exec` 命令会 attach 到本地运行的 `opencode serve` 服务（默认端口 4096），而不是直接执行 shell 命令。请确保先运行 `omo-bot start` 启动服务。

## License

MIT
