# OpenPilot — AI 智能体运行平台

OpenPilot 是一个单进程一体化部署的 AI 智能体运行平台，支持多模型、多频道、多智能体协同工作。提供完整的 HTTP/WebSocket API 网关和 Web 控制面板。

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    Control UI (React)                    │
│              Vite + TailwindCSS + Zustand                │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────────┐
│                   Gateway (Express)                      │
│         REST API · WebSocket Stream · Static Serve       │
├──────────────────────────────────────────────────────────┤
│                   Pi Agent Runtime                        │
│        ReAct Loop · Tool Pipeline · Context Guard        │
├──────────┬───────────┬───────────┬───────────────────────┤
│  Model   │  Session  │   Tool    │     Channel           │
│  Manager │  Manager  │  Executor │     Manager           │
│          │           │           │                       │
│ OpenAI   │ SQLite    │ File      │ Telegram (grammy)     │
│ Anthropic│ JSONL     │ Network   │ Discord (discord.js)  │
│ Google   │ LRU Cache │ Shell     │ Slack                 │
│ DeepSeek │           │ Browser   │                       │
│ Ollama   │           │ Patch     │ CommandLane           │
│ 11+ 供商 │           │ Memory    │ InboundDebouncer      │
│          │           │ SubAgent  │ PairingStore          │
├──────────┴───────────┴───────────┴───────────────────────┤
│  AgentManager · SubagentRegistry · PolicyEngine · Audit  │
├──────────────────────────────────────────────────────────┤
│              Sandbox · PluginManager · Skills             │
└──────────────────────────────────────────────────────────┘
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端运行时 | Node.js + TypeScript |
| HTTP 框架 | Express 5 |
| WebSocket | ws |
| 数据库 | SQLite (better-sqlite3) + JSONL 审计日志 |
| 前端框架 | React 19 + Vite 7 |
| 样式 | TailwindCSS 4 |
| 状态管理 | Zustand 5 |
| 代码编辑器 | Monaco Editor |
| 图表 | Recharts |
| Telegram | grammy |
| Discord | discord.js v14 |
| AI SDK | openai · @anthropic-ai/sdk · @google/generative-ai |
| 后端测试 | Jest + ts-jest |
| 前端测试 | Vitest + Testing Library |
| 构建 | tsc (后端) + Vite (前端) |

## 功能完成情况

### 核心运行时
- [x] Pi Agent ReAct 循环（多轮工具调用 + 自动重试 + 失败转移）
- [x] 多模型支持：11+ 供应商、22+ 模型，运行时自动发现
- [x] Auth Profile 轮换（同一供应商多 Key 自动切换 + 冷却机制）
- [x] 失败转移链（主模型失败自动切换备选模型）
- [x] 上下文窗口守卫（超限自动压缩会话）
- [x] 并发限制器（防止过载）

### 会话管理
- [x] SQLite 持久化 + LRU 内存缓存
- [x] JSONL 并行写入审计日志
- [x] 会话 CRUD（创建、加载、保存、删除）
- [x] 会话压缩（Compaction）
- [x] 每日 Token 限额

### 工具系统
- [x] 7 类内置工具：文件、网络、Shell、浏览器、Patch、Memory、SubAgent
- [x] PolicyEngine 策略引擎（允许/拒绝/需审批）
- [x] AuditLogger 审计日志
- [x] 工具目录（按 Profile 分组）
- [x] 执行审批队列（生产模式人工审批）

### 多智能体
- [x] AgentManager：智能体 CRUD + 文件管理（SOUL.md / IDENTITY.md 等）
- [x] 智能体级别模型 + 系统提示词覆盖
- [x] SubagentRegistry：子智能体生命周期管理（深度限制、并发控制）
- [x] 智能体路由绑定（7 级优先级：peer > peer.parent > guild+roles > guild > team > account > channel > default）

