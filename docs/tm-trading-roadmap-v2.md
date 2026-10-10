# TM Trading — Architecture & Roadmap V2

> Version: 2026-10-05
>
> Mục tiêu chính mới: **Realtime Trading Simulator / Terminal**.
> Hệ thống mô phỏng giao dịch bằng **thời gian thực + dữ liệu thị trường thực**, không dùng tiền thật.
> Backtest, live paper, replay và sau này demo broker dùng chung core để tránh lệch hành vi.

## 0. Quyết định định hướng

TM Trading **không trở thành một app chỉ báo**. Sản phẩm chính là một **Trading Terminal + Simulation Platform**.

Chuỗi trải nghiệm chuẩn:

```text
Realtime Market Data
        ↓
Market Normalizer / Aggregator
        ↓
Candle + Quote + Orderbook Store
        ↓
Indicator Engine
        ↓
Methods / Signal Engine
        ↓
Trade Plan
        ↓
Risk Gate
        ↓
Paper / Replay Simulator
        ↓
Position / PnL
        ↓
Journal / Analytics
        ↓
AI Copilot
```

Một engine phải có thể chạy ở 4 mode:

```text
LIVE_ANALYSIS   = dữ liệu thật, không đặt lệnh
LIVE_PAPER      = dữ liệu thật + mô phỏng lệnh realtime
REPLAY          = dữ liệu lịch sử + clock mô phỏng
BACKTEST        = dữ liệu lịch sử + chạy batch
```

Real-money execution vẫn là giai đoạn sau cùng; mọi lệnh executable phải qua Risk Gate.

---

# 1. Những gì giữ nguyên từ roadmap hiện tại

Các phần đã hoàn thành được giữ nguyên, không rewrite:

- Engine VSA/Pine parity và golden tests.
- Version stamp `engineVersion / paramsHash / dataHash / universeSnapshot / gitRev`.
- UTC ms và các quy tắc thời gian.
- Idempotency / durable dedupe.
- Backtester + fee + slippage + sub-bar 1m.
- Risk Manager + sizing + daily loss cap + kill-switch.
- Paper executor.
- Drift detection và tự halt mở lệnh.
- Scanner / news / funding / OI / liquidation / regime.
- Method registry + VSA / price action / trend / orderflow.
- AI gateway + agent + daily brief + guardrails.
- MT5 bridge contract và demo-first policy.
- Dashboard `/`, `/runs`, `/runs/compare`, `/signals`, Risk Gate card.
- Journal và preset-drift foundation.

Theo roadmap hiện tại, Phase 6 và Phase 7 đã hoàn thành; paper executor đã có e2e open/close, còn dashboard hiện tập trung vào backtest, live signals, risk/drift và báo cáo.  

---

# 2. Vấn đề cần giải quyết ở V2

## 2.1 Thiếu Realtime Trading Workspace

Dashboard hiện xem được kết quả và signal nhưng chưa phải một terminal để:

```text
watch symbol → xem chart realtime → bật indicator → xem signal → tạo paper order → theo dõi position
```

## 2.2 Indicator phải là một nguồn sự thật

Không viết một bản indicator ở frontend và một bản khác ở engine.

```text
                    Indicator Core
                         ↓
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
       Backtest      Live Chart      Replay
```

Mọi indicator dùng chung implementation và version.

## 2.3 Live paper và backtest phải dùng cùng execution semantics

Không có:

```text
backtest fill logic ≠ paper fill logic
```

Phải có `fill-model` chung, chỉ khác source clock/data.

## 2.4 Phải phân biệt candle đang chạy và candle đã đóng

Mọi market bar phải có:

```text
barState: forming | closed
```

Signal policy phải explicit:

```text
CLOSE_ONLY
INTRABAR
CLOSE_AND_INTRABAR
```

Mặc định strategy parity dùng `CLOSE_ONLY` nếu spec chưa nói rõ.

---

# 3. Kiến trúc V2

