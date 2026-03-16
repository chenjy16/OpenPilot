# OpenPilot — AI Personal Computer Assistant & Agent Runtime Platform

OpenPilot is a single-process, all-in-one AI agent runtime platform supporting multi-model, multi-channel, and multi-agent collaboration. It provides a complete HTTP/WebSocket API gateway and a Web control panel. Designed as a personal computer assistant, it covers a wide range of daily life and work tasks.

---

## 🎯 What It Can Do: Life & Work Task Checklist

### 📁 File & Document Processing
- [x] **Read/Write Local Files** — Read, create, and edit any text file on your computer (code, config, notes, etc.)
- [x] **Code Patching** — Apply precise patches to code files, supporting OpenAI-format patches
- [x] **Batch File Operations** — Bulk rename, move, and organize files via Shell tools

### 💻 Shell Commands & System Operations
- [x] **Execute Terminal Commands** — Run any Shell command on your computer (install software, compile projects, manage processes, etc.)
- [x] **Background Process Management** — Start, monitor, and stop background services
- [x] **System Info Queries** — Check disk space, memory usage, network status, etc.

### 🌐 Network & Information Retrieval
- [x] **HTTP Requests** — Call any API, fetch web content, download data
- [x] **Web Browsing** — Automated browser operations (open pages, take screenshots, click, execute JS)
- [x] **Information Search** — Search and retrieve real-time information via web tools

### 🖥️ Screen & Screenshots
- [x] **Desktop Screenshots** — One-click screen capture (macOS native screencapture)
- [x] **Screen Recording** — Record screen video clips (macOS)

### 🧠 Memory & Knowledge Management
- [x] **Long-term Memory** — Persistently store personal preferences, frequently used info, and work habits via USER.md
- [x] **Session Search** — Full-text search of conversation history (SQLite FTS5) to quickly find past discussions
- [x] **Session Management** — Create, switch, compact, and delete conversation sessions to keep context clean

### 💬 Multi-Channel Messaging
- [x] **Telegram Bot** — Chat with your AI assistant anytime, anywhere via Telegram (supports DM and groups)
- [x] **Discord Bot** — Use the AI assistant in Discord servers (supports DM, channels, threads)
- [x] **Web Chat Interface** — Built-in browser chat panel with streaming output and tool call display
- [x] **Cross-Channel Session Isolation** — Conversations across different channels are isolated for privacy

### 🤖 Multi-Agent Collaboration
- [x] **Multi-Agent Management** — Create AI agents with different roles (coding assistant, writing assistant, analyst, etc.)
- [x] **Agent Routing** — Automatically assign agents based on channel, user, or group
- [x] **Sub-Agents** — Main agents can spawn sub-agents for complex tasks (depth limits, concurrency control)
- [x] **Agent Identity** — Each agent has its own name, avatar, and system prompt

### 🔮 PolyOracle — AI Prediction Market Analysis
- [x] **Real-time Market Data** — Connects to Polymarket Gamma API for live prediction market quotes
- [x] **AI Probability Analysis** — AI independently evaluates event probabilities and compares with market prices to find +EV opportunities
- [x] **Signal Recording** — All analysis results are persisted to the database for historical tracking
- [x] **Scheduled Auto-Scanning** — Cron job scans markets every 4 hours (configurable)
- [x] **Push Notifications** — +EV opportunities are automatically pushed to Telegram/Discord (24h dedup)
- [x] **Visual Dashboard** — Market quotes, AI signals, Cron status, and notification settings in one place

### 📊 Quant Copilot — AI-Powered Stock Analysis
- [x] **Technical Analysis** — Automated technical indicator calculation (SMA, RSI, MACD, Bollinger Bands) via Python/pandas
- [x] **AI-Driven Insights** — LLM analyzes technical data and generates buy/sell/hold signals with confidence scores
- [x] **Finnhub News Integration** — Fetches latest market news for sentiment-aware analysis
- [x] **Configurable Watchlist** — Set your stock watchlist and signal threshold via the Web UI
- [x] **Auto Python Environment** — Python venv and dependencies are automatically installed on startup
- [x] **Agent Model Routing** — Uses the model configured for the `quant-analyst` agent, with fallback chain support