### 多频道
- [x] ChannelManager 统一频道管理（注册、连接、断开、重连、健康检查）
- [x] Telegram 完整实现（grammy，DM/群组/超级群组，Bot 命令）
- [x] Discord 完整实现（discord.js v14，DM/频道/线程，附件，消息分块）
- [x] Slack 框架实现
- [x] Gateway 适配器路径（从 config.json5 读取多账号配置）
- [x] InboundDebouncer 入站消息去抖
- [x] PairingStore 设备配对
- [x] SecurityGate DM 安全策略（open/allowlist/pairing/disabled）
- [x] 出站消息分块投递

### 多频道多智能体协同
- [x] CommandLane 并发控制（按 lane 限流）
- [x] 7 级路由优先级绑定
- [x] dmScope 会话隔离（per-channel-peer / per-peer）
- [x] 跨频道会话隔离
- [x] 动态绑定更新
- [x] Discord 线程会话键后缀
- [x] Telegram group/supergroup 兼容匹配
- [x] 通配符 accountId 绑定

### API 网关
- [x] REST API：50+ 端点（会话、聊天、模型、智能体、频道、配置、技能、Cron 等）
- [x] WebSocket 流式对话（stream_start → stream_chunk → tool_call_start → tool_call_result → stream_end）
- [x] 并发请求守卫（同一会话不允许并行请求）
- [x] 请求速率限制 + 输入验证 + 安全中间件（Helmet）
- [x] 容器健康探针（/healthz, /readyz）
- [x] 静态资源服务（Control UI SPA）

### Control UI 控制面板
- [x] 聊天界面（消息列表、输入框、流式显示、工具调用展示）
- [x] 会话管理（列表、创建、删除、压缩）
- [x] 模型选择器
- [x] 频道管理（状态、配置、连接/断开）
- [x] 智能体管理（CRUD、绑定配置、文件编辑）
- [x] 技能管理（启用/禁用、社区技能搜索安装）
- [x] 系统配置（33 个配置区段、38 个枚举字段）
- [x] Cron 定时任务管理
- [x] 用量统计
- [x] 审计日志查看
- [x] 系统状态总览

### 配置系统
- [x] JSON5 配置文件（~/.openpilot/config.json5）
- [x] 环境变量覆盖
- [x] API 动态读写 + 持久化
- [x] API Key 掩码保护
- [x] 深度合并更新

### 技能系统
- [x] 内置技能状态报告
- [x] 社区技能双源（ClawHub + SkillsMP）
- [x] 关键词搜索 + AI 语义搜索
- [x] 一键安装

### 测试覆盖
- [x] 后端：27 个测试套件，569+ 测试用例通过
- [x] 前端：20 个测试套件，136 测试用例通过
- [x] 多智能体协同测试（单频道 21 用例 + 跨频道 20 用例）
- [x] Discord 集成测试（43 用例）
- [x] E2E 生产就绪性测试

## 项目结构

