# TM Trading — Architecture & Roadmap V3.3

> Version: **2026-10-11**
>
> V3.3 clarification: adopts a clean, workflow-oriented information architecture based on §57.3. The existing menu layout is treated as a migration input, not a design constraint. Existing TM Hub/core capabilities must be preserved, but their visual grouping and sidebar placement may be reorganized. Section 58 is authoritative for navigation and core integration.
>
> Product direction: **Realtime Trading Terminal + Market Replay + Paper Trading Simulator + Trading Research/AI Platform**.
>
> Core principle:
>
> ```text
> REAL MARKET DATA
>       ↓
> MARKET CORE
>       ↓
> NATIVE INDICATOR ENGINE
>       ↓
> METHOD / SIGNAL ENGINE
>       ↓
> RISK GATE
>       ↓
> PAPER / REPLAY SIMULATOR
>       ↓
> POSITION / PNL
>       ↓
> JOURNAL / DATASET
>       ↓
> AI RESEARCH
>       ↓
> EXPERIMENT / BACKTEST / HOLDOUT
>       ↓
> NEW STRATEGY VERSION
>       ↓
> LIVE PAPER VALIDATION
> ```
>
> **V3 is simulation-first.** Real-money execution is not a core milestone and stays disabled by default. Broker/exchange demo/testnet integration is a later compatibility milestone only.
>
> **Most important architectural decision:** Backtest, live analysis, live paper and replay must use the same market-event contract, indicator implementation, signal contract, risk rules and fill model wherever semantics are applicable. Avoid separate implementations that can drift.

---

# 0. Executive Summary

TM Trading started as an engine/backtest/risk/dashboard project. V3 evolves it into a **market-realistic trading simulator**.

The product is not intended to become a clone of TradingView. The product is a controlled environment where the user can:

```text
1. Select any supported instrument / venue.
2. Receive market data in realtime.
3. View a continuously updating chart.
4. Enable TM-native indicators.
5. Run TM methods/signals on the same data.
6. Build a trade plan.
7. Execute a paper order through Risk Gate.
8. Watch fills, position, PnL and risk change in realtime.
9. Record the full market/trade context.
10. Replay historical sessions without future leakage.
11. Let AI study accumulated trade data.
12. Create experiments instead of silently changing the live strategy.
13. Backtest and hold out experiments.
14. Create a new immutable strategy version.
15. Validate the new version in live paper mode.
```

The core loop becomes:

```text
OBSERVE → DECIDE → SIMULATE → MEASURE → REVIEW → EXPERIMENT → VALIDATE
```

## 0.1 What V3 changes from V2

V2 already established:

- deterministic engine
- backtester
- version/hash discipline
- Risk Manager
- Paper executor
- drift detection
- scanner/intelligence
- methods
- AI gateway/agent
- dashboard
- journal foundation

V3 adds the missing product layer:

- multi-source realtime market plane
- instrument catalog and symbol mapping
- realtime candle/quote/order-book/trade state
- native indicator platform
- realtime chart workspace
- trading terminal
- realistic paper fill simulator
- replay/training clock
- market recorder and dataset lineage
- AI research workspace
- experiment/version lifecycle
- stronger data quality/latency observability

## 0.2 Product non-goals

Do not allow scope to drift into:

- a generic charting clone with hundreds of cosmetic indicators
- an AI that silently changes parameters and deploys them
- a real-money auto-trading system before the simulator is trustworthy
- a database that stores every raw tick forever without a retention plan
- a frontend that becomes the source of trading truth
- a separate indicator implementation for every screen

---

# 1. Carry-Forward Baseline From Previous Roadmaps

The previous roadmap decisions remain valid unless explicitly superseded below.

## 1.1 Existing completed foundations to preserve

Do not rewrite the following merely to support V3:

- `engine/ta.mjs` and deterministic TA primitives
- Pine/reference parity fixtures
- `engine/methods/` registry
- VSA / price-action / trend / orderflow method plugins
- `engine/backtest.mjs`
- `engine/report.mjs`
- `engine/version.mjs`
- `paramsHash` / `dataHash` / `universeSnapshot` / `gitRev`
- Mongo persistence and NDJSON fallback
- durable alert dedupe
- `clientOrderId` / idempotency
- `exec/risk.mjs`
- `exec/paper.mjs`
- drift detection / halt behavior
- service heartbeat
- scanner/news/funding/OI/liquidation/regime modules
- AI gateway / AI agent / daily brief / guardrails
- journal / preset-drift foundation
- existing Nuxt + Nuxt UI dashboard
- TM Hub authentication/config inheritance
- MT5 IPC contract as a later demo integration

## 1.2 Existing safety invariants remain mandatory

No signal source can bypass Risk Gate.

No UI action can mutate position state directly.

No AI output is a source of truth for executable state.

No report can combine incompatible engine/data generations.

No replay can read future data.

No paper result can silently use a different fill semantic from backtest unless the difference is explicitly versioned and labeled.

---

# 2. New Core Product Definition

## 2.1 Four execution modes

Every strategy should be executable in these modes:

```ts
type RunMode =
  | 'BACKTEST'
  | 'REPLAY'
  | 'LIVE_ANALYSIS'
  | 'LIVE_PAPER'
```

Later, demo connectors may add:

```ts
'DEMO_BROKER'
'DEMO_EXCHANGE'
```

Real-money execution must not be enabled by the V3 default configuration.

## 2.2 Single semantic core

```text
                 SAME DATA CONTRACT
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
      BACKTEST         REPLAY       LIVE PAPER
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                SAME INDICATORS
                         ▼
                  SAME METHODS
                         ▼
                  SAME SIGNALS
                         ▼
                     SAME RISK
                         ▼
                 SAME FILL MODEL
```

Differences are caused only by:

- data availability
- clock
- latency
- live market state
- execution source

not by duplicated business logic.

---

# 3. Architecture Overview V3

```text
                                        TM HUB
                               IAM / Config / Auth
                                          │
                                          ▼
                                  ┌──────────────┐
                                  │ TM TRADING   │
                                  │ Control App  │
                                  └──────┬───────┘
                                         │
          ┌──────────────────────────────┼───────────────────────────────┐
          │                              │                               │
          ▼                              ▼                               ▼
   MARKET DATA PLANE             ANALYTICS PLANE                 SIMULATION PLANE
          │                              │                               │
  ┌───────┼────────┐             ┌──────┼─────────┐              ┌──────┼─────────┐
  │       │        │             │      │         │              │      │         │
 Binance Bybit    OKX         Indicators Methods Intel         Clock  Orders   Positions
  │       │        │             │      │         │              │      │         │
  └───────┼────────┘             └──────┼─────────┘              └──────┼─────────┘
          │                             │                               │
      CCXT / long-tail          Signal / Confluence                Fill Model
          │                             │                               │
  Twelve Data / MT5 /          Snapshot + Context                  Risk Gate
  reference providers                    │                               │
          │                             │                               │
          └───────────────┬─────────────┴──────────────┬────────────────┘
                          ▼                            ▼
                    MARKET EVENT BUS             JOURNAL / DATASET
                          │                            │
                          ▼                            ▼
                    REALTIME API                  AI RESEARCH
                          │                            │
                          ▼                            ▼
                   NUxt TERMINAL              EXPERIMENT ENGINE
```

---

# 4. Architectural Decisions V3

## D15 — Market Core is independent from transport

`engine/` must not know about:

- WebSocket library
- Redis implementation
- Nuxt
- browser state
- exchange-specific payloads

Provider/transport code belongs under `market/`.

## D16 — Canonical instrument ID

Never use an exchange-native symbol as the primary identifier.

Examples:

```text
crypto:spot:BTC/USDT
crypto:perp:BTC/USDT
crypto:futures:BTC/USDT:20261225
metal:spot:XAU/USD
fx:spot:EUR/USD
```

Exchange mappings are secondary.

## D17 — Event time vs ingest time

Every external event must preserve:

```ts
{
  eventTime: number,
  ingestTime: number,
  sourceTime?: number,
  source: string,
  sequence?: number
}
```

Trading logic uses `eventTime`.

Latency uses `ingestTime - eventTime` where both clocks are compatible.

## D18 — One Trading Clock abstraction

```ts
interface TradingClock {
  now(): number
  mode(): 'live' | 'replay' | 'backtest'
  canRead(eventTime: number): boolean
}
```

No engine module may call `Date.now()` for market decisions.

## D19 — No future leakage

At every clock position:

```text
readable eventTime <= clock.now()
```

Replay must not preload or expose future values to the strategy calculation path.

## D20 — Forming vs closed bar is explicit

Every candle has:

```ts
state: 'forming' | 'closed'
```

Every signal declares:

```text
triggerPolicy:
CLOSE_ONLY
INTRABAR
CLOSE_AND_INTRABAR
```

Default: `CLOSE_ONLY` unless the strategy contract explicitly states otherwise.

## D21 — Market data source has a role

Each provider mapping must declare:

```text
PRIMARY_EXECUTION_SOURCE
PRIMARY_ANALYSIS_SOURCE
REFERENCE_SOURCE
FALLBACK_SOURCE
```

A reference aggregate provider must never silently become the execution price source.

## D22 — Native indicators are the product source of truth

TM Trading should own the implementation of the indicators used by its simulator.

TradingView/Pine can remain a reference/parity source for existing indicators, but the realtime application must not depend on a TradingView runtime to calculate its internal indicators.

## D23 — One indicator implementation across modes

```text
indicator core
   ├── chart
   ├── live signal
   ├── replay
   ├── backtest
   └── AI context
```

## D24 — Snapshot-at-decision

Every signal/order/position transition stores or references an immutable context snapshot/hash.

Minimum context:

```text
instrument
venue
TF
clockTime
bar state
bid/ask/last
OHLCV
indicator values
method events
funding/OI where available
regime
risk state
strategy version
```

## D25 — UI sends intent, server owns state

UI can request:

```text
OPEN_LONG
OPEN_SHORT
PLACE_LIMIT
PLACE_STOP
CANCEL_ORDER
MOVE_SL
MOVE_TP
PARTIAL_CLOSE
CLOSE_POSITION
```

Server decides whether the requested transition is valid.

## D26 — Fill model is reusable

Backtest, replay and live paper use the same fill-model package with different market event inputs.

## D27 — Data quality must be explicit

Each event can carry:

```text
quality:
  valid
  stale
  delayed
  gap
  duplicate
  out_of_order
  degraded
```

Indicator/simulator policies must be able to block on invalid market state.

## D28 — Realtime subscriptions are demand-driven

Do not subscribe to every high-frequency channel for every symbol.

Use subscription tiers:

```text
L0 catalog
L1 ticker/scanner
L2 chart candles/trades
L3 orderbook/funding/OI
L4 active-paper full execution context
```

## D29 — Raw market data has retention tiers

```text
HOT   = memory/Redis
WARM  = compressed local files / Parquet
COLD  = long-term historical store/object storage when needed
APP   = MongoDB for metadata/state/journal
```

MongoDB is not the default raw-tick firehose.

## D30 — Strategy versions are immutable

Do not edit a strategy version after it has produced recorded trades.

Use:

```text
TM-VSA v1.0
TM-VSA v1.1
TM-VSA v1.2
```

Every new parameter set creates a new immutable version.

## D31 — AI proposes experiments, not silent changes

```text
AI
 ↓
proposal
 ↓
human approval
 ↓
experiment
 ↓
backtest
 ↓
holdout
 ↓
live paper
 ↓
new version
```

## D32 — Real-time UI is observation/control, not calculation authority

The browser renders state and sends intents.

Core calculations happen server-side/engine-side so browser disconnects do not corrupt the simulation.

## D33 — Connection loss is a state, not an error to hide

Terminal must show:

```text
CONNECTED
DEGRADED
STALE
RECONNECTING
DISCONNECTED
```

Paper simulator must have a configurable policy for stale market data.

## D34 — No “fake realtime” from REST polling when WS is available

REST may be used for:

- historical bootstrap
- recovery/resync
- metadata
- snapshots

WebSocket/stream is preferred for realtime market state.

---

# 5. Market Data Provider Strategy

## 5.1 Direct exchange adapters — primary

Start with:

```text
Binance
Bybit
OKX
```

Reasons:

- direct venue prices
- direct order book/trade data
- futures-specific metrics
- lower ambiguity than an aggregated feed for execution simulation
- direct instrument metadata

Binance provides WebSocket market streams for market data and futures/spot streams; adapter work must follow its connection, stream and message lifecycle requirements.

Bybit V5 provides separate public streams for spot, linear contracts, inverse contracts, options and related markets; its kline stream exposes a `confirm` field that distinguishes a closed candle from an updating candle. citeturn689979search2turn689979search10

Bybit orderbook streams are snapshot/delta based and have different depth/frequency tiers, so the local orderbook must implement correct snapshot reset + delta application. citeturn689979search4

OKX explicitly recommends WebSocket for market data/order-book depth and exposes instrument configuration plus realtime market channels; instrument changes can be published through its `instruments` channel. citeturn471653search0turn471653search1

## 5.2 Secondary native adapters

After the first three are stable:

```text
Coinbase
Kraken
```

Only add a provider when a concrete use case exists.

## 5.3 Long-tail crypto coverage

Use CCXT as the **coverage adapter**, not the semantic core.

Current CCXT documentation lists support for many exchanges through the unified API, while CCXT Pro provides WebSocket abstractions with methods such as `watchOrderBook`, `watchTicker`, `watchOHLCV`, and `watchTrades`. The supported exchange list changes over time and must be treated as runtime/config metadata rather than hard-coded assumptions. citeturn689979search8turn689979search0

Architecture:

```text
Top venues
   ↓
native adapters

Long tail
   ↓
CCXT adapter
   ↓
canonical events
```

Do not force CCXT-normalized fields into places where native venue semantics matter.

## 5.4 Cross-asset/reference provider

Use a multi-asset provider such as Twelve Data for reference/coverage where it makes sense.

Twelve Data documents a unified market-data API across many asset classes and a WebSocket service that can subscribe to symbols across markets/exchanges in the same service. citeturn471653search5turn471653search6

Recommended roles:

```text
FX reference
XAU/USD reference
broader market coverage
historical/reference data
```

Do not assume a reference-provider price is identical to a broker/exchange execution price.

## 5.5 Gold / FX broker source

For eventual XAU/XAG/FX simulator realism, prefer the exact broker feed used by the demo execution environment.

For example:

```text
MT5 terminal / broker feed
        ↓
XAUUSD/XAGUSD/FX quote stream
        ↓
TM Market Adapter
```

Twelve Data can serve as a reference/secondary source, but broker-specific spread, session, contract and price behavior should be modeled from the broker feed when the goal is execution realism.

## 5.6 Aggregated market-data provider

An aggregator such as CoinAPI may be added later for:

- market discovery
- broad historical coverage
- cross-exchange reference
- fallback/reference analytics

It must not silently replace a direct venue source for venue-specific paper execution.

---

# 6. Source-of-Truth Matrix

| Dataset | Primary source | Secondary/reference | Used for paper fill? |
|---|---|---|---|
| Binance BTC/ETH/SOL futures | Binance native WS | CCXT / aggregate | YES |
| Bybit futures | Bybit native WS | CCXT | YES when Bybit venue selected |
| OKX futures | OKX native WS | CCXT | YES when OKX venue selected |
| Crypto spot | native venue | CCXT / Twelve Data | YES when venue selected |
| XAU/USD | broker/MT5 source | Twelve Data / reference | YES only when broker source is selected |
| FX | broker/reference source | Twelve Data | Later |
| Macro events | macro provider | cached/reference | NO |
| News | RSS/API | other feeds | NO |

The app must always display `venue` and `dataSource` for a price used in simulation.

---

# 7. Canonical Instrument Catalog

Create an `Instrument Catalog Service`.

## 7.1 Canonical ID examples