### 📈 Auto Quant Trading — Automated Quantitative Trading Pipeline
- [x] **Signal Evaluation** — Confidence-based filtering (high→0.9, medium→0.6, low→0.3) with configurable threshold
- [x] **Auto Order Execution** — Signals automatically converted to orders via Longport broker API
- [x] **Quantity Calculation** — Supports fixed quantity, fixed amount, and Kelly formula sizing modes
- [x] **Stop-Loss / Take-Profit** — Automatic monitoring with configurable check intervals, triggers market sell orders
- [x] **Trade Notifications** — Order creation, fill, failure, stop-loss trigger, and risk alerts pushed to Telegram/Discord
- [x] **Paper / Live Mode** — Paper mode routes through Longport's simulated API; live mode uses real account (same codebase, different Access Token)
- [x] **Signal Deduplication** — Configurable dedup window prevents duplicate orders for the same signal
- [x] **Strategy Engine** — Technical indicator strategy scanning and backtesting
- [x] **Portfolio Management** — Position tracking and P&L analysis
- [x] **Risk Control** — Pre-order risk checks (position limits, daily loss limits, order size limits)
- [x] **Trading Dashboard** — Real-time order list, pipeline status, stop-loss monitors, auto-trading config panel
- [x] **Audit Trail** — All trading operations logged with full request/response details

### ⏰ Scheduled Task Scheduling
- [x] **Cron Scheduler** — Persistent scheduled task system based on node-cron
- [x] **Database Storage** — Task definitions stored in SQLite, manageable via UI
- [x] **Manual Trigger** — Support manual task execution via API or UI
- [x] **Concurrency Control** — Prevents duplicate execution of the same task

### 🔧 System Configuration & Management
- [x] **Web Control Panel** — Full management interface covering chat, sessions, models, channels, agents, skills, config, cron, usage, audit, etc.
- [x] **Dynamic Configuration** — Modify system config in real-time via UI or API, no manual file editing needed
- [x] **Field-Level Descriptions** — Config UI fetches schema metadata to display labels and help text for each field
- [x] **Multi-Model Switching** — Supports 11+ AI providers, 30+ models, freely switchable at runtime
- [x] **API Key Rotation** — Multiple keys per provider with automatic switching + cooldown mechanism
- [x] **Failover** — Automatic fallback to alternative models when the primary model fails
- [x] **Audit Logging** — All tool invocations are traceable

### 🖼️ Image Generation
- [x] **Multi-Engine Support** — Supports Qwen (Tongyi Wanxiang), Stability AI, OpenAI DALL·E, local Stable Diffusion
- [x] **Natural Language to Image** — Describe the desired image, AI generates it automatically
- [x] **Auto-Send** — Generated images are automatically sent to Telegram/Discord via PendingFiles

### 📄 Document Generation
- [x] **PDF Generation** — Markdown content auto-converted to PDF (supports CJK, code highlighting, tables)
- [x] **PPT Generation** — JSON slide data auto-generated into PowerPoint files (theme configurable)
- [x] **Auto-Send** — Generated documents are automatically sent to the user

### 🎤 Voice Interaction (STT/TTS)
- [x] **Speech-to-Text (STT)** — Supports Google Gemini, OpenAI Whisper, DashScope Qwen Omni, and more
- [x] **Text-to-Speech (TTS)** — Supports Edge TTS (free) and OpenAI TTS
- [x] **Voice Message Loop** — Voice messages auto-transcribed → AI processes → voice reply (inbound mode)
- [x] **No Text Confusion** — Text commands get text replies; voice commands get voice replies

### 🎬 Video Editing (Phase 1 MVP)
- [x] **Video Probing** — Extract video metadata via ffprobe (duration, resolution, codec, frame rate, bitrate)
- [x] **Video Trimming** — Trim video clips by specifying time ranges
- [x] **Video Speed Change** — Supports 0.25x to 4.0x speed (video + audio sync)
- [x] **Timeline JSON** — LLM outputs structured editing instructions; tools perform deterministic FFmpeg rendering
- [x] **Fail-Fast** — Returns clear error immediately when FFmpeg is unavailable
- [x] **Auto-Send** — Rendered videos are automatically sent to the user via PendingFiles

### 🧩 Skill Extensions
- [x] **Community Skill Market** — Search and install community-contributed skills (ClawHub + SkillsMP dual source)
- [x] **One-Click Install** — Install new skills from the community market with one click
- [x] **Skill Management** — Enable/disable installed skills

### 🔒 Security & Approvals
- [x] **Policy Engine** — Tool-level allow/deny/require-approval policies
- [x] **Execution Approval** — Dangerous operations (Shell, file writes) require human approval in production mode
- [x] **DM Security Policy** — Supports open/allowlist/pairing/disabled modes
- [x] **API Key Masking** — Sensitive information in config is automatically redacted

---

## 📋 Typical Use Cases

