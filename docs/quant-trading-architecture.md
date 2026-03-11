# 量化分析与自动化交易系统 — 技术架构设计文档

> 版本: 1.0 | 更新日期: 2026-03-11

---

## 1. 系统总览

本系统是一个全栈量化交易平台，集成在 AI Assistant (OpenPilot) 中，实现从信号生成到自动下单的完整闭环。

### 1.1 架构分层

```
┌───────────────────────────────────────────────────────────────┐
│                    Frontend (React + Zustand)                  │
│  TradingDashboardView · AutoTradingPanel · PerformanceView     │
│  tradingStore — WebSocket 实时推送 + HTTP 轮询                  │
└─────────────────────────┬─────────────────────────────────────┘
                          │ REST API + WebSocket
┌─────────────────────────▼─────────────────────────────────────┐
│                    API Layer (Express Router)                   │
│  tradingRoutes.ts — 30+ endpoints (/api/trading/*)             │
│  server.ts — broadcastTradingEvent() WS push                   │
└─────────────────────────┬─────────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────────┐
│                    Trading Core (TypeScript)                    │
│                                                                │
│  AutoTradingPipeline ──→ TradingGateway ──→ LongportAdapter    │
│       ↓                      ↓                                 │
│  SignalEvaluator        RiskController                         │
│  QuantityCalculator     StrategyAllocator                      │
│  StopLossManager        OrderManager                           │
│  TradeNotifier          PaperTradingEngine                     │
│  PerformanceAnalytics   PositionSyncer                         │
└─────────────────────────┬─────────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────────┐
│                    Data Layer                                   │
│  SQLite (better-sqlite3) — 14 张交易相关表                      │
│  QuoteService (Longport SDK) — 实时/延迟行情                    │
│  DataManager (yfinance) — OHLCV 日线缓存                       │
│  UniverseScreener (Python) — 每日选股                           │
└───────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈

| 层级 | 技术 |
|------|------|
| 后端运行时 | Node.js + TypeScript |
| 数据库 | SQLite (better-sqlite3, 同步 API) |
| 券商 SDK | longport v3.0.23 (Node.js binding) |
| Python 脚本 | yfinance + pandas + pandas_ta (venv: scripts/.venv) |
| 前端框架 | React 18 + TypeScript + Vite |
| 状态管理 | Zustand |
| 测试 | Jest (后端, 968 tests) + Vitest (前端) |

---

## 2. 核心模块详解

### 2.1 AutoTradingPipeline — 自动交易编排层

**文件**: `src/services/trading/AutoTradingPipeline.ts`

职责: 连接信号检测 → 评估 → 数量计算 → 下单 → 止损注册 → 通知 → 日志。

**信号来源**:
- **Quant Analyst 信号**: 轮询 `stock_signals` 表，由 AI 智能体 (quant-analyst) 通过 `stock_deliver_alert` 工具投递
- **策略扫描信号**: `processStrategyScanResult()` 接收 StrategyEngine 的技术指标扫描结果

**处理流程**:
```
pollNewSignals() — 定时轮询 (默认 5s)
  │
  ▼ 顺序处理每个信号 (避免并发去重失效)
processSignal(signal)
  ├─ 1. auto_trade_enabled? → 否则 skip
  ├─ 2. SignalEvaluator.evaluate()
  │     ├─ action === 'hold' → skip
  │     ├─ entry_price 缺失 → skip
  │     ├─ confidence < threshold → skip
  │     └─ 去重窗口内重复 → skip
  ├─ 3. QuantityCalculator.calculateOrderQuantity()
  ├─ 4. TradingGateway.placeOrder()
  ├─ 5. StopLossManager.register() (买入且有 SL/TP)
  ├─ 6. TradeNotifier.notifyOrderCreated()
  └─ 7. 写入 pipeline_signal_log
