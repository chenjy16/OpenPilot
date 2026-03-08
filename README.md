# OpenPilot — AI 个人电脑助理 & 智能体运行平台

OpenPilot 是一个单进程一体化部署的 AI 智能体运行平台，支持多模型、多频道、多智能体协同工作。提供完整的 HTTP/WebSocket API 网关和 Web 控制面板。可作为个人电脑助理，覆盖日常生活和工作中的多种事务。

---

## 🎯 能做什么：生活与工作事务清单

### 📁 文件与文档处理
- [x] **读写本地文件** — 读取、创建、编辑电脑上的任意文本文件（代码、配置、笔记等）
- [x] **代码补丁** — 对代码文件进行精确的 Patch 修改，支持 OpenAI 格式补丁
- [x] **批量文件操作** — 通过 Shell 工具批量重命名、移动、整理文件

### 💻 Shell 命令与系统操作
- [x] **执行终端命令** — 在电脑上运行任意 Shell 命令（安装软件、编译项目、管理进程等）
- [x] **后台进程管理** — 启动、监控、停止后台服务
- [x] **系统信息查询** — 查看磁盘空间、内存使用、网络状态等

### 🌐 网络与信息获取
- [x] **HTTP 请求** — 调用任意 API、获取网页内容、下载数据
- [x] **网页浏览** — 自动化浏览器操作（打开网页、截图、点击、执行 JS）
- [x] **信息搜索** — 通过网络工具搜索和获取实时信息

### 🖥️ 屏幕与截图
- [x] **桌面截图** — 一键截取当前屏幕画面（macOS 原生 screencapture）
- [x] **屏幕录制** — 录制屏幕视频片段（macOS）

### 🧠 记忆与知识管理
- [x] **长期记忆** — 通过 USER.md 持久化存储个人偏好、常用信息、工作习惯
- [x] **会话搜索** — 全文检索历史对话记录（SQLite FTS5），快速找到之前讨论过的内容
- [x] **会话管理** — 创建、切换、压缩、删除对话会话，保持上下文整洁

### 💬 多渠道消息通信
- [x] **Telegram 机器人** — 通过 Telegram 随时随地与 AI 助理对话（支持私聊和群组）
- [x] **Discord 机器人** — 在 Discord 服务器中使用 AI 助理（支持 DM、频道、线程）
- [x] **Web 聊天界面** — 浏览器内置聊天面板，支持流式输出和工具调用展示
- [x] **跨渠道会话隔离** — 不同渠道的对话互不干扰，隐私安全

### 🤖 多智能体协同
- [x] **多智能体管理** — 创建不同角色的 AI 智能体（编程助手、写作助手、分析师等）
- [x] **智能体路由** — 根据渠道、用户、群组自动分配对应的智能体
- [x] **子智能体** — 主智能体可以生成子智能体处理复杂任务（深度限制、并发控制）
- [x] **智能体身份** — 每个智能体有独立的名称、头像、系统提示词

### 🔮 PolyOracle — AI 预测市场分析
- [x] **实时市场数据** — 接入 Polymarket Gamma API，获取热门预测市场行情
- [x] **AI 概率分析** — AI 独立评估事件概率，与市场价格对比发现 +EV 机会
- [x] **信号记录** — 所有分析结果持久化存储到数据库，可追溯历史判断
- [x] **定时自动扫描** — Cron 定时任务每 4 小时自动扫描市场（可配置）
- [x] **推送通知** — +EV 机会自动推送到 Telegram/Discord（24h 去重）
- [x] **可视化仪表盘** — 市场行情、AI 信号、Cron 状态、通知设置一站式管理

### ⏰ 定时任务调度
- [x] **Cron 调度器** — 基于 node-cron 的持久化定时任务系统
- [x] **数据库存储** — 任务定义存储在 SQLite，支持 UI 管理
- [x] **手动触发** — 支持通过 API 或 UI 手动触发任务执行
- [x] **并发控制** — 防止同一任务重复执行

### 🔧 系统配置与管理
- [x] **Web 控制面板** — 完整的管理界面，涵盖聊天、会话、模型、频道、智能体、技能、配置、Cron、用量、审计等
- [x] **动态配置** — 通过 UI 或 API 实时修改系统配置，无需手动编辑文件
- [x] **多模型切换** — 支持 11+ AI 供应商、30+ 模型，运行时自由切换
- [x] **API Key 轮换** — 同一供应商多 Key 自动切换 + 冷却机制
- [x] **失败转移** — 主模型失败自动切换备选模型，保证服务可用
- [x] **审计日志** — 所有工具调用记录可追溯

