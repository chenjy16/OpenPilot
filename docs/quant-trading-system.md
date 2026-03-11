# 量化交易系统 — 全流程分析与工作流文档

> 基于当前代码库的端到端流程验证，分析各环节是否可以跑通，并总结具体设计。

---

## 总体结论

**全部 7 个阶段均可端到端跑通。** Longport WebSocket 在台湾网络环境下的超时问题已通过 Finnhub HTTP 回退机制解决。Portfolio 实时价格与 PnL 显示正常运作。

---

## 系统架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CronScheduler (定时调度)                       │
│  universe-screen → stock-scan → signal → AutoTradingPipeline        │
│  vix-monitor → RiskController → StopLossManager                     │
│  data-sync → DataManager (OHLCV 缓存)                               │
│  weekly-review → AI 周末复盘                                         │
│  signal-verify → SignalTracker (信号回溯)                             │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ UniverseScreener │   │   StockScanner    │   │ AutoTradingPipeline │
│ (股票池筛选)      │   │ (AI 量化扫描)     │   │ (自动交易管线)       │
└──────────────┘   └──────────────────┘   └──────────────────┘
                           │                        │
                           ▼                        ▼
                   ┌──────────────┐        ┌──────────────────┐
                   │ stock_signals │        │  Dual-Agent Debate │
                   │   (DB 表)     │        │  (Bull/Bear/Arbiter)│
                   └──────────────┘        └──────────────────┘
                                                    │
                                                    ▼
                                           ┌──────────────────┐
                                           │  TradingGateway   │
                                           │  (统一交易入口)     │
                                           │  TWAP / 直接下单   │
                                           └──────────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                             ┌────────────┐ ┌────────────┐ ┌────────────┐
                             │ PaperEngine │ │ Longport   │ │ StopLoss   │
                             │ (模拟交易)   │ │ (实盘券商)  │ │ Manager    │
                             └────────────┘ └────────────┘ └────────────┘
                                                                │
                                                                ▼
                                                        ┌──────────────┐
                                                        │ QuoteService  │
                                                        │ WS + HTTP回退  │
                                                        └──────────────┘
