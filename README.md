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

完整环境变量列表见 [AGENTS.md](AGENTS.md#环境变量)。

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
help
```

如果配置正确，机器人会回复帮助信息。

## 指令说明

| 指令 | 说明 | 示例 |
|------|------|------|
| `help` | 显示帮助 | `help` |
| `list` | 列出所有会话 | `list` |
| `create <name>` | 创建会话 | `create opencode` |
| `kill <name>` | 终止会话 | `kill opencode` |
| `<session> <command>` | 执行命令 | `opencode ls -la` |

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

项目提供 `omo` 脚本作为 OpenCode CLI 的远程调度工具。

### 前置条件

- Bun 运行时
- OpenCode CLI (`npm install -g opencode`)
- `~/.local/bin` 在 PATH 中

### 安装

```bash
npm run bi              # 默认安装为 omo
npm run bi mybot        # 安装为 mybot
```

### 改名

```bash
npm run br mybot        # 改名为 mybot
```

### 卸载

```bash
npm run bu
```

### 命令

```
omo start                    启动 opencode serve
omo stop                     停止服务并清理会话
omo new                      创建新会话（空）
omo new:exec <prompt>        创建会话并执行
omo new:plan <prompt>        创建会话并规划
omo new:deep <prompt>        创建会话并深度研究
omo new:explore <prompt>     创建会话并只读探索
omo exec <prompt>            继续当前会话并执行
omo plan <prompt>            继续当前会话并规划
omo deep <prompt>            继续当前会话并深度研究
omo explore <prompt>         继续当前会话并只读探索
```

### 工作流程

```bash
omo start                    # 启动服务
omo new:exec 修复登录bug     # 创建会话并执行
omo exec 继续实现            # 继续对话
omo new                      # 开新局
omo plan 设计认证系统        # 规划模式
omo stop                     # 停止服务
```

### 路径说明

| 路径类型 | 路径 | 说明 |
|---------|------|------|
| 安装目录 | `~/.local/bin` | 软链接所在目录 |
| 运行时目录 | `~/.omo_runtime` | 自动创建 |
| 配置文件 | `~/.omo_runtime/config.json` | 命令名配置 |
| PID 文件 | `~/.omo_runtime/omo_server.pid` | 服务进程 ID |
| 日志文件 | `~/.omo_runtime/omo_server.log` | 服务输出日志 |
| 服务地址 | `http://127.0.0.1:4096` | OpenCode serve 地址 |

### 飞书集成

在飞书 SESSION 模式下，可以直接发送 `omo xxx` 命令。系统会自动注入 chatId 实现会话隔离。

详细文档见 [docs/OMO_BOT_ARCH.md](docs/OMO_BOT_ARCH.md)

## 文档

- [飞书配置说明书](docs/FEISHU_SETUP.md) - 详细的应用配置步骤
- [指令系统设计](docs/COMMAND_DESIGN.md) - 指令格式和解析方案
- [架构说明书](docs/ARCHITECTURE.md) - 技术架构和模块设计
- [AGENTS.md](AGENTS.md) - 开发指南、环境变量、测试命令

## License

MIT