| Scenario | How It Works |
|----------|-------------|
| Get prediction market opportunities every morning | Cron scheduled scan → AI analysis → Telegram push |
| Analyze stock technical indicators | Quant Copilot → Python technical analysis → AI signal generation |
| Remotely operate your computer from phone | Send message via Telegram/Discord → AI executes Shell commands |
| Organize project files | Describe needs in chat → AI reads/writes files + executes commands |
| Monitor website changes | Scheduled task + browser screenshot + push notification |
| Code review & modification | Discuss in chat → AI reads code → generates patches |
| Query real-time information | AI calls HTTP tools to fetch API data |
| Manage multiple AI roles | Create different agents, bind to different channels/groups |
| Remember personal preferences | AI auto-writes to USER.md, auto-loads in next conversation |
| Generate promotional images | Describe the scene → AI calls image generation → auto-sends to chat |
| Generate PDF reports | Provide content → AI generates Markdown → auto-converts to PDF |
| Create PPT presentations | Describe outline → AI generates slide JSON → auto-generates .pptx |
| Send voice messages to AI | Send voice on Telegram → STT transcription → AI processes → voice reply |
| Edit video clips | Send video + "trim 1:20-1:40" → AI generates Timeline → FFmpeg renders |
| Auto quant trading | Stock scan → AI signal → confidence filter → auto order → stop-loss monitor → notification |
| Paper trading test | Configure paper mode → orders route to Longport simulated API → verify strategy without real money |

---

## Architecture

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
│ 11+ prov │           │ Screen    │ PairingStore          │
│          │           │ SubAgent  │                       │
│          │           │ Polymarket│                       │
│          │           │ Stock     │                       │
│          │           │ Image     │                       │
│          │           │ Document  │                       │
│          │           │ Voice     │                       │
│          │           │ Video     │                       │
│          │           │ Trading   │                       │
├──────────┴───────────┴───────────┴───────────────────────┤
│  AgentManager · SubagentRegistry · PolicyEngine · Audit  │
├──────────────────────────────────────────────────────────┤
│  CronScheduler · PolymarketScanner · StockScanner        │
│  NotificationService · VoiceService · ImageRouter        │
│  AutoTradingPipeline · TradingGateway · StopLossManager  │
│  SignalEvaluator · StrategyEngine · PortfolioManager     │
├──────────────────────────────────────────────────────────┤
│              Sandbox · PluginManager · Skills             │
└──────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Runtime | Node.js + TypeScript |
| HTTP Framework | Express 5 |
| WebSocket | ws |
| Database | SQLite (better-sqlite3) + JSONL audit logs |
| Frontend Framework | React 19 + Vite 7 |
| Styling | TailwindCSS 4 |
| State Management | Zustand 5 |
| Code Editor | Monaco Editor |
| Charts | Recharts |
| Telegram | grammy |
| Discord | discord.js v14 |
| AI SDK | openai · @anthropic-ai/sdk · @google/generative-ai |
| Scheduled Tasks | node-cron |
| Voice Synthesis | edge-tts (Python) |
| Stock Analysis | yfinance + pandas (Python) |
| Trading | longport SDK (Longport OpenAPI) |
| Video Processing | FFmpeg / FFprobe |
| Backend Testing | Jest + ts-jest + fast-check (property-based) |
| Frontend Testing | Vitest + Testing Library |
| Build | tsc (backend) + Vite (frontend) |

## Feature Completion Status

### Core Runtime
- [x] Pi Agent ReAct loop (multi-turn tool calls + auto-retry + failover)
- [x] Multi-model support: 11+ providers, 30+ models, auto-discovered at runtime
- [x] Auth Profile rotation (multiple keys per provider with auto-switch + cooldown)
- [x] Failover chain (automatic fallback to alternative models on failure)
- [x] Context window guard (auto-compacts session when limit exceeded)
- [x] Concurrency limiter (overload protection)

### Session Management
- [x] SQLite persistence + LRU memory cache
- [x] JSONL parallel audit log writing
- [x] Session CRUD (create, load, save, delete)
- [x] Session compaction
- [x] Daily token quota

### Tool System
- [x] 14 built-in tool categories: File, Network, Shell, Browser, Patch, Memory, SubAgent, Screen, Polymarket, Stock, Trading, Image, Document, Voice, Video
- [x] PolicyEngine (allow/deny/require-approval)
- [x] AuditLogger audit logging
- [x] Tool catalog (38+ tools, 16 categories, grouped by Profile)
- [x] Execution approval queue (human approval in production mode)

### Multi-Agent
- [x] AgentManager: agent CRUD + file management (SOUL.md / IDENTITY.md, etc.)
- [x] Agent-level model + system prompt overrides
- [x] SubagentRegistry: sub-agent lifecycle management (depth limits, concurrency control)
- [x] Agent routing bindings (7-level priority: peer > peer.parent > guild+roles > guild > team > account > channel > default)