```
openpilot/
├── src/                        # 后端源码
│   ├── index.ts                # 入口，Bootstrap 全流程
│   ├── api/                    # Express API 网关 + WebSocket
│   │   ├── server.ts           # 50+ REST 端点 + WS 流式
│   │   └── middleware.ts       # 速率限制、输入验证、安全
│   ├── runtime/                # AI 运行时
│   │   ├── AIRuntime.ts        # 核心执行引擎（重试、失败转移、并发）
│   │   └── sandbox.ts          # 沙箱隔离
│   ├── pi-agent/               # Pi Agent ReAct 循环
│   │   ├── PiAgent.ts          # ReAct 主循环
│   │   └── PiSession.ts        # 会话 Transcript 管理
│   ├── models/                 # 模型供应商
│   │   ├── ModelManager.ts     # 模型发现、配置、轮换、失败转移
│   │   ├── OpenAIProvider.ts   # OpenAI / 兼容 API
│   │   ├── AnthropicProvider.ts
│   │   └── GeminiProvider.ts   # Google Generative AI
│   ├── session/                # 会话持久化
│   │   ├── SessionManager.ts   # SQLite + LRU Cache + JSONL
│   │   └── database.ts         # Schema 初始化
│   ├── channels/               # 多频道系统
│   │   ├── types.ts            # 频道插件抽象层
│   │   ├── ChannelManager.ts   # 统一管理 + 路由 + 健康检查
│   │   ├── TelegramChannel.ts  # Telegram (grammy)
│   │   ├── DiscordChannel.ts   # Discord (discord.js v14)
│   │   ├── SlackChannel.ts     # Slack
│   │   ├── CommandLane.ts      # 并发控制 Lane
│   │   ├── InboundDebouncer.ts # 入站去抖
│   │   └── PairingStore.ts     # 设备配对
│   ├── agents/                 # 智能体管理
│   │   ├── AgentManager.ts     # CRUD + 文件 + 身份
│   │   ├── SubagentRegistry.ts # 子智能体生命周期
│   │   └── types.ts            # AgentInfo 类型
│   ├── tools/                  # 工具系统
│   │   ├── ToolExecutor.ts     # 执行器 + Hook 链
│   │   ├── PolicyEngine.ts     # 策略引擎
│   │   ├── auditHook.ts        # 审计日志
│   │   ├── fileTools.ts        # 文件操作
│   │   ├── networkTools.ts     # HTTP 请求
│   │   ├── shellTools.ts       # Shell 命令
│   │   ├── browserTools.ts     # 浏览器自动化
│   │   ├── patchTools.ts       # 代码 Patch
│   │   ├── memoryTools.ts      # 持久记忆
│   │   └── subAgentTools.ts    # 子智能体调用
│   ├── skills/                 # 技能系统
│   │   ├── community.ts        # 社区技能（ClawHub + SkillsMP）
│   │   └── types.ts
│   ├── config/                 # 配置系统
│   │   └── index.ts            # JSON5 加载 + 环境变量覆盖 + 持久化
│   ├── plugins/                # 插件系统
│   │   └── PluginManager.ts
│   ├── types/                  # 核心类型定义
│   │   └── index.ts
│   └── logger.ts               # 结构化日志
├── frontend/                   # 前端 Control UI
│   ├── src/
│   │   ├── App.tsx             # 主应用 + 路由
│   │   ├── components/
│   │   │   ├── chat/           # 聊天组件（消息列表、输入、工具调用）
│   │   │   ├── session/        # 会话列表
│   │   │   ├── model/          # 模型选择器
│   │   │   ├── common/         # 通用组件（确认框、错误横幅、进度条）
│   │   │   ├── layout/         # 布局（侧边栏、顶栏）
│   │   │   ├── views/          # 页面视图（13 个）
│   │   │   └── tools/          # 审计日志组件
│   │   ├── stores/             # Zustand 状态管理
│   │   ├── services/           # API 客户端
│   │   ├── hooks/              # 自定义 Hooks
│   │   └── types/              # 前端类型
│   └── index.html
├── data/                       # 数据目录
│   ├── sessions.db             # SQLite 数据库
│   └── sessions-jsonl/         # JSONL 审计日志
├── examples/                   # 使用示例
├── dist/                       # 后端编译输出
└── frontend/dist/              # 前端构建输出 → dist/control-ui/
```

## 快速开始

### 环境要求

- Node.js >= 20
- npm >= 9

### 安装

```bash
# 克隆项目
git clone <repo-url> openpilot
cd openpilot

# 安装后端依赖
npm install

# 安装前端依赖
cd frontend && npm install && cd ..
```

### 配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env，至少配置一个 AI 供应商的 API Key：
#   OPENAI_API_KEY=sk-...
#   ANTHROPIC_API_KEY=sk-ant-...
#   GOOGLE_AI_API_KEY=AIza...

# （可选）配置频道 Bot Token：
#   TELEGRAM_BOT_TOKEN=...
#   DISCORD_BOT_TOKEN=...
```

高级配置使用 JSON5 格式，文件位于 `~/.openpilot/config.json5`：

```json5
{
  // 频道配置
  channels: {
    telegram: { enabled: true, token: "..." },
    discord: { enabled: true, token: "..." },
  },
  // 网关配置
  gateway: {
    port: 3000,
    bind: "loopback",  // loopback | lan | auto | custom
  },
  // 智能体路由绑定
  bindings: [
    { agentId: "coder", match: { channel: "telegram", peer: { kind: "direct", id: "12345" } } },
    { agentId: "reviewer", match: { channel: "discord", guildId: "guild-id" } },
  ],
}
```

### 构建

```bash
# 构建后端
npm run build

