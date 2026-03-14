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

### 运行状态: ✅ 可跑通

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
- `src/services/trading/AutoTradingPipeline.ts`

### 运行状态: ✅ 可跑通

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

### 运行状态: ✅ 可跑通

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
- `risk_budget`: 风险预算 (单笔最大亏损 = 总资金 × max_risk_pct / 每股风险)

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
- `src/services/trading/StrategyAllocator.ts`

### 运行状态: ✅ 可跑通

---

## 阶段 6: 行情服务 (Quote Service)

### 触发方式
- 系统启动时自动初始化
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

### 价格源实时性分析（仅美股）

| 特性 | Longport WS (主通道) | Finnhub HTTP (回退通道) |
|------|---------------------|----------------------|
| 美股实时性 | Nasdaq Basic，~15 分钟延迟（免费版） | 实时报价 |
| 更新方式 | WebSocket 推送 + 60s 轮询 | HTTP 请求，30s 缓存 TTL |
| 调用限制 | 无（推送模式，订阅上限 500 只） | 60 次/分钟 |

### 关键文件
- `src/services/trading/QuoteService.ts`
- `src/services/trading/FinnhubPriceProvider.ts`

### 运行状态: ✅ 可跑通

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

---

## 前端页面

### 实盘大屏 (LiveDashboardView)

只读直播看板，深色主题，60 秒自动刷新，1920×1080 优化。

数据来源: `GET /api/trading/live-dashboard` → `handleLiveDashboard()`

#### 账户概览卡片 (AccountSummaryCard)

| 字段 | 计算逻辑 | 数据来源 |
|------|----------|----------|
| 持仓成本 | `Σ(avg_cost × quantity)` 所有持仓 | `gateway.getPositions()` |
| 持仓市值 | `Σ(current_price × quantity)` 所有持仓 | `gateway.getPositions()` + QuoteService 实时价 |
| 累计收益率 | `(市值 - 成本) / 成本 × 100` | 由上两项计算 |
| 当日盈亏 | equity_curve 最后一天的 `daily_pnl` | `PerformanceAnalytics.getMetrics()` |

注意: 当日盈亏基于已平仓交易 (FIFO 匹配 buy→sell)，不含未实现盈亏。无平仓交易时显示 $0.00。

#### AI 决策流 (AIDecisionFeed)
- 查询 `trading_audit_log` 表中 `operation = 'multi_strategy_order'` 的最近 10 条记录
- JOIN `trading_orders` 获取 `order_side` 和 `order_price`
- 从 `request_params` JSON 解析 `symbol`、`composite_score`、`ai_filter_result`
- 无记录时显示"暂无 AI 决策"

#### 持仓面板 (PositionPanel)
- 数据来自 `gateway.getPositions()`，经 PositionSyncer 实时价格填充
- 浮动盈亏: `(current_price - avg_cost) × quantity`
- 盈亏%: `(current_price - avg_cost) / avg_cost × 100`

#### 其他组件
| 组件 | 说明 |
|------|------|
| LiveHeader | 标题 + 交易中/已收盘状态 + 运行天数 |
| EquityCurveChart | 净值曲线图表 (基于 equity_curve) |
| TradeHistoryTable | 近期 20 条已平仓交易 (来自 trade_journal) |
| MetricsBar | 胜率、夏普比率、最大回撤、总交易数、盈亏比 |
| RiskSummary | 风控规则状态摘要 |

### 量化交易页面 (TradingDashboardView)

交互式交易管理页面，白色主题，15 秒轮询刷新。

#### 账户概览 (AccountOverview)
| 字段 | 计算逻辑 | 数据来源 |
|------|----------|----------|
| 持仓成本 | `Σ(avg_cost × quantity)` | `tradingStore.positions` |
| 持仓市值 | `Σ(current_price × quantity)` | `tradingStore.positions` |
| 浮动盈亏 | `市值 - 成本` | 由上两项计算 |
| 当日交易笔数 | `stats.total_orders` | `GET /api/trading/stats` |

两个页面的持仓成本/市值计算逻辑一致，均基于 positions 数组，统一使用 USD。