```

---

## 阶段 1: 股票池筛选 (Universe Screen)

### 触发方式
- Cron 定时任务: `universe-screen-daily`，每周一至周五 22:00 UTC
- 手动触发: 通过 API 调用

### 详细流程
1. `CronScheduler` 触发 `universe-screen` handler
2. `UniverseScreener.runScreen()` 调用 Python 脚本 `scripts/universe_screener.py`
3. Python 脚本通过 yfinance 获取 S&P 500 / NASDAQ 100 / 全市场股票数据
4. 按以下条件筛选:
   - 日均成交量 ≥ 1,000,000
   - 股价范围: $5 ~ $500
   - ATR% 范围: 1.5% ~ 8.0%
   - 取 Top 100 (按日均成交金额排序)
5. 结果写入 `dynamic_watchlist` 表
6. 板块数据推送至 `RiskController.setSectorMappings()` (用于板块集中度风控)
7. 筛选出的 symbols 自动合并到 `StockScanner` 的 watchlist

### 关键文件
- `src/services/UniverseScreener.ts`
- `scripts/universe_screener.py`

### 运行状态: ✅ 可跑通
- Python 脚本通过 `execFile` 调用，5 分钟超时
- 结果以 JSON 格式输出，TypeScript 端解析并存入 SQLite

---

## 阶段 2: AI 量化扫描 (Stock Scan)

### 触发方式
- Cron 定时任务: `stock-scan`，可自定义 schedule
- 手动触发: 通过 API 调用

### 详细流程
1. `CronScheduler` 触发 `stock-scan` handler
2. 合并 watchlist: 手动配置 + `UniverseScreener` 筛选结果
3. 对每个 symbol 执行 `StockScanner.analyzeSingle()`:
   - 调用 `stock_tech_analysis` 工具 → Python `stock_analysis.py` 计算技术指标 (SMA, RSI, MACD, 布林带, ATR14)
   - 调用 `stock_sentiment` 工具 → 获取市场情绪与新闻数据
   - 调用 `AIRuntime.execute()` → Quant Agent (quant-analyst) 综合研判
   - AI 输出结构化 Signal_Card (symbol, action, entry_price, stop_loss, take_profit, confidence, reasoning)
4. Signal_Card 写入 `stock_signals` 表
5. 高置信度信号通过 `NotificationService` 推送至 Telegram/Discord

### 关键文件
- `src/services/StockScanner.ts`
- `scripts/stock_analysis.py`
- Quant Agent IDENTITY.md (在 `src/index.ts` 中配置)

### 运行状态: ✅ 可跑通
- Quant Agent 已在 `main()` 中自动创建并配置 IDENTITY.md
- 技术面 + 消息面双重数据源，AI 综合研判后输出 Signal_Card

---

## 阶段 3: 信号评估与过滤 (Signal Evaluation)

### 触发方式
- `AutoTradingPipeline` 轮询 `stock_signals` 表 (每 30 秒)

### 详细流程
1. `AutoTradingPipeline.pollNewSignals()` 查询未处理的信号
2. 对每个信号调用 `SignalEvaluator.evaluate()`:
   - action === 'hold' → 跳过
   - entry_price 缺失 → 跳过
   - confidence 低于阈值 (默认 0.6) → 跳过
   - 去重窗口内已有相同 symbol+action 的成功订单 → 跳过
3. 通过评估的信号进入 Dual-Agent Debate 阶段

### 关键文件
- `src/services/trading/SignalEvaluator.ts`
- `src/services/trading/AutoTradingPipeline.ts` (`pollNewSignals`, `processSignal`)

### 运行状态: ✅ 可跑通
- 纯函数 + DB 查询，无外部依赖
- 去重窗口默认 24 小时，防止重复下单

---

## 阶段 4: 双智能体辩论 (Dual-Agent Debate)

### 触发方式
- `AutoTradingPipeline.processSignal()` 中，信号通过 SignalEvaluator 后自动触发

### 详细流程
1. `AutoTradingPipeline.runDebate()` 被调用
2. 串行调用三个 AI Agent:
   - **Bull Analyst (多头分析师)**: 分析利好因素和买入理由
   - **Bear Analyst (空头分析师)**: 分析利空因素和风险点
   - **Arbiter (仲裁者)**: 综合多空意见，输出最终决策
3. Arbiter 输出结构化 JSON: `{ action, confidence, reasoning }`
4. 如果 Arbiter 决策为 'hold' 或 confidence 不足 → 跳过
5. 如果 Arbiter 决策为 'buy'/'sell' → 进入下单流程

### 关键文件
- `src/services/trading/AutoTradingPipeline.ts` (`runDebate`)
- Bull/Bear Agent 在 `src/index.ts` 中创建并配置 IDENTITY.md

### 运行状态: ✅ 可跑通
- 三个 Agent 均在 `main()` 中自动创建
- 使用 DeepSeek-R1 作为主模型，o1-mini 作为 fallback
- 延迟约 15-45 秒/信号 (三次 LLM 调用)，对 Swing Trading 可接受

---

## 阶段 5: 风控检查与仓位计算 (Risk Management)

### 触发方式
- `TradingGateway.placeOrder()` 中自动执行

### 详细流程

#### 5a. 仓位计算 (QuantityCalculator)
支持 4 种模式:
- `fixed_quantity`: 固定股数
- `fixed_amount`: 固定金额 (金额 / 入场价)
- `kelly_formula`: Kelly 公式 (基于胜率和盈亏比)
- `volatility_parity`: 波动率平价 (单笔最大亏损 = 总资金 × 1%, 止损宽容度 = 2 × ATR)

#### 5b. 风控检查 (RiskController)
5 条静态规则:
| 规则 | 说明 | 默认阈值 |
|------|------|----------|
| max_order_amount | 单笔最大金额 | 可配置 |
| max_daily_amount | 日累计最大金额 | 可配置 |
| max_position_ratio | 单股最大持仓比例 | 可配置 |
| max_daily_loss | 日最大亏损 | 可配置 |
| max_daily_trades | 日最大交易次数 | 可配置 |

动态风控:
- `updateDynamicRisk(portfolioDrawdown, vixLevel)` 根据 VIX 和回撤调整风险乘数
- 市场状态分为: `low_vol` / `normal` / `high_vol` / `crisis`
- 板块集中度检查: `checkSectorExposure()` 防止单一板块过度集中

#### 5c. 策略资金分配 (StrategyAllocator)
- 每个策略有独立的 `allocated_capital` 和 `used_capital`
- 下单时检查策略剩余额度
- 卖出成交时自动记录 PnL: `recordPnl(strategy_id, pnl, released)`

### 关键文件
- `src/services/trading/QuantityCalculator.ts`
- `src/services/trading/RiskController.ts`
- `src/services/trading/StrategyAllocator.ts` (在 TradingGateway 中引用)

### 运行状态: ✅ 可跑通
- 纯函数 + DB 查询，无外部依赖
- 风控规则在 `initDefaultRules()` 中初始化

---

## 阶段 6: 行情服务 (Quote Service)

### 触发方式
- 系统启动时自动初始化 (步骤 16)
- StopLossManager / PositionSyncer 按需调用

### 详细流程 — 双通道架构

```
QuoteService
├── 主通道: Longport WebSocket (实时推送)
│   ├── 连接超时: 8 秒
│   ├── 推送事件: handleQuoteEvent → 更新内存缓存
│   └── 失败时: 自动切换到 HTTP 回退
│
└── 回退通道: Finnhub HTTP API
    ├── 缓存 TTL: 30 秒
    ├── 请求超时: 10 秒
    ├── 速率限制: 60 次/分钟 (免费 tier)
    └── 自动去除市场后缀 (AAPL.US → AAPL)