### Multi-Channel
- [x] ChannelManager unified channel management (register, connect, disconnect, reconnect, health check)
- [x] Telegram full implementation (grammy, DM/group/supergroup, Bot commands)
- [x] Discord full implementation (discord.js v14, DM/channel/thread, attachments, message chunking)
- [x] Slack framework implementation
- [x] Gateway adapter path (reads multi-account config from config.json5)
- [x] InboundDebouncer inbound message debouncing
- [x] PairingStore device pairing
- [x] SecurityGate DM security policy (open/allowlist/pairing/disabled)
- [x] Outbound message chunked delivery

### PolyOracle — AI Prediction Market Analysis
- [x] Gamma API real-time market data integration
- [x] AI probability analysis (single Analyst architecture, supports qwen/gemini/deepseek, etc.)
- [x] Signal storage (market_signals table)
- [x] +EV opportunity identification (edge ≥ 5% threshold, configurable)
- [x] Scheduled auto-scanning (CronScheduler + PolymarketScanner)
- [x] Telegram/Discord push notifications (24h dedup)
- [x] Visual dashboard (5 tabs: About, Markets, Signals, Cron, Notification Settings)
- [x] Metric tooltip explanations + usage guide

### Quant Copilot — AI Stock Analysis
- [x] StockScanner service with Python-based technical analysis (SMA, RSI, MACD, Bollinger Bands)
- [x] AI-driven signal generation (buy/sell/hold with confidence scores)
- [x] Finnhub API integration for market news and sentiment
- [x] Configurable watchlist and signal threshold via Web UI
- [x] Auto Python venv setup and dependency installation on startup
- [x] Agent-level model routing (quant-analyst agent config → fallback chain → auto-detect)
- [x] Stock analysis tools registered in tool catalog
- [x] Unit tests and property-based tests

### Auto Quant Trading — Automated Trading Pipeline
- [x] AutoTradingPipeline: signal polling → evaluation → order → stop-loss → notification
- [x] SignalEvaluator: confidence filtering (high/medium/low → numeric) + dedup window
- [x] QuantityCalculator: fixed_quantity / fixed_amount / kelly_formula sizing modes
- [x] StopLossManager: register, monitor (configurable interval), trigger, restore from DB
- [x] TradeNotifier: order/fill/fail/stop-loss/risk notifications via NotificationService
- [x] TradingGateway: unified entry point, paper/live mode routing, risk check, audit logging
- [x] LongportAdapter: Longport OpenAPI SDK integration, symbol normalization (AAPL→AAPL.US), connection reuse
- [x] OrderManager: order CRUD, status transitions, daily stats
- [x] RiskController: position limits, daily loss limits, order size limits
- [x] PaperTradingEngine: local paper engine fallback (when no broker credentials)
- [x] StrategyEngine: technical indicator strategy scanning and backtesting
- [x] PortfolioManager: position tracking and P&L analysis
- [x] SignalTracker: signal lifecycle management
- [x] Trading API endpoints (config, pipeline status, signals, stop-loss, orders, account, positions)
- [x] Trading Dashboard UI (orders, pipeline status, auto-trading panel, stop-loss monitors)
- [x] CronView: scheduler job display with edit, toggle, and manual trigger
- [x] Property-based tests for all core modules (fast-check)

### Scheduled Task System
- [x] CronScheduler (node-cron + SQLite persistence)
- [x] Task CRUD (create, update, delete, enable/disable)
- [x] Manual trigger execution
- [x] Concurrency guard (prevents duplicate task runs)
- [x] Handler registration mechanism (extensible for new task types)

### Notification Service
- [x] NotificationService (Telegram/Discord push)
- [x] Signal notifications (+EV opportunity push)
- [x] Scan summary notifications
- [x] System alert notifications
- [x] 24h dedup (notified_at field)

### Image Generation
- [x] ImageRouter multi-engine routing (Qwen/Stability/OpenAI/local SD)
- [x] Auto-save to ~/.openpilot/generated/
- [x] PendingFiles mechanism for auto-sending to Channel

### Document Generation
- [x] PDF generation (Markdown → HTML → PDF, supports Puppeteer rendering)
- [x] PPT generation (JSON slides → .pptx, theme configurable)
- [x] PendingFiles mechanism for auto-sending to Channel