```text
crypto:spot:BTC/USDT
crypto:spot:ETH/USDT
crypto:perp:BTC/USDT
crypto:perp:ETH/USDT
metal:spot:XAU/USD
metal:spot:XAG/USD
fx:spot:EUR/USD
```

## 7.2 Venue mapping example

```json
{
  "instrumentId": "crypto:perp:BTC/USDT",
  "venue": "binance",
  "nativeSymbol": "BTCUSDT",
  "marketType": "USD-M-FUTURES",
  "status": "active"
}
```

Bybit:

```json
{
  "instrumentId": "crypto:perp:BTC/USDT",
  "venue": "bybit",
  "nativeSymbol": "BTCUSDT",
  "marketType": "linear",
  "status": "active"
}
```

OKX:

```json
{
  "instrumentId": "crypto:perp:BTC/USDT",
  "venue": "okx",
  "nativeSymbol": "BTC-USDT-SWAP",
  "marketType": "swap",
  "status": "active"
}
```

## 7.3 Instrument fields

```ts
interface Instrument {
  instrumentId: string
  assetClass: 'crypto' | 'metal' | 'fx' | 'index' | 'equity' | 'commodity'
  marketType: 'spot' | 'perpetual' | 'futures' | 'option' | 'cfd'

  base?: string
  quote?: string

  venue: string
  nativeSymbol: string

  status: 'active' | 'halted' | 'delisted'

  tickSize?: number
  qtyStep?: number
  minQty?: number

  pricePrecision?: number
  quantityPrecision?: number

  contractSize?: number
  contractType?: string
  expiry?: number

  priceUnit?: string
  quantityUnit?: string

  firstSeenAt?: number
  lastSeenAt?: number
}
```

## 7.4 Catalog synchronization

The catalog service should:

```text
fetch venue instruments
       ↓
normalize
       ↓
upsert mapping
       ↓
mark stale/delisted
       ↓
version catalog snapshot
```

Use venue instrument update feeds when available. OKX explicitly documents realtime instrument updates, which should be used where practical. citeturn471653search1

---

# 8. Realtime Market Plane

## 8.1 Pipeline

```text
External Provider
       ↓
Connection Manager
       ↓
Raw Event
       ↓
Adapter Decoder
       ↓
Canonical Normalizer
       ↓
Quality / Sequence Check
       ↓
Market Event Bus
       ├── Quote Store
       ├── Trade Tape
       ├── Orderbook Store
       ├── Candle Builder
       ├── Funding/OI Store
       ├── Liquidation Store
       └── Recorder
```

## 8.2 Connection manager responsibilities

- connect
- authenticate where required
- heartbeat
- reconnect
- exponential backoff
- resubscribe
- sequence/gap detection
- snapshot recovery
- connection health
- latency measurement
- provider-specific limits
- connection sharding

## 8.3 Subscription manager

Subscriptions are demand-driven.

### L0 — catalog

No realtime stream.

### L1 — watchlist/scanner

```text
ticker
24h stats
minimal quote
```

### L2 — chart

```text
kline
trade
quote
```

### L3 — analysis

```text
orderbook
funding
OI
liquidations
```

### L4 — active paper position

```text
quote
trade
orderbook
kline
funding
OI
liquidation
execution-quality metrics
```

## 8.4 Resource rules

Never subscribe indiscriminately to high-frequency streams for all symbols.

Example:

```text
5,000 symbols
    ↓
L1 ticker only

User opens BTCUSDT
    ↓
L2 + L3

User opens paper position
    ↓
L4
```

---

# 9. Canonical Market Events

Every adapter emits canonical events.

## 9.1 `market.trade`

```ts
interface TradeEvent {
  type: 'market.trade'
  instrumentId: string
  venue: string

  tradeId: string
  price: number
  quantity: number
  side?: 'buy' | 'sell'

  eventTime: number
  ingestTime: number
  sourceTime?: number
  sequence?: number

  quality: 'valid' | 'delayed' | 'out_of_order' | 'duplicate'
}
```

## 9.2 `market.quote`

```ts
interface QuoteEvent {
  type: 'market.quote'
  instrumentId: string
  venue: string

  bid?: number
  ask?: number
  last?: number

  eventTime: number
  ingestTime: number
  sequence?: number

  quality: 'valid' | 'stale' | 'delayed' | 'gap' | 'out_of_order'
}
```

## 9.3 `market.orderbook`

```ts
interface OrderBookLevel {
  price: number
  quantity: number
}

interface OrderBookEvent {
  type: 'market.orderbook'
  instrumentId: string
  venue: string

  kind: 'snapshot' | 'delta'
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]

  sequence?: number
  eventTime: number
  ingestTime: number
  quality: 'valid' | 'gap' | 'stale' | 'out_of_order'
}
```

The local orderbook is stateful and must not be treated as independent snapshots when the provider uses snapshot/delta semantics. Bybit and OKX both document snapshot/delta/orderbook depth behavior that must be respected in the adapters. citeturn689979search4turn471653search4

## 9.4 `market.candle`

```ts
interface CandleEvent {
  type: 'market.candle'
  instrumentId: string
  venue: string
  timeframe: string

  open: number
  high: number
  low: number
  close: number
  volume: number

  openTime: number
  closeTime: number
  state: 'forming' | 'closed'

  source: 'exchange' | 'builder'
  eventTime: number
  ingestTime: number
}
```

## 9.5 `market.funding`

```ts
interface FundingEvent {
  type: 'market.funding'
  instrumentId: string
  venue: string
  fundingRate: number
  nextFundingTime?: number
  eventTime: number
  ingestTime: number
}
```

## 9.6 `market.open-interest`

```ts
interface OpenInterestEvent {
  type: 'market.open-interest'
  instrumentId: string
  venue: string
  value: number
  unit?: string
  eventTime: number
  ingestTime: number
}
```

## 9.7 `market.liquidation`

```ts
interface LiquidationEvent {
  type: 'market.liquidation'
  instrumentId: string
  venue: string
  side: 'buy' | 'sell'
  price: number
  quantity: number
  notional?: number
  eventTime: number
  ingestTime: number
}
```

---

# 10. Candle Builder and Timeframe System

## 10.1 Base interval

Use `1m` as the durable base candle where the venue provides reliable 1m data.

For realtime charting, also maintain the current forming bar.

## 10.2 Derived intervals

Allow derived bars only when the source interval divides the target interval exactly.

Examples:

```text
1m → 5m
1m → 10m
1m → 15m
1m → 30m
1m → 1h
4m → 12m
```

Do not silently construct a non-divisible timeframe.

## 10.3 Candle state

A forming candle can update many times.

When closed:

```text
forming → closed
```

The engine must emit a final immutable close event.

## 10.4 Realtime vs historical reconciliation

When a realtime feed reconnects:

```text
reconnect
  ↓
fetch recent REST candles
  ↓
compare current local bar
  ↓
repair gap
  ↓
resume WS
```

Never assume the local state remained correct after a connection gap.

---

# 11. Native Indicator Engine V3

## 11.1 Product decision

TM Trading should build a **native indicator engine** instead of trying to embed the Pine runtime.

Pine indicators owned by the project can still be ported/reference-tested, but native TypeScript/Node implementations become the runtime source of truth for the simulator.

## 11.2 Indicator architecture

```text
indicator/
├── registry.mjs
├── contract.mjs
├── context.mjs
├── buffers.mjs
├── incremental.mjs
├── math/
│   ├── sma.mjs
│   ├── ema.mjs
│   ├── rma.mjs
│   ├── atr.mjs
│   └── ...
├── trend/
├── momentum/
├── volume/
├── volatility/
├── structure/
├── orderflow/
├── derivatives/
└── custom/
```

## 11.3 Indicator contract

```ts
interface IndicatorDefinition {
  id: string
  version: string

  inputSchema: unknown
  outputSchema: unknown

  warmup: number

  init?(ctx: IndicatorInitContext): unknown

  update(
    state: unknown,
    input: IndicatorInput
  ): IndicatorUpdateResult

  calculate?(
    input: IndicatorInput
  ): IndicatorOutput
}
```

Support both:

```text
batch calculation
incremental realtime calculation
```

The implementation must be numerically deterministic.

## 11.4 Basic indicator library

Priority P0:

```text
SMA
EMA
RMA/Wilder
WMA
ATR
RSI
ROC
highest/lowest
rolling mean/std
VWAP
Volume MA
```

Priority P1:

```text
MACD
Bollinger Bands
ADX/DMI
Donchian
OBV
CMF
MFI
Stochastic
SuperTrend
```

Priority P2:

```text
Volume Profile
VWAP bands
market structure
pivot systems
liquidity metrics
order-flow metrics
```

## 11.5 Trading-native indicators

After the generic core is stable, build the features that matter to TM Trading:

```text
VSA
Wyckoff
BOS
CHoCH
FVG
Liquidity Sweep
Order Block
Supply/Demand
Taker Delta
Delta divergence
Open-interest delta
Funding pressure
Liquidation pressure
Regime
Confluence
```

These should expose both:

```text
data series
trade events
reason codes
```

## 11.6 Indicator outputs

Never return only a number.

A useful output shape:

```ts
interface IndicatorOutput {
  indicatorId: string
  version: string
  instrumentId: string
  timeframe: string
  eventTime: number

  values: Record<string, number | boolean | null>

  state?: Record<string, unknown>

  events?: IndicatorEvent[]

  paramsHash: string
}
```

## 11.7 Warmup policy

Every indicator declares warmup bars.

Before warmup completes:

```text
value = null
ready = false
```

Never silently substitute zero.

## 11.8 Realtime update policy

For every forming candle:

```text
update current buffer
→ recompute required rolling state
→ emit provisional output
```

On candle close:

```text
finalize
→ emit immutable close output
→ persist only according to retention policy
```

---

# 12. Pine / TradingView Compatibility Layer

TradingView is not the runtime source for the TM terminal.

However, existing TM Pine scripts should be treated as **reference specifications**.

## 12.1 Import strategy

Do not promise arbitrary `.pine` files can execute inside Node.

Instead:

```text
Pine source
  ↓
manual/assisted port
  ↓
TM-native indicator/method
  ↓
golden fixture
  ↓
TradingView vs native comparison
  ↓
PARITY PASS
```

## 12.2 Preserve Pine semantics that matter

Where the existing strategy depends on:

- RMA seed
- pivot confirmation delay
- strict comparisons
- bar state
- replacement behavior
- TP/SL ordering
- timeframe behavior

those semantics must become explicit native engine tests.

This preserves the existing parity discipline instead of maintaining two hidden implementations.

## 12.3 Optional Pine metadata

A native indicator may declare:

```yaml
reference:
  platform: tradingview
  script: TM VSA
  version: 1.8.0
  referenceHash: ...
```

This is metadata only.

---

# 13. Signal / Method Engine V3

Methods consume canonical market data + indicator outputs.

```text
Market Snapshot
      ↓
Indicators
      ↓
Method registry
      ↓
Method event/score
      ↓
Confluence
      ↓
Trade Plan
```

## 13.1 Method contract

```ts
interface TradingMethod {
  id: string
  version: string

  analyze(input: MethodInput): MethodResult
}
```

## 13.2 Method result

```ts
interface MethodResult {
  methodId: string
  version: string

  events: MethodEvent[]

  score?: number

  setup?: {
    side: 'LONG' | 'SHORT'
    entry?: number
    sl?: number
    tps?: number[]
  }

  reasons: string[]

  paramsHash: string
}
```

## 13.3 Confluence

Confluence must remain transparent.

Example:

```text
VSA          +0.62
Price Action +0.71
Trend        +0.83
Orderflow    +0.12
Regime       +0.60
Funding      -0.10
Liquidation  +0.35
------------------
Total        +0.51
```

Store both the component values and the final score.

---

# 14. Market Snapshot Engine

Create a lightweight immutable snapshot for every decision point.

```ts
interface MarketSnapshot {
  snapshotId: string
  snapshotHash: string

  instrumentId: string
  venue: string
  timeframe: string

  clockTime: number

  bar: {
    open: number
    high: number
    low: number
    close: number
    volume: number
    state: 'forming' | 'closed'
  }

  quote?: {
    bid?: number
    ask?: number
    last?: number
  }

  indicators: Record<string, unknown>

  derivatives?: {
    fundingRate?: number
    openInterest?: number
  }

  regime?: unknown

  dataQuality: 'good' | 'degraded' | 'blocked'
}
```

## Snapshot policy

Create snapshots when:

- signal emitted
- paper order created
- paper order filled
- stop/TP triggered
- position closed
- strategy alert fired
- AI context captured

Do not write every tick as a full MongoDB snapshot.

---

# 15. Realtime Trading Terminal `/trade`

## 15.1 Main layout

```text
┌──────────────────────────────────────────────────────────────────────┐
│ BTCUSDT.P · Binance Futures · 15m · LIVE ● · latency 42ms          │
├────────────────┬───────────────────────────────────┬─────────────────┤
│ WATCHLIST      │           MAIN CHART              │ ORDER BOOK      │
│                │                                   │                 │
│ BTCUSDT.P      │ Candles                           │ ASK             │
│ ETHUSDT.P      │ EMA / VWAP / structures          │ spread          │
│ SOLUSDT.P      │ Signals                           │ imbalance       │
│ XRPUSDT.P      │ Entry / SL / TP                   │ BID             │
│ XAUUSD         │ Zones / levels                    │                 │
├────────────────┴───────────────────────────────────┴─────────────────┤
│ Volume │ Delta │ OI │ Funding │ RSI │ MACD │ Liquidation           │
├──────────────────────────────────────────────────────────────────────┤
│ Trade Ticket │ Positions │ Orders │ Signals │ Alerts │ Journal     │
└──────────────────────────────────────────────────────────────────────┘
```

## 15.2 Terminal state

Terminal must show:

```text
market connection
last event time
server clock
candle freshness
indicator freshness
paper engine status
risk gate status
account equity
open positions
```

## 15.3 Watchlist

Watchlist rows can show:

```text
symbol
venue
market type
last
24h change
volume
funding
OI
spread
connection status
```

L1 subscription by default.

## 15.4 Chart

Chart supports:

```text
1m
3m
5m
10m
15m
30m
1h
2h
4h
1D
```

Only show a timeframe when data construction is valid.

Chart layers:

```text
price candles
indicator overlays
structure zones
signal markers
entry/SL/TP
trade markers
paper position
risk levels
news markers
```

## 15.5 Orderbook

Show:

```text
asks
spread
mid
bids
cumulative depth
imbalance
```

Orderbook is informational for the simulator unless the selected venue/source explicitly supports a fill model using depth.

## 15.6 Trade tape

Show:

```text
trade time
price
size
side
```

Optional aggregation:

```text
per 100ms
per 1s
per price level
```

---

# 16. Trade Ticket

The trade ticket is an intent generator, not an execution engine.

## 16.1 Inputs

```text
Side
Order type
Quantity / risk %
Entry / limit price
SL
TP1
TP2
TP3
Leverage (paper constraint)
```

## 16.2 Preview

Before submit:

```text
Entry
Estimated fill
Risk amount
SL distance
RR
Fee estimate
Spread
Slippage assumption
Exposure
Margin estimate
```

## 16.3 Submit flow

```text
UI intent
  ↓
server validation
  ↓
Risk Gate
  ↓
simulation order creation
  ↓
fill model
  ↓
position state
  ↓
WebSocket update
```

---

# 17. Paper Simulation Engine V3

The current `exec/paper.mjs` becomes an adapter/facade over the new `simulation/` core.

## 17.1 Target structure

```text
simulation/
├── clock.mjs
├── order.mjs
├── fill-model.mjs
├── fee-model.mjs
├── spread-model.mjs
├── slippage-model.mjs
├── latency-model.mjs
├── position.mjs
├── account.mjs
├── margin.mjs
├── liquidation.mjs
├── pnl.mjs
├── simulator.mjs
└── replay.mjs
```