#### 其他功能模块
| 模块 | 说明 |
|------|------|
| TradingModeSwitch | 模拟/实盘模式切换 (含确认弹窗) |
| BrokerSettingsPanel | Longport 券商凭证配置 |
| DynamicRiskPanel | VIX 市场状态 + 风险乘数 + 组合回撤 |
| AutoTradingPanel | 自动交易管线控制 (启停、配置) |
| ActiveOrdersTable | 活跃订单 (pending/submitted/partial_filled) |
| OrderHistoryTable | 历史订单 (分页、筛选、API 分页查询) |
| RiskStatusPanel | 风控规则使用进度条 |
| ManualOrderForm | 手动下单表单 |

---

## Cron 定时任务总览

| Job ID | Schedule | 说明 |
|--------|----------|------|
| `universe-screen-daily` | `0 22 * * 1-5` | 筛选适合量化交易的美股 |
| `stock-scan` | 可配置 | 技术面+消息面 AI 分析 |
| `data-sync-daily` | `30 22 * * 1-5` | 同步 OHLCV 日线数据 |
| `vix-monitor-periodic` | `*/15 13-21 * * 1-5` | VIX > 25 时收紧止损 |
| `signal-verify-periodic` | `*/30 * * * 1-5` | 验证历史信号准确性 |
| `weekly-review-saturday` | `0 2 * * 6` | AI 周末复盘报告 |

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
| `pipeline_signal_log` | 管线信号处理日志 |

### 模拟交易表
| 表名 | 说明 |
|------|------|
| `paper_account` | 模拟账户 (单行, 初始资金 100 万) |
| `paper_positions` | 模拟持仓 |

### 数据与分析表
| 表名 | 说明 |
|------|------|
| `ohlcv_daily` | OHLCV 日线缓存 |
| `backtest_results` | 回测结果 |
| `dynamic_watchlist` | 动态股票池 (UniverseScreener 输出) |
| `stock_signals` | AI 分析信号 (Signal_Card 格式) |
| `trade_journal` | 已平仓交易记录 (用于绩效分析和 AI 周末复盘) |

### 风控与策略表
| 表名 | 说明 |
|------|------|
| `symbol_sectors` | 股票板块映射 |
| `strategy_allocations` | 策略资金分配与 PnL 追踪 |
| `dynamic_risk_state` | 动态风控状态 (VIX, 回撤, 风险乘数) |

---

## 持仓同步 (PositionSyncer)

- 每 60 秒同步一次
- Broker 数据为 source of truth
- 通过 `QuoteService.getPriceNumber()` 获取实时价格填充 `current_price`
- Longport `stockPositions()` 不返回实时价，初始 `current_price = avg_cost`
- 自动处理: 新增持仓 / 更新持仓 / 移除已清仓

---

## LongportAdapter 账户与持仓

### getAccount() 返回值
| 字段 | 来源 | 币种 |
|------|------|------|
| `total_assets` | `bal.netAssets` | HKD (账户基础币种) |
| `available_cash` | USD cashInfos `availableCash` | USD |
| `frozen_cash` | USD cashInfos `frozenCash` | USD |
| `currency` | 硬编码 `'USD'` | — |

> ⚠️ `total_assets` 实际为 HKD 计价的净资产，与其他 USD 字段存在币种不一致。
> 目前实盘大屏和量化交易页面均不使用 `total_assets` 显示，改为从 positions 计算。
> 但 `QuantityCalculator` 的 kelly/volatility_parity/risk_budget 模式仍使用此值，
> 在实盘模式下可能导致仓位计算偏差（HKD 金额 ÷ USD 价格）。

### getPositions() 返回值
| 字段 | 来源 |
|------|------|
| `symbol` | `pos.symbol` (如 AAPL.US) |
| `quantity` | `pos.quantity` |
| `avg_cost` | `pos.costPrice` (USD) |
| `current_price` | 初始 = `costPrice`，后由 PositionSyncer 通过 QuoteService 更新 |
| `market_value` | `quantity × current_price` |

---

## v2.0 已实现的核心功能

1. **双智能体辩论** — Bull + Bear + Arbiter 三角辩论
2. **TWAP 智能拆单** — 金额 > $50,000 自动拆分 5 片
3. **波动率平价仓位** — 单笔最大亏损 = 总资金 × 1%
4. **Chandelier Exit** — ATR 移动止损
5. **Finnhub HTTP 回退** — Longport WS 超时后自动切换
6. **VIX 恐慌指数监控** — VIX > 25 收紧止损
7. **AI 周末复盘** — 每周六自动分析亏损交易
8. **实盘大屏** — 只读直播看板，深色主题，60s 自动刷新
9. **统一 USD 显示** — 两个页面均基于 positions 计算，统一美元