### Voice Interaction (STT/TTS)
- [x] VoiceService unified voice service
- [x] STT multi-engine: Google Gemini, OpenAI Whisper, DashScope Qwen Omni
- [x] TTS multi-engine: Edge TTS (free), OpenAI TTS
- [x] Voice message loop (inbound mode: voice in → voice out)
- [x] OGG/Opus → MP3 auto-transcoding (ffmpeg)
- [x] DashScope SSE streaming response parsing

### Video Editing (Phase 1 MVP)
- [x] FFmpeg Guardian (Fail-Fast dependency check)
- [x] video_probe_tool (ffprobe metadata probing)
- [x] video_edit_tool (Timeline JSON → FFmpeg deterministic rendering)
- [x] Timeline JSON validator (format, time range, speed range)
- [x] FFmpeg command builder (trim, speed_up, add_subtitle)
- [x] PendingFiles mechanism for auto-sending to Channel
- [x] VideoConfig integration (ffmpegPath, outputDir, renderTimeout)

### Multi-Channel Multi-Agent Collaboration
- [x] CommandLane concurrency control (per-lane throttling)
- [x] 7-level routing priority bindings
- [x] dmScope session isolation (per-channel-peer / per-peer)
- [x] Cross-channel session isolation
- [x] Dynamic binding updates
- [x] Discord thread session key suffix
- [x] Telegram group/supergroup compatible matching
- [x] Wildcard accountId binding

### API Gateway
- [x] REST API: 60+ endpoints (sessions, chat, models, agents, channels, config, skills, cron, polymarket, stocks, trading, etc.)
- [x] WebSocket streaming chat (stream_start → stream_chunk → tool_call_start → tool_call_result → stream_end)
- [x] Concurrent request guard (no parallel requests for the same session)
- [x] Request rate limiting + input validation + security middleware (Helmet)
- [x] Container health probes (/healthz, /readyz)
- [x] Static asset serving (Control UI SPA)

### Control UI Panel
- [x] Chat interface (message list, input, streaming display, tool call display)
- [x] Session management (list, create, delete, compact)
- [x] Model selector
- [x] Channel management (status, config, connect/disconnect)
- [x] Agent management (CRUD, binding config, file editing)
- [x] Skill management (enable/disable, community skill search & install)
- [x] System configuration (33+ config sections, 38+ enum fields, field-level descriptions from schema)
- [x] Cron scheduled task management
- [x] PolyOracle dashboard (markets, signals, cron, notification settings, about)
- [x] Quant Copilot dashboard (stock analysis, technical indicators, AI signals)
- [x] Trading Dashboard (order list, pipeline status, auto-trading config, stop-loss monitors)
- [x] Portfolio view (position tracking, P&L)
- [x] Cron scheduler management (legacy + DB-backed jobs, edit, toggle, manual trigger)
- [x] Usage statistics
- [x] Audit log viewer
- [x] System status overview
- [x] Scenario Navigators menu group (PolyOracle + Quant Copilot + Trading Dashboard + Portfolio)

### Configuration System
- [x] JSON5 config file (~/.openpilot/config.json5)
- [x] Environment variable overrides
- [x] API dynamic read/write + persistence
- [x] API Key masking protection
- [x] Deep merge updates
- [x] Schema-driven field labels and descriptions in UI

### Skill System
- [x] Built-in skill status reports
- [x] Community skill dual source (ClawHub + SkillsMP)
- [x] Keyword search + AI semantic search
- [x] One-click install

### Test Coverage
- [x] Backend: 40+ test suites, 970+ test cases passing
- [x] Frontend: 20 test suites, 154 test cases passing
- [x] Multi-agent collaboration tests (single-channel 21 cases + cross-channel 20 cases)
- [x] Discord integration tests (43 cases)
- [x] E2E production readiness tests
- [x] StockScanner unit tests + property-based tests
- [x] Stock tools unit tests + property-based tests
- [x] Trading module: 12 test suites (unit + property-based tests with fast-check)
- [x] Tool catalog tests

## Project Structure