## 17.2 Order state machine

```text
CREATED
   ↓
RISK_CHECKED
   ↓
PENDING
   ├─────────────→ CANCELLED
   ├─────────────→ EXPIRED
   ↓
PARTIALLY_FILLED
   ↓
FILLED
   ↓
OPEN_POSITION
   ↓
CLOSED
```

Terminal rejection:

```text
REJECTED
```

## 17.3 Order types

P0:

```text
market
limit
stop-market
```

P1:

```text
stop-limit
reduce-only
partial close
```

---

# 18. Fill Model

## 18.1 Market order

Default quote-aware policy:

```text
LONG  → ask + slippage
SHORT → bid - slippage
```

If bid/ask unavailable:

```text
fallback to last + explicit spread/slippage model
```

Mark the result as `degradedFill=true`.

## 18.2 Limit order

A long limit can fill only after the observed market has traded at or below its limit under the selected fill policy.

A short limit can fill only after the observed market has traded at or above its limit.

Do not use future bar information.

## 18.3 Stop order

When stop condition is observed:

```text
trigger
  ↓
market fill policy
```

Gap behavior must be explicit.

## 18.4 Partial fills

Support configurable participation policy:

```text
FULL
TOP_OF_BOOK
DEPTH_AWARE
BAR_VOLUME_PARTICIPATION
```

Start with `FULL` + explicit slippage; add depth-aware after the core simulator is stable.

## 18.5 Fees

Fee calculation must be source/account-profile dependent.

Persist:

```text
feeRate
feeCurrency
feeAmount
```

## 18.6 Latency

Record at least:

```text
signalTime
intentTime
serverReceiveTime
fillDecisionTime
fillTime
```

Paper mode should allow a configurable simulated latency profile.

---

# 19. Position Model

```ts
interface Position {
  positionId: string
  accountId: string

  instrumentId: string
  venue: string

  side: 'LONG' | 'SHORT'
  qty: number
  avgEntry: number

  sl?: number
  tps?: number[]

  leverage?: number
  marginUsed?: number

  realizedPnl: number
  unrealizedPnl: number
  fees: number

  openedAt: number
  updatedAt: number
  closedAt?: number

  strategyVersion?: string
  signalId?: string
  snapshotHash?: string
}
```

## Position state must be server-authoritative.

---

# 20. Paper Account

```ts
interface PaperAccount {
  accountId: string
  mode: 'LIVE_PAPER' | 'REPLAY'

  currency: string
  initialBalance: number

  balance: number
  equity: number
  availableBalance: number
  marginUsed: number

  realizedPnl: number
  unrealizedPnl: number

  dailyPnl?: number
  maxDrawdown?: number

  createdAt: number
  updatedAt: number
}
```

The account must survive:

- browser refresh
- terminal reconnect
- backend restart

without changing historical state.

---

# 21. Risk Gate Integration

Every paper order uses the existing Risk Gate.

```text
UI
 ↓
Intent
 ↓
Normalize order
 ↓
Risk Gate
 ├── allowed
 └── rejected
        ↓
Simulation
```

Check:

```text
kill-switch
paper account state
daily loss cap
position size
exposure
max concurrent positions
max leverage
minimum RR
SL/TP validity
stale-data state
instrument trading status
```

If market data is stale beyond policy:

```text
BLOCK NEW OPEN
```

Existing protective exits may continue according to explicit simulator policy.

---

# 22. Replay / Training Engine

## 22.1 Goal

Turn historical market data into a **decision-training environment**.

## 22.2 Replay pipeline

```text
Historical Event Stream
        ↓
Replay Clock
        ↓
Market State
        ↓
Indicator Engine
        ↓
Methods
        ↓
Chart
        ↓
User Decision
        ↓
Risk Gate
        ↓
Paper Simulator
        ↓
Journal
```

## 22.3 Future data hiding

At time `T`:

```text
visible: eventTime <= T
hidden:  eventTime > T
```

No API or frontend store may expose future candles to the strategy state.

## 22.4 Controls

```text
Play
Pause
Step event
Step trade
Step candle
0.25x
0.5x
1x
2x
5x
10x
```

## 22.5 Replay challenge mode

Optional:

```text
signal overlays hidden
future bars hidden
user chooses LONG / SHORT / WAIT
```

Then replay continues and scores the decision.

Do not present this as financial advice; it is a simulation/review feature.

---

# 23. Market Recorder

## 23.1 Recording goals

A recorder is necessary for:

- replay
- debugging
- paper-trade reconstruction
- indicator parity
- execution-quality analysis
- AI dataset creation

## 23.2 Storage tiers

```text
Hot:
memory / Redis

Warm:
compressed files / Parquet

Application state:
MongoDB

Long-term:
object storage later
```

## 23.3 What to record by default

P0:

```text
1m candles
quotes at signal/order events
market snapshots at decision points
paper orders/fills
indicator outputs used for decisions
```

P1:

```text
trades
orderbook snapshots
funding
OI
liquidation
```

P2:

```text
full tick/orderbook replay archives
```

## 23.4 Retention

Every raw dataset must declare:

```text
retention
compression
schemaVersion
source
start/end
checksum
```

---

# 24. Data Quality and Reconciliation

## 24.1 Quality checks

For each provider:

```text
heartbeat
latency
sequence
monotonic event time
duplicate rate
gap rate
malformed event rate
reconnect rate
```

## 24.2 Candle reconciliation

Periodically compare local candles against venue REST candles.

If mismatch exceeds threshold:

```text
mark data suspect
repair
invalidate dependent derived data if necessary
```

## 24.3 Cross-source comparison

For common instruments:

```text
Binance BTC
Bybit BTC
OKX BTC
```

Compute:

```text
spread
relative spread
latency
price divergence
```

Use this for market intelligence, not to substitute one venue's execution price with another.

---

# 25. Notification System

Existing notification infrastructure is preserved and extended.

```text
market / signal / risk / order / position / service
                         ↓
                 Notification Router
                         ↓
          ┌──────────────┼───────────────┐
          ▼              ▼               ▼
       Web Push       Telegram        Electron
```

Priority:

```text
critical
important
normal
info
```

Critical examples:

```text
Risk halted
Market source disconnected
Paper engine stale
Signal drift
Position SL/TP event
Service overdue
```

---

# 26. MongoDB V3 Model

Preserve existing collections and add/extend:

```text
instruments
instrument_mappings
market_sources
market_source_health
market_snapshots
indicator_configs
indicator_runs
strategy_profiles
strategy_versions
workspaces
chart_layouts
paper_accounts
paper_orders
paper_fills
positions
simulation_runs
replay_sessions
trade_context
experiments
experiment_runs
ai_proposals
notification_logs
```

## 26.1 `strategy_profiles`

```json
{
  "profileId": "tm-vsa-btc-15m",
  "name": "TM VSA BTC 15m",
  "status": "active",
  "strategyVersionId": "tm-vsa@1.4.0",
  "instruments": ["crypto:perp:BTC/USDT"],
  "timeframes": ["15m"],
  "riskProfileId": "paper-default",
  "createdAt": 0,
  "updatedAt": 0
}
```

## 26.2 `strategy_versions`

Immutable.

```json
{
  "strategyVersionId": "tm-vsa@1.4.0",
  "strategyId": "tm-vsa",
  "version": "1.4.0",
  "engineVersion": "0.7.x",
  "paramsHash": "...",
  "referenceHash": "...",
  "indicatorVersions": {},
  "methodVersions": {},
  "parameters": {},
  "createdAt": 0,
  "createdBy": "user",
  "status": "paper"
}
```

## 26.3 `market_snapshots`

Store only decision/event snapshots by default.

```text
snapshotId
snapshotHash
instrumentId
venue
timeframe
clockTime
bar
quote
indicators
methods
regime
dataQuality
strategyVersionId
```

## 26.4 `paper_orders`

```text
orderId
clientOrderId
accountId
instrumentId
venue
side
type
qty
limitPrice
stopPrice
sl
tps
status
createdAt
submittedAt
filledAt
simulationVersion
strategyVersionId
snapshotHash
```

## 26.5 `paper_fills`

```text
fillId
orderId
fillPrice
fillQty
feeRate
feeAmount
spread
slippage
latencyMs
eventTime
```

## 26.6 `trade_context`

This is the future AI dataset.

```text
tradeId
strategyVersionId
method
symbol
venue
timeframe
entry snapshot
exit snapshot
indicators
market regime
funding/OI
news context
risk state
execution metrics
outcome
```

---

# 27. AI Research Layer V3

AI becomes a **researcher**, not an unrestricted executor.

## 27.1 Inputs AI may read

```text
market snapshots
indicator outputs
method events
signals
paper trades
journal
backtest summaries
experiment results
regime
funding/OI
news summaries
execution-quality metrics
```

## 27.2 Research questions

Examples:

```text
Which regime produces the best expectancy?
Which setup fails most often?
Which symbol/TF combination is unstable?
Are losses concentrated around high ATR?
Does OI divergence affect this setup?
Does entry latency reduce expectancy?
Does spread/slippage materially alter results?
```

## 27.3 AI output

AI should produce structured proposals:

```ts
interface AIExperimentProposal {
  proposalId: string
  strategyVersionId: string

  hypothesis: string

  changes: Array<{
    parameter: string
    from: unknown
    to: unknown
  }>

  evidence: Array<{
    metric: string
    value: number
    sampleSize: number
  }>

  risks: string[]

  recommendedTest: {
    symbols?: string[]
    timeframes?: string[]
    holdoutRequired: boolean
  }
}
```

No proposal directly changes production state.

---

# 28. Experiment Engine

## 28.1 Experiment lifecycle

```text
PROPOSED
   ↓
APPROVED
   ↓
RUNNING
   ↓
BACKTESTED
   ↓
HOLDOUT
   ↓
PAPER_VALIDATION
   ↓
ACCEPTED / REJECTED
```

## 28.2 Experiment comparison

Compare:

```text
baseline
candidate
random baseline
holdout
```

Metrics:

```text
trades
WR
PF
expectancy
median R
net return
max DD
Sharpe-like diagnostic if later justified
MFE
MAE
slippage
fees
```

Do not select based on one metric.

## 28.3 Minimum acceptance

A candidate must:

- beat the defined baseline where required
- maintain sufficient sample size
- survive symbol holdout
- avoid obvious degeneracy
- preserve risk constraints
- have a reproducible run hash

---

# 29. Strategy Version Lifecycle

```text
DRAFT
  ↓
BACKTEST
  ↓
HOLDOUT
  ↓
PAPER
  ↓
STABLE_PAPER
  ↓
ARCHIVED
```

A version can never be silently changed in place.

New parameters = new version.

---

# 30. API Architecture V3

## 30.1 Instrument APIs

```text
GET /api/v1/instruments
GET /api/v1/instruments/:id
GET /api/v1/instruments/:id/sources
GET /api/v1/venues
GET /api/v1/market-sources/health
```

## 30.2 Market data APIs

```text
GET /api/v1/markets/:instrument/candles
GET /api/v1/markets/:instrument/trades
GET /api/v1/markets/:instrument/orderbook
GET /api/v1/markets/:instrument/funding
GET /api/v1/markets/:instrument/open-interest
```

REST is bootstrap/recovery, not the preferred high-frequency realtime transport.

## 30.3 Indicator APIs

```text
GET /api/v1/indicators
GET /api/v1/indicators/:id
POST /api/v1/indicator-runs
GET /api/v1/indicator-runs/:id
```

## 30.4 Strategy APIs

```text
GET /api/v1/strategies
GET /api/v1/strategies/:id
GET /api/v1/strategies/:id/versions
POST /api/v1/strategies/:id/versions
POST /api/v1/strategies/:id/activate-paper
```

## 30.5 Paper APIs

```text
GET /api/v1/paper/accounts
GET /api/v1/paper/accounts/:id
GET /api/v1/paper/accounts/:id/orders
GET /api/v1/paper/accounts/:id/positions
POST /api/v1/paper/orders
POST /api/v1/paper/orders/:id/cancel
POST /api/v1/paper/positions/:id/close
PATCH /api/v1/paper/positions/:id/risk
```

## 30.6 Replay APIs

```text
POST /api/v1/replay/sessions
GET /api/v1/replay/sessions/:id
POST /api/v1/replay/sessions/:id/play
POST /api/v1/replay/sessions/:id/pause
POST /api/v1/replay/sessions/:id/step
POST /api/v1/replay/sessions/:id/reset
```

## 30.7 Research APIs

```text
GET /api/v1/research/trades
GET /api/v1/research/strategies/:id
GET /api/v1/research/proposals
POST /api/v1/research/experiments
GET /api/v1/research/experiments/:id
POST /api/v1/research/experiments/:id/run
```

---

# 31. WebSocket V3

## 31.1 Client subscribe

```json
{
  "type": "subscribe",
  "requestId": "r1",
  "channels": [
    {
      "topic": "candle",
      "instrumentId": "crypto:perp:BTC/USDT",
      "venue": "binance",
      "timeframe": "15m"
    },
    {
      "topic": "quote",
      "instrumentId": "crypto:perp:BTC/USDT",
      "venue": "binance"
    },
    {
      "topic": "orderbook",
      "instrumentId": "crypto:perp:BTC/USDT",
      "venue": "binance"
    }
  ]
}
```

## 31.2 Server event envelope

```ts
interface RealtimeEnvelope<T> {
  type: string
  sequence: number
  eventTime: number
  ingestTime: number
  source: string
  payload: T
}
```

## 31.3 Client recovery

On sequence gap:

```text
pause rendering
request state snapshot
reconcile
resume
```

Never silently continue with an unknown gap.

---

# 32. Frontend State Architecture

Nuxt UI remains presentation.

Recommended stores:

```text
marketStore
instrumentStore
chartStore
indicatorStore
strategyStore
paperAccountStore
positionStore
orderStore
replayStore
notificationStore
workspaceStore
```

Do not put the authoritative position state only in Pinia.

Pinia is a cache/view state; server state is authoritative.

---

# 33. Chart / Workspace Persistence

A workspace should store:

```text
instrument
venue
timeframe
chart type
indicator list
indicator params
panel order
zoom/time range
visible overlays
active strategy
paper account
```

Example:

```json
{
  "workspaceId": "ws-btc-scalp",
  "instrumentId": "crypto:perp:BTC/USDT",
  "venue": "binance",
  "timeframe": "15m",
  "indicators": [
    {"id": "ema", "params": {"length": 20}},
    {"id": "ema", "params": {"length": 50}},
    {"id": "rsi", "params": {"length": 14}}
  ],
  "strategyVersionId": "tm-vsa@1.4.0"
}
```

---

# 34. Execution/Market Simulation Fidelity Levels

To avoid pretending all paper trades are equally realistic, expose a fidelity label.

```text
F0 = candle-only simulation
F1 = quote-aware spread/slippage
F2 = trade-stream + quote-aware
F3 = depth-aware orderbook simulation
F4 = broker-specific demo reconciliation
```

Terminal must show the active fidelity.

Example:

```text
PAPER · F2 · BINANCE FUTURES
```

A result should never be interpreted as more precise than its fidelity level.

---

# 35. Data Quality Gates

## 35.1 Block conditions

New paper entries should be blocked when:

```text
market stream disconnected
quote stale > threshold
candle gap unresolved
orderbook sequence invalid for depth-dependent fill
instrument not active
risk state unavailable
```

## 35.2 Degraded conditions

May continue if policy allows:

```text
funding stale
OI delayed
news unavailable
secondary provider unavailable
```

The terminal must display degraded status.

---

# 36. Cross-Exchange Scanner

Use canonical instruments to compare venues.

For example:

```text
BTC/USDT PERP
Binance 120,100
Bybit   120,115
OKX     120,108
```

Compute:

```text
absolute spread
relative spread
latency
funding difference
OI difference
```

Do not present the spread as a guaranteed executable arbitrage opportunity.