### 🧩 技能扩展
- [x] **社区技能市场** — 搜索和安装社区贡献的技能（ClawHub + SkillsMP 双源）
- [x] **一键安装** — 从社区市场一键安装新技能
- [x] **技能管理** — 启用/禁用已安装技能

### 🔒 安全与审批
- [x] **策略引擎** — 工具级别的允许/拒绝/需审批策略
- [x] **执行审批** — 生产模式下危险操作（Shell、文件写入）需人工审批
- [x] **DM 安全策略** — 支持 open/allowlist/pairing/disabled 四种模式
- [x] **API Key 掩码** — 配置中的敏感信息自动脱敏

---

## 📋 典型使用场景

| 场景 | 如何实现 |
|------|----------|
| 每天早上获取预测市场机会 | Cron 定时扫描 → AI 分析 → Telegram 推送 |
| 在手机上远程操作电脑 | Telegram/Discord 发消息 → AI 执行 Shell 命令 |
| 整理项目文件 | 对话中描述需求 → AI 读写文件 + 执行命令 |
| 监控网站变化 | 定时任务 + 浏览器截图 + 通知推送 |
| 代码审查与修改 | 聊天中讨论 → AI 读取代码 → 生成补丁 |
| 查询实时信息 | AI 调用 HTTP 工具获取 API 数据 |
| 管理多个 AI 角色 | 创建不同智能体，绑定到不同渠道/群组 |
| 记住个人偏好 | AI 自动写入 USER.md，下次对话自动加载 |

---

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
│ Qwen     │           │ Memory    │ InboundDebouncer      │
│ 11+ 供商 │           │ Screen    │ PairingStore          │
│          │           │ SubAgent  │                       │
│          │           │ Polymarket│                       │
├──────────┴───────────┴───────────┴───────────────────────┤
│  AgentManager · SubagentRegistry · PolicyEngine · Audit  │
├──────────────────────────────────────────────────────────┤
│  CronScheduler · PolymarketScanner · NotificationService │
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
| 定时任务 | node-cron |
| 后端测试 | Jest + ts-jest |
| 前端测试 | Vitest + Testing Library |
| 构建 | tsc (后端) + Vite (前端) |

## 功能完成情况

### 核心运行时
- [x] Pi Agent ReAct 循环（多轮工具调用 + 自动重试 + 失败转移）
- [x] 多模型支持：11+ 供应商、30+ 模型，运行时自动发现
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
- [x] 9 类内置工具：文件、网络、Shell、浏览器、Patch、Memory、SubAgent、Screen、Polymarket
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

### PolyOracle — AI 预测市场分析
- [x] Gamma API 实时市场数据接入
- [x] AI 概率分析（单 Analyst 架构，支持 qwen/gemini/deepseek 等模型）
- [x] 信号存储（market_signals 表）
- [x] +EV 机会识别（edge ≥ 5% 阈值可配置）
- [x] 定时自动扫描（CronScheduler + PolymarketScanner）
- [x] Telegram/Discord 推送通知（24h 去重）
- [x] 可视化仪表盘（5 个 Tab：关于、市场、信号、Cron、通知设置）
- [x] 指标说明 Tooltip + 使用引导

### 定时任务系统
- [x] CronScheduler（node-cron + SQLite 持久化）
- [x] 任务 CRUD（创建、更新、删除、启用/禁用）
- [x] 手动触发执行
- [x] 并发守卫（防止同一任务重复运行）
- [x] Handler 注册机制（可扩展新任务类型）