```text
                           TM HUB
                    IAM / Config / Auth
                              │
                              ▼
                      ┌──────────────┐
                      │ TM TRADING   │
                      │ Control/App  │
                      └──────┬───────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   MARKET PLANE        ANALYTICS PLANE      EXECUTION PLANE
        │                    │                    │
 Binance/Bybit/OKX     Indicators           Risk Gate
 Gold/other sources    Methods              Fill Model
        │               Signals              Paper
        ▼                    │                Replay
 Normalizer                  │                MT5 Demo (later)
        │                    │                    │
        ▼                    ▼                    ▼
  Event Bus / Cache ─────────┴──────────────┐
                                            ▼
                                    Position State
                                            │
                                            ▼
                                        Journal
                                            │
                                  ┌─────────┴─────────┐
                                  ▼                   ▼
                               Metrics              AI
```

---

# 4. Nguyên tắc kiến trúc quan trọng

## D15 — Market Core tách khỏi transport

`engine/` không biết WebSocket, Redis hay Nuxt.

```text
market/          transport + provider + aggregation
engine/          deterministic calculations
simulation/      deterministic order/fill/position state
server/          HTTP/WebSocket API
app/             UI
```

## D16 — Event time là thời gian giao dịch

Mọi event có:

```ts
{
  eventTime: number,
  ingestTime: number,
  source: string
}
```

`eventTime` dùng để tính chiến lược; `ingestTime` chỉ dùng đo latency/observability.

## D17 — Không dùng dữ liệu tương lai

Trong LIVE/REPLAY/BACKTEST:

- Chỉ dùng data có `eventTime <= currentClock`.
- Không cho engine đọc candle chưa tồn tại trong clock hiện tại.
- Replay phải ẩn toàn bộ future bars.

## D18 — Một Clock abstraction

```ts
interface TradingClock {
  now(): number
  mode(): 'live' | 'replay' | 'backtest'
}
```

Live dùng system/event time; replay dùng simulated time; backtest dùng bar time.

## D19 — Market Snapshot immutable

Mỗi quyết định trading nên tham chiếu snapshot:

```text
symbol
TF
last price
bid/ask
bar state
indicators
funding
OI
volume
regime
timestamp
```

Signal/journal lưu `snapshotId` hoặc hash để tái dựng nguyên trạng.

## D20 — Paper order không giả lập kiểu “close price = fill”

Fill model phải xem xét:

```text
bid / ask
spread
order type
latency
slippage
bar high/low
sub-bar 1m khi cần
```

Khi thiếu quote thực, phải dùng model fallback có nhãn rõ ràng.

## D21 — UI không tự quyết định trạng thái position

Frontend chỉ gửi intent:

```text
OPEN_LONG
OPEN_SHORT
CANCEL
MOVE_SL
MOVE_TP
CLOSE
```

Server/Risk/Simulator là nguồn sự thật.

## D22 — Không lưu tick vô hạn vào MongoDB

```text
raw tick/trade
    ↓
Memory/Redis
    ↓
aggregation
    ↓
1m candle
    ↓
MongoDB
```

Raw tick chỉ lưu khi thật sự cần replay/forensics và có retention riêng.

---

# 5. Cấu trúc project V2