Use it as market context and data-quality information.

---

# 37. Market Intelligence Integration

Existing modules should feed the terminal rather than require a separate dashboard.

## 37.1 Funding

Show:

```text
current funding
next funding time
recent percentile
crowding state
```

## 37.2 OI

Show:

```text
OI
OI change
price/OI relationship
```

## 37.3 Liquidation

Show:

```text
recent liquidation events
cluster zones
actual vs estimated
```

Estimated data must stay explicitly labeled `estimated`.

## 37.4 News

Show event markers with:

```text
source
publishedAt
impact
symbol relevance
```

---

# 38. Performance Architecture

## P0

Single Node process is acceptable for development and early live-paper usage.

## P1

Split into workers:

```text
market-worker
indicator-worker
simulation-worker
services-worker
api-gateway
```

Communicate through Redis or a message broker only when load requires it.

## P2

Scale by:

```text
venue
asset class
symbol shard
```

Never scale by duplicating authoritative position state.

---

# 39. Redis Usage

Redis is for hot state/event fanout, not authoritative long-term trade history.

Suggested keys:

```text
market:quote:<venue>:<instrument>
market:candle:<venue>:<instrument>:<tf>
market:orderbook:<venue>:<instrument>
market:health:<venue>
indicator:<version>:<instrument>:<tf>
paper:account:<id>
paper:position:<id>
```

Channels:

```text
market.events
indicator.events
signal.events
paper.events
risk.events
notification.events
```

---

# 40. Observability

## 40.1 Provider health

Track:

```text
connection
last event
latency
reconnect count
sequence gaps
dropped events
subscription count
```

## 40.2 Indicator health

Track:

```text
last update
warmup status
calculation latency
errors
```

## 40.3 Simulator health

Track:

```text
order latency
fills
rejections
stale-data blocks
position state consistency
```

## 40.4 End-to-end latency

```text
exchange event
    ↓
adapter receive
    ↓
normalizer
    ↓
indicator
    ↓
signal
    ↓
risk
    ↓
simulator
    ↓
UI
```

Persist metrics for performance analysis.

---

# 41. Security

Never put exchange/broker secret credentials in browser code.

Current V3 can operate entirely on public market data + paper accounts.

When demo account credentials are later added:

```text
Browser
  ↓
TM server
  ↓
encrypted secret store
  ↓
provider/broker
```

Require:

- explicit account binding
- least privilege
- audit log
- secret rotation
- no secrets in logs
- no secrets in URLs

---

# 42. Testing Strategy V3

## 42.1 Unit tests

Every adapter:

```text
fixture raw event
→ expected canonical event
```

Every indicator:

```text
fixture bars
→ expected values/events
```

Every fill model:

```text
market events
→ expected fill
```

## 42.2 Golden tests

Continue Pine/native parity where Pine is the reference.

## 42.3 Property tests

Useful invariants:

```text
OHLCV validity
no negative volume
position quantity never negative
closed position cannot receive new fills
PnL conservation
fee >= 0
order state transitions legal
```

## 42.4 Integration tests

```text
provider → normalizer → candle
provider → orderbook
market → indicator
indicator → signal
signal → risk
risk → simulator
simulator → position
position → journal
```

## 42.5 Replay determinism

Same event dataset + same strategy version + same simulator version must produce the same result.

```text
run A resultHash === run B resultHash
```

unless nondeterminism is explicitly part of the experiment.

---

# 43. Current Project Structure V3

```text
tm-trading/
├── README.md
├── package.json
├── .env.example
│
├── app/
│   ├── pages/
│   │   ├── index.vue
│   │   ├── trade.vue
│   │   ├── replay.vue
│   │   ├── signals.vue
│   │   ├── positions.vue
│   │   ├── journal.vue
│   │   ├── research/
│   │   └── runs/
│   ├── components/trading/
│   ├── composables/
│   └── stores/
│
├── market/
│   ├── adapters/
│   │   ├── binance/
│   │   ├── bybit/
│   │   ├── okx/
│   │   ├── coinbase/
│   │   ├── kraken/
│   │   ├── ccxt/
│   │   ├── twelve-data/
│   │   └── mt5/
│   ├── contracts/
│   ├── catalog/
│   ├── connection-manager.mjs
│   ├── subscription-manager.mjs
│   ├── normalizer.mjs
│   ├── quality.mjs
│   ├── recorder.mjs
│   ├── event-bus.mjs
│   ├── quote-store.mjs
│   ├── orderbook-store.mjs
│   ├── candle-builder.mjs
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
│   ├── snapshot.mjs
│   └── store.mjs
│
├── simulation/
│   ├── clock.mjs
│   ├── order.mjs
│   ├── fill-model.mjs
│   ├── fee-model.mjs
│   ├── spread-model.mjs
│   ├── latency-model.mjs
│   ├── account.mjs
│   ├── position.mjs
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
│   ├── confluence.mjs
│   └── heartbeat.mjs
│
├── ai/
│   ├── gateway.mjs
│   ├── agent.mjs
│   ├── research.mjs
│   ├── proposal.mjs
│   ├── experiment.mjs
│   └── prompts/
│
├── server/
│   ├── api/v1/
│   ├── websocket/
│   ├── webhook.mjs
│   └── middleware/
│
├── tools/
├── tests/
├── docs/
│   ├── data-model.md
│   ├── market-data-contract.md
│   ├── provider-contract.md
│   ├── instrument-catalog.md
│   ├── indicator-contract.md
│   ├── indicator-parity.md
│   ├── simulation-contract.md
│   ├── fill-model.md
│   ├── replay-contract.md
│   ├── strategy-versioning.md
│   ├── research-contract.md
│   └── alert-schema.md
│
├── data/
│   ├── cache/
│   ├── recordings/
│   └── research/
├── reports/
├── logs/
├── backups/
└── private/
```

Do not move working modules purely for visual symmetry. Refactor only where it improves boundary clarity and tests remain green.

---

# 44. CLI / Developer Commands

Recommended additions:

```bash
npm run market:once
npm run market:watch
npm run market:status
npm run market:catalog
npm run indicator:test
npm run indicator:parity
npm run terminal:dev
npm run paper:watch
npm run paper:status
npm run replay:create
npm run replay:run
npm run replay:test
npm run research:once
npm run experiment:create
npm run experiment:run
npm run experiment:report
npm run verify
npm test
```

No command should secretly connect to real-money accounts.

---

# 45. Roadmap V3

## Phase 1 — Structure — ✅ carry forward

No rewrite.

## Phase 2 — Engine parity — ✅ carry forward

No rewrite.

## Phase 3 — Data contracts/version/idempotency — ✅ carry forward

No rewrite.

## Phase 4 — Data + Backtester — ✅ carry forward

No rewrite.

## Phase 5 — Validation / Optimizer — 🔄 continue

Priority:

1. baseline random
2. symbol holdout
3. min trade thresholds
4. walk-forward
5. overfit filters
6. cache by params/data hash
7. regime-aware preset later

**Important:** Phase 5 no longer blocks the new realtime terminal. It runs in parallel.

Acceptance:

```text
baseline vs candidate
+ holdout evidence
+ reproducible hashes
```

---

# Phase 6 — Live loop + Risk + Paper — ✅ carry forward / refactor only

Existing Risk Gate remains the only order gate.

Refactor:

```text
exec/paper.mjs
        ↓
simulation/simulator.mjs
```

`exec/paper.mjs` remains a compatibility facade until all callers migrate.

Acceptance stays green before switching the default paper path.

---

# Phase 7 — Dashboard — ✅ carry forward

Existing routes remain:

```text
/
/runs
/runs/[id]
/runs/compare
/signals
```

Add a central terminal entry:

```text
/trade
```

---

# Phase 7A — Instrument Catalog + Provider Layer 🔒

## Goal

Support many venues without leaking venue-specific symbols into the engine/UI.

## Tasks

- create canonical `Instrument` model
- create `instrument_mappings`
- build Binance catalog adapter
- build Bybit catalog adapter
- build OKX catalog adapter
- add source health
- add active/delisted state
- add tick size / lot size / contract metadata
- create `market_sources` configuration
- build catalog refresh job

## Acceptance

```text
BTC/USDT canonical instrument
→ Binance mapping
→ Bybit mapping
→ OKX mapping
```

and all three can coexist without changing chart/indicator code.

---

# Phase 7B — Realtime Market Plane 🔒

## P0 providers

```text
Binance
Bybit
OKX
```

## P1 providers

```text
Coinbase
Kraken
CCXT long-tail
```

## Cross-asset/reference

```text
Twelve Data
```

## Gold

```text
MT5/broker source first for execution-oriented simulation
Twelve Data/reference source as secondary
```

## Tasks

- adapter contract
- connection manager
- subscription manager
- canonical events
- heartbeat
- reconnect
- snapshot recovery
- sequence validation
- candle builder
- quote store
- orderbook store
- trade tape store
- funding/OI store
- source health
- latency monitoring

## Acceptance

At minimum:

```text
BTCUSDT Binance realtime
BTCUSDT Bybit realtime
BTC-USDT-SWAP OKX realtime
```

must:

- connect
- reconnect
- resubscribe
- produce canonical events
- avoid duplicate state
- recover from sequence gaps
- show source latency

---

# Phase 7C — Native Indicator Engine 🔒

## P0

```text
SMA
EMA
RMA
ATR
RSI
VWAP
Volume MA
```

## P1

```text
MACD
Bollinger
ADX/DMI
OBV
CMF
Donchian
```

## TM-native

Port/implement the current TM methods and indicator semantics:

```text
VSA
Wyckoff
BOS/CHoCH
FVG
Liquidity Sweep
Order Block
Orderflow
Funding/OI
Regime
Confluence
```

## Tasks

- registry
- parameter schema
- warmup contract
- batch mode
- incremental mode
- versioning
- golden fixtures
- parity tests for existing Pine-backed logic
- indicator latency measurement

## Acceptance

```text
same data
same params
same version
→ same result
```

between:

```text
backtest
live
replay
```

---

# Phase 7D — Realtime Chart + Trading Terminal 🔒

Route:

```text
/trade
```

Build in this order:

1. header/status
2. instrument picker
3. watchlist
4. candles
5. timeframe switch
6. native indicators
7. signal overlay
8. orderbook
9. trade tape
10. trade ticket
11. position panel
12. risk panel
13. workspace persistence

Acceptance:

```text
open BTC
→ chart updates continuously
→ change TF
→ toggle indicator
→ indicator updates
→ signal appears
→ entry/SL/TP displayed
```

No full page reload during realtime changes.

---

# Phase 7E — Live Paper Simulator 🔒

## Goal

Create the central user experience:

```text
REAL MARKET
→ USER DECISION
→ RISK
→ PAPER FILL
→ POSITION
→ PNL
```

## Tasks

- simulator core
- market order
- limit
- stop
- partial fill
- spread
- slippage
- fee
- latency
- SL/TP
- partial close
- account state
- realtime PnL
- restart recovery
- position reconciliation

## Acceptance

A user can:

```text
select BTCUSDT.P
place paper LONG
see fill
see position
see PnL move with live market
set SL/TP
hit SL/TP
close position
see journal row
```

without any real-money order path.

---

# Phase 7F — Market Recorder + Dataset Lineage 🔒

## Goal

Make every meaningful decision reproducible.

## Tasks

- recording metadata
- schema version
- source version
- source health
- raw/normalized lineage
- snapshot hash
- retention policy
- parquet/compact recording path
- replay reader

Acceptance:

```text
paper trade #100
→ snapshot available
→ indicator state identifiable
→ strategy version identifiable
→ source identifiable
→ replay context reconstructable
```

---

# Phase 7G — Replay / Training 🔒

## Goal

Historical practice with the exact same simulator semantics.

## Tasks

- replay clock
- event player
- future-data firewall
- chart playback
- paper account
- challenge mode
- journal integration

Acceptance:

```text
replay run A
=== replay run B
```

for the same version/data/hash and starting state.

---

# Phase 7H — Terminal Intel Integration

Move existing Phase 8/9 intelligence into `/trade`:

```text
funding
OI
liquidation
regime
news
flow
accumulation
```

Acceptance:

```text
selected symbol
→ terminal context panel
→ no need to navigate to another dashboard for core trade context
```

---

# Phase 8 — Market Intelligence — ✅ carry forward + terminal integration

Existing services continue.

New work:

- data quality tags
- direct symbol linking via canonical instrument ID
- terminal overlays
- source health

---

# Phase 9 — Regime & Derivatives — ✅ carry forward + terminal integration

Existing:

```text
altseason
BTC.D
Fear & Greed
funding
OI
liquidation
```

Add:

- live regime badge
- OI/funding panel
- liquidation overlay
- estimated-vs-actual label

---

# Phase 10 — Methods + Confluence UI

Existing methods remain.

New:

- visual markers
- method event inspector
- confluence explanation
- signal replay
- method toggle per chart

Acceptance:

Every signal has:

```text
method
version
reasons
score
snapshot
```

---

# Phase 11 — AI Research Copilot

## Replace generic “AI trade idea” emphasis with research loop

Tabs:

```text
ANALYZE
EXPERIMENT
COMPARE
REVIEW
```

AI can:

- summarize a strategy
- explain losing clusters
- identify regime dependency
- compare versions
- analyze execution quality
- propose experiments

AI cannot:

- silently modify strategy
- silently enable a new version
- bypass Risk Gate
- create a real order path

Acceptance:

```text
trade dataset
→ AI research result
→ structured proposal
→ experiment
```

---

# Phase 12 — Demo Broker / Exchange Integration

Only after Live Paper is stable.

## XAU / FX

```text
MT5 Demo
```

## Crypto

Where supported by venue test/demo environments, add demo account reconciliation.

Acceptance:

```text
local intent
↔ risk gate
↔ demo order
↔ external position
↔ local position
```

If reconciliation fails, stop new entries.

---

# Phase 13 — Journal + Feedback Loop

Existing journal remains.

Add:

```text
trade_context
experiment links
strategy version links
market-quality metrics
execution-quality metrics
```

AI review can detect:

```text
entry too late
bad regime
bad RR
high spread
high latency
slippage
method weakness
symbol weakness
TF weakness
```

Output is research evidence, not automatic deployment.

---

# 46. Milestones

## M1 — Realtime data stable

```text
Binance + Bybit + OKX
instrument catalog
canonical events
health/reconnect
```

## M2 — Native chart engine stable

```text
candles
indicators
signals
overlays
```

## M3 — Live paper stable

```text
paper orders
fills
positions
PnL
risk
```

## M4 — Replay stable

```text
same indicator/method/simulation core
no future leakage
```

## M5 — Research loop stable

```text
journal
AI analysis
experiment
backtest
holdout
new version
```

## M6 — Demo connectivity

Only after M1–M5 are stable.

---

# 47. Definition of Done — Realtime Trading Simulator

The milestone is complete only when this end-to-end flow works:

```text
1. Choose instrument
2. Choose venue
3. Receive realtime data
4. Build/update candles
5. Change timeframe
6. Enable TM indicator
7. Indicator updates in realtime
8. Method generates event
9. Trade plan appears
10. Risk Gate evaluates
11. User submits paper order
12. Simulator fills using selected fidelity
13. Position appears realtime
14. PnL updates with market
15. SL/TP works
16. Position closes
17. Journal stores complete context
18. Reload restores state
19. Backend restart does not duplicate orders
20. Same dataset can be replayed deterministically
21. AI can analyze the trade/context
22. AI can create a proposal
23. Proposal becomes an experiment
24. Experiment produces reproducible backtest/holdout output
25. New strategy version can return to paper validation
```

---

# 48. Data Provider Implementation Rules for AI Coding

AI coding must follow these rules.

## Rule 1 — Never hard-code exchange symbols in engine logic

Wrong:

```ts
if (symbol === 'BTCUSDT') ...
```