---

## 通知与 WebSocket

### 通知推送 (TradeNotifier)
- 订单创建/成交/失败、止盈止损触发、风控拒绝、VIX 告警
- 通过 `NotificationService` → Telegram / Discord
- 同时通过 WebSocket 推送至前端 (`server.broadcastTradingEvent`)

### 前端 WebSocket 实时更新
- 连接 `ws://host/ws`，自动重连 (5 秒延迟)
- 事件类型: `order_created`, `order_filled`, `order_failed`, `stop_loss_triggered`, `risk_alert`
- 收到事件后自动刷新相关数据 (订单、账户、持仓)

---

## 优雅关闭 (Graceful Shutdown)

收到 SIGTERM/SIGINT 后依序停止:
1. `AutoTradingPipeline.stop()`
2. `TradingGateway.cancelAllTWAP()`
3. `StopLossManager.stopMonitoring()`
4. `QuoteService.stop()`
5. `PositionSyncer.stop()`
6. `CronScheduler.stop()`
7. `APIServer.stop()`
8. `ChannelManager.disconnectAll()`
9. 10 秒超时后强制退出

---

## 关键文件索引

### 交易核心
| 文件 | 说明 |
|------|------|
| `src/services/trading/AutoTradingPipeline.ts` | 自动交易管线 |
| `src/services/trading/TradingGateway.ts` | 统一交易入口 |
| `src/services/trading/SignalEvaluator.ts` | 信号评估与过滤 |
| `src/services/trading/QuantityCalculator.ts` | 仓位计算 (5 种模式) |
| `src/services/trading/RiskController.ts` | 风控引擎 |
| `src/services/trading/StopLossManager.ts` | 止盈止损管理 |
| `src/services/trading/StrategyAllocator.ts` | 策略资金分配 |
| `src/services/trading/PerformanceAnalytics.ts` | 绩效分析 (equity curve, 胜率等) |
| `src/services/trading/TradeJournal.ts` | 交易日志 (已平仓记录) |

### 券商与行情
| 文件 | 说明 |
|------|------|
| `src/services/trading/LongportAdapter.ts` | Longport 券商适配器 |
| `src/services/trading/PaperTradingEngine.ts` | 模拟交易引擎 |
| `src/services/trading/QuoteService.ts` | 行情服务 (WS + HTTP) |
| `src/services/trading/FinnhubPriceProvider.ts` | Finnhub HTTP 回退 |
| `src/services/trading/PositionSyncer.ts` | 持仓同步 |

### API 与前端
| 文件 | 说明 |
|------|------|
| `src/api/tradingRoutes.ts` | 交易 API 路由 + handleLiveDashboard |
| `frontend/src/components/views/LiveDashboardView.tsx` | 实盘大屏 |
| `frontend/src/components/views/TradingDashboardView.tsx` | 量化交易页面 |
| `frontend/src/components/views/AccountSummaryCard.tsx` | 实盘大屏账户卡片 |
| `frontend/src/components/views/PositionPanel.tsx` | 实盘大屏持仓面板 |
| `frontend/src/components/views/AIDecisionFeed.tsx` | AI 决策流 |
| `frontend/src/stores/tradingStore.ts` | 量化交易状态管理 |
| `frontend/src/stores/liveDashboardStore.ts` | 实盘大屏状态管理 |
| `frontend/src/utils/liveDashboardUtils.ts` | 格式化工具 (formatUSD 等) |

---

## 已知限制与注意事项

1. **Longport 免费美股行情 ~15 分钟延迟** — 对 Swing Trading 可接受
2. **Finnhub 免费 tier 60 次/分钟** — 仅作为回退通道
3. **目前仅支持美股** — 港股/A股代码保留但未启用
4. **双智能体辩论延迟 15-45 秒** — 三次 LLM 串行调用
5. **VWAP 拆单不可行** — 缺少分钟级成交量数据，仅实现 TWAP
6. **VIX 数据延迟 ~15 分钟** — yfinance 免费数据
7. **当日盈亏仅含已平仓** — 基于 FIFO 匹配的 closed trades，不含未实现盈亏
8. **getAccount().total_assets 币种问题** — netAssets 为 HKD，影响 kelly/volatility_parity 仓位计算