```

**可配置参数** (存储在 `trading_config` 表):

| 参数 | 默认值 | 说明 |
|------|--------|------|
| auto_trade_enabled | false | 总开关 |
| confidence_threshold | 0.6 | 信号置信度阈值 (0-1) |
| dedup_window_hours | 24 | 去重窗口 (小时) |
| quantity_mode | fixed_quantity | 下单量模式 |
| fixed_quantity_value | 100 | 固定数量 |
| fixed_amount_value | 10000 | 固定金额 |
| signal_poll_interval_ms | 5000 | 轮询间隔 |

### 2.2 TradingGateway — 统一交易入口

**文件**: `src/services/trading/TradingGateway.ts`

所有交易操作的唯一入口，协调 OrderManager、RiskController 和执行引擎。

**placeOrder() 流程**:
```
CreateOrderRequest
  │
  ├─ 1. OrderManager.createOrder() → pending
  ├─ 2. 市价单价格估算 (防止 price=null 绕过风控)
  ├─ 3. RiskController.checkOrder() — 5 项风控规则
  ├─ 4. RiskController.checkSectorExposure() — 板块集中度
  ├─ 5. StrategyAllocator.checkAllocation() — 策略资金限额
  ├─ 6. 路由到执行引擎:
  │     ├─ paper + 有券商凭证 → LongportAdapter (模拟 API)
  │     ├─ paper + 无凭证 → PaperTradingEngine (本地模拟)
  │     └─ live → LongportAdapter (实盘 API)
  ├─ 7. OrderManager.updateOrderStatus()
  ├─ 8. StrategyAllocator.recordUsage() (成交时)
  └─ 9. 写入 trading_audit_log
```

**交易模式切换**:
- `paper` 模式: 优先使用 Longport 模拟 API (paper_access_token)，无凭证时回退到本地 PaperTradingEngine
- `live` 模式: 必须通过 `testConnection()` 验证后才能切换
- Paper 和 Live 共享 App Key/Secret，使用不同 Access Token

### 2.3 RiskController — 风控引擎

**文件**: `src/services/trading/RiskController.ts`

**静态风控规则** (存储在 `risk_rules` 表):

| 规则类型 | 默认阈值 | 说明 |
|----------|----------|------|
| max_order_amount | 100,000 | 单笔订单金额上限 |
| max_daily_amount | 500,000 | 单日交易总金额上限 |
| max_position_ratio | 0.3 (30%) | 单只股票持仓占比上限 |
| max_daily_loss | 50,000 | 单日最大亏损限额 |
| max_daily_trades | 50 | 单日最大交易笔数 |

**板块风控**: `checkSectorExposure()` — 单一板块暴露不超过总资产 40%，板块数据来自 `symbol_sectors` 表 (由 UniverseScreener 推送)。

**动态风控**: `updateDynamicRisk(portfolioDrawdown, vixLevel)` — 根据市场状态自动调整所有风控阈值:

| 市场状态 | 触发条件 | risk_multiplier | 效果 |
|----------|----------|-----------------|------|
| crisis | DD>15% 或 VIX>35 | 0.25 | 阈值缩至 1/4 |
| high_vol | DD>8% 或 VIX>25 | 0.5 | 阈值减半 |
| normal | 默认 | 1.0 | 正常 |
| low_vol | DD<2% 且 VIX<15 | 1.5 | 阈值放宽 50% |

### 2.4 StopLossManager — 止盈止损监控

**文件**: `src/services/trading/StopLossManager.ts`

**功能**:
- 注册止盈止损记录 (关联 order_id)
- 30 秒定时检查所有活跃记录
- 触发时自动生成市价卖出订单
- 支持移动止损 (trailing stop): 价格创新高时自动上移止损位
- 启动时从 DB 恢复活跃记录 (`restoreFromDb()`)
- 新注册符号自动订阅 QuoteService (`onNewSymbol` 回调)

**移动止损逻辑**:
```
if (currentPrice > highest_price):
    highest_price = currentPrice
    newStopLoss = currentPrice * (1 - trailing_percent / 100)
    if (newStopLoss > stop_loss):
        stop_loss = newStopLoss  // 只升不降