Correct:

```ts
instrumentId === 'crypto:perp:BTC/USDT'
```

## Rule 2 — Exchange-specific quirks stay in adapters

Wrong:

```ts
if (source === 'bybit') ...
```

inside indicator/simulation logic.

Correct:

```text
market/adapters/bybit/
```

converts into the canonical contract first.

## Rule 3 — Native providers first for venue-specific execution simulation

Use Binance native for Binance paper simulation, Bybit native for Bybit, OKX native for OKX.

## Rule 4 — CCXT is coverage, not the canonical semantic model

Do not expose raw CCXT objects to the rest of the project.

## Rule 5 — Every adapter requires fixtures

For each provider:

```text
raw message
expected normalized event
expected state update
```

## Rule 6 — Reconnection must be tested

A provider is not “implemented” until:

```text
connect
↓
receive
↓
disconnect
↓
reconnect
↓
resubscribe
↓
state recover
```

passes integration tests.

## Rule 7 — Data source must be visible in UI

Example:

```text
BTCUSDT.P · Binance · LIVE · 42ms
```

not just:

```text
BTCUSDT.P · LIVE
```

## Rule 8 — Never hide degraded data

If a source is delayed or reconstructed:

```text
DEGRADED
```

must be visible.

---

# 49. Provider Documentation Baseline

Use official provider documentation as the adapter implementation reference.

### Binance

Official WebSocket documentation:

```text
https://developers.binance.com/
```

### Bybit

WebSocket V5:

```text
https://bybit-exchange.github.io/docs/v5/ws/connect
https://bybit-exchange.github.io/docs/v5/websocket/public/kline
https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
https://bybit-exchange.github.io/docs/v5/websocket/public/trade
```

Bybit's official docs explicitly distinguish forming vs confirmed kline state (`confirm`) and describe snapshot/delta orderbook handling. citeturn689979search10turn689979search4

### OKX

```text
https://www.okx.com/docs-v5/en/
```

Use native WebSocket and instrument channels where possible. OKX documents realtime market channels, instrument updates, candlesticks, trades and multiple orderbook tiers. citeturn471653search0turn471653search1turn471653search4

### CCXT

```text
https://docs.ccxt.com/docs/
https://docs.ccxt.com/docs/pro
```

Current documentation lists over one hundred exchange integrations on the unified side and a large WebSocket-enabled subset via the Pro layer; treat these numbers as changing runtime coverage, not permanent constants. citeturn689979search8turn689979search0

### Twelve Data

```text
https://support.twelvedata.com/
```

Use it as a multi-asset reference/coverage provider. Its current documentation describes realtime WebSocket streaming and broad multi-asset coverage. citeturn471653search5turn471653search6

### MetaTrader 5

Use broker/terminal documentation and the exact broker's symbol specification when XAU/FX demo simulation requires broker-specific behavior.

---

# 50. Migration Plan From V2 → V3

Do not rewrite everything.

## Step 1

Keep all current tests green.

```bash
npm test
npm run typecheck
npm run verify
```

## Step 2

Introduce canonical contracts without changing existing consumers.

```text
market/contracts
```

Add adapters around existing Binance data code.

## Step 3

Move current Binance data logic behind:

```text
BinanceMarketAdapter
```

Keep `engine/data.mjs` as a compatibility layer until consumers migrate.

## Step 4

Add:

```text
Instrument Catalog
Market Event Bus
Connection Manager
```

## Step 5

Implement native Indicator Registry.

Initially wrap/reuse existing TA functions wherever possible.

Do not duplicate math.

## Step 6

Implement `/trade` with **read-only realtime mode first**.

No paper orders yet.

## Step 7

Refactor `exec/paper.mjs` onto `simulation/`.

## Step 8

Enable live-paper ticket.

## Step 9

Add recorder and replay.

## Step 10

Add AI research/experiments.

## Step 11

Add additional venues.

## Step 12

Only later add demo broker/exchange integrations.

---

# 51. First Implementation Sprint

AI coding should NOT attempt all of V3 in one pass.

Sprint 1:

```text
[ ] market/contracts
[ ] Instrument model
[ ] Binance adapter wrapper
[ ] Bybit adapter
[ ] OKX adapter
[ ] connection manager
[ ] normalized quote/trade/candle events
[ ] market health
[ ] tests/fixtures
```

Sprint 2:

```text
[ ] candle builder
[ ] quote store
[ ] orderbook store
[ ] market clock
[ ] websocket server
[ ] terminal market composables
```

Sprint 3:

```text
[ ] indicator registry
[ ] EMA/SMA/RMA/ATR/RSI/VWAP
[ ] incremental update
[ ] indicator tests
[ ] chart overlays
```

Sprint 4:

```text
[ ] /trade
[ ] watchlist
[ ] chart
[ ] orderbook
[ ] trade tape
[ ] signal overlay
```

Sprint 5:

```text
[ ] simulation core
[ ] fill model
[ ] paper orders
[ ] positions
[ ] PnL
[ ] risk integration
```

Sprint 6:

```text
[ ] recorder
[ ] replay clock
[ ] replay UI
[ ] deterministic replay tests
```

Sprint 7:

```text
[ ] AI research context
[ ] trade dataset
[ ] experiment proposal
[ ] experiment runner
[ ] comparison UI
```

---

# 52. AI Coding Rules

When an AI coding agent receives this roadmap, it must:

1. Read existing implementation before creating a replacement.
2. Preserve current public contracts unless a migration plan exists.
3. Reuse `engine/ta.mjs` instead of reimplementing the same math.
4. Reuse `exec/risk.mjs` as the only order gate.
5. Keep exchange quirks inside adapters.
6. Keep provider payloads out of the UI.
7. Keep authoritative state on the server/engine.
8. Add tests before large refactors where practical.
9. Update docs/contracts when changing schemas.
10. Run `npm test`, `npm run typecheck`, `npm run verify` after each milestone.
11. Never add a hidden real-money execution path.
12. Never let AI directly mutate a live strategy version.
13. Never use current wall-clock time inside deterministic historical calculations.
14. Never silently repair or invent missing market data.
15. Label estimated/degraded/reconstructed data.
16. Version simulation/fill behavior whenever semantics change.
17. Keep migration code until old callers are fully migrated and tests prove parity.
18. Prefer small composable modules over a giant `market.mjs` or `trading.mjs` file.

---

# 53. Final Architecture Principle

The final TM Trading system should behave like this:

```text
                         ┌───────────────────┐
                         │   REAL MARKETS    │
                         └─────────┬─────────┘
                                   │
                            Multi-source data
                                   │
                         ┌─────────▼─────────┐
                         │   MARKET CORE     │
                         │ catalog + events  │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ INDICATOR ENGINE  │
                         │ native + versioned│
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ METHOD / SIGNAL   │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │    RISK GATE      │
                         └─────────┬─────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       SIMULATION CORE       │
                    │ live-paper / replay        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ POSITION / PNL / JOURNAL    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       AI RESEARCH            │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ EXPERIMENT / BACKTEST /     │
                    │ HOLDOUT / NEW VERSION      │
                    └──────────────┬──────────────┘
                                   │
                                   └──────→ PAPER
```

The product is therefore not just “a chart with indicators”.

It is a **closed-loop trading research and simulation system** where:

```text
market data
   → analysis
   → decision
   → simulated execution
   → measurement
   → research
   → validation
   → improved version
```

The single most important rule is:

> **One market core, one indicator core, one signal contract, one risk gate, one simulation/fill model, one position/journal model — reused across backtest, live analysis, live paper and replay.**

---

# 54. V3 Completion Checklist

## Market

- [ ] canonical instrument catalog
- [ ] Binance adapter
- [ ] Bybit adapter
- [ ] OKX adapter
- [ ] CCXT coverage adapter
- [ ] Twelve Data reference adapter
- [ ] MT5/broker reference adapter
- [ ] connection manager
- [ ] subscription manager
- [ ] normalized events
- [ ] market quality
- [ ] recorder

## Indicator

- [ ] registry
- [ ] versioning
- [ ] warmup
- [ ] incremental state
- [ ] base TA
- [ ] trading-native indicators
- [ ] parity fixtures

## Terminal

- [ ] `/trade`
- [ ] watchlist
- [ ] chart
- [ ] orderbook
- [ ] trade tape
- [ ] indicator panel
- [ ] signal panel
- [ ] trade ticket
- [ ] position panel
- [ ] risk panel
- [ ] workspace persistence

## Simulation

- [ ] market order
- [ ] limit
- [ ] stop
- [ ] spread
- [ ] slippage
- [ ] fees
- [ ] latency
- [ ] partial fills
- [ ] TP/SL
- [ ] account state
- [ ] position state
- [ ] deterministic replay

## Research

- [ ] trade context
- [ ] AI research
- [ ] proposal model
- [ ] experiment runner
- [ ] baseline
- [ ] holdout
- [ ] comparison
- [ ] version lifecycle

## Safety / Quality

- [ ] Risk Gate remains mandatory
- [ ] no browser-authoritative positions
- [ ] no future leakage
- [ ] no hidden real-money path
- [ ] provider degradation visible
- [ ] replay deterministic
- [ ] full test suite green

---

# 55. Reference Sources

These are implementation references, not the application data contract itself.

- Binance developer documentation: https://developers.binance.com/
- Bybit V5 WebSocket: https://bybit-exchange.github.io/docs/v5/ws/connect
- Bybit public kline: https://bybit-exchange.github.io/docs/v5/websocket/public/kline
- Bybit public orderbook: https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook
- Bybit public trades: https://bybit-exchange.github.io/docs/v5/websocket/public/trade
- OKX V5 API: https://www.okx.com/docs-v5/en/
- CCXT: https://docs.ccxt.com/docs/
- CCXT WebSocket/Pro: https://docs.ccxt.com/docs/pro
- Twelve Data: https://support.twelvedata.com/
- MetaTrader 5 / MQL5 documentation: https://www.mql5.com/en/docs

Provider capabilities and limits can change. Adapter implementations must be validated against the provider's current official documentation during development.

---

# 56. Status Note

This document is the **V3 implementation roadmap/specification** derived from the previous TM Trading roadmap and the current product direction.

It intentionally does not claim that every V3 phase is already implemented.

When implementation progresses, update this file with:

```text
status
completion date
tests
acceptance evidence
known limitations
migration notes
```

Do not remove historical design decisions without recording why they changed.

---

# 57. UI Navigation, Strategy Lab, Test Center, Data Center & AI Research — Implementation Addendum

> **Status:** Addendum to Roadmap V3, added 2026-10-11.  
> **Purpose:** Turn the V3 architecture into a concrete, navigable product specification so coding agents can implement the menus, page responsibilities, route contracts, data lineage, and end-to-end testing workflow.  
> **Authority:** This addendum supplements V3; it does not replace existing architecture, phases, contracts, or completed work. Existing routes and behavior must remain compatible unless an explicit migration is implemented and tested.

## 57.1 Product requirement

TM Trading must support three connected capabilities:

1. **Manage reusable indicators and strategies.** An indicator is a reusable calculation/output module; a strategy combines indicators, methods, entry/exit conditions, parameters, timeframes and risk settings; a bot profile defines how a strategy is run; a bot instance is one concrete running or completed execution/test session.
2. **Run repeatable tests over historical and realtime data.** Historical backtest, historical replay and realtime forward paper test must be selectable from one Test Center. They must share the same semantic indicator/method/signal/risk/fill contracts wherever their mode semantics apply.
3. **Manage the evidence used for analysis and improvement.** Every test run links to its immutable strategy/indicator versions, parameters, dataset or realtime recording, data-quality report, execution/simulation version and resulting trades. AI must use these links to analyze results and create proposals/experiments without silently mutating the active strategy.

This product is simulation-first. This UI must not introduce a real-money execution path. `LIVE_PAPER` means real market data with local simulated orders; it is not live exchange execution.

## 57.2 Navigation design principles

- Navigation is organized around user workflows, not source-code folders or backend services.
- Keep the sidebar compact through collapsible groups. Do not place every indicator, timeframe, order type or chart panel as a navigation item.
- `/trade` is the primary realtime workspace. Chart panels such as orderbook, trade tape, indicators, funding/OI, signals, trade ticket, positions and risk belong inside the terminal as panels/tabs/drawers, not separate sidebar entries.
- Strategy Lab defines reusable configuration; Test Center runs and evaluates it; Data Center manages input data/recordings and traceability; AI Research interprets evidence and proposes experiments.
- Reuse existing pages/routes, notably `/`, `/runs`, `/runs/[id]`, `/runs/compare`, `/signals`, `/trade`, `/replay`, `/positions`, `/journal`, `/research`. Do not create a second page that duplicates an existing workflow just because the menu is being reorganized.
- Existing routes must remain working. If a route is renamed, add a redirect/compatibility layer and regression tests; prefer not to rename established routes.
- TM Trading already inherits authentication/navigation conventions from TM Hub. Use the existing hub route/menu mechanism and app identity. Do not invent a separate auth/RBAC system for this addendum.
- A menu item must be hidden or shown as “Coming soon” according to the existing product convention when its page is not implemented. Do not publish active-looking links to 404 pages.
- Labels must use the project's existing i18n pattern for Vietnamese and English. Avoid hard-coded labels in Vue pages if current navigation uses translation keys.

## 57.3 Target sidebar menu

Use this as the **target information architecture**. Implement it incrementally; only expose active routes that exist and pass tests.

```text
TM TRADING

1. Tổng quan                                  /

2. Thị trường                                [group]
   ├─ Khám phá thị trường                    /markets
   ├─ Scanner                                /scanner
   ├─ Market Intelligence                    /intel
   └─ Lịch kinh tế & tin tức                 /calendar        (optional; only if data source is ready)

3. Giao dịch                                 [group]
   ├─ Trading Terminal                       /trade
   ├─ Tín hiệu                                /signals
   ├─ Paper Account                          /paper           (new overview; optional if folded into /positions initially)
   ├─ Orders                                 /orders          (new)
   └─ Positions                              /positions

4. Strategy Lab                              [group]
   ├─ Strategy Library                       /strategies
   ├─ Indicator Library                      /indicators
   ├─ Methods & Confluence                   /methods
   ├─ Bot Profiles                           /bots
   └─ Bot Instances                          /bots/instances

5. Test Center                               [group]
   ├─ New Test                                /lab/new
   ├─ Backtest Runs                           /runs            (reuse existing route)
   ├─ Live Forward Tests                      /forward-tests   (new)
   ├─ Replay & Training                       /replay          (reuse existing route)
   └─ Compare & Validation                    /runs/compare    (reuse existing route)

6. Data & Research                           [group]
   ├─ Data Center                             /data
   │  ├─ Datasets                             /data/datasets
   │  ├─ Market Recordings                    /data/recordings
   │  ├─ Data Quality                         /data/quality
   │  └─ Test Data Lineage                    /data/lineage
   ├─ AI Research                             /research        (reuse existing route)
   ├─ Experiments                             /research/experiments
   └─ Trade Journal                           /journal         (reuse existing route)

7. Cảnh báo                                  [group]
   ├─ Alert Rules                             /alerts          (new, if separated from current alert management)
   └─ Notification History                    /notifications   (new; may initially be a panel)

8. Hệ thống                                  [group]
   ├─ Data Sources                            /system/data-sources
   ├─ Health & Connections                    /health          (reuse existing endpoint/page when present)
   ├─ Logs                                    /logs
   └─ Settings                                /settings
```

### Menu grouping notes

