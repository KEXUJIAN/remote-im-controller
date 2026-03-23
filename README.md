# Remote IM Controller

通过飞书 WebSocket 长连接远程控制 WSL 终端的 Node.js 守护进程。

## 功能特性

- 📱 通过飞书接收远程指令
- 💻 控制 tmux 会话执行命令
- 📺 抓取终端输出推送回飞书
- 🔒 基于用户 ID 的鉴权机制
- 🔄 自动断线重连
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

## 模块测试

每个模块可独立测试：

```bash
# 测试 tmux 控制模块
npm run test:tmux

# 测试文本解析模块
npm run test:parser

# 测试飞书通信模块（模拟模式）
npm run test:feishu

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
│   ├── app.ts              # 主入口
│   ├── tmux_manager.ts     # tmux 控制
│   ├── parser.ts           # 文本清洗
│   ├── command_parser.ts   # 指令解析
│   ├── command_router.ts   # 指令路由
│   ├── feishu_bot.ts       # 飞书通信
│   ├── logger.ts           # 日志模块
│   └── types.ts            # 类型定义
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

## License

MIT