```

**PnL 计算**: 根据 `side` 字段区分多空方向:
- 多头 (buy): `(currentPrice - entryPrice) * quantity`
- 空头 (sell): `(entryPrice - currentPrice) * quantity`

### 2.5 OrderManager — 订单生命周期

**文件**: `src/services/trading/OrderManager.ts`

管理订单从创建到终态的完整生命周期，使用 UUID 作为 local_order_id。

**状态机**:
```
pending → submitted → partial_filled → filled
  │          │              │
  │          ├→ cancelled    ├→ cancelled
  │          └→ rejected
  └→ failed
```

所有状态转换通过 `VALID_STATUS_TRANSITIONS` 严格校验，非法转换抛出异常。

### 2.6 LongportAdapter — 券商对接

**文件**: `src/services/trading/LongportAdapter.ts`

实现 `BrokerAdapter` 接口，对接长桥证券 OpenAPI。

**关键设计**:
- 懒初始化: `ensureContext()` 首次调用时创建 `TradeContext`
- 查询操作 (getAccount, getPositions, getOrderStatus) 支持 2 次重试，间隔 1s
- 下单/撤单操作不重试 (避免重复下单)
- `updateCredentials()` 仅在凭证实际变化时重置连接
- `normalizeSymbol()`: AAPL → AAPL.US, 0700 → 0700.HK
- 区域配置: `hk` (默认) / `sg` / `cn`，影响 API 端点 URL

**支持的订单类型映射**:

| 内部类型 | Longport SDK |
|----------|-------------|
| market | OrderType.MO |
| limit | OrderType.LO |
| stop | OrderType.MIT |
| stop_limit | OrderType.LIT |

### 2.7 QuoteService — 实时行情

**文件**: `src/services/trading/QuoteService.ts`

基于 Longport `QuoteContext` 的行情服务。

**工作模式**:
- WebSocket 推送: 订阅 `SubType.Quote`，通过 `setOnQuote` 回调接收实时报价
- 定时轮询: 每 60s 主动拉取一次 (免费账户 US 行情有 ~15 分钟延迟)
- 内存缓存: `priceCache` Map 存储最新价格
- 批量获取: 每次最多 50 个符号 (Longport API 限制)

**对外接口**:
- `getPriceNumber(symbol)`: StopLossManager 使用，缓存未命中时直接查询
- `subscribe(symbols)`: 动态添加订阅
- `EventEmitter.on('price', callback)`: 价格变更事件

### 2.8 PerformanceAnalytics — 绩效分析

**文件**: `src/services/trading/PerformanceAnalytics.ts`

**FIFO 交易匹配**: 按时间顺序将买入成交与卖出成交配对，计算每笔 round-trip 的 PnL。

**指标计算**:
- 胜率 (win_rate): 盈利交易数 / 总完成交易数
- Sharpe Ratio: `(mean_excess_return / std) * sqrt(252)`，无风险利率 4%
- Sortino Ratio: 仅使用下行波动率
- 最大回撤: 追踪权益曲线峰值，记录最大回撤金额/百分比/恢复天数
- 策略归因: 按 strategy_id 分组统计胜率和 PnL

### 2.9 StrategyAllocator — 多策略资金管理

**文件**: `src/services/trading/StrategyAllocator.ts`

为每个策略分配独立的资金预算，跟踪使用量和已实现 PnL。

**核心方法**:
- `setAllocation(strategyId, capital)`: 设置策略资金上限
- `checkAllocation(strategyId, orderAmount)`: 下单前检查剩余额度
- `recordUsage(strategyId, amount)`: 成交后记录资金占用
- `recordPnl(strategyId, pnl, releasedCapital)`: 平仓后更新 PnL 和回撤

### 2.10 SignalEvaluator — 信号过滤

**文件**: `src/services/trading/SignalEvaluator.ts`

纯函数 + 数据库查询，评估信号是否应触发自动交易。

**过滤链** (按顺序):
1. `action === 'hold'` → 跳过
2. `entry_price` 缺失 → 跳过
3. 置信度映射: high=0.9, medium=0.6, low=0.3 → 低于阈值跳过
4. 去重: 查询 `pipeline_signal_log` 中同 symbol+action 且 result='order_created' 的记录

### 2.11 QuantityCalculator — 下单量计算

**文件**: `src/services/trading/QuantityCalculator.ts`

三种模式 (纯函数):
- `fixed_quantity`: 固定股数
- `fixed_amount`: 固定金额 / 入场价 = 股数
- `kelly_formula`: Kelly 公式 `f* = 0.5 * (1 - 1/b)`，其中 `b = reward/risk`

### 2.12 TradeNotifier — 交易通知

**文件**: `src/services/trading/TradeNotifier.ts`

复用 `NotificationService` (Telegram/Discord/Slack) 推送交易事件。同时通过 `onEvent` 回调触发 WebSocket 实时推送。

**通知类型**: 订单创建、订单成交、订单失败、止盈止损触发、紧急告警 (风控拒绝止损单)。

所有通知方法 catch 错误并静默记录，不影响交易流程。

---

## 3. 数据层

### 3.1 数据库表结构 (SQLite)

**文件**: `src/services/trading/tradingSchema.ts` — `initTradingTables(db)`

| 表名 | 用途 | 主键 |
|------|------|------|
| `trading_orders` | 订单记录 | id (自增) |
| `risk_rules` | 风控规则 (5 条) | id, rule_type UNIQUE |
| `trading_audit_log` | 审计日志 | id |
| `paper_account` | 模拟账户 (单行) | id=1 |
| `paper_positions` | 模拟持仓 | id, symbol UNIQUE |
| `trading_config` | 键值配置 | key |
| `stop_loss_records` | 止盈止损记录 | id |
| `pipeline_signal_log` | Pipeline 处理日志 | id |
| `ohlcv_daily` | OHLCV 日线缓存 | (symbol, date) |
| `backtest_results` | 回测结果 | id |
| `symbol_sectors` | 股票板块映射 | symbol |
| `strategy_allocations` | 策略资金分配 | strategy_id |
| `dynamic_risk_state` | 动态风控状态 (单行) | id=1 |
| `dynamic_watchlist` | 选股结果 | symbol |

### 3.2 trading_orders 表字段

```sql
id, local_order_id (UUID), broker_order_id,
symbol, side (buy/sell), order_type (market/limit/stop/stop_limit),
quantity, price, stop_price,
status (pending/submitted/partial_filled/filled/cancelled/rejected/failed),
trading_mode (paper/live),
filled_quantity, filled_price,
strategy_id → strategies(id),
signal_id → stock_signals(id),
reject_reason,
created_at, updated_at
```

### 3.3 DataManager — OHLCV 缓存

**文件**: `src/services/trading/DataManager.ts`

- 通过 Python 脚本 (`scripts/stock_analysis.py --history`) 从 yfinance 获取日线数据
- 缓存到 `ohlcv_daily` 表，后续读取直接查 DB
- 缓存新鲜度: 最新数据距今 ≤1 天且数据量 ≥70% 时使用缓存
- `syncSymbols()`: 批量同步，由 `data-sync-daily` 定时任务调用

### 3.4 UniverseScreener — 自动选股

**文件**: `src/services/UniverseScreener.ts` + `scripts/universe_screener.py`

**Python 脚本筛选条件**:
- 股票池: sp500 / nasdaq100 / momentum / all
- 日均成交量 ≥ 100 万股
- 价格区间: $5 - $500
- ATR% (波动率): 1.5% - 8%
- 按日均成交金额排序，取 Top N

**筛选后数据**: symbol, price, avg_volume, avg_dollar_volume, market_cap, atr_pct, returns_20d, rsi, above_sma20, sector

**板块数据联动**: 筛选完成后通过 `onSectorData` 回调将 sector 映射推送给 RiskController。

---

## 4. 定时任务

通过 `CronScheduler` 管理，存储在 SQLite，支持 cron 表达式。

| 任务 ID | 名称 | 调度 | Handler |
|---------|------|------|---------|
| universe-screen-daily | 股票池自动筛选 | `0 22 * * 1-5` (工作日 22:00 UTC) | universe-screen |
| data-sync-daily | 历史数据同步 | `30 22 * * 1-5` | data-sync |
| signal-verify-periodic | 信号回溯验证 | `*/30 * * * 1-5` (工作日每 30 分钟) | signal-verify |

**PositionSyncer**: 独立定时器 (非 CronScheduler)，每 60 秒:
1. `TradingGateway.syncOrderStatuses()` — 轮询券商订单状态
2. 同步持仓数据到 PortfolioManager

---

## 5. API 接口

所有接口挂载在 `/api/trading/` 前缀下。

### 5.1 订单管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /orders | 创建订单 |
| GET | /orders | 查询订单列表 (支持 status/symbol/日期过滤) |
| GET | /orders/:id | 查询单个订单 |
| POST | /orders/:id/cancel | 撤销订单 |

### 5.2 账户与持仓

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /account | 账户信息 (总资产/可用/冻结) |
| GET | /positions | 持仓列表 |
| GET | /stats | 交易统计 (总单数/成交数/成交金额) |

### 5.3 配置与凭证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /config | 交易配置 (含 Pipeline 参数) |
| PUT | /config | 更新配置 |
| GET | /broker-credentials | 凭证状态 (脱敏) |
| PUT | /broker-credentials | 保存券商凭证 |
| POST | /broker-test | 测试券商连接 |

### 5.4 风控

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /risk-rules | 风控规则列表 |
| PUT | /risk-rules | 更新风控规则 |
| GET | /dynamic-risk | 动态风控状态 |
| POST | /dynamic-risk/update | 手动更新动态风控 |

### 5.5 Pipeline 与监控

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /pipeline/status | Pipeline 运行状态 |
| GET | /pipeline/signals | 最近处理的信号日志 |
| GET | /stop-loss | 活跃止盈止损记录 |
| GET | /performance | 绩效指标 + 权益曲线 |

### 5.6 策略资金

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /strategy-allocations | 策略资金分配列表 |
| PUT | /strategy-allocations | 设置策略资金分配 |

---

## 6. 前端架构

### 6.1 状态管理 — tradingStore (Zustand)

**文件**: `frontend/src/stores/tradingStore.ts`

集中管理所有交易相关状态，提供 20+ 个 action 方法。

**数据刷新策略**:
- `fetchAll()`: 首次加载时并行获取 7 项核心数据
- `startPolling()`: 3 秒轮询 orders/account/stats
- `connectTradingWs()`: WebSocket 实时接收交易事件，自动重连 (5s)
- 事件驱动刷新: 收到 order_filled → 自动 fetchOrders + fetchAccount

**WebSocket 事件类型**:
- `order_created` / `order_filled` / `order_failed`
- `stop_loss_triggered`

### 6.2 页面组件

| 组件 | 文件 | 功能 |
|------|------|------|
| TradingDashboardView | `views/TradingDashboardView.tsx` | 主面板: 订单表、持仓表、账户卡片、止损记录、实时事件 |
| AutoTradingPanel | `views/AutoTradingPanel.tsx` | Pipeline 开关、配置编辑、状态监控 |
| PerformanceView | `views/PerformanceView.tsx` | 绩效指标、权益曲线、策略归因 |

**布局**: 最大宽度 1600px，左右 3:2 网格比例 (`grid-cols-5`)。

---

## 7. 启动与依赖注入

**文件**: `src/index.ts` — `main()` 函数

启动顺序 (交易相关部分):

```
1.  initTradingTables(db)           — 建表/迁移
2.  OrderManager(db)                — 订单管理
3.  RiskController(db)              — 风控 + initDefaultRules()
4.  PaperTradingEngine(db)          — 本地模拟引擎
5.  LongportAdapter()               — 券商适配器
6.  TradingGateway(db, OM, RC, PE, LA) — 统一入口
7.  TradeNotifier(notificationService) — 通知
8.  SignalEvaluator(db)             — 信号评估
9.  StopLossManager(db, TG, TN)    — 止盈止损
10. StrategyEngine(db, sandbox)     — 策略引擎
11. StrategyAllocator(db)           — 资金分配
12. AutoTradingPipeline(db, TG, SE, SLM, TN, StratEng) — 编排层
13. stopLossManager.restoreFromDb() — 恢复活跃止损
14. pipeline.start() (if enabled)   — 启动信号轮询
15. server.setTradingServices(...)  — 注入 API 路由
16. tradeNotifier.setOnEvent(...)   — 接入 WS 推送
17. PositionSyncer.start()          — 60s 持仓同步
18. QuoteService.configure/start()  — 行情服务
19. stopLossManager.setPriceProvider/setOnNewSymbol — 接入行情
20. stopLossManager.startMonitoring(30000) — 启动止损检查
21. UniverseScreener + CronScheduler — 选股定时任务
22. DataManager + data-sync cron    — 数据同步
23. SignalTracker + signal-verify cron — 信号验证
```

**优雅关闭** (SIGTERM/SIGINT):
```
pipeline.stop() → stopLossManager.stopMonitoring() → quoteService.stop()
→ positionSyncer.stop() → cronScheduler.stop() → server.stop()
→ 10s 超时强制退出
```

---

## 8. 数据流全景

### 8.1 信号到订单 (自动交易)

```
Quant Analyst Agent
  │ stock_deliver_alert tool
  ▼