- If 8 groups feel too large in the current sidebar, **Data & Research** can remain one collapsible group, as specified above. Do not flatten its children into the top-level sidebar.
- `Backtest Runs`, `Compare & Validation`, `Replay & Training`, `Signals`, `Positions`, `Journal` already have or are expected to have corresponding route foundations in V3. Reuse those; do not recreate their core logic.
- `Paper Account` may initially route to `/positions` with a paper-account tab/query; create a separate `/paper` page only if it adds a true account-level view (balance, equity, exposure, open PnL, realized PnL, risk status).
- `Alert Rules` and `Notification History` are secondary to the core simulator. If not implemented yet, keep the existing Telegram/webhook behavior and do not block the Terminal/Strategy Lab work on these pages.
- Market-specific contextual information should open the selected canonical instrument in `/trade`, preserving instrument and venue context in route/query state.

## 57.4 Route responsibilities and acceptance requirements

### A. `/` — Overview

Purpose: One-page operational summary, not another charting screen.

Show:
- provider/market health and stale-data warnings;
- active bot instances grouped by mode/status;
- recent backtest and forward-test runs;
- paper account equity, open positions, daily simulated PnL and risk status;
- latest alerts/notifications;
- last AI research/experiment status when available.

Requirements:
- All KPIs must be calculated from existing server-side domain services/engine summaries, not recomputed with separate frontend business logic.
- Distinguish historical backtest metrics from live-paper metrics.
- Clearly label “no data”, “stale”, “degraded”, “halted” and “not implemented”; do not turn missing information into zero or green/healthy status.

### B. `/markets` — Market Explorer

Purpose: Search and discover canonical instruments across supported venues.

Must support:
- search by canonical instrument, native symbol, base/quote, asset class, venue and market type;
- filters for Spot, Perpetual, Futures, Metal/FX/reference instruments where available;
- active/suspended/delisted status;
- data availability and current provider health;
- open the selected instrument directly in `/trade` with instrument ID and venue selection preserved.

Do not create a second independent symbol list. This page must consume the Instrument Catalog API.

### C. `/trade` — Trading Terminal

Purpose: Main user workspace for real market observation and local paper simulation.

Primary regions:
- top bar: canonical instrument, venue/feed, market type, timeframe, live/stale status, exchange/provider timestamp and receive-time/latency indicator;
- watchlist;
- chart and timeframe controls;
- indicator/overlay controls;
- signal and method markers;
- orderbook and recent trade tape where feed supports them;
- optional funding/OI/liquidation/regime/news context panels;
- trade ticket for paper-only intents;
- bottom tabs/panels for Orders, Positions, Signals, Risk and Journal.

UI actions express intent only. Server/engine owns authoritative order, position, risk and PnL state. All order intents must pass through the existing `exec/risk.mjs` gate before reaching the simulation engine. Real-money order controls must not exist in V3.

Acceptance:
- selecting instrument/timeframe does not require a full page reload;
- chart uses canonical market data and shared native Indicator Engine;
- stale/gapped/sequence-invalid data is visibly marked and can block new paper entries according to policy;
- paper orders, position updates and PnL update from server state;
- refresh/restart restores authoritative open paper positions without duplicate orders.

### D. `/indicators` — Indicator Library

Purpose: Manage reusable native indicators independently from strategies.

List/detail fields:
- indicator ID and display name;
- category (trend, momentum, volatility, volume/orderflow, structure, market context/custom);
- implementation version and status (draft, validated, deprecated);
- parameter schema and defaults;
- required inputs/warmup bars;
- outputs (series/events/markers/levels);
- supported timeframes/data capabilities;
- incremental-update support;
- test/fixture status and documentation;
- strategies and test runs that reference this indicator.

Actions:
- inspect details and sample output;
- create/configure a reusable parameter preset when the implementation permits it;
- run indicator fixture/parity validation;
- view dependent strategies;
- deprecate an old version without deleting its historical references.

Important:
- Do not allow arbitrary UI-authored JavaScript to execute inside the engine.
- Indicator implementation code is versioned and deployed as code; user profiles store configuration, not executable source blobs.
- A strategy/run referencing an indicator version must continue to resolve that immutable version.

### E. `/strategies` — Strategy Library

Purpose: Store reusable strategy definitions and immutable versions.

A strategy definition may compose:
- one or more indicator instances and parameters;
- existing `engine/methods/` plugins;
- entry, exit, confirmation and invalidation conditions;
- trigger policy (`CLOSE_ONLY`, `INTRABAR`, or `CLOSE_AND_INTRABAR` where supported);
- timeframe and multi-timeframe requirements;
- SL/TP/trailing/timeout policies;
- risk profile reference;
- symbol/venue constraints;
- strategy version, params hash, engine compatibility and status.

Recommended detail tabs:
- Overview;
- Components (indicators/methods);
- Rules (entry/exit/invalidation);
- Parameters;
- Versions;
- Test History;
- Live Paper Deployments;
- Research/Experiments.

Actions:
- create from template/existing strategy;
- clone to a new draft;
- create an immutable version;
- validate configuration/schema;
- run test through Test Center;
- compare versions;
- deprecate or disable a version.

Never mutate the parameter/config version that already produced historical runs. A change creates a new immutable version.

### F. `/methods` — Methods & Confluence

Purpose: Explain and manage the existing method registry; do not duplicate the Strategy Library.

Show VSA/Wyckoff, price action, trend/pullback, orderflow and other registered methods with:
- method version;
- inputs/parameters;
- emitted events/scores/reasons;
- fixture status;
- supported modes;
- strategy dependencies;
- historical test evidence.

Confluence is a method-composition/analysis feature, not an order instruction by itself. The UI must show contributing components/reasons rather than only one opaque aggregate score.

### G. `/bots` — Bot Profiles

Purpose: Configure reusable bot execution profiles. A bot profile references a strategy version; it does not copy the strategy code.

Profile fields:
- profile ID/name/description;
- exact immutable strategy version;
- default mode (`BACKTEST`, `REPLAY`, `LIVE_ANALYSIS`, `LIVE_PAPER`);
- one or more canonical instruments/venue mappings;
- timeframe(s);
- parameter override only when explicitly permitted, resulting in a unique effective config/hash;
- risk profile, simulated account, maximum concurrent positions and session rules;
- market-data requirements and trigger policy;
- notification policy;
- enabled/disabled status.

A profile is not itself a running bot. Actual runs create bot instances/session records.

### H. `/bots/instances` — Bot Instances

Purpose: Observe actual running or completed bot/test sessions.

Each instance/session must display:
- bot profile and exact strategy/version/hash;
- mode and dataset/live source;
- instrument(s), timeframe(s);
- start/stop times;
- lifecycle state: `queued`, `starting`, `running`, `paused`, `stopping`, `completed`, `failed`, `halted`;
- last processed market event/bar time and event lag;
- generated signals/orders/trades counts;
- paper equity/PnL and risk state when relevant;
- last error and health state.

Actions allowed by state:
- start;
- pause/resume where semantically safe;
- request graceful stop;
- open corresponding run/session details;
- view logs and market-data quality.

All lifecycle transitions must be server validated and persisted. Restarting the service must not create duplicate instances/orders. “Stop bot” stops new decision processing according to a documented policy; open simulated positions must follow an explicit, visible close-or-continue policy and never be silently discarded.

### I. `/lab/new` — Test Builder

Purpose: One configuration form to launch historical tests, replay sessions or live forward paper tests.

Required fields:
- test mode: `BACKTEST`, `REPLAY`, `LIVE_ANALYSIS`, `LIVE_PAPER`;
- bot profile or strategy version;
- canonical instrument/venue(s);
- timeframe(s);
- data source/dataset/recording selection;
- date range for historical tests, or start-now/stop condition for realtime forward tests;
- starting simulated balance and risk profile when a paper account is used;
- fee/spread/slippage/latency/fill-model profile;
- trigger policy and bar-state semantics;
- batch matrix options for symbol × timeframe × parameter variants when supported;
- in-sample/validation/holdout configuration for research tests;
- optional notes/tags/experiment parent.

Validation rules:
- reject missing/invalid market data or show an explicit degraded-data override where safely supported;
- verify the requested provider has the requested market type and instrument mapping;
- reject unsupported indicator warmup/TF/data requirements;
- prevent accidental dataset overlap between training and holdout;
- store the effective configuration snapshot and all relevant hashes before run start;
- historical and realtime runs must never be conflated in reports.

After submit, show a run detail/status page, not only a transient toast.

### J. `/runs`, `/runs/[id]`, `/runs/compare` — Historical Test Runs

Preserve the existing routes and existing backtest APIs.

Enhance run list/detail so every run reveals:
- status and failure reason;
- mode/type;
- strategy version, indicator/method versions and effective params hash;
- market data source, dataset/recording ID and `dataHash`;
- instrument × timeframe coverage;
- time window, run timestamp and software versions;
- metrics (trade count, win rate, PF, net PnL, expectancy, max drawdown, median R, fees/slippage and sample-size warnings);
- link to trade list, equity curve, signal timeline, dataset lineage and AI analysis.

Compare must refuse to pool incompatible generations. It may display different versions side by side with visible incompatibility warnings; it must not imply their raw pooled metrics are directly comparable when data/model semantics differ.

### K. `/forward-tests` — Live Forward Tests

Purpose: Manage bots evaluating strategies on the current live market using local paper execution.

The page shows:
- running/paused/stopped sessions;
- data-source state and last processed event/bar;
- elapsed test duration, event count, signal count and paper order count;
- simulated balance/equity/PnL/drawdown;
- open positions and risk status;
- stale/gap/lag indicators;
- comparison to the frozen backtest baseline for the exact same strategy version;
- stop/pause/resume controls according to defined lifecycle policy.

Do not claim a forward test proves profitability. Show sample size and elapsed time, and distinguish realized vs unrealized PnL.

### L. `/replay` — Replay & Training

Purpose: Run historical events on a simulated clock through the same strategy and fill semantics as live paper.

Controls:
- dataset/session selection;
- play/pause/step;
- playback speed;
- start/end range;
- optional challenge mode that hides future candles/events;
- reset/restart from a defined initial state.

Requirements:
- enforce the future-data firewall: no strategy-readable event timestamp can exceed `clock.now()`;
- use the same indicator/method/simulation implementations as applicable;
- repeatable playback from the same dataset hash, strategy version, simulator version and initial account state must produce the same result hash;
- mark approximations when source tick/orderbook data is not available and candle-level fill assumptions are used.

### M. `/data` and Data Center child routes

Data Center is a management/lineage experience, not a raw-tick console.

#### `/data/datasets`

Manage curated datasets with:
- ID/name/tags;
- instruments, venues and timeframe coverage;
- time range and timestamps/clock convention;
- source/provider and market type;
- dataset version/hash;
- candle/tick/orderbook coverage where available;
- data-quality status and known limitations;
- number of linked tests/replays/experiments.

Support creating a dataset manifest from existing cached history or completed recordings. Do not duplicate large data blobs in Mongo when file/object references are appropriate.

#### `/data/recordings`

Manage realtime recording sessions:
- source/venue/provider;
- instrument/subscription set;
- start/end and last event timestamp;
- event types recorded;
- dropped/duplicate/out-of-order counts;
- storage location/format and retention policy;
- record state and errors;
- links to dataset manifests and tests that consumed the recording.

#### `/data/quality`

Report missing candle intervals, gaps, stale periods, timestamp skew, duplicates, sequence gaps, provider disconnects and incomplete data. Quality state must be explicit: `valid`, `degraded`, or `invalid`, with reasons.

#### `/data/lineage`

Trace any run/trade/experiment through:

```text
trade / signal
→ bot instance
→ strategy version + effective params hash
→ indicator/method versions
→ dataset or recording ID + data hash
→ provider and venue mapping
→ engine/simulator/fill-model versions
→ result/metrics
```

Every link must be queryable, not only included as unstructured text.

### N. `/research` and `/research/experiments` — AI Research

Research workspace must consume selected, versioned evidence rather than arbitrary unscoped collections.

Core views:
- Analyze: analyze a strategy/run/dataset/trade cluster;
- Proposals: structured improvement hypotheses with supporting evidence and limitations;
- Experiments: create/run/compare proposed variants;
- Compare: base vs candidate, in-sample vs holdout, and historical vs live-paper evidence;
- Review: execution/trade journal review and recurring error analysis.

A proposal must include:
- target strategy/version and exact baseline hashes;
- question/hypothesis;
- proposed change and bounded parameter space;
- evidence links, trade/sample count and data windows;
- possible confounders/limitations;
- experiment plan and acceptance criteria;
- status: proposed, approved, running, evaluated, rejected, accepted-for-paper-validation.

AI cannot silently edit or activate a strategy. The only path from proposal to a candidate is:

```text
AI proposal
→ human approval
→ immutable experiment config
→ backtest/baseline
→ holdout/walk-forward
→ compare results
→ approved candidate version
→ live paper validation
```

Minimum data available to AI:
- strategy/indicator/method version metadata;
- run manifest and data lineage;
- trades and trade outcomes;
- point-in-time trade context snapshots;
- data-quality and execution-quality metrics;
- regime/session/symbol/timeframe grouping where the underlying fields exist.

AI must explicitly report insufficient sample/data quality and must not invent missing facts. A high win rate alone is not sufficient to accept a candidate.

### O. `/alerts` and `/notifications`

Alert rules may cover price levels, indicator/method events, strategy signals, data quality, bot errors, risk halt and experiment completion. Notifications route via providers already integrated by the project (e.g. Telegram) and any later supported provider.

Every delivered alert stores source, rule/version, event timestamp, receive timestamp, dedupe key, destination and delivery result. Notification failure must not corrupt market processing or order state.

### P. `/system/data-sources`, `/health`, `/logs`, `/settings`

Show source connection state, last event, latency, reconnect count, catalog synchronization state, data quality and service heartbeat. Provider-specific state must remain inside provider adapter contracts; UI displays normalized diagnostics.

Keep existing auth, TM Hub integration, local binding/TLS restrictions and single-user scope. Secrets/API credentials must never be shown after storage or delivered to browser code.

## 57.5 Domain entity boundaries — mandatory for UI/API

Use separate domain objects. Do not collapse these into one generic “bot” document.

```text
IndicatorDefinition
  └─ IndicatorVersion
       └─ IndicatorPreset (optional reusable parameter selection)

StrategyDefinition
  └─ StrategyVersion (immutable code/config contract + version hashes)
       └─ StrategyProfile (optional operational config alias only if it does not mutate the version)

BotProfile
  └─ BotInstance / TestSession
       ├─ RunManifest
       ├─ Signals
       ├─ Orders
       ├─ Positions
       └─ Trade Context / Outcomes

DatasetManifest
  └─ RecordingSession / source files / candle ranges

Experiment
  ├─ baseline run reference
  ├─ candidate config/version
  ├─ train/validation/holdout dataset references
  └─ comparison report

ResearchProposal
  └─ approved Experiment (never directly an executable order)
```

Existing collections and models must be inspected before creating new ones. Reuse current `runs`, `trades`, `signals`/`alerts`, `positions`, `risk_state`, `intel`, and `journal` where their contracts already fit. Add migrations/schema versions rather than creating duplicate collections with overlapping meanings.

Suggested logical entities (names may follow existing model naming conventions):

- `indicator_definitions`, `indicator_versions`, `indicator_presets`;
- `strategy_definitions`, `strategy_versions`, `bot_profiles`, `bot_instances`;
- `run_manifests` or an explicit compatible extension of the current run model;
- `dataset_manifests`, `recording_sessions`, `data_quality_reports`;
- `trade_context_snapshots` or immutable snapshot references on existing signal/order/position/trade models;
- `experiments`, `experiment_runs`, `research_proposals`, `research_reports`.

Do not create all collections blindly. First audit current Mongo models and `docs/data-model.md`; document the decision for reuse vs new schema. Every entity needs stable IDs, UTC millisecond timestamps, clear status enums, indexes for common filters, and explicit relationship references.

## 57.6 Suggested API surface

Follow the current `/api/v1` conventions, auth middleware and pagination standards. Final route names may be adjusted to match existing APIs, but the domain separation must remain.