```
openpilot/
├── src/                        # Backend source code
│   ├── index.ts                # Entry point, full bootstrap flow
│   ├── api/                    # Express API gateway + WebSocket
│   │   ├── server.ts           # 60+ REST endpoints + WS streaming
│   │   ├── tradingRoutes.ts    # Trading API endpoints (orders, config, pipeline, stop-loss)
│   │   └── middleware.ts       # Rate limiting, input validation, security
│   ├── runtime/                # AI runtime
│   │   ├── AIRuntime.ts        # Core execution engine (retry, failover, concurrency)
│   │   └── sandbox.ts          # Sandbox isolation
│   ├── pi-agent/               # Pi Agent ReAct loop
│   │   ├── PiAgent.ts          # ReAct main loop
│   │   └── PiSession.ts        # Session transcript management
│   ├── models/                 # Model providers
│   │   ├── ModelManager.ts     # Model discovery, config, rotation, failover
│   │   ├── OpenAIProvider.ts   # OpenAI / compatible APIs
│   │   ├── AnthropicProvider.ts
│   │   └── GeminiProvider.ts   # Google Generative AI
│   ├── session/                # Session persistence
│   │   ├── SessionManager.ts   # SQLite + LRU Cache + JSONL
│   │   └── database.ts         # Schema initialization
│   ├── channels/               # Multi-channel system
│   │   ├── types.ts            # Channel plugin abstraction layer
│   │   ├── ChannelManager.ts   # Unified management + routing + health check
│   │   ├── TelegramChannel.ts  # Telegram (grammy)
│   │   ├── DiscordChannel.ts   # Discord (discord.js v14)
│   │   ├── SlackChannel.ts     # Slack
│   │   ├── CommandLane.ts      # Concurrency control lane
│   │   ├── InboundDebouncer.ts # Inbound debouncing
│   │   └── PairingStore.ts     # Device pairing
│   ├── agents/                 # Agent management
│   │   ├── AgentManager.ts     # CRUD + files + identity
│   │   ├── SubagentRegistry.ts # Sub-agent lifecycle
│   │   └── types.ts            # AgentInfo types
│   ├── tools/                  # Tool system
│   │   ├── ToolExecutor.ts     # Executor + hook chain
│   │   ├── PolicyEngine.ts     # Policy engine
│   │   ├── auditHook.ts        # Audit logging
│   │   ├── toolCatalog.ts      # Tool catalog (38+ tools, 16 categories)
│   │   ├── fileTools.ts        # File operations
│   │   ├── networkTools.ts     # HTTP requests
│   │   ├── shellTools.ts       # Shell commands
│   │   ├── browserTools.ts     # Browser automation
│   │   ├── patchTools.ts       # Code patching
│   │   ├── memoryTools.ts      # Persistent memory
│   │   ├── screenTools.ts      # Screen capture/recording
│   │   ├── polymarketTools.ts  # Polymarket market tools
│   │   ├── stockTools.ts       # Stock analysis tools
│   │   ├── imageTools.ts       # Image generation (multi-engine)
│   │   ├── documentTools.ts    # Document generation (PDF/PPT)
│   │   ├── voiceTools.ts       # Voice tools (STT/TTS/status)
│   │   ├── videoTools.ts       # Video editing (probe/render)
│   │   └── subAgentTools.ts    # Sub-agent invocation
│   ├── cron/                   # Scheduled tasks
│   │   └── CronScheduler.ts    # Cron scheduler (SQLite persistence)
│   ├── services/               # Business services
│   │   ├── PolymarketScanner.ts # Market scanning + AI analysis
│   │   ├── StockScanner.ts     # Stock technical analysis + AI signals
│   │   ├── StrategyEngine.ts   # Technical indicator strategy engine
│   │   ├── PortfolioManager.ts # Position tracking + P&L analysis
│   │   ├── SignalTracker.ts    # Signal lifecycle management
│   │   ├── NotificationService.ts # Push notifications (Telegram/Discord)
│   │   ├── VoiceService.ts     # Voice service (STT/TTS multi-engine)
│   │   ├── ImageRouter.ts      # Image generation routing (multi-engine)
│   │   └── trading/            # Automated trading system
│   │       ├── types.ts        # Trading type definitions
│   │       ├── tradingSchema.ts # DB schema (orders, stop-loss, audit, etc.)
│   │       ├── AutoTradingPipeline.ts # Signal polling + order orchestration
│   │       ├── TradingGateway.ts # Unified entry point (paper/live routing)
│   │       ├── LongportAdapter.ts # Longport broker API adapter
│   │       ├── SignalEvaluator.ts # Confidence filtering + dedup
│   │       ├── QuantityCalculator.ts # Order sizing (fixed/kelly)
│   │       ├── StopLossManager.ts # Stop-loss/take-profit monitoring
│   │       ├── TradeNotifier.ts # Trade notification formatting
│   │       ├── OrderManager.ts  # Order CRUD + status transitions
│   │       ├── RiskController.ts # Pre-order risk checks
│   │       ├── PaperTradingEngine.ts # Local paper engine fallback
│   │       └── PositionSyncer.ts # Position sync with broker
│   ├── skills/                 # Skill system
│   │   ├── community.ts        # Community skills (ClawHub + SkillsMP)
│   │   └── types.ts
│   ├── config/                 # Configuration system
│   │   └── index.ts            # JSON5 loading + env var overrides + persistence
│   ├── plugins/                # Plugin system
│   │   └── PluginManager.ts
│   ├── types/                  # Core type definitions
│   │   └── index.ts
│   └── logger.ts               # Structured logging
├── scripts/                    # Python scripts
│   ├── stock_analysis.py       # Technical indicator calculation (SMA, RSI, MACD, BB)
│   ├── backtest_engine.py      # Strategy backtesting engine
│   └── requirements.txt        # Python dependencies (yfinance, pandas)
├── frontend/                   # Frontend Control UI
│   ├── src/
│   │   ├── App.tsx             # Main app + routing
│   │   ├── components/
│   │   │   ├── chat/           # Chat components (message list, input, tool calls)
│   │   │   ├── charts/         # Chart components (K-line chart)
│   │   │   ├── session/        # Session list
│   │   │   ├── model/          # Model selector
│   │   │   ├── common/         # Common components (confirm dialog, error banner, progress bar)
│   │   │   ├── layout/         # Layout (sidebar, topbar)
│   │   │   ├── views/          # Page views (20+: Chat, Sessions, Trading Dashboard, Auto Trading, etc.)
│   │   │   └── tools/          # Audit log component
│   │   ├── stores/             # Zustand state management (uiStore, tradingStore)
│   │   ├── services/           # API client
│   │   ├── hooks/              # Custom hooks
│   │   └── types/              # Frontend types
│   └── index.html
├── data/                       # Data directory
│   ├── sessions.db             # SQLite database
│   └── sessions-jsonl/         # JSONL audit logs
├── dist/                       # Backend compiled output
└── frontend/dist/              # Frontend build output → dist/control-ui/
```