### 通知服务
- [x] NotificationService（Telegram/Discord 推送）
- [x] 信号通知（+EV 机会推送）
- [x] 扫描摘要通知
- [x] 系统告警通知
- [x] 24h 去重（notified_at 字段）

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
- [x] REST API：50+ 端点（会话、聊天、模型、智能体、频道、配置、技能、Cron、Polymarket 等）
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
- [x] PolyOracle 仪表盘（市场、信号、Cron、通知设置、关于）
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
- [x] 后端：27 个测试套件，484+ 测试用例通过
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
│   │   ├── toolCatalog.ts      # 工具目录（29 工具，13 分类）
│   │   ├── fileTools.ts        # 文件操作
│   │   ├── networkTools.ts     # HTTP 请求
│   │   ├── shellTools.ts       # Shell 命令
│   │   ├── browserTools.ts     # 浏览器自动化
│   │   ├── patchTools.ts       # 代码 Patch
│   │   ├── memoryTools.ts      # 持久记忆
│   │   ├── screenTools.ts      # 屏幕截图/录制
│   │   ├── polymarketTools.ts  # Polymarket 市场工具
│   │   └── subAgentTools.ts    # 子智能体调用
│   ├── cron/                   # 定时任务
│   │   └── CronScheduler.ts    # Cron 调度器（SQLite 持久化）
│   ├── services/               # 业务服务
│   │   ├── PolymarketScanner.ts # 市场扫描 + AI 分析
│   │   └── NotificationService.ts # 通知推送（Telegram/Discord）
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
│   │   │   ├── views/          # 页面视图（15 个）
│   │   │   └── tools/          # 审计日志组件
│   │   ├── stores/             # Zustand 状态管理
│   │   ├── services/           # API 客户端
│   │   ├── hooks/              # 自定义 Hooks
│   │   └── types/              # 前端类型
│   └── index.html
├── data/                       # 数据目录
│   ├── sessions.db             # SQLite 数据库
│   └── sessions-jsonl/         # JSONL 审计日志
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
git clone https://github.com/chenjy16/OpenPilot.git
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
  // 自定义模型供应商
  models: {
    providers: {
      qwen: {
        apiKey: "sk-...",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: [{ id: "qwen3.5-flash", name: "qwen3.5-flash" }],
      },
    },
  },
  // PolyOracle 通知配置
  polymarket: {
    notify: {
      enabled: true,
      telegram: { chatId: "your-chat-id" },
      minEdge: 0.10,
    },
  },
}
```

### 构建

```bash
# 构建后端
npm run build

# 构建前端（输出到 dist/control-ui/）
cd frontend && npx vite build && cd ..
```

### 运行

```bash
# 启动服务（单进程，包含 API + WebSocket + Control UI）
node dist/index.js
```

服务启动后：
- Control UI：`http://127.0.0.1:3000`（浏览器访问）
- API 网关：`http://127.0.0.1:3000/api/`
- WebSocket：`ws://127.0.0.1:3000/ws`
- 健康检查：`http://127.0.0.1:3000/healthz`

### 测试

```bash
# 后端测试
npx jest --testPathIgnorePatterns="database.test" --no-coverage

# 前端测试
cd frontend && npx vitest --run
```

## 部署

### 单进程部署（推荐）

```bash
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
| 聊天 | `POST /api/chat` | 同步聊天 |
| 聊天 | `WS /ws` | 流式聊天（WebSocket） |
| 会话 | `GET/POST/DELETE /api/sessions` | 会话 CRUD |
| 模型 | `GET /api/models` | 模型目录 |
| 智能体 | `GET/POST/PUT/DELETE /api/agents` | 智能体 CRUD |
| 频道 | `GET /api/channels` | 频道状态 |
| 技能 | `GET /api/skills/community/search` | 社区搜索 |
| 配置 | `GET/PUT /api/config` | 系统配置读写 |
| Cron | `GET/POST/PUT/DELETE /api/cron/jobs` | 定时任务 |
| Polymarket | `GET /api/polymarket/markets` | 市场数据 |
| Polymarket | `GET /api/polymarket/signals` | AI 信号 |
| Polymarket | `POST /api/polymarket/scan` | 手动触发扫描 |
| 用量 | `GET /api/usage` | Token 用量统计 |
| 审计 | `GET /api/audit-logs` | 工具审计日志 |

## 支持的模型

| 供应商 | 模型 |
|--------|------|
| OpenAI | gpt-5.2, gpt-5.1, gpt-5, gpt-4o, o3, o4-mini 等 |
| Anthropic | claude-opus-4, claude-sonnet-4, claude-haiku-4.5 等 |
| Google | gemini-3-pro, gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash 等 |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Qwen | qwen3.5-flash（通过 OpenAI 兼容 API） |
| Ollama | 本地模型（自动发现） |
| OpenRouter / Together / Moonshot / Doubao / MiniMax | 通过 OpenAI 兼容 API |

## License

MIT