```text
# Catalog / Market
GET    /api/v1/instruments
GET    /api/v1/market/sources
GET    /api/v1/market/health

# Indicators
GET    /api/v1/indicators
GET    /api/v1/indicators/:id
GET    /api/v1/indicators/:id/versions
GET    /api/v1/indicators/:id/dependencies

# Strategies
GET    /api/v1/strategies
POST   /api/v1/strategies
GET    /api/v1/strategies/:id
POST   /api/v1/strategies/:id/versions
GET    /api/v1/strategies/:id/versions
GET    /api/v1/strategies/:id/runs

# Bots
GET    /api/v1/bots/profiles
POST   /api/v1/bots/profiles
GET    /api/v1/bots/instances
POST   /api/v1/bots/instances
POST   /api/v1/bots/instances/:id/start
POST   /api/v1/bots/instances/:id/pause
POST   /api/v1/bots/instances/:id/resume
POST   /api/v1/bots/instances/:id/stop

# Test Center / Runs
POST   /api/v1/lab/runs
GET    /api/v1/lab/runs
GET    /api/v1/lab/runs/:id
POST   /api/v1/lab/runs/:id/cancel
GET    /api/v1/lab/runs/:id/lineage
GET    /api/v1/forward-tests

# Data Center
GET    /api/v1/datasets
POST   /api/v1/datasets
GET    /api/v1/datasets/:id
GET    /api/v1/recordings
GET    /api/v1/recordings/:id
GET    /api/v1/data-quality
GET    /api/v1/lineage/:entityType/:id

# Research / Experiments
GET    /api/v1/research/trades
GET    /api/v1/research/strategies/:id
GET    /api/v1/research/proposals
POST   /api/v1/research/proposals
POST   /api/v1/research/experiments
GET    /api/v1/research/experiments/:id
POST   /api/v1/research/experiments/:id/run
GET    /api/v1/research/experiments/:id/report
```

These are proposed API contracts, not a demand to implement every route in one sprint. Before adding an endpoint, inspect whether a current route already provides the same function. Do not duplicate `/api/v1/runs`, `/api/v1/signals` or existing health/risk APIs without a migration rationale.

## 57.7 Required end-to-end workflows

### Workflow 1 — Register and validate an indicator

```text
Indicator Library
→ inspect indicator/version/parameters
→ run fixture and warmup checks
→ verify incremental output matches batch output
→ mark the implementation version validated
→ expose it to Strategy Library
```

A failed indicator validation must prevent it from being selected for a production-like paper test, while still permitting isolated developer tests.

### Workflow 2 — Create strategy and bot profile

```text
Strategy Library
→ select indicator/method versions
→ configure entry/exit rules and parameters
→ create immutable Strategy Version
→ validate schema/requirements
→ create Bot Profile referencing that version
```

### Workflow 3 — Historical strategy test

```text
Test Builder
→ select Strategy Version + Dataset + instruments/TFs
→ record immutable Run Manifest/hashes
→ run Backtest
→ save trades/metrics/warnings
→ open Run Detail
→ view Data Lineage
→ compare with baseline/holdout
```

### Workflow 4 — Realtime auto-test using market data

```text
Bot Profile
→ start LIVE_PAPER instance
→ market subscriptions are validated
→ Market Core supplies events
→ indicator/method engine calculates state
→ signal passes dedupe + Risk Gate
→ Paper Simulator creates simulated order/fills
→ positions/PnL update
→ trade context/outcomes saved
→ session appears in Forward Tests and Journal
```

If market data is stale, has a critical gap, fails sequence recovery or lacks required fields, the bot must transition to a visible degraded/paused/halted state according to a defined safety policy. It must not silently create an entry using stale prices.

### Workflow 5 — AI analysis and improvement

```text
select strategy/run/trade cluster
→ choose compatible dataset and date window
→ AI generates evidence-linked analysis
→ save Research Proposal
→ human approves experiment
→ Experiment Runner executes baseline + candidate
→ holdout/walk-forward report
→ compare metrics/sample sizes/robustness
→ approve candidate version for LIVE_PAPER validation
```

All outputs must preserve data and engine lineage. Rejected proposals remain recorded for traceability.

## 57.8 Test Center result metrics

For each run, display applicable metrics with sample sizes and warnings:

- total signals, accepted/rejected signals and reason counts;
- orders, fills, partial fills, no-fills, cancelled/replaced orders;
- trades, wins/losses/breakeven;
- gross/net PnL, fees, spread cost and slippage cost;
- win rate, profit factor, expectancy in R, median R and average R with degenerate-risk warning;
- max drawdown and equity curve;
- MAE/MFE and holding-time statistics when available;
- stale/gap/late events and skipped decisions;
- results grouped by symbol, timeframe, regime, method and session where sample size supports it.

Do not show a single “best strategy” badge solely based on return or win rate. Show sample size, test period, costs, holdout status, data quality and version compatibility.

## 57.9 Navigation implementation and migration instructions for the coding agent

The implementation agent must execute these steps in order:

1. **Audit first:** inspect `app/pages`, existing layouts/navigation components, TM Hub route seeding/inheritance, i18n dictionaries, API endpoints, current models, `docs/data-model.md` and V3 phase status. Produce a route inventory with `implemented`, `partial`, `planned`, `missing` status.
2. **Do not rebuild the sidebar from scratch:** extend the existing TM Hub/local navigation contract. Reuse existing menu IDs/routes and preserve auth metadata.
3. **Add navigation metadata:** for each route define stable ID, route path, label translation key, icon, group/order, required feature availability and optional badge source. Avoid putting status logic in display labels.
4. **Implement in slices:** first Strategy Lab navigation/pages (Indicator Library, Strategy Library, Bot Profiles/Instances); next Test Center (Test Builder and run detail enhancements); next Data Center/lineage; then AI Research integration. `/trade` and current routes must remain usable throughout.
5. **Do not implement dead-link placeholders as working features:** either hide an incomplete route or show a real, honest Coming Soon page according to project conventions.
6. **Reuse API/domain services:** frontend must not duplicate metrics, simulate PnL, calculate indicator results separately, or mutate bot/position state directly.
7. **Add tests for route authorization/visibility, navigation links, empty/loading/error states, pagination/filtering, run lineage, and existing-route regressions.**
8. **Run all project checks:** `npm test`, `npm run typecheck`, `npm run verify`, and the existing app/e2e test command if present. Do not claim completion unless outputs are captured and passing.
9. Update the V3 status/checklist with implementation status, date, tests, acceptance evidence and known limitations. Do not mark planned features complete merely because a route exists.

## 57.10 Recommended implementation order

Priority 0 — avoid breaking the current application:
- preserve all existing tests and route behavior;
- audit route/model/API inventory;
- align menu group IDs and i18n keys with TM Hub.

Priority 1 — make strategy reusable:
- Indicator Library read/detail pages;
- Strategy Library list/detail/versioning;
- Bot Profiles and Bot Instances contracts/views.

Priority 2 — make tests manageable:
- Test Builder;
- historical run manifest and detail/compare traceability;
- Live Forward Tests page with session status;
- clear separation between backtest, replay and live paper metrics.

Priority 3 — make data reusable:
- Dataset Library;
- Market Recordings list/detail;
- Data Quality report;
- lineage from run → dataset/recording → version → trade context.

Priority 4 — close the AI research loop:
- AI analysis scoped to selected evidence;
- structured proposal persistence;
- experiment creation/runner/results;
- baseline/holdout comparison;
- candidate version → live paper validation.

Do not block a functioning realtime terminal on completing the full AI workspace. However, do not claim AI optimization is complete until the data lineage, experiment records and evaluation workflow are real and tested.

## 57.11 Definition of Done for menus and research UI

This addendum is complete only when:

- sidebar follows the target groups and no active menu item points to a missing route;
- existing routes continue to work and remain protected by the existing auth contract;
- users can distinguish Indicator, Strategy, Bot Profile, Bot Instance, Test Run, Dataset and Experiment;
- a strategy version can be reused by multiple test modes without copying strategy logic;
- a historical run and a realtime forward-test session both have persisted manifests and status;
- each completed run shows strategy/version/parameters/data/engine/simulator lineage;
- the user can navigate from a trade result to its context snapshot and input data reference;
- AI analysis is scoped to a selected strategy/run/dataset and stores its evidence references;
- an AI proposal becomes an experiment only through a recorded approval/action;
- a candidate version can be compared and then started in live paper mode without enabling real execution;
- tests cover navigation, permissions, data lineage and existing route regressions;
- full quality gates remain green.

**Do not treat this menu addendum as evidence that these features have already been implemented. It is the required implementation specification for the next coding work.**

---

# 58. Unified Navigation, TM Hub/Core Integration & Menu Migration — V3.3 Authority

> **V3.3 supersedes conflicting navigation instructions in V3.2 §58 and the “keep current groups” wording that previously over-constrained the UI.** Use §57.3 as the product information architecture and this section to integrate the existing TM Hub/shared-core capabilities without duplicating or deleting them.
>
> The current menu tree is an implementation inventory, not the target UX. The coding agent may reorganize top-level groups, labels, ordering and parent relationships when doing so makes the product clearer. Existing feature behavior, leaf-route IDs/paths and Hub contracts must remain compatible unless a deliberate, tested migration says otherwise.

## 58.1 Navigation goals

The sidebar should follow the user's workflow:

```text
UNDERSTAND THE MARKET
       ↓
ANALYZE / TRADE
       ↓
MANAGE STRATEGIES AND BOTS
       ↓
TEST / REPLAY / COMPARE
       ↓
MANAGE DATA AND EVIDENCE
       ↓
RESEARCH WITH AI
```

TM Hub capabilities support the whole product. They are platform/core capabilities, not a second trading domain. Keep them available, but place them in a compact shared-resources or administration area rather than allowing legacy group names to dictate the main product layout.

Navigation principles:

1. Group by user task and product domain, not source-code folders or old implementation history.
2. `/trade` is the primary realtime workspace. Chart panels (indicators, orderbook, tape, funding/OI, signals, trade ticket, positions and risk) are panels/tabs/drawers inside `/trade`, not all separate sidebar entries.
3. Strategy definitions, bot configuration, test execution, test data, research findings and platform administration must be distinct concepts.
4. Preserve core behavior while freely improving the menu hierarchy. Do not duplicate a Hub-owned feature as a new local page/service.
5. Never show a route as operational if it currently resolves to 404 or lacks the required implementation; use the existing hide/Coming Soon convention.
6. Continue to use the TM Hub route registry, app ID, authentication/session, RBAC and remote configuration contracts where they are the actual owner.
7. Use the current i18n approach for all menu labels. Do not hard-code visible navigation text in page components.

## 58.2 Target sidebar information architecture

This is the **target UI structure**. It intentionally differs from the existing nine-root-group menu. Build incrementally and only activate routes that are implemented and tested.

```text
TM TRADING

1. Overview                                      /

2. Markets                                       [group]
   ├─ Market Explorer                            /markets
   ├─ Scanner                                    /scanner
   ├─ Market Intelligence                         /intel
   └─ News & Economic Calendar                    /calendar                 (when available)

3. Trading                                       [group]
   ├─ Trading Terminal                           /trade
   ├─ Signals                                    /signals
   ├─ Paper Account                              /paper                    (optional distinct account view)
   ├─ Orders                                     /orders                   (add only with real order-management value)
   ├─ Positions                                  /positions
   └─ Accounts                                   /accounts                 (existing account/profile connection view; audit ownership first)

4. Strategy Lab                                  [group]
   ├─ Strategy Library                           /strategies
   ├─ Indicator Library                          /indicators
   ├─ Methods & Confluence                       /methods
   ├─ Bot Profiles                               /bots
   └─ Bot Instances                              /bots/instances

5. Test Center                                  [group]
   ├─ New Test                                   /lab/new
   ├─ Historical Runs                            /runs
   ├─ Live Forward Tests                         /forward-tests
   ├─ Replay & Training                          /replay
   └─ Compare & Validation                       /runs/compare

6. Data & Research                               [group]
   ├─ Data Center                                /data
   │  ├─ Datasets                                /data/datasets
   │  ├─ Market Recordings                       /data/recordings
   │  ├─ Data Quality                            /data/quality
   │  └─ Test Data Lineage                       /data/lineage
   ├─ AI Research                                /research
   ├─ Experiments                                /research/experiments
   └─ Trade Journal                              /journal

7. Alerts & Notifications                        [group]
   ├─ Alert Rules                                /alerts                   (new or adapt existing alert UI)
   ├─ Notification History                       /notifications            (reuse Hub/shared notification capability)
   └─ Inbox                                      /resources/inbox          (existing shared capability; keep current path)

8. Shared Resources                             [group]
   ├─ Media Library                              /resources/media
   ├─ Import                                     /resources/import
   ├─ Connections                                /resources/connections
   └─ Queues / Jobs                              /resources/queues

9. Administration & System                      [group; admin visibility]
   ├─ Identity & Access
   │  ├─ Users                                   /administration/users
   │  ├─ Roles                                   /administration/roles
   │  └─ Permissions                             /administration/permissions
   ├─ Apps & Navigation
   │  ├─ Applications                            /administration/apps
   │  └─ Routes                                  /administration/routes
   ├─ Configuration                              /administration/configs
   ├─ Market Data Sources                        /system/data-sources          (new Trading-domain view)
   ├─ Health                                     /health                       (reuse existing health route if present)
   ├─ Logs                                       /administration/logs           (reuse canonical existing route)
   ├─ Profile                                    /system/profile
   ├─ Documentation                              /system/docs
   └─ Settings                                   /system/settings

Secondary “Tools” menu (not a primary trading group; may live in app switcher/footer):
   ├─ Text                                       /utilities/text
   ├─ Icons                                      /utilities/icons
   ├─ Encode                                     /utilities/encode
   ├─ Random                                     /utilities/random
   └─ Editor                                     /utilities/editor
```

### Route notes

- The target tree is a UX hierarchy, not an instruction to duplicate pages. Before adding `/paper`, `/orders`, `/notifications`, `/alerts`, `/calendar`, `/scanner`, `/methods`, `/strategies`, `/indicators`, `/bots`, `/data/*`, `/research/experiments`, `/forward-tests` or `/system/data-sources`, audit whether a working equivalent already exists. Reuse/extend it if possible.
- Existing registered paths in the user-provided `createTradingRoutes` inventory include `/`, `/trade`, `/replay`, `/positions`, `/accounts`, `/signals`, `/intel`, `/runs`, `/journal`, the `/resources/*`, `/administration/*`, `/system/*` and `/utilities/*` routes. Treat those leaf routes as compatibility contracts by default.
- The existing `/resources/notifications` path is in the current route inventory. Use it as the canonical path unless repository inspection proves another active canonical route; do not register both `/resources/notifications` and `/notifications` as independent implementations. A redirect or menu alias may be added only if routing and Hub constraints support it and tests cover it.
- The existing `/administration/logs` is in the provided route inventory. If `/logs` is already a live route, audit it and select one canonical page; avoid two log viewers with different sources of truth.
- `/accounts` must be audited before changing its label/meaning. Do not assume it is exclusively a broker account page: inspect implementation to determine whether it currently manages execution accounts, app connections or both. Preserve its current behavior and split only if a clear domain boundary exists.
- “Queues / Jobs” means shared/background job infrastructure. It is not the same as bot instances or a test-run queue, even if these can use shared queue infrastructure behind the scenes.
- “Connections” at `/resources/connections` means the existing shared connection-management capability. Market WebSocket connectors, exchange adapters and active data subscriptions remain owned by `market/`; the UI may link to or summarize them through a deliberate integration, not silently reuse unrelated records.
- “Import” at `/resources/import` is a shared import utility. It is not automatically the canonical Dataset Library or Market Recorder. Dataset ingestion must produce dataset metadata, quality checks and lineage in the Data Center.
- TM Hub login/session and app identity remain part of the app shell and should not become a duplicate “Authentication” menu unless the existing Hub product explicitly exposes a supported session-management page.