```text
tm-trading/
├── app/
│   ├── pages/
│   │   ├── index.vue
│   │   ├── trade.vue                 # Trading Terminal
│   │   ├── replay.vue                # Historical Replay
│   │   ├── signals.vue
│   │   ├── runs/
│   │   ├── positions.vue
│   │   └── journal.vue
│   ├── components/
│   │   └── trading/
│   │       ├── TradingChart.vue
│   │       ├── Watchlist.vue
│   │       ├── OrderBook.vue
│   │       ├── TradeTape.vue
│   │       ├── IndicatorPanel.vue
│   │       ├── SignalOverlay.vue
│   │       ├── TradeTicket.vue
│   │       ├── PositionPanel.vue
│   │       ├── RiskPanel.vue
│   │       └── ReplayControls.vue
│   ├── composables/
│   │   ├── useMarketStream.ts
│   │   ├── useTradingChart.ts
│   │   ├── useIndicators.ts
│   │   ├── usePaperTrading.ts
│   │   └── useReplay.ts
│   └── stores/
│       ├── market.ts
│       ├── chart.ts
│       ├── trading.ts
│       └── workspace.ts
│
├── market/
│   ├── adapters/
│   │   ├── binance/
│   │   ├── bybit/
│   │   ├── okx/
│   │   ├── coinbase/
│   │   └── gold/
│   ├── normalizer.mjs
│   ├── connection-manager.mjs
│   ├── subscriptions.mjs
│   ├── aggregator.mjs
│   ├── candle-builder.mjs
│   ├── quote-store.mjs
│   ├── orderbook-store.mjs
│   ├── event-bus.mjs
│   └── market-clock.mjs
│
├── engine/
│   ├── ta.mjs
│   ├── indicators/
│   ├── methods/
│   ├── signals.mjs
│   ├── version.mjs
│   ├── data.mjs
│   ├── backtest.mjs
│   ├── report.mjs
│   └── store.mjs
│
├── simulation/
│   ├── clock.mjs
│   ├── order.mjs
│   ├── fill-model.mjs
│   ├── position.mjs
│   ├── account.mjs
│   ├── pnl.mjs
│   ├── simulator.mjs
│   └── replay.mjs
│
├── exec/
│   ├── risk.mjs
│   ├── paper.mjs
│   └── mt5/
│
├── services/
│   ├── scanner.mjs
│   ├── news.mjs
│   ├── funding.mjs
│   ├── regime.mjs
│   ├── liquidation.mjs
│   └── heartbeat.mjs
│
├── server/
│   ├── api/v1/
│   ├── websocket/
│   ├── webhook.mjs
│   └── middleware/
│
├── ai/
├── docs/
│   ├── data-model.md
│   ├── time-rules.md
│   ├── market-data-contract.md
│   ├── indicator-contract.md
│   ├── simulation-contract.md
│   └── alert-schema.md
│
└── data/
```

---

# 6. Data flow realtime

```text
Exchange WS / Gold provider
          ↓
Connection Manager
          ↓
Raw Event
          ↓
Normalizer
          ↓
Canonical Market Event
          ↓
Event Bus
      ┌───┼────────┬──────────┐
      ↓   ↓        ↓          ↓
   Candle Quote  OrderBook  Trade Tape
      │   │        │          │
      └───┴────────┴──────────┘
                  ↓
            Market Snapshot
                  ↓
       Indicator / Method Engine
                  ↓
               Signal
                  ↓
              Risk Gate
                  ↓
          Simulation/FIll Model
                  ↓
            Position State
                  ↓
         WebSocket → Terminal UI
```

---

# 7. Canonical market events

## `market.trade`

```ts
interface TradeEvent {
  source: string
  symbol: string
  market: 'spot' | 'futures' | 'gold'
  price: number
  quantity?: number
  side?: 'buy' | 'sell'
  eventTime: number
  ingestTime: number
}
```

## `market.quote`

```ts
interface QuoteEvent {
  source: string
  symbol: string
  bid?: number
  ask?: number
  last?: number
  eventTime: number
  ingestTime: number
}
```

## `market.candle`

```ts
interface CandleEvent {
  symbol: string
  timeframe: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  openTime: number
  closeTime: number
  state: 'forming' | 'closed'
  source: string
}
```

Mọi consumer phải đọc canonical event, không đọc raw exchange payload.

---

# 8. Indicator contract

```ts
interface IndicatorDefinition {
  id: string
  version: string
  paramsSchema: unknown
  warmup: number
  calculate(input: IndicatorInput): IndicatorOutput
}
```

Tối thiểu Phase Indicator Core:

```text
SMA
EMA
RMA
ATR
RSI
VWAP
MACD
Bollinger Bands
Volume MA
OBV
CMF
Donchian
```

Sau đó dùng cùng infrastructure để expose các feature hệ thống:

```text
VSA
BOS / CHoCH
FVG
Liquidity Sweep
Order Block
Delta
Funding
OI
Liquidation Zones
Regime
Confluence
```

---

# 9. Chart contract

Chart không chỉ vẽ OHLCV.

Layer:

```text
Candles
├── Price overlays
│   ├── EMA/SMA
│   ├── VWAP
│   ├── Zones
│   ├── FVG
│   ├── Order Block
│   ├── Liquidity
│   └── Entry/SL/TP
│
├── Signal markers
│   ├── LONG
│   ├── SHORT
│   ├── TP
│   └── SL
│
└── Lower panels
    ├── Volume
    ├── Delta
    ├── RSI
    ├── MACD
    ├── OI
    └── Funding
```

Mỗi overlay có:

```text
source
version
paramsHash
calculatedAt/eventTime
```

---

# 10. Trading Terminal `/trade`

## Layout chuẩn

```text
┌───────────────────────────────────────────────────────────────┐
│ Symbol / Exchange / Market / TF / Realtime status            │
├─────────────┬───────────────────────────────┬─────────────────┤
│ Watchlist   │          Trading Chart        │ Order Book      │
│             │                               │                 │
│ BTCUSDT.P   │ candles + indicators          │ asks            │
│ ETHUSDT.P   │ signal + entry/SL/TP           │ spread          │
│ SOLUSDT.P   │ zones / volume                 │ bids            │
│ XAUUSD      │                               │                 │
├─────────────┴───────────────────────────────┴─────────────────┤
│ Volume / Delta / OI / Funding / RSI                          │
├───────────────────────────────────────────────────────────────┤
│ Trade Ticket │ Positions │ Orders │ Signals │ Alerts          │
└───────────────────────────────────────────────────────────────┘
```

Phải có:

- realtime connection badge
- data latency
- last event time
- candle state
- server clock
- paper account status

---

# 11. Paper Trading Simulator

## Order lifecycle

```text
CREATED
  ↓
RISK_CHECKED
  ↓
PENDING
  ↓
PARTIALLY_FILLED
  ↓
FILLED
  ↓
OPEN_POSITION
  ↓
CLOSED
```

Terminal states:

```text
REJECTED
CANCELLED
EXPIRED
```

## Fill model

### Market order

```text
side = LONG  → ask + slippage
side = SHORT → bid - slippage
```

### Limit order

Chỉ fill khi market chạm level theo data đã tồn tại tại thời điểm đó.

### Stop order

Trigger rồi chuyển sang market/defined fill policy.

### Position

Theo dõi:

```text
entry
size
avgEntry
sl
multiple TP
leverage
margin
unrealizedPnL
realizedPnL
fees
slippage
MAE
MFE
```

---

# 12. Live Paper mode

Đây là mode chính của sản phẩm hiện tại.

```text
REAL MARKET
    ↓
REAL CLOCK
    ↓
REALTIME CHART
    ↓
USER / METHOD / AI PROPOSAL
    ↓
RISK GATE
    ↓
PAPER FILL
    ↓
REALTIME POSITION/PnL
```

Không forward order sang exchange.

User phải cảm nhận gần như trade thật:

```text
real price
real spread
real market movement
real latency measurement
real position evolution
real notification
```

nhưng:

```text
virtual balance
virtual position
virtual order
```

---

# 13. Replay mode

Replay dùng cùng `simulation/`.

```text
Historical data
      ↓
Simulated Clock
      ↓
Market Events
      ↓
Same Indicator Engine
      ↓
Same Signal Engine
      ↓
Same Fill Model
      ↓
Same Paper Account
```

Controls:

```text
Play
Pause
Step 1 event
Step 1 candle
0.5x
1x
2x
5x
10x
```

Future data tuyệt đối không được lộ.

---

# 14. Market data sources

## Crypto

Ưu tiên abstraction để hỗ trợ:

```text
Binance
Bybit
OKX
Coinbase
```

Phân biệt rõ:

```text
spot
perpetual
futures
```

## Futures metrics

```text
markPrice
indexPrice
fundingRate
openInterest
liquidation
orderbook
trade flow
```

## Gold

Gold phải là provider riêng, không ép vào Binance model:

```text
XAU/USD provider
MT5 broker feed
Trading Economics / other licensed/reference provider
```

Nguồn nào là execution price thì phải được đánh dấu `executionSource=true`.

---

# 15. Data hierarchy

Mỗi instrument có:

```text
Instrument
  ├── canonicalId
  ├── assetClass
  ├── marketType
  ├── quoteCurrency
  └── sourceMappings[]
```

Ví dụ:

```text
crypto:BTC/USDT
 ├── Binance BTCUSDT
 ├── Bybit BTCUSDT
 └── OKX BTC-USDT
```

Không dùng exchange symbol làm primary key của engine.

---

# 16. MongoDB model bổ sung

Giữ collections hiện có và bổ sung:

```text
instruments
market_sources
workspaces
chart_layouts
indicator_configs
paper_accounts
paper_orders
paper_fills
positions
market_snapshots
replay_sessions
simulation_runs
notification_logs
```

## `paper_accounts`

```text
accountId
mode: live-paper | replay
currency
initialBalance
equity
availableBalance
marginUsed
createdAt
updatedAt
```

## `paper_orders`

```text
orderId
accountId
symbol
side
type
qty
limitPrice
stopPrice
sl
tps
status
createdAt
filledAt
clientOrderId
simulationVersion
```

## `paper_fills`

```text
orderId
fillPrice
fillQty
fee
slippage
spread
latencyMs
eventTime
```

## `market_snapshots`

Chỉ lưu snapshot tại signal/order/journal event hoặc theo sampling policy; không lưu mọi tick mặc định.

---

# 17. API V2

## Historical

```text
GET /api/v1/markets/:instrument/candles
GET /api/v1/markets/:instrument/trades
GET /api/v1/markets/:instrument/orderbook
```

## Realtime

```text
/ws/market
/ws/trading
/ws/alerts
/ws/notifications
```

## Indicators

```text
GET  /api/v1/indicators
POST /api/v1/indicators/calculate
```

## Paper

```text
GET  /api/v1/paper/accounts
GET  /api/v1/paper/accounts/:id
POST /api/v1/paper/orders
DELETE /api/v1/paper/orders/:id
POST /api/v1/paper/positions/:id/close
PATCH /api/v1/paper/positions/:id/risk
```

## Replay

```text
POST /api/v1/replay/sessions
GET  /api/v1/replay/sessions/:id
POST /api/v1/replay/sessions/:id/play
POST /api/v1/replay/sessions/:id/pause
POST /api/v1/replay/sessions/:id/step
```

---

# 18. WebSocket contract

Client subscribe:

```json
{
  "type": "subscribe",
  "channels": [
    "candle:binance:futures:BTCUSDT:15m",
    "quote:binance:futures:BTCUSDT",
    "orderbook:binance:futures:BTCUSDT"
  ]
}
```

Server event:

```json
{
  "type": "market.candle",
  "sequence": 123456,
  "eventTime": 1780000000000,
  "payload": {}
}
```

Client phải xử lý:

```text
sequence gap
reconnect
resubscribe
stale stream
server reset
```

---

# 19. Indicator lifecycle realtime

Mỗi tick/candle update:

```text
RAW EVENT
  ↓
Update current bar
  ↓
Update rolling buffers
  ↓
Update indicators
  ↓
Evaluate methods
  ↓
Evaluate signal policy
```

Không tính lại toàn bộ lịch sử mỗi tick.

Cần incremental state cho indicator khi có lợi ích rõ ràng:

```text
EMA
RMA
ATR
RSI
VWAP
OBV
CMF
```

Các thuật toán phức tạp hơn có thể recompute trên bounded window trước, rồi tối ưu sau.

---

# 20. Realtime signal semantics

Signal phải chứa:

```text
signalId
symbol
tf
side
eventTime
barState
triggerPolicy
method
entry
sl
tp
confidence
snapshotHash
engineVersion
paramsHash
```

Không cho một `forming` candle signal bị xem là tương đương một `closed` candle signal.

---

# 21. Paper-first acceptance criteria

Một strategy chỉ được đưa vào “live paper” khi:

```text
1. Golden parity pass
2. Backtest reproducible
3. Risk tests pass
4. Live market feed stable
5. No unresolved drift
6. Paper fill model tested
```

Sau đó chạy paper tối thiểu theo tiêu chí của project, thay vì chỉ dựa vào số ngày cố định.

Nên đánh giá:

```text
sample size
expectancy
PF
max DD
execution drift
signal drift
slippage
fees
```

---

# 22. Trading Journal V2

Mỗi trade lưu thêm:

```text
source
mode
symbol
tf
method
regime
signalId
snapshotHash
entryDecisionAt
entryFillAt
entryLatencyMs
spreadAtEntry
slippageAtEntry
entry
sl
tp
MFE
MAE
exitReason
resultR
PnL
```

Mục tiêu là trả lời:

```text
Tôi thua vì signal sai?
Hay vào chậm?
Hay spread/slippage?
Hay trade sai regime?
Hay risk/size?
```

---

# 23. Notification architecture

```text
Signal / Order / Position / Risk event
              ↓
       Notification Router
              ↓
    ┌─────────┼─────────┐
    ↓         ↓         ↓
 Web Push   Telegram  Electron
```

Alert levels:

```text
info
normal
important
critical
```

Critical:

```text
risk halted
connection dead
signal drift
paper account abnormal
service overdue
```

---

# 24. Observability

Terminal phải có:

```text
Market connection
Last event
Latency
Sequence
Candle freshness
Indicator freshness
Simulation clock
Paper executor
Risk Gate
Notification service
```

Ví dụ:

```text
BINANCE WS     ● CONNECTED   48ms
BTCUSDT 15m    ● LIVE        bar 12s ago
INDICATORS     ● READY
PAPER ENGINE   ● RUNNING
RISK GATE      ● ACTIVE
```

---

# 25. Roadmap V2

## Phase 5 — Validation / Optimizer (tiếp tục)

Mục tiêu: không tối ưu mù.

- baseline ngẫu nhiên
- hold-out theo symbol
- min trade count
- walk-forward
- cache theo `paramsHash`
- preset theo symbol × TF
- sau đó regime-aware preset

**Không để optimizer chặn realtime terminal.** Có thể chạy song song.

Acceptance:

```text
method > baseline trên hold-out
```

hoặc dừng tối ưu method đó.

---

## Phase 7R — Realtime Market Plane 🔒

Xây nền realtime trước UI phức tạp.

- Binance futures/spot WS
- provider adapter contract
- connection manager
- normalized events
- candle builder
- quote store
- orderbook store
- Redis/event bus nếu cần
- latency/sequence monitoring
- realtime 1m → 4m/10m aggregation

Acceptance:

```text
BTCUSDT realtime ổn định
reconnect/resubscribe
candle forming/closed đúng
4m/10m boundary đúng
không duplicate event
```

---

## Phase 7I — Indicator Engine + Chart 🔒

- Indicator registry
- versioned params
- incremental/basic calculation
- chart adapter
- multi-timeframe
- overlays
- lower panels
- signal/entry/SL/TP overlay
- zoom/pan/crosshair
- workspace persistence

Acceptance:

```text
Chart realtime ≈ source market
Indicator live = indicator engine
Indicator engine = backtest implementation
```

---

## Phase 7T — Trading Terminal

Route:

```text
/trade
```

Xây:

- watchlist
- chart
- orderbook
- trade tape
- indicator controls
- method controls
- signal panel
- risk panel
- position panel
- trade ticket
- connection status

Acceptance:

```text
mở symbol
chuyển TF
bật/tắt indicator
xem signal
xem orderbook
không reload trang khi market update
```

---

## Phase 7P — Live Paper Trading 🔒

Dùng `exec/risk.mjs` hiện tại, nhưng refactor paper execution sang `simulation/` core.

- market/limit/stop
- spread
- slippage
- latency
- partial fills
- fees
- multiple TP
- modify SL/TP
- close/partial close
- account/equity
- position state realtime

Acceptance:

```text
REAL MARKET → PAPER ORDER → POSITION → PnL
```

mọi action đi qua risk gate.

---

## Phase 7R2 — Replay / Training

- simulated clock
- historical stream
- hide future data
- play/pause/step
- speed control
- same indicators
- same methods
- same fill model
- same journal

Acceptance:

```text
Replay result sử dụng cùng simulation semantics với Live Paper.
```

---

## Phase 8/9 — Intel trên Terminal

Đưa những module đã có lên chart/terminal:

```text
news
funding
OI
liquidation
regime
altseason
volume flow
accumulation
```