stock_signals 表
  │ AutoTradingPipeline.pollNewSignals() (5s)
  ▼
SignalEvaluator.evaluate()
  │ 通过
  ▼
QuantityCalculator.calculateOrderQuantity()
  │
  ▼
TradingGateway.placeOrder()
  ├─ RiskController.checkOrder()
  ├─ RiskController.checkSectorExposure()
  ├─ StrategyAllocator.checkAllocation()
  │
  ▼
LongportAdapter.submitOrder()  ←→  Longport OpenAPI
  │
  ▼
OrderManager.updateOrderStatus() → trading_orders 表
  │
  ├─ StopLossManager.register() → stop_loss_records 表
  ├─ TradeNotifier → NotificationService → Telegram/Discord
  └─ TradeNotifier.onEvent → WebSocket → 前端实时更新
```

### 8.2 止盈止损触发

```
QuoteService (30s 轮询 + WS 推送)
  │ getPriceNumber(symbol)
  ▼
StopLossManager.checkAll()
  ├─ 移动止损: 更新 highest_price / stop_loss
  ├─ 触发判断: price ≤ SL 或 price ≥ TP
  │
  ▼ 触发
TradingGateway.placeOrder(market sell)
  │
  ▼
更新 stop_loss_records.status → triggered_sl/triggered_tp
  │
  ├─ trading_audit_log 记录
  └─ TradeNotifier.notifyStopLossTriggered()