## 58.3 Existing route inventory: preserve capabilities, not old grouping

Use the supplied `createTradingRoutes(context)` as the initial inventory, and confirm it against the repository. The current list contains the following entries:

| Current route/item | Current path | V3.3 target location | Migration rule |
|---|---|---|---|
| `home` | `/` | Overview | Keep |
| `trade_terminal` | `/trade` | Trading | Keep; primary workspace |
| `trade_replay` | `/replay` | Test Center | Keep; move visual group |
| `exec_positions` | `/positions` | Trading | Keep |
| `exec_accounts` | `/accounts` | Trading / account context after audit | Keep and inspect actual purpose |
| `intel_signals` | `/signals` | Trading | Keep |
| `intel_market` | `/intel` | Markets | Keep |
| `research_runs` | `/runs` | Test Center | Keep |
| `research_journal` | `/journal` | Data & Research | Keep |
| `resources_media` | `/resources/media` | Shared Resources | Keep |
| `resources_inbox` | `/resources/inbox` | Alerts & Notifications | Keep |
| `resources_notifications` | `/resources/notifications` | Alerts & Notifications | Keep; canonical notification route unless audit proves otherwise |
| `resources_connections` | `/resources/connections` | Shared Resources | Keep; distinguish generic connections from market adapters |
| `resources_import` | `/resources/import` | Shared Resources | Keep; not a substitute for Dataset Library |
| `resources_queues` | `/resources/queues` | Shared Resources / operational jobs | Keep; do not conflate with bots/test runs |
| `admin_users` | `/administration/users` | Administration & System → Identity & Access | Keep; Hub/RBAC ownership audit |
| `admin_roles` | `/administration/roles` | Administration & System → Identity & Access | Keep; Hub/RBAC ownership audit |
| `admin_permissions` | `/administration/permissions` | Administration & System → Identity & Access | Keep; Hub/RBAC ownership audit |
| `admin_routes` | `/administration/routes` | Administration & System → Apps & Navigation | Keep; use Hub route registry |
| `admin_configs` | `/administration/configs` | Administration & System → Configuration | Keep; inspect remote-config ownership |
| `admin_logs` | `/administration/logs` | Administration & System → Logs | Keep; one canonical log-viewing source |
| `admin_apps` | `/administration/apps` | Administration & System → Apps & Navigation | Keep; preserve registered app identity |
| `system_profile` | `/system/profile` | Administration & System → Profile | Keep |
| `system_docs` | `/system/docs` | Administration & System → Documentation | Keep |
| `system_settings` | `/system/settings` | Administration & System → Settings | Keep; distinguish local preferences from Hub remote config |
| `utilities_text` | `/utilities/text` | Secondary Tools | Keep functionality; remove from primary trading navigation if appropriate |
| `utilities_icons` | `/utilities/icons` | Secondary Tools | Keep functionality; remove from primary trading navigation if appropriate |
| `utilities_encode` | `/utilities/encode` | Secondary Tools | Keep functionality; remove from primary trading navigation if appropriate |
| `utilities_random` | `/utilities/random` | Secondary Tools | Keep functionality; remove from primary trading navigation if appropriate |
| `utilities_editor` | `/utilities/editor` | Secondary Tools | Keep functionality; remove from primary trading navigation if appropriate |

The group pseudo-routes `group_workspace`, `group_execution`, `group_intel`, `group_research`, `group_resources`, `group_admin`, `group_system` and `group_utilities` are **current navigation scaffolding, not business functionality**. The coding agent may replace/reorganize these visual groups once it has audited route-registry references and the Hub seed/update semantics. Do not delete pseudo-route records blindly if RBAC, persisted navigation state or other records reference their IDs.

## 58.4 TM Hub/core boundary

TM Trading is a satellite application and must reuse the current Hub integration. The coding agent must verify actual ownership in code; names alone do not prove where the source of truth lives.

| Capability | Owner/source of truth | UI placement | Prohibited duplication |
|---|---|---|---|
| Login, access token, refresh/session behavior | Existing TM Hub integration | App shell; no duplicate primary page | Do not create a separate local login/session provider |
| App identity / registry | TM Hub Application Registry or current registered app contract | Administration & System → Apps & Navigation | Do not register a second Trading app identity |
| User/role/permission and RBAC | TM Hub IAM/RBAC where currently configured | Administration & System → Identity & Access | Do not create a second user/role/permission database or authorization source |
| Dynamic navigation / route registry | Current Hub route mechanism | Administration & System → Apps & Navigation | Do not introduce a separate menu registry |
| Shared/remote configuration | TM Hub Remote Configuration where currently configured | Administration & System → Configuration | Do not create a parallel remote-config source; trading-specific runtime settings should have clear ownership and secrets stay server-side |
| Shared media | Existing media service/gateway | Shared Resources → Media Library | Do not build another media manager if the current one already works |
| Inbox/notifications | Existing shared notification/messaging capabilities | Alerts & Notifications | Reuse providers and delivery logs; trading alert rules/events may be new domain logic |
| Generic connections | Existing shared connections UI/service | Shared Resources → Connections | Do not treat it as the actual exchange websocket manager unless the integration explicitly maps both |
| Import and queues | Existing shared core services | Shared Resources | Do not replace them with dataset ingestion or test-run management |
| Logs / health / services | Reuse current observability services where suitable | Administration & System | Trading-specific market quality metrics must retain domain-specific fields and semantics |
| Generic utilities | Current utilities | Secondary Tools | Keep out of the primary trading workflow unless there is a strong user need |

### Security and permission rules

- Keep `TRADING_APP_ID` and the existing Hub auth/session contract unchanged unless an explicit tested migration requires otherwise.
- The menu is presentation, not authorization. Every server route/action must enforce the existing server-side auth and app identity checks.
- New trading permissions may be added only through the existing permission/RBAC mechanism. Do not invent local role semantics that conflict with Hub roles.
- Secrets, API keys, tokens and broker credentials must not be sent to the browser or placed in visible menu/config payloads.
- New admin pages should follow the existing admin visibility/permission conventions. Non-admin users should not see admin-only routes where that convention applies.

## 58.5 New Trading-domain pages to add

Only add these after auditing for existing implementations. Prefer the §57.3 route targets and the route responsibilities in §57.4.

| Domain | Proposed route | Minimum purpose | Depends on |
|---|---|---|---|
| Market | `/markets` | Discover canonical instruments, venue and data availability | Instrument Catalog / Market API |
| Market | `/scanner` | Browse movers/volume/flow/regime candidates | Existing scanner services + normalized instruments |
| Strategy Lab | `/indicators` | Indicator definitions, params schema, version and validation status | Indicator registry |
| Strategy Lab | `/strategies` | Compose reusable indicators/methods/entry-exit/risk configuration | Strategy version contract |
| Strategy Lab | `/methods` | Method library, score/reasons and chart visualization configuration | `engine/methods` registry |
| Strategy Lab | `/bots` | Define reusable bot profiles, run mode and risk profile | Bot profile contract |
| Strategy Lab | `/bots/instances` | Control/view concrete bot runs and runtime status | Bot instance supervisor |
| Test Center | `/lab/new` | Define historical/live-paper/replay test matrix | Test-run contract |
| Test Center | `/forward-tests` | Monitor realtime forward-paper tests | Market Core + simulation runner |
| Data Center | `/data` | Data Center landing page | Dataset/recording API |
| Data Center | `/data/datasets` | Dataset catalog, filters and immutable data metadata | Dataset manifests/storage |
| Data Center | `/data/recordings` | Recording sessions, capture coverage and retention | Market recorder |
| Data Center | `/data/quality` | Missing/gap/stale/duplicate/out-of-order metrics | Data quality service |
| Data Center | `/data/lineage` | Trace run → strategy → dataset → context → trades/results | Immutable hashes/manifest |
| Research | `/research` | AI analysis over explicitly selected evidence | AI research services + dataset lineage |
| Research | `/research/experiments` | Proposals, candidate parameter sets and experiment lifecycle | Experiment runner |
| Alerts | `/alerts` | Configure alert conditions and routing where not already covered | Alert rule service |
| System | `/system/data-sources` | Configure/inspect trading market data providers, subscriptions and source roles | Market adapters/connection manager |
| Markets | `/calendar` | News/economic calendar if a reliable source is configured | News/calendar provider |
| Trading | `/paper` | Account-level equity, risk, exposure and PnL overview if not adequately represented elsewhere | Simulation account service |
| Trading | `/orders` | Paper order lifecycle and history if not adequately represented in `/trade`/`/positions` | Simulation order service |

Do not add every proposed route at once. Routes with no working service/API should remain hidden or display a non-interactive Coming Soon state according to app convention.

## 58.6 Domain boundaries: similarly named features are not interchangeable

- **TM Hub Configs ≠ Strategy Parameters.** Hub configs control app/service configuration and secrets; strategy parameters are versioned domain data owned by Strategy Lab.
- **Generic Connections ≠ Market Data Providers.** The former are shared app integrations; the latter maintain exchange sockets, instrument subscriptions, reconnect state, feed roles and market-data quality.
- **Generic Import ≠ Dataset Management.** Data Center must own dataset manifests, quality status, hashes, coverage and lineage.
- **Shared Queues ≠ Bot Instances/Test Runs.** A queue may execute work, but the user-visible bot/test domain must persist identity, configuration, status, outcomes and cancellation semantics.
- **Admin Logs ≠ Trade Journal.** Logs capture operational events; Journal captures domain-level trades, decisions and outcomes.
- **Notifications ≠ Alert Rules.** Notifications are delivery/history capabilities; the trading domain defines alert conditions and deduplication keys, then routes events through shared delivery providers.
- **Apps/Routes/RBAC ≠ Strategy/Method Registry.** TM Hub registers applications/navigation/permissions; TM Trading registers indicator/method/strategy versions.
- **Bot Profile ≠ Bot Instance.** A profile is reusable configuration; an instance is one concrete run tied to one immutable profile/strategy version, dataset or live-paper source and execution state.
- **Strategy ≠ Indicator.** Indicators produce values/events; strategies compose indicators/methods/conditions/risk into a testable decision process.
- **Dataset ≠ Test Run.** A dataset is reusable immutable input; each run is a specific execution with its own config, hashes, status and result.

## 58.7 Route registry migration requirements

Before changing the menu, the coding agent must inspect:

1. `createTradingRoutes` and any related seed/bootstrap scripts.
2. How TM Hub route records are created/updated and whether seeding is insert-only, upsert or explicit migration.
3. Whether `id`, `path`, `name`, `parent_id`, `sort`, `label`, `icon`, `is_visible`, `required_permission` are consumed by other code or RBAC mappings.
4. Existing route page/component and API for every leaf route.
5. Current i18n keys and en/vi label coverage.
6. How nested menus are rendered. Do not introduce three-level nesting if the existing navigation component only supports one group level; flatten into logical groups or add/test support deliberately.

Migration policy:

- **Leaf route IDs and paths are stable by default.** Reorganize `parent_id`, `sort` and display labels through an explicit, idempotent migration/seed update where supported.
- Group pseudo-route IDs can be reorganized, but first check for references. If safe removal cannot be proven, mark obsolete groups hidden and retain them in the registry until a later cleanup.
- New group/menu records must use deterministic IDs and be checked for duplicates before insertion.
- Re-running the route seed/migration must not duplicate menu entries or reset user-owned preferences unexpectedly.
- Keep URLs and deep links functioning. If a route path must change, add redirects/compatibility and tests; path changes are not required just to reorganize the sidebar.
- Use the existing Hub route mechanism. Do not add a second local navigation database or route registry.
- Add regression tests proving every existing leaf route still resolves and every visible menu item maps to a real route or supported group.

## 58.8 `docs/navigation-audit.md` — required first deliverable

Before implementing menu refactors, produce `docs/navigation-audit.md` with:

- the exact current route inventory from `createTradingRoutes`;
- target V3.3 group and leaf route for each current route;
- page/component/API/domain service evidence for each existing route;
- whether auth, RBAC, route registry, apps registry, configs, media, inbox, notifications, connections, import, queues and utilities are provided by Hub/shared core or local Trading code;
- route conflicts, duplicate capabilities, missing pages and misleading labels;
- existing i18n keys that can be reused and missing translations;
- exact route/menu migration plan, including rollback strategy;
- tests that prove the current functionality remains usable after reorganizing the menu.

Do not mark an item `implemented` merely because a route seed record exists. Use `implemented`, `partial`, `planned`, `missing`, and cite file/API/test evidence.

## 58.9 Recommended implementation order

### Slice 1 — Audit and clean navigation

- Create `docs/navigation-audit.md`.
- Keep all current pages and APIs working.
- Map current routes into the V3.3 hierarchy.
- Reorganize only menu presentation and i18n first; do not mix with market-engine refactoring.
- Verify Hub auth/session/RBAC and dynamic route loading.

### Slice 2 — Strategy Lab foundation

- Indicator Library read-only/registry view.
- Strategy Library read-only view of existing method/config/version data.
- Add creation/editing only when schema/version contracts are defined.
- Separate Indicator, Method, Strategy, Bot Profile and Bot Instance models.

### Slice 3 — Test Center

- New Test Builder for BACKTEST, REPLAY and LIVE_PAPER.
- Historical run list/details/compare reuse `/runs`, `/runs/[id]`, `/runs/compare` where present.
- Live forward-test monitor.
- Every test run records strategy/indicator versions, params hash, dataset/recording identity, engine version, run mode, timestamps and result manifest.

### Slice 4 — Data Center

- Dataset Library, Market Recordings, Data Quality and Test Data Lineage.
- Connect market recorder and historical data service.
- Establish dataset retention and immutability behavior before storing large recordings.

### Slice 5 — AI Research and Experiments

- AI reads a selected, versioned evidence set and summarizes limitations/sample size.
- Structured proposal → human approval → experiment → backtest/holdout → live-paper validation.
- A candidate must never silently replace the active strategy version.

### Slice 6 — Shared core placement and polish

- Place Media, Inbox, Notifications, Connections, Import and Queues in the target Shared Resources/Alerts groups.
- Place users/roles/permissions, apps/routes/configs, profile/docs/settings/logs/health in the target Administration & System group or supported admin subnavigation.
- Move generic utilities out of the primary trading workflow (e.g. secondary Tools/footer) without deleting their functionality or breaking deep links.
- Validate all page translations, active states, mobile sidebar behavior and admin visibility.

## 58.10 Acceptance criteria

The navigation migration is complete only when:

- The sidebar follows the V3.3 target workflow and no longer simply exposes the legacy nine-group layout by default.
- All existing leaf routes from the supplied route registry still resolve; any intentionally hidden route remains reachable according to product policy and is not silently deleted.
- Existing authentication/session behavior, `TRADING_APP_ID`, Hub route registry, RBAC, shared configs and core integrations continue working.
- No duplicate local login, IAM, dynamic route registry, shared notification delivery, shared media, or remote-config system has been introduced.
- New menu items are not visible as active links unless their route/API/page has passed the required tests.
- Market data provider health is distinct from generic connection records.
- Indicator, Strategy, Bot Profile, Bot Instance, Test Run, Dataset and Experiment are distinct domain entities with traceable links.
- Every test run can identify which strategy version, parameters, engine and dataset/recording produced it.
- AI proposals cannot silently mutate active strategy versions or bypass Risk Gate.
- The migration is idempotent and duplicate-safe.
- Route regression tests, unit/integration tests, typecheck, verify and relevant UI/e2e tests pass.
- The roadmap's implementation status is updated only with evidence from actual code/tests.

**Final instruction to AI coding:** use the current route seed and repository to discover what exists, but do not treat the current menu grouping as a requirement. Implement the cleaner §58.2 information architecture; preserve the underlying shared TM Hub/core capabilities and compatible leaf routes; reorganize or hide legacy group scaffolding only through an audited, tested migration.