## Quick Start

### Requirements

- Node.js >= 20
- npm >= 9
- Python >= 3.10 (for stock analysis and voice features; auto-configured on startup)

### Installation

```bash
# Clone the project
git clone https://github.com/chenjy16/OpenPilot.git
cd openpilot

# Install backend dependencies
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### Configuration

```bash
# Copy the environment variable template
cp .env.example .env

# Edit .env, configure at least one AI provider API Key:
#   OPENAI_API_KEY=sk-...
#   ANTHROPIC_API_KEY=sk-ant-...
#   GOOGLE_AI_API_KEY=AIza...

# (Optional) Configure channel Bot tokens:
#   TELEGRAM_BOT_TOKEN=...
#   DISCORD_BOT_TOKEN=...

# (Optional) Configure Finnhub API Key for stock analysis:
#   FINNHUB_API_KEY=...
#   (Can also be set via the Web UI under Quant Copilot config section)

# (Optional) Configure Longport for auto quant trading:
#   Credentials are configured via the Web UI Trading Config panel
#   (app_key, app_secret, paper_access_token from https://open.longbridge.com)
```

Advanced configuration uses JSON5 format, located at `~/.openpilot/config.json5`:

```json5
{
  // Channel configuration
  channels: {
    telegram: { enabled: true, token: "..." },
    discord: { enabled: true, token: "..." },
  },
  // Gateway configuration
  gateway: {
    port: 3000,
    bind: "loopback",  // loopback | lan | auto | custom
  },
  // Custom model providers
  models: {
    providers: {
      qwen: {
        apiKey: "sk-...",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: [{ id: "qwen3.5-flash", name: "qwen3.5-flash" }],
      },
    },
  },
  // PolyOracle notification config
  polymarket: {
    notify: {
      enabled: true,
      telegram: { chatId: "your-chat-id" },
      minEdge: 0.10,
    },
  },
  // Quant Copilot config
  stockAnalysis: {
    finnhubApiKey: "your-finnhub-api-key",
    watchlist: "AAPL,GOOGL,MSFT,TSLA",
    signalThreshold: 0.6,
  },
  // Voice configuration
  voice: {
    stt: { model: "qwen3-omni-flash/qwen3-omni-flash", language: "zh" },
    tts: { auto: "inbound", model: "edge/default", voice: "zh-CN-XiaoxiaoNeural" },
  },
  // Video editing configuration
  video: {
    outputDir: "~/.openpilot/generated/video",
    renderTimeout: 120000,
  },
}
```

### Build

```bash
# Build backend (TypeScript → dist/)
npm run build

# Build frontend (React → dist/control-ui/)
npm run ui:build

# Or build both in one command
npm run gateway:dev   # build + ui:build + start
```

### Run

```bash
# Development mode (with hot reload via nodemon)
npm run dev

# Production mode (from compiled dist/)
NODE_ENV=production NODE_OPTIONS=--dns-result-order=ipv4first node dist/index.js