```

### 8.3 每日数据流

```
22:00 UTC  universe-screen-daily
  │ Python: universe_screener.py → yfinance
  ▼
dynamic_watchlist 表 + symbol_sectors 表
  │ onSectorData → RiskController.setSectorMappings()
  │ QuoteService.subscribe(newSymbols)
  ▼
22:30 UTC  data-sync-daily
  │ Python: stock_analysis.py --history → yfinance
  ▼
ohlcv_daily 表 (OHLCV 日线缓存)
```

---

## 9. 已知限制与优化方向

### 9.1 当前限制

| 项目 | 现状 | 影响 |
|------|------|------|
| 行情延迟 | 免费 Longport 账户 US 行情延迟 ~15 分钟 | 止损触发有延迟，适合日线级策略 |
| 市场覆盖 | 仅 US 股票 (.US 后缀) | 代码支持 HK/A 股但未启用 |
| 回测引擎 | 仅存储结果表，无完整回测执行器 | 需补充 BacktestEngine |
| 动态风控 | VIX 数据需手动输入 | 可接入 VIX 实时数据源 |
| 策略 PnL | StrategyAllocator.recordPnl() 未自动调用 | 需在平仓时自动触发 |
| 日内损益 | max_daily_loss 用未实现亏损近似 | 缺少日初快照 |

### 9.2 推荐优化方向

**P0 — 稳定性**:
1. 补充 BacktestEngine，支持策略回测执行
2. 接入 VIX 实时数据 (如 CBOE 或 yfinance ^VIX)，自动触发 `updateDynamicRisk()`
3. 在 StopLossManager 触发平仓后自动调用 `StrategyAllocator.recordPnl()`
4. 添加日初账户快照表，精确计算 daily P&L

**P1 — 功能增强**:
5. 多市场支持: 配置化 symbol 后缀规则，支持 HK (.HK) 和 A 股 (.SH/.SZ)
6. 条件单: 支持 stop / stop_limit 订单在 PaperTradingEngine 中的模拟
7. 分批建仓/减仓: 支持 TWAP/VWAP 算法拆单
8. 信号聚合: 多个 Agent 信号加权投票

**P2 — 可观测性**:
9. Grafana/Prometheus 指标导出 (订单延迟、风控拒绝率、行情延迟)
10. 交易日报自动生成并推送
11. 前端权益曲线图表 (ECharts/Recharts)
12. 回测结果可视化对比

---

## 10. 文件索引

### 后端核心模块

| 文件 | 模块 |
|------|------|
| `src/services/trading/AutoTradingPipeline.ts` | 自动交易编排 |
| `src/services/trading/TradingGateway.ts` | 统一交易入口 |
| `src/services/trading/OrderManager.ts` | 订单生命周期 |
| `src/services/trading/RiskController.ts` | 风控引擎 |
| `src/services/trading/StopLossManager.ts` | 止盈止损 |
| `src/services/trading/LongportAdapter.ts` | 长桥券商适配 |
| `src/services/trading/PaperTradingEngine.ts` | 本地模拟引擎 |
| `src/services/trading/QuoteService.ts` | 实时行情 |
| `src/services/trading/SignalEvaluator.ts` | 信号过滤 |
| `src/services/trading/QuantityCalculator.ts` | 下单量计算 |
| `src/services/trading/TradeNotifier.ts` | 交易通知 |
| `src/services/trading/PerformanceAnalytics.ts` | 绩效分析 |
| `src/services/trading/StrategyAllocator.ts` | 多策略资金 |
| `src/services/trading/DataManager.ts` | OHLCV 缓存 |
| `src/services/trading/PositionSyncer.ts` | 持仓同步 |
| `src/services/trading/tradingSchema.ts` | 数据库 Schema |
| `src/services/trading/types.ts` | 类型定义 |

### 服务层

| 文件 | 模块 |
|------|------|
| `src/services/UniverseScreener.ts` | 自动选股 |
| `src/services/SignalTracker.ts` | 信号验证 |
| `src/services/StrategyEngine.ts` | 策略引擎 + 参数优化 |
| `src/services/StockScanner.ts` | AI 股票扫描 |

### API 与前端

| 文件 | 模块 |
|------|------|
| `src/api/tradingRoutes.ts` | 交易 REST API |
| `src/api/server.ts` | WebSocket 推送 |
| `frontend/src/stores/tradingStore.ts` | 前端状态管理 |
| `frontend/src/components/views/TradingDashboardView.tsx` | 交易面板 |
| `frontend/src/components/views/AutoTradingPanel.tsx` | Pipeline 控制 |
| `frontend/src/components/views/PerformanceView.tsx` | 绩效页面 |

### Python 脚本

| 文件 | 用途 |
|------|------|
| `scripts/universe_screener.py` | 股票池筛选 (yfinance) |
| `scripts/stock_analysis.py` | 技术分析 + OHLCV 获取 |