# 构建前端（输出到 dist/control-ui/）
cd frontend && npx vite build && cd ..
# 或
npm run ui:build
```

### 运行

```bash
# 启动服务（单进程，包含 API + WebSocket + Control UI）
node dist/index.js

# 或使用 npm script
npm start
```

服务启动后：
- API 网关：`http://127.0.0.1:3000`
- WebSocket：`ws://127.0.0.1:3000/ws`
- Control UI：`http://127.0.0.1:3000`（浏览器访问）
- 健康检查：`http://127.0.0.1:3000/healthz`

### 测试

```bash
# 后端测试
npx jest --testPathIgnorePatterns="database.test" --no-coverage

# 前端测试
cd frontend && npx vitest --run

# 完整构建验证
npm run build && cd frontend && npx vite build
```

## 部署

### 单进程部署（推荐）

OpenPilot 采用单进程一体化部署模式，一个 Node.js 进程包含所有功能：

```bash
# 生产环境启动
NODE_ENV=production node dist/index.js
```

### systemd 服务

```ini
[Unit]
Description=OpenPilot AI Agent Platform
After=network.target

[Service]
Type=simple
User=openpilot
WorkingDirectory=/opt/openpilot
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY frontend/dist/ ./dist/control-ui/
EXPOSE 3000
HEALTHCHECK CMD curl -f http://localhost:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
```

### 网络绑定模式

通过 `config.json5` 的 `gateway.bind` 控制：

| 模式 | 绑定地址 | 用途 |
|------|----------|------|
| `loopback` | 127.0.0.1 | 本地开发（默认） |
| `lan` | 0.0.0.0 | 局域网访问 |
| `auto` | 0.0.0.0 | 自动检测 |
| `custom` | 自定义 | 指定 `gateway.customBindHost` |

## API 概览

| 分类 | 端点 | 说明 |
|------|------|------|
| 健康 | `GET /healthz` | 容器存活探针 |
| 健康 | `GET /readyz` | 就绪探针（含 DB 检查） |
| 健康 | `GET /api/health` | 详细健康状态 |
| 聊天 | `POST /api/chat` | 同步聊天（请求/响应） |
| 聊天 | `WS /ws` | 流式聊天（WebSocket） |
| 会话 | `GET/POST/DELETE /api/sessions` | 会话 CRUD |
| 会话 | `POST /api/sessions/:id/compact` | 会话压缩 |
| 模型 | `GET /api/models` | 模型目录 |
| 模型 | `GET /api/models/configured` | 已配置模型 |
| 智能体 | `GET/POST/PUT/DELETE /api/agents` | 智能体 CRUD |
| 智能体 | `PUT /api/agents/:id/bindings` | 路由绑定 |
| 频道 | `GET /api/channels` | 频道状态 |
| 频道 | `PUT /api/channels/:type/config` | 频道配置 |
| 频道 | `POST /api/channels/:type/reconnect` | 重连频道 |
| 技能 | `GET /api/skills/status` | 技能状态 |
| 技能 | `GET /api/skills/community/search` | 社区搜索 |
| 配置 | `GET/PUT /api/config` | 系统配置读写 |
| Cron | `GET/POST/PUT/DELETE /api/cron/jobs` | 定时任务 |
| 用量 | `GET /api/usage` | Token 用量统计 |
| 审计 | `GET /api/audit-logs` | 工具审计日志 |

## 支持的模型

| 供应商 | 模型 |
|--------|------|
| OpenAI | gpt-4o, gpt-4o-mini, gpt-4, gpt-3.5-turbo, o1, o1-mini, o3-mini |
| Anthropic | claude-sonnet-4, claude-opus-4, claude-3.5-sonnet, claude-3-haiku |
| Google | gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Ollama | 本地模型（自动发现） |
| OpenRouter / Together / Moonshot / Doubao / MiniMax / Qianfan | 通过 OpenAI 兼容 API |

## License

MIT