# Or simply
npm start
```

After startup:
- Control UI: `http://127.0.0.1:3000` (browser access)
- API Gateway: `http://127.0.0.1:3000/api/`
- WebSocket: `ws://127.0.0.1:3000/ws`
- Health Check: `http://127.0.0.1:3000/healthz`

### Package & Distribute

Build a distributable tarball for deployment on another machine:

```bash
# 1. Full build
npm run build && npm run ui:build

# 2. Package (includes compiled code, dependencies, scripts, config template)
tar -czf openpilot-v1.0.0.tar.gz \
  dist/ \
  scripts/ \
  node_modules/ \
  package.json \
  package-lock.json \
  .env.example

# 3. On the target machine
tar -xzf openpilot-v1.0.0.tar.gz
bash scripts/install.sh    # checks Node.js, installs deps, initializes .env
npm start                  # start the service
```

The `scripts/install.sh` script handles:
- Node.js version check (>= 20)
- Python3 detection (optional, for stock analysis)
- Production dependency installation (`npm ci --production`)
- `.env` initialization from `.env.example`
- Data directory creation

### Testing

```bash
# Backend tests
npx jest --testPathIgnorePatterns="database.test" --no-coverage

# Frontend tests
cd frontend && npx vitest --run
```

## Deployment

### Single Process (Recommended)

```bash
NODE_ENV=production NODE_OPTIONS=--dns-result-order=ipv4first node dist/index.js
```

### systemd Service

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
COPY scripts/ ./scripts/
COPY frontend/dist/ ./dist/control-ui/
EXPOSE 3000
HEALTHCHECK CMD curl -f http://localhost:3000/healthz || exit 1
CMD ["node", "dist/index.js"]
```

### Network Binding Modes

| Mode | Bind Address | Use Case |
|------|-------------|----------|
| `loopback` | 127.0.0.1 | Local development (default) |
| `lan` | 0.0.0.0 | LAN access |
| `auto` | 0.0.0.0 | Auto-detect |
| `custom` | Custom | Specify `gateway.customBindHost` |

## API Overview

| Category | Endpoint | Description |
|----------|---------|-------------|
| Health | `GET /healthz` | Container liveness probe |
| Health | `GET /readyz` | Readiness probe (includes DB check) |
| Chat | `POST /api/chat` | Synchronous chat |
| Chat | `WS /ws` | Streaming chat (WebSocket) |
| Sessions | `GET/POST/DELETE /api/sessions` | Session CRUD |
| Models | `GET /api/models` | Model catalog |
| Agents | `GET/POST/PUT/DELETE /api/agents` | Agent CRUD |
| Channels | `GET /api/channels` | Channel status |
| Skills | `GET /api/skills/community/search` | Community search |
| Config | `GET/PUT /api/config` | System config read/write |
| Config | `GET /api/config/schema` | Config field metadata (labels, descriptions) |
| Cron | `GET/POST/PUT/DELETE /api/cron/jobs` | Scheduled tasks |
| Polymarket | `GET /api/polymarket/markets` | Market data |
| Polymarket | `GET /api/polymarket/signals` | AI signals |
| Polymarket | `POST /api/polymarket/scan` | Manual scan trigger |
| Stocks | `POST /api/stocks/analyze` | Stock technical analysis + AI signal |
| Trading | `GET /api/trading/orders` | Order list (with filter) |
| Trading | `POST /api/trading/orders` | Place order |
| Trading | `GET/PUT /api/trading/config` | Trading config (mode, auto-trade, quantity, etc.) |
| Trading | `GET /api/trading/account` | Account info (paper or live) |
| Trading | `GET /api/trading/positions` | Current positions |
| Trading | `GET /api/trading/pipeline/status` | Auto-trading pipeline status |
| Trading | `GET /api/trading/pipeline/signals` | Recent processed signals |
| Trading | `GET /api/trading/stop-loss` | Active stop-loss monitors |
| Usage | `GET /api/usage` | Token usage statistics |
| Audit | `GET /api/audit-logs` | Tool audit logs |

## Supported Models

| Provider | Models |
|----------|--------|
| OpenAI | gpt-5.2, gpt-5.1, gpt-5, gpt-4o, o3, o4-mini, etc. |
| Anthropic | claude-opus-4, claude-sonnet-4, claude-haiku-4.5, etc. |
| Google | gemini-3-pro, gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, etc. |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| Qwen | qwen3.5-plus, qwen3.5-flash (via OpenAI-compatible API) |
| Ollama | Local models (auto-discovered) |
| OpenRouter / Together / Moonshot / Doubao / MiniMax | Via OpenAI-compatible API |

## License

MIT