Không tạo một dashboard phụ nếu thông tin có thể biểu diễn ngay trên terminal.

Ví dụ:

```text
Funding badge
OI trend
Liquidation zones
Regime badge
News marker
```

---

## Phase 10 — Methods + Confluence UI

Các method hiện có trở thành visual modules:

```text
VSA
Price Action
Trend
Orderflow
SMC
```

Mỗi method có:

```text
event
score
reason
visual marker
```

Confluence panel:

```text
VSA          +0.62
PA           +0.71
Trend        +0.83
Orderflow    +0.12
Regime       +0.60
Funding      -0.10
Liquidation  +0.35
-------------------
TOTAL        +0.51
```

Không biến score thành lệnh tự động.

---

## Phase 11 — AI Copilot trong Terminal

AI chỉ đọc:

```text
current snapshot
chart context
methods
signals
regime
risk
journal
backtest
```

AI output:

```text
analysis
trade plan
risk notes
counter arguments
journal review
```

Mọi executable action vẫn:

```text
AI proposal
   ↓
Risk Gate
   ↓
Human confirmation (mặc định)
```

---

## Phase 12 — Broker / Exchange Demo

### XAU

```text
TM Trading
   ↓
Risk Gate
   ↓
MT5 Demo
```

### Crypto

Chỉ sau khi paper stable:

```text
Exchange Demo/Testnet
```

Mọi execution phải có reconciliation:

```text
local order
↔ external order
↔ external position
```

---

## Phase 13 — Journal Feedback Loop

- trading mistakes
- entry late
- bad regime
- RR issue
- slippage issue
- preset drift
- method drift
- performance by session/TF/symbol
- AI review

Output:

```text
What works?
What fails?
When does it fail?
Why?
```

Không tự sửa strategy parameters bằng AI.

---

# 26. Thứ tự ưu tiên thực tế

```text
A. Finish/verify Phase 5 baseline
        │
        ├───────────────┐
        ▼               ▼
B. Realtime Plane   C. Optimizer
        │
        ▼
D. Indicator Engine
        │
        ▼
E. Trading Terminal
        │
        ▼
F. Live Paper
        │
        ▼
G. Replay
        │
        ▼
H. Intel overlays
        │
        ▼
I. Methods + Confluence UI
        │
        ▼
J. AI Copilot UI
        │
        ▼
K. Broker/Exchange Demo
        │
        ▼
L. Feedback Loop
```

**Optimizer có thể chạy song song B→G.** Không cần chờ optimizer hoàn hảo mới làm terminal.

---

# 27. Definition of Done cho “Realtime Trading Simulator”

Hệ thống chỉ được coi là đạt milestone khi toàn bộ chuỗi sau hoạt động:

```text
1. Mở BTCUSDT.P
2. Nhận giá realtime
3. Candles realtime cập nhật
4. Chuyển 5m/15m/1h
5. Indicator cập nhật
6. Method tạo event
7. Signal tạo trade plan
8. Risk Gate kiểm tra
9. User bấm Paper Long/Short
10. Simulator mô phỏng fill
11. Position xuất hiện realtime
12. PnL thay đổi theo market
13. SL/TP xử lý đúng
14. Close position
15. Journal ghi đầy đủ
16. Telegram/Web Push nhận alert
17. Reload app vẫn khôi phục đúng state
18. Restart services không sinh duplicate order/signal
```

Đây mới là milestone trung tâm của TM Trading V2.

---

# 28. Nguyên tắc cuối cùng

```text
ONE MARKET CORE
ONE INDICATOR CORE
ONE SIGNAL CONTRACT
ONE RISK GATE
ONE SIMULATION/FILL MODEL
ONE POSITION/JOURNAL MODEL

                 ↓

BACKTEST
LIVE ANALYSIS
LIVE PAPER
REPLAY
DEMO EXECUTION
```

Không tạo các implementation song song cho cùng một logic trading.

Mục tiêu của V2 không phải là có thật nhiều indicator, mà là tạo một hệ thống trong đó:

> **Dữ liệu thật → phân tích thật → quyết định thật → mô phỏng khớp lệnh thật → theo dõi PnL thật → review thật**, nhưng chưa dùng tiền thật.