```

#### `getPriceNumber(symbol)` 获取价格的优先级:
1. 内存缓存 (WebSocket 推送的最新价)
2. Longport HTTP 轮询 (如果 WS 连接正常)
3. Finnhub HTTP 回退 (如果 Longport 不可用)
4. 抛出错误 (所有通道都失败)

### 关键文件
- `src/services/trading/QuoteService.ts`
- `src/services/trading/FinnhubPriceProvider.ts`

### 运行状态: ✅ 可跑通
- 台湾网络环境下 Longport WebSocket 超时问题已通过 Finnhub HTTP 回退解决
- `setFallbackProvider()` 在 `main()` 步骤 16 中配置
- StopLossManager 和 PositionSyncer 均已接入 `QuoteService.getPriceNumber()`
- 即使 Longport 凭证缺失，也可以纯 Finnhub 模式运行

---

## 阶段 7: 交易执行 (Trading Gateway)

### 触发方式
- `AutoTradingPipeline.processSignal()` 调用 `TradingGateway.placeOrder()`
- StopLossManager 触发止盈止损时调用

### 详细流程

#### 7a. 普通下单
1. 风控检查 (`RiskController.checkOrder()`)
2. 如果通过 → 路由到对应 Broker:
   - `paper` 模式 → `PaperTradingEngine` (本地模拟)
   - `live` 模式 → `LongportAdapter` (实盘券商)
3. 订单写入 `trading_orders` 表
4. 通知推送 (`TradeNotifier.notifyOrderCreated()`)
5. 审计日志 (`trading_audit_log`)

#### 7b. TWAP 拆单 (金额 > $50,000)
1. 计算拆单数量: `totalQuantity / slices` (默认 5 片)
2. 每片间隔 `intervalMs` (默认 60 秒) 执行
3. 每片独立走风控 → 下单 → 记录
4. 支持 `cancelAllTWAP()` 中途取消

#### 7c. 止盈止损执行
1. `StopLossManager.checkAll()` 每 30 秒轮询
2. 获取实时价格 (通过 QuoteService)
3. 检查是否触发:
   - 固定止损: `current_price ≤ stop_loss`
   - 固定止盈: `current_price ≥ take_profit`
   - Trailing Stop: 更新 `highest_price`，检查 `current_price ≤ highest_price × (1 - trailing_percent)`
   - Chandelier Exit: `current_price ≤ highest_price - trailing_atr_multiplier × atr_value`
4. 触发时 → 自动下卖单 → 通知推送

### 关键文件
- `src/services/trading/TradingGateway.ts`
- `src/services/trading/StopLossManager.ts`
- `src/services/trading/LongportAdapter.ts`
- `src/services/trading/PaperTradingEngine.ts`

### 运行状态: ✅ 可跑通
- Paper 模式完全本地化，无外部依赖
- Live 模式通过 Longport SDK 连接券商
- TWAP 拆单逻辑已实现，支持中途取消
- Chandelier Exit (ATR-based trailing) 已实现

---

## Cron 定时任务总览

| Job ID | 名称 | Schedule | Handler | 说明 |
|--------|------|----------|---------|------|
| `universe-screen-daily` | 股票池自动筛选 | `0 22 * * 1-5` (周一至五 22:00 UTC) | `universe-screen` | 筛选适合量化交易的美股 |
| `stock-scan` | AI 量化扫描 | 可配置 | `stock-scan` | 技术面+消息面 AI 分析 |
| `data-sync-daily` | 历史数据同步 | `30 22 * * 1-5` (周一至五 22:30 UTC) | `data-sync` | 同步 OHLCV 日线数据到本地 |
| `vix-monitor-periodic` | VIX 恐慌指数监控 | `*/15 13-21 * * 1-5` (美股交易时段每 15 分钟) | `vix-monitor` | VIX > 25 时收紧所有止损至 1×ATR |
| `signal-verify-periodic` | 信号回溯验证 | `*/30 * * * 1-5` (周一至五每 30 分钟) | `signal-verify` | 验证历史信号的准确性 |
| `weekly-review-saturday` | AI 周末复盘报告 | `0 2 * * 6` (周六 02:00 UTC) | `weekly-review` | 分析本周亏损交易，生成反思报告 |

---

## 数据库表结构

### 交易核心表
| 表名 | 说明 |
|------|------|
| `trading_orders` | 订单记录 (symbol, side, type, quantity, price, status, mode) |
| `trading_config` | 交易配置 (key-value 格式) |
| `trading_audit_log` | 审计日志 (operation, order_id, params, result) |
| `risk_rules` | 风控规则 (5 种类型, threshold, enabled) |
| `stop_loss_records` | 止盈止损记录 (含 trailing, Chandelier Exit ATR 字段) |
| `pipeline_signal_log` | 管线信号处理日志 (signal → 结果追踪) |

### 模拟交易表
| 表名 | 说明 |
|------|------|
| `paper_account` | 模拟账户 (单行, 初始资金 100 万) |
| `paper_positions` | 模拟持仓 |

### 数据与分析表
| 表名 | 说明 |
|------|------|
| `ohlcv_daily` | OHLCV 日线缓存 (symbol + date 联合主键) |
| `backtest_results` | 回测结果 (含权益曲线 JSON) |
| `dynamic_watchlist` | 动态股票池 (UniverseScreener 输出) |
| `stock_signals` | AI 分析信号 (Signal_Card 格式) |

### 风控与策略表
| 表名 | 说明 |
|------|------|
| `symbol_sectors` | 股票板块映射 (用于板块集中度风控) |
| `strategy_allocations` | 策略资金分配与 PnL 追踪 |
| `dynamic_risk_state` | 动态风控状态 (VIX, 回撤, 风险乘数) |

---

## v2.0 已实现的核心功能

### 1. 双智能体辩论 (Dual-Agent Debate)
- Bull Analyst + Bear Analyst + Arbiter 三角辩论
- 在 `AutoTradingPipeline.runDebate()` 中实现
- 使用 DeepSeek-R1 / o1-mini 模型

### 2. TWAP 智能拆单
- 金额 > $50,000 自动拆分为 5 片
- 每片间隔 60 秒执行
- 在 `TradingGateway.executeTWAP()` 中实现

### 3. 波动率平价仓位 (Volatility Parity)
- 单笔最大亏损 = 总资金 × 1%
- 止损宽容度 = 2 × ATR
- 在 `QuantityCalculator` 的 `volatility_parity` 模式中实现

### 4. Chandelier Exit (ATR 移动止损)
- `stop_loss = highest_price - multiplier × ATR`
- `stop_loss_records` 表新增 `trailing_atr_multiplier` 和 `atr_value` 字段
- 在 `StopLossManager.checkAll()` 中实现

### 5. Finnhub HTTP 回退
- Longport WebSocket 超时 (8 秒) 后自动切换
- 30 秒缓存 TTL，60 次/分钟速率限制
- 在 `FinnhubPriceProvider` 中实现

### 6. VIX 恐慌指数监控
- 每 15 分钟获取 VIX (通过 Python yfinance)
- VIX > 25 时收紧所有止损至 1×ATR
- 联动 `RiskController.updateDynamicRisk()` 调整风险乘数

### 7. AI 周末复盘
- 每周六 02:00 UTC 自动执行
- 分析本周亏损交易，生成《败局反思报告》
- 通过 `TradeNotifier` 推送至 Telegram/Discord

---

## 通知与前端

### 通知推送 (TradeNotifier)
- 订单创建/成交/失败通知
- 止盈止损触发通知
- 风控拒绝告警
- VIX 紧急告警
- 通过 `NotificationService` → Telegram / Discord 推送
- 同时通过 WebSocket 推送至前端 (`server.broadcastTradingEvent`)

### 前端组件
- `AutoTradingPanel.tsx`: 管线控制面板 (启停、配置、状态)
- `TradingDashboardView.tsx`: 交易仪表盘 (订单、持仓、审计日志)
- `tradingStore.ts`: Zustand 状态管理 (WebSocket 实时更新)

---

## 持仓同步 (PositionSyncer)

- 每 60 秒同步一次
- Broker 数据为 source of truth
- 通过 `QuoteService.getPriceNumber()` 获取实时价格 (Longport 的 `stockPositions()` 不返回实时价)
- 自动处理: 新增持仓 / 更新持仓 / 移除已清仓

---

## 优雅关闭 (Graceful Shutdown)

收到 SIGTERM/SIGINT 后依序停止:
1. `AutoTradingPipeline.stop()` — 停止信号轮询
2. `TradingGateway.cancelAllTWAP()` — 取消所有进行中的 TWAP
3. `StopLossManager.stopMonitoring()` — 停止止损监控
4. `QuoteService.stop()` — 断开行情连接
5. `PositionSyncer.stop()` — 停止持仓同步
6. `CronScheduler.stop()` — 停止定时任务
7. `APIServer.stop()` — 停止 HTTP/WS 服务
8. `ChannelManager.disconnectAll()` — 断开 Telegram/Discord
9. 10 秒超时后强制退出

---

## 关键文件索引

### 交易核心
| 文件 | 说明 |
|------|------|
| `src/services/trading/AutoTradingPipeline.ts` | 自动交易管线 (信号轮询 → 辩论 → 下单) |
| `src/services/trading/TradingGateway.ts` | 统一交易入口 (风控 → 路由 → TWAP) |
| `src/services/trading/SignalEvaluator.ts` | 信号评估与过滤 |
| `src/services/trading/QuantityCalculator.ts` | 仓位计算 (4 种模式) |
| `src/services/trading/RiskController.ts` | 风控引擎 (静态规则 + 动态风控) |
| `src/services/trading/StopLossManager.ts` | 止盈止损管理 (含 Chandelier Exit) |
| `src/services/trading/StrategyAllocator.ts` | 策略资金分配 |

### 券商与行情
| 文件 | 说明 |
|------|------|
| `src/services/trading/LongportAdapter.ts` | Longport 券商适配器 |
| `src/services/trading/PaperTradingEngine.ts` | 模拟交易引擎 |
| `src/services/trading/QuoteService.ts` | 行情服务 (WS + HTTP 双通道) |
| `src/services/trading/FinnhubPriceProvider.ts` | Finnhub HTTP 回退 |
| `src/services/trading/PositionSyncer.ts` | 持仓同步 |

### 扫描与分析
| 文件 | 说明 |
|------|------|
| `src/services/UniverseScreener.ts` | 股票池自动筛选 |
| `src/services/StockScanner.ts` | AI 量化扫描 |
| `scripts/universe_screener.py` | Python 股票池筛选脚本 |
| `scripts/stock_analysis.py` | Python 技术面分析脚本 |
| `scripts/vix_monitor.py` | Python VIX 监控脚本 |

### 通知与前端
| 文件 | 说明 |
|------|------|
| `src/services/trading/TradeNotifier.ts` | 交易通知器 |
| `src/services/trading/tradingSchema.ts` | 数据库 Schema (14+ 表) |
| `frontend/src/components/views/AutoTradingPanel.tsx` | 管线控制面板 |
| `frontend/src/components/views/TradingDashboardView.tsx` | 交易仪表盘 |
| `frontend/src/stores/tradingStore.ts` | 前端状态管理 |

### 系统入口
| 文件 | 说明 |
|------|------|
| `src/index.ts` | 主启动文件 (步骤 15-19 为交易模块初始化) |
| `src/services/CronScheduler.ts` | 定时任务调度器 |

---

## 已知限制与注意事项

1. **Longport 免费行情为 Nasdaq Basic (LV1 实时)** — 免费订阅上限约 500 只股票，港股/A股通也是实时 LV1
2. **Finnhub 免费 tier 限制 60 次/分钟** — 监控 symbol 数量过多时需注意速率
3. **双智能体辩论延迟 15-45 秒** — 三次 LLM 串行调用，对日线级交易可接受
4. **VWAP 拆单不可行** — 缺少分钟级成交量数据，仅实现 TWAP
5. **VIX 数据延迟 ~15 分钟** — yfinance 免费数据，对 VIX 级别判断 (>25 vs <15) 足够
6. **PaperTradingEngine 条件单** — Stop/Stop-Limit 订单仅返回 `submitted`，不模拟触发
