# TM Trading — Architecture & Roadmap V3.6

> Version: **2026-10-19**
>
> V3.6 integration update: retains the complete V3.5 roadmap and adds **Section 61 — End-to-End Platform Integration, Durable Bot Runtime, Pine Reuse, AI Provider Gateway, Contextual Module Assistant and TM Trading MCP**. Sections 59 and 60 remain authoritative for AI agents/sessions/autonomy and News/Events/Macro respectively. Section 61 is authoritative for cross-module contracts, end-to-end runtime behavior, provider integration, embedded assistance, MCP automation, and implementation order; where earlier sections describe isolated modules in ways that conflict with §61, §61 wins. This is an architecture/specification update—not evidence that these features have already been implemented.
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

## D35 — AI providers are app-owned; the hub is a catalog, not a proxy

Provider credentials, model choice, budgets and request audit belong to the app
that spends the tokens. TM Hub may publish provider metadata and an optional
enable/disable overlay, but it must not become a required credential broker or
inference proxy for child apps.

```text
hub: provider catalog + app registration + optional kill switch
app: connection secret (encrypted at rest) -> adapter -> provider
```

Consequences:

- An app can ship and pass Phase G without a working hub connection.
- The hub cannot revoke an app-owned secret; it can only ask the app to disable
  the connection. Hub-owned connections (identity OAuth, shared storage, push)
  remain hub-side and are consumed through grants, not by copying keys.
- A fallback is allowed only within the same wire protocol and capability set;
  cross-protocol fallback is a behavior change, not resilience.


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

Do not create all collections blindly. First audit current Mongo models and `docs/engine/data-model.md`; document the decision for reuse vs new schema. Every entity needs stable IDs, UTC millisecond timestamps, clear status enums, indexes for common filters, and explicit relationship references.

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

1. **Audit first:** inspect `app/pages`, existing layouts/navigation components, TM Hub route seeding/inheritance, i18n dictionaries, API endpoints, current models, `docs/engine/data-model.md` and V3 phase status. Produce a route inventory with `implemented`, `partial`, `planned`, `missing` status.
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

## 58.8 `docs/web-app/navigation-audit.md` — required first deliverable

Before implementing menu refactors, produce `docs/web-app/navigation-audit.md` with:

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

- Create `docs/web-app/navigation-audit.md`.
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


---

# 59. AI Trading Agents, Bot Automation, Live Trading Sessions & Continuous Research — V3.4 Authority

> **Purpose:** Specify the two missing first-class product areas identified by the product owner: (1) a page to manage AI trading agents and their permitted autonomy; (2) a page to manage/list/detail live trading sessions. This section also defines how strategies, bots, sessions, datasets, outcomes and AI research relate, so coding agents must not collapse them into one generic “bot” object.
>
> **Authority:** This section supersedes conflicting menu/layout suggestions in earlier sections for AI agent management and trading-session management. It does not remove the existing TM Hub/core integration rules, existing routes, or risk controls. Existing implementation must be audited before code changes.

## 59.1 Product goal

TM Trading is intended to help the owner:

1. Develop and version TM-native indicators and methods.
2. Compose indicators/methods into versioned strategies with explicit entry, exit and risk rules.
3. Run test bots on historical data and live market data using simulated execution.
4. Manage AI agents that observe market context, analyze evidence, propose setups, or operate within an explicitly allowed paper/demo autonomy level.
5. Review every live/replay/test session as a traceable sequence of market events, indicators, decisions, risk checks, orders, fills, positions, PnL and errors.
6. Persist the evidence needed for reproducible backtests, forward tests, research, and AI-assisted improvement.
7. Let AI propose new hypotheses/parameters/methods, test them in isolated experiments, and validate candidate versions before promoting them.
8. In a later, separately gated milestone, optionally connect an approved AI/bot workflow to broker/exchange demo environments. Real-money execution is outside the default V3.4 scope and must remain disabled by default.

The feedback loop is:

```text
MARKET DATA
  → INDICATORS / METHODS
  → STRATEGY VERSION
  → BOT / AI AGENT CONFIGURATION
  → TRADING SESSION
  → SESSION EVENTS + TRADE CONTEXT + OUTCOMES
  → VERSIONED DATASET / RESEARCH EVIDENCE
  → AI ANALYSIS / HYPOTHESIS
  → ISOLATED EXPERIMENT
  → BACKTEST + HOLDOUT + FORWARD PAPER VALIDATION
  → HUMAN-APPROVED IMMUTABLE VERSION
  → NEW PAPER SESSION
```

AI may collect and organize allowed in-app market/session evidence automatically. “Self-training” means a controlled research/training pipeline that produces a versioned candidate with measurable evaluation—not silent online mutation of the live strategy, indicator, model policy, or risk configuration.

## 59.2 Target navigation additions and revised menu

The target navigation should expose agent and session management clearly without turning every runtime object or chart panel into a top-level menu.

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
   ├─ Live Trading Sessions                      /sessions                  (NEW — session list)
   ├─ Signals                                    /signals
   ├─ Paper Account                              /paper                     (if distinct from account/positions views)
   ├─ Orders                                     /orders                    (if a distinct order-history page is needed)
   ├─ Positions                                  /positions
   └─ Accounts                                   /accounts                  (audit existing meaning first)

4. Strategy Lab                                  [group]
   ├─ Indicator Library                          /indicators
   ├─ Strategy Library                           /strategies
   ├─ Methods & Confluence                       /methods
   └─ Strategy Versions                          /strategies/versions       (can be a tab of Strategy Library)

5. AI & Automation                              [group]
   ├─ AI Trading Agents                          /ai-agents                 (NEW — agent management)
   ├─ Bot Profiles                               /bots                      (reusable bot/deployment configuration)
   ├─ Bot Instances                              /bots/instances            (configured persistent runtime instances)
   └─ Autonomy & Safety Policies                 /ai-agents/policies        (can be a tab until policy complexity warrants a page)

6. Test Center                                  [group]
   ├─ Test Builder                               /lab/new
   ├─ Historical Runs                            /runs
   ├─ Live Forward Tests                         /forward-tests             (research monitor; links to sessions)
   ├─ Replay & Training                          /replay
   └─ Compare & Validation                       /runs/compare

7. Data & Research                               [group]
   ├─ Data Center                                /data
   │  ├─ Datasets                                /data/datasets
   │  ├─ Market Recordings                       /data/recordings
   │  ├─ Data Quality                            /data/quality
   │  └─ Test Data Lineage                       /data/lineage
   ├─ AI Research                                /research
   ├─ Experiments                                /research/experiments
   └─ Trade Journal                              /journal

8. Alerts & Notifications                        [group]
   ├─ Alert Rules                                /alerts
   ├─ Notification History                       existing canonical notifications path
   └─ Inbox                                      /resources/inbox

9. Administration & System                      [group; admin visibility]
   ├─ Identity & Access                          existing TM Hub-backed pages
   ├─ Apps & Navigation                          existing TM Hub-backed pages
   ├─ Shared Resources                           Media / Import / Connections / Queues
   ├─ Market Data Sources                        /system/data-sources
   ├─ Health & Logs                              reuse canonical existing routes
   ├─ Profile / Documentation / Settings         reuse canonical existing routes
   └─ Secondary Tools                            Text / Icons / Encode / Random / Editor
```

Navigation rules:

- `/sessions` is the primary page for active and historical **runtime sessions**. Session detail is a row-click or `/sessions/[sessionId]` route.
- `/forward-tests` is a research/testing view filtered to forward-test runs and performance evaluation; it must link to the corresponding session instead of duplicating session state.
- `/ai-agents` manages AI agent definitions, versions, permissions and operational state. It is not the same as a bot profile or a live session.
- `/bots` manages reusable bot profiles; `/bots/instances` manages configured runtime instances. Starting an instance creates a new session; stopping a session does not erase the instance/profile.
- If the current router or Hub menu does not support nested routes/groups, flatten the menu while keeping the same conceptual separation. Keep routes hidden/Coming Soon until page + API + permission checks exist.
- Preserve canonical existing paths and TM Hub route registry behavior. Do not register duplicate notification/log/account functionality merely to fit the tree.

## 59.3 Domain entities: mandatory separation

The system must distinguish these concepts. They are separate persisted entities or clearly separated bounded-context models; do not overload one schema with all fields.

### Indicator / Indicator Version

A reusable calculation or market-structure event producer. It has a stable identity, immutable version, parameters/schema, input requirements, warmup requirements, output contract, supported market/timeframes and tests.

### Strategy / Strategy Version

A versioned decision specification that references indicator/method versions and declares entry, exit, stop/target, trigger policy, timeframes, market constraints and allowed parameters. A strategy version that produced recorded sessions/trades must not be mutated in place.

### AI Agent / AI Agent Version

A controlled reasoning/automation definition. It includes provider/model, system prompt/template version, allowed tools, input data scopes, memory/retrieval policy, analysis cadence, output schema, autonomy level and explicit limits. Version every behavior that can affect decisions.

### Bot Profile

Reusable runtime deployment configuration that binds a strategy version (and optionally an AI agent version), target market/instruments, timeframe, run mode, simulated account, risk profile, market-data source roles, fill-model profile, alert routing and start/stop policy.

### Bot Instance

A manageable runtime deployment record based on a bot profile. It holds operational state such as configured, ready, running, paused, degraded, stopping, stopped or error. It can create multiple sessions over its lifecycle. It must not itself be the sole trade-history container.

### Trading Session

An immutable, auditable runtime run created when a bot instance, user or approved orchestrator starts trading/analysis for a specific period and scope. It snapshots the effective strategy/agent/profile versions, parameters, instruments, data sources, risk policy, simulator semantics and initial account state. It owns an ordered timeline and references the session's events, orders, fills, positions, outcomes and metrics.

### Test Run / Replay Run

A controlled evaluation run linked to a dataset/recording and immutable strategy configuration. A live forward-paper test may be linked to a live trading session, but `TestRun` and `TradingSession` are not interchangeable: one is an evaluation experiment/run, the other is a real-time runtime interval with an operational timeline.

### Dataset / Recording / Research Evidence Set

- `Dataset`: immutable or versioned curated input manifest.
- `MarketRecording`: capture job/session, event coverage and storage references.
- `ResearchEvidenceSet`: explicitly selected versioned combination of runs, trades, contexts, recordings/datasets and quality metadata consumed by AI.

### Experiment / Candidate Version

An isolated hypothesis/configuration created from a baseline. It references the exact source version and data splits, records evaluation metrics and limitations, and can only become an approved candidate after acceptance gates.

## 59.4 Relationship model

```text
Indicator → IndicatorVersion
Method → MethodVersion
Strategy → StrategyVersion
                    │
                    ├─────────────┐
                    ▼             ▼
              Bot Profile     AI Agent Version (optional)
                    │             │
                    ▼             └──── AI may analyze/propose/orchestrate only permitted actions
               Bot Instance
                    │
                 start
                    ▼
              Trading Session
                    │
      ┌─────────────┼────────────────┐
      ▼             ▼                ▼
   Timeline      Orders/Fills     Positions/Outcomes
      │             │                │
      └─────────────┼────────────────┘
                    ▼
          Session Snapshot / Journal
                    │
                    ▼
       Dataset / Research Evidence Set
                    │
                    ▼
          AI Research → Experiment
                    │
                    ▼
     Backtest → Holdout → Live Paper Test
                    │
                    ▼
      Human-approved immutable version
```

An AI Agent may exist without being authorized to trade. A bot may run a deterministic strategy without an AI Agent. An AI-assisted session must identify exactly which agent version made each AI decision. This allows comparison between plain strategy bot and AI-assisted bot.

## 59.5 Page specification — `/ai-agents` AI Trading Agents

### Purpose

A control and observability page for AI agents that assist or eventually conduct trading workflows with real-time market context. It must make clear which agent is only analyzing, which is proposing trade plans, which is paper-trading, and which is connected to a demo environment.

### List page requirements

Display a searchable/filterable table or card grid with:

- agent name and stable ID;
- agent version and model/provider;
- assigned strategy version(s), or `analysis-only` when no strategy is bound;
- active bot instance/session links;
- market/instrument/timeframe scope;
- run mode: `ANALYZE_ONLY`, `PROPOSE_ONLY`, `LIVE_PAPER`, `DEMO_BROKER`, `DEMO_EXCHANGE`;
- autonomy level and required approval policy;
- state: `draft`, `ready`, `running`, `paused`, `degraded`, `error`, `disabled`, `retired`;
- latest heartbeat, last decision time, last error, current session and data-quality health;
- number of decisions/proposals, paper actions and risk denials in the selected period.

Filters: state, provider/model, strategy, run mode, autonomy level, market class and data health.

### Agent detail tabs

1. **Overview:** identity, description, owner, current version, model/provider health and deployment links.
2. **Configuration:** model, prompts/templates, temperature/token budget, timeouts, analysis cadence, supported locales and structured output schema.
3. **Strategy Binding:** allowed strategy versions, instruments, timeframes, market-data inputs and indicator/method context.
4. **Tools & Data Scope:** allowlist of internal tools and data scopes; read-only data tools separated from actions that can request an order.
5. **Autonomy & Risk:** autonomy level, approval requirements, maximum session duration, maximum open positions, allowed markets, risk caps, daily loss cap, kill-switch behavior and forbidden actions.
6. **Versions:** immutable configuration/model/prompt version history, diff and linked evaluation evidence.
7. **Activity & Audit:** agent outputs, structured proposals, tool calls, denials, errors and operator actions, each linked to a timestamped context snapshot.
8. **Performance:** outcomes grouped by agent version, strategy version, instrument, timeframe and regime; show sample size and data limitations.

### Actions

- Create draft agent.
- Clone into a new version; do not overwrite a version that has already produced decisions/sessions.
- Validate configuration and tool allowlist.
- Run offline evaluation or shadow analysis.
- Start/pause/resume/disable an eligible agent subject to state and permissions.
- Attach/detach an agent from a bot profile through an audited configuration change.
- Inspect active session.
- Roll back to an earlier immutable version by creating a new deployment referencing that version; do not rewrite history.

### Agent lifecycle

```text
DRAFT → VALIDATING → READY → RUNNING ↔ PAUSED
                         │          │
                         ├──────────┴→ DEGRADED
                         ├────────────→ ERROR
                         └────────────→ DISABLED / RETIRED
```

State transitions must be server-authoritative and persisted. Restarting the UI must not change agent state. A running agent must report health/heartbeat and a reason when it is degraded or stopped.

## 59.6 Autonomy levels and execution guardrails

The UI must show autonomy level as an explicit field—not infer it from the model name or a free-text prompt.

| Level | Name | Allowed behavior | Order behavior |
|---|---|---|---|
| A0 | Observe | Read permitted market/session data and summarize | No order intent |
| A1 | Propose | Produce structured market analysis/trade-plan proposals with evidence and counterarguments | No order submission; user decides |
| A2 | Autonomous Paper | Generate decisions and manage simulated orders in Live Paper within risk policy | Paper only; every action passes the existing Risk Gate |
| A3 | Broker/Exchange Demo | In a later milestone, interact with explicitly identified broker/demo/testnet accounts | Demo only, explicit allowlist, reconciliation and hard kill-switch |
| A4 | Real execution | Future scope only; not enabled by V3.4 | Must remain disabled by default and requires a separate security, risk, legal/provider and operational review, explicit opt-in, extra approval gates and audited enablement |

Mandatory guardrails:

- No AI or bot path may bypass `exec/risk.mjs` or its successor-compatible Risk Gate contract.
- The server validates every action; frontend controls are not authorization.
- AI text must be parsed into a strict, versioned action schema. Unstructured prose must never be interpreted as an order.
- Every executable intent must reference `agentVersion`, `strategyVersion`, `sessionId`, context snapshot, risk decision and idempotency key.
- Unknown, stale, missing or degraded market data must block new entries according to a policy; do not invent prices or continue with an unsafe fallback.
- Kill-switch must halt new entries immediately. Handling existing simulated positions must follow an explicit policy and be audited.
- No silent strategy, prompt, model, risk policy or parameter mutation inside a session. Configuration changes apply to a new version/session or an explicitly versioned safe transition.
- The UI must show real mode, paper mode and demo mode unmistakably. No live-money connection may be reachable from an ordinary V3.4 control.

## 59.7 Page specification — `/sessions` Live Trading Sessions

### Purpose

A single place to see and manage every active or historical trading runtime session, especially sessions driven by real-time market data. This is the operational record of what actually happened, not just a list of strategies or a performance report.

### Session list

Each row must show:

- session ID and readable name;
- run mode: `LIVE_ANALYSIS`, `LIVE_PAPER`, `REPLAY`, `BACKTEST`, or later explicit demo mode;
- status: `starting`, `running`, `paused`, `degraded`, `stopping`, `stopped`, `completed`, `failed`;
- started time, elapsed duration, stopped/completed time;
- agent name/version if AI-driven;
- bot instance/profile ID;
- strategy version and effective params hash;
- instrument(s), venue/provider and timeframe(s);
- last market event/bar time, feed lag and data-quality state;
- number of signals, decisions, orders, fills and closed trades;
- simulated balance/equity, realized/unrealized PnL and drawdown when relevant;
- risk state (active/halted/kill-switch) and latest error/warning.

Filters: active/historical, mode, state, AI agent, bot profile/instance, strategy version, venue, instrument, timeframe, time range, risk status and data quality.

Actions, subject to state/permissions:

- Open session detail.
- Pause/resume where supported.
- Request graceful stop.
- Emergency halt/kill-switch (with confirmation and policy text).
- Export a session evidence bundle or create a dataset manifest from its recording, if storage/permissions allow.
- Open linked AI analysis, journal, run comparison or experiment.

Do not offer “delete session” as an ordinary action if the session contains trade/audit evidence. Prefer archive/retention policies; preserve immutable records needed for traceability.

## 59.8 Page specification — `/sessions/[sessionId]` Session Detail

Use tabs or anchored panels rather than forcing every detail onto a single screen:

1. **Overview:** mode/status/timeline, runtime duration, instrument scope, current strategy/agent versions, simulated account summary and risk status.
2. **Live Chart:** reuse `/trade` chart components with session-bound data/markers; do not build a second chart engine.
3. **Decisions & Signals:** ordered timeline of market context → indicator/method outputs → AI analysis/proposal (if applicable) → signal/decision → risk gate result.
4. **Orders & Fills:** requested intent, order type, quote at request, fill model/version, requested/fill prices, partial fills, fees, spread, slippage and cancel/reject reasons.
5. **Positions & PnL:** lifecycle, entry/exit, SL/TP updates, realized/unrealized PnL, MAE/MFE, exposure and exit reason.
6. **Market & Data Quality:** provider/venue, timestamps, stale/gap/disconnect periods, subscription set, missing fields, dropped/duplicate/out-of-order events.
7. **AI Activity:** agent version, structured outputs, tool calls, evidence references, confidence/calibration metadata if defined, risk denials and operator approvals. Never expose secrets/API keys.
8. **Logs & Audit:** state transitions, start/pause/resume/stop actions, exceptions, reconnects, kill-switch events and audit IDs.
9. **Research:** create/open a linked evidence set, journal review, comparison or experiment proposal.

Timeline must be ordered by event time with received/processed time separately shown where useful. Late-arriving market data must not rewrite the claim of what the agent knew at the decision time; store corrections as new events or quality annotations.

## 59.9 Session lifecycle and runtime semantics

A session is one explicit run scope. It can be started by a user, an approved schedule or an authorized automation action, but every start must persist a `sessionId` before accepting actions.

```text
CREATED → VALIDATING → STARTING → RUNNING ↔ PAUSED
                                  │          │
                                  ├──────────┴→ DEGRADED
                                  ├────────────→ STOPPING → STOPPED
                                  ├────────────→ COMPLETED
                                  └────────────→ FAILED
```

- Validation checks strategy version, agent policy, instrument/venue support, feed health, dataset/source role, indicator warmup, risk configuration and account state.
- A failed preflight does not create an active trading session; it records an auditable failed-start attempt with reason.
- Graceful stop blocks new entries, cancels eligible pending paper orders according to policy and manages open simulated positions according to the selected policy. It must not silently erase positions.
- Pause/resume must define how existing positions and protective orders behave. On resume, refresh market state and reject stale snapshots.
- Session recovery after process restart must reload durable state and avoid duplicate orders/events by using idempotency keys and unique indexes where appropriate.
- Realtime decision logic uses event/market time, not wall-clock `Date.now()` for historical ordering. Preserve UTC milliseconds per existing time rules.
- One bot instance may launch multiple sessions sequentially or concurrently only if the profile's concurrency policy explicitly permits it.

## 59.10 Data collected for each AI/bot decision

Store an immutable decision-context snapshot or content-addressed reference at each decision point. Do not store only final “LONG/SHORT” text.

Minimum fields:

```ts
interface DecisionContextManifest {
  sessionId: string
  decisionId: string
  eventTime: number
  receivedAt: number
  processedAt: number

  instrumentId: string
  venue: string
  timeframe: string
  runMode: string

  quote?: { bid?: number; ask?: number; last?: number }
  candleRef?: { datasetId?: string; recordingId?: string; candleKey: string }
  indicatorSnapshotRef: string
  methodSnapshotRef?: string
  marketIntelSnapshotRef?: string
  dataQualityRef: string

  strategyVersion: string
  strategyParamsHash: string
  agentVersion?: string
  botProfileVersion: string
  engineVersion: string
  simulatorVersion?: string
  riskPolicyVersion: string

  decisionType: string
  decisionPayloadHash: string
  riskDecisionId?: string
}
```

Persist separately where applicable:

- raw/normalized signal event;
- AI observation and structured output;
- proposed action and action validation result;
- Risk Gate allow/deny decision with reason codes;
- order lifecycle/fill/fee/slippage records;
- position transitions and outcomes;
- source latency/quality observations;
- operator intervention and approval/rejection;
- references to the exact dataset/recording and relevant data hashes.

Use MongoDB for manifests, operational state, summaries, indexes and references; use the existing retention strategy for raw recording files/event streams. Avoid storing large raw tick/orderbook firehoses as unbounded MongoDB documents.

## 59.11 AI self-improvement pipeline

V3.4 should implement the data and governance foundation first; it must not promise that an AI model can autonomously discover a profitable strategy or improve win rate. Research outputs are hypotheses until evaluated with sufficient evidence.

### Pipeline

1. **Collect:** selected market recordings, session events, decisions, trades, outcomes and data-quality reports.
2. **Curate:** create a versioned `ResearchEvidenceSet`; remove duplicates; record missing coverage; link labels to event-time context; prevent future leakage.
3. **Diagnose:** group outcomes by strategy/agent version, symbol, timeframe, session, regime, volatility, signal reason, risk decision, spread/slippage and data health, when fields exist.
4. **Propose:** AI creates structured, bounded hypotheses and references the evidence. It must include sample size and limitations; no claim of higher win rate without validation.
5. **Experiment:** clone the immutable baseline into a new candidate version; define dataset splits, controls, baseline and acceptance metrics before execution.
6. **Evaluate:** use fees/slippage and appropriate execution semantics; in-sample/validation/holdout or walk-forward; compare expectancy, profit factor, drawdown, trade count, robustness and costs—not win rate alone.
7. **Promote to paper:** only eligible candidates with passing gates can start a distinct `LIVE_PAPER` session; maintain the incumbent baseline for side-by-side evaluation.
8. **Approve/version:** human reviews the result and explicitly promotes a new immutable strategy/agent version. No in-place mutation of active versions.
9. **Monitor drift:** compare paper outcomes and signal parity to frozen expectations; if data or behavior drifts beyond configured limits, halt new entries and notify the operator.

### Minimum experiment record

- experiment ID/title/hypothesis;
- parent strategy/agent version IDs;
- baseline and candidate hashes;
- exact evidence-set/dataset IDs and hashes;
- data window, symbol universe and timeframe matrix;
- in-sample/validation/holdout/walk-forward split definition;
- parameters searched and compute budget;
- execution, fee, spread, slippage and fill-model versions;
- metrics with trade counts and confidence/uncertainty indicators where valid;
- known missing data and confounders;
- status and approving user/audit reference;
- linked backtest runs and paper sessions.

### AI/model training distinction

Keep separate:

- **Strategy parameter optimization:** search parameters/conditions of an existing deterministic strategy.
- **AI agent/model evaluation:** evaluate structured decisions by one immutable model/prompt/tool version on held-out evidence.
- **Model training/fine-tuning:** optional later capability that requires a curated dataset, labels, split policy, model/version tracking, evaluation suite and rollback. Do not claim this exists merely because an LLM analyzes trade logs.
- **Live inference:** use the frozen released AI agent version and current allowed context. New training output becomes a candidate version, never an implicit live update.

## 59.12 Suggested domain models / collections

Audit the existing `docs/engine/data-model.md` and Mongo models first. Reuse existing collections and extend them only with a migration. The following names are logical targets; do not create duplicates if equivalent models already exist:

| Logical model | Purpose | Must link to |
|---|---|---|
| `indicator_definitions` / `indicator_versions` | Native indicator registry and immutable definitions | Indicator tests, strategies, versions |
| `strategy_profiles` / `strategy_versions` | Reusable strategies and immutable snapshots | Indicator/method versions, params hash |
| `ai_agents` / `ai_agent_versions` | Agent identity and immutable behavior configuration | Provider/model, strategy allowlist, tool policy |
| `bot_profiles` | Reusable deployment/risk/data configuration | Strategy version, optional agent version |
| `bot_instances` | Managed persistent runtime configuration/state | Bot profile, current status, session links |
| `trading_sessions` | Session manifest, lifecycle and summary | Bot instance, run mode, version snapshots |
| `session_events` | Ordered operational/decision timeline | Session ID, event ID, event/receive timestamps |
| `decision_contexts` | Immutable context manifests/references | Market data, indicators, strategy/agent versions |
| `orders` / `fills` / `positions` | Execution simulation domain state | Session ID, idempotency/client order ID |
| `research_evidence_sets` | Curated AI input evidence | Datasets, recordings, runs, trades, quality reports |
| `experiments` / `experiment_runs` | Hypothesis, candidate config, execution/evaluation | Baseline/candidate versions, splits, metrics |
| `ai_proposals` / `ai_evaluations` | Structured proposal/evaluation/audit | Agent version, evidence, experiment, reviewer |

Every collection requires documented indexes, retention/archival policy, schema version and tests. Use unique/deterministic IDs for replay-safe event ingestion. Do not invent a second order ID/idempotency scheme that conflicts with the existing `clientOrderId` contract.

## 59.13 Suggested APIs and realtime events

These are contract proposals. Align naming with the existing Nitro/API conventions and avoid duplicates after repository audit.

### AI agent management

```text
GET    /api/v1/ai-agents
POST   /api/v1/ai-agents
GET    /api/v1/ai-agents/:id
POST   /api/v1/ai-agents/:id/versions
POST   /api/v1/ai-agents/:id/validate
POST   /api/v1/ai-agents/:id/start
POST   /api/v1/ai-agents/:id/pause
POST   /api/v1/ai-agents/:id/resume
POST   /api/v1/ai-agents/:id/disable
GET    /api/v1/ai-agents/:id/activity
GET    /api/v1/ai-agents/:id/performance
GET    /api/v1/ai-agents/:id/sessions
```

### Trading sessions

```text
GET    /api/v1/sessions
POST   /api/v1/sessions                 # create through validated start workflow
GET    /api/v1/sessions/:id
GET    /api/v1/sessions/:id/timeline
GET    /api/v1/sessions/:id/orders
GET    /api/v1/sessions/:id/positions
GET    /api/v1/sessions/:id/metrics
GET    /api/v1/sessions/:id/data-quality
POST   /api/v1/sessions/:id/pause
POST   /api/v1/sessions/:id/resume
POST   /api/v1/sessions/:id/stop
POST   /api/v1/sessions/:id/halt
GET    /api/v1/sessions/:id/evidence
```

### Research integration

```text
POST   /api/v1/research/evidence-sets
GET    /api/v1/research/evidence-sets/:id
POST   /api/v1/research/proposals
POST   /api/v1/research/experiments
GET    /api/v1/research/experiments/:id
POST   /api/v1/research/experiments/:id/run
POST   /api/v1/research/experiments/:id/approve-candidate
```

Realtime event envelope should include at least:

```ts
interface SessionRealtimeEvent {
  eventId: string
  schemaVersion: number
  type: string
  sessionId: string
  eventTime: number
  receivedAt: number
  sequence?: number
  quality?: 'valid' | 'stale' | 'delayed' | 'gap' | 'duplicate' | 'out_of_order' | 'degraded'
  payload: unknown
}
```

Do not push every raw event to every browser. Session UI subscribes to session-specific state/timeline and appropriate aggregated market updates. Large histories use paginated REST/API queries; realtime channels carry deltas/status.

## 59.14 Page navigation and session creation flow

A user should be able to:

1. Open Strategy Library and pick an immutable strategy version.
2. Select “Create Bot Profile” and choose market scope, mode, account, risk profile and optional AI Agent version.
3. Validate the profile, including provider, instrument support, warmup and risk configuration.
4. Create a Bot Instance from the profile.
5. Start a Live Paper session.
6. Land directly on `/sessions/:id`, with the session appearing in `/sessions`.
7. Pause/resume/stop the session according to lifecycle policy.
8. Open the completed session, inspect all decisions/trades and create a Research Evidence Set.
9. Ask AI to analyze the evidence and create an Experiment.
10. Validate a candidate and launch a new paper session with a new immutable version, preserving the baseline for comparison.

A separate “Quick Start Paper Session” action may exist in `/trade`, but it must call the same server-side validated creation workflow and must not bypass profile/version snapshotting.

## 59.15 Implementation milestones

Do not attempt full autonomy in one implementation task. Implement in vertical slices with passing tests.

### Slice A — Domain audit and menu/routes

- Audit existing strategy/method/agent/bot/run/session/journal models and routes.
- Produce `docs/web-app/ai-agent-session-audit.md` and update `docs/web-app/navigation-audit.md`.
- Add AI Trading Agents and Trading Sessions to target navigation with feature-gated visibility.
- Preserve TM Hub auth, app identity, RBAC, route registry and existing routes.

Acceptance: route-to-domain ownership documented; no duplicate core services; no active menu link to a missing page.

### Slice B — Read-only observability

- Implement `/ai-agents` list/detail using existing AI gateway/model where available.
- Implement `/sessions` list and `/sessions/[id]` timeline using existing paper/journal/session evidence where available.
- Clearly label missing data fields; do not fabricate status, performance or live connectivity.

Acceptance: existing records can be queried and filtered; empty/loading/error states work; route auth and e2e tests pass.

### Slice C — Durable session lifecycle

- Add session manifest/model, state transitions, event timeline, unique IDs and restart recovery.
- Wire new live-paper runtime to create/update/close sessions without removing `exec/paper.mjs` compatibility prematurely.
- Ensure start/stop/pause/resume actions are server-authoritative and idempotent.

Acceptance: restart does not duplicate orders or sessions; state transitions are tested; every order/fill/position traces to one session.

### Slice D — AI Agent governance

- Version agent config and prompts.
- Implement tool allowlist, autonomy levels and explicit action schema.
- Enable A0/A1 first, then A2 Live Paper only after risk integration tests.
- A3 demo connector remains future gated; A4 real execution remains disabled.

Acceptance: unauthorized tools/actions are blocked and audited; agent cannot submit order without session, action schema, risk decision and idempotency key.

### Slice E — Evidence and research feedback

- Build session evidence bundle and reusable Research Evidence Set.
- Connect to existing AI research/experiment/backtest/holdout infrastructure.
- Add base-vs-candidate comparison and new paper validation sessions.

Acceptance: AI output links to evidence; experiment is reproducible; candidate remains separate from active baseline until approved.

### Slice F — Operational hardening

- Data-source health and stale/gap blocking.
- Heartbeats, lag metrics, alerting and kill-switch integration.
- Retention, backups, export, permission enforcement and audit review.

Acceptance: simulated failure tests for disconnection, stale feed, restart, duplicate command, Risk Gate denial and kill-switch pass.

## 59.16 Tests and Definition of Done

Unit/integration/e2e coverage must include:

- AI agent schema validation, immutable versions, invalid tool and autonomy policy denial;
- agent state transitions and health/heartbeat;
- create/start/pause/resume/stop session idempotency;
- session state recovery after process restart;
- duplicate event/order prevention;
- every simulated order goes through the existing Risk Gate;
- stale or invalid market feed blocks new entries per policy;
- session timeline preserves event time, received time and ordering metadata;
- orders, fills, positions and outcomes link back to the session;
- a completed session can produce a reproducible evidence set;
- AI proposal links to immutable evidence and an experiment; no silent strategy promotion;
- replay has no future leakage;
- existing `/`, `/trade`, `/runs`, `/runs/compare`, `/signals`, `/positions`, `/accounts`, `/journal`, Hub auth/RBAC and route seed behavior do not regress;
- the menu migration remains idempotent and preserves canonical leaf routes;
- `npm test`, `npm run typecheck`, `npm run verify` and relevant UI/e2e tests pass.

A page existing is not enough. A session UI is complete only when it shows real persisted session records and links to authoritative runtime state. An AI agent UI is complete only when versions, permissions, autonomy policy, operational state and audit history are backed by real data/contracts.

## 59.17 Required first deliverable for AI coding

Before implementing behavior, create a short audit with:

1. Existing files/models/APIs available for `ai/gateway.mjs`, `ai/agent.mjs`, `exec/risk.mjs`, `exec/paper.mjs`, `engine/journal.mjs`, `positions`, `runs`, `signals`, `intelligence`, and TM Hub route/auth integration.
2. Existing fields that can represent a session; if none, define the minimal new schema and migration.
3. Whether existing AI agent code is an analysis tool caller or a persistent autonomous runtime; do not assume one implies the other.
4. Route/API ownership map for `/ai-agents`, `/bots`, `/bots/instances`, `/sessions`, `/forward-tests`, `/research`, `/research/experiments`.
5. A milestone plan that begins with read-only observability and ends with governed Live Paper orchestration.

Do not make an autonomous trading promise based only on the presence of an AI chat endpoint. Implement the runtime and evidence lifecycle explicitly.

**Final V3.4 direction:** TM Trading should make it possible to answer, for every trading session: *which strategy and AI version ran, which data it saw, why it made each decision, how Risk Gate responded, what the simulator filled, what the outcome was, and which evidence supports the next proposed improvement.*


# 60. News, Events & Macro Intelligence — V3.5 Authority

This section adds a first-class information layer to TM Trading. It does **not** replace Market Core, indicators, strategies, Risk Gate, the AI Agent governance defined in §59, or the existing Market Intelligence foundation. It supplies traceable, time-correct information to those systems.

The system must answer five questions for every news-driven AI conclusion:

1. **What was reported?** Preserve title, publisher, original URL, language, timestamps, relevant entities and permitted source excerpt/summary.
2. **How do we know?** Distinguish official primary disclosure, licensed professional reporting, secondary commentary and unverified social claims.
3. **When could the system have known it?** Preserve publication, source-update, first-seen, ingestion and processing timestamps separately.
4. **Which market or instrument may be affected, and why?** Link the item to entities, event taxonomy, exposures, macro variables and a stated causal hypothesis rather than applying one generic sentiment label.
5. **Did it add measurable value?** Evaluate forecasts and signals against a suitable baseline with out-of-sample, time-aware tests.

The feature is an evidence and decision-support system. An AI-generated outlook is a conditional assessment, not a guarantee or personalized investment instruction. Under the current simulation-first roadmap, news intelligence informs observation, research and paper trading; it never bypasses Risk Gate or enables real-money execution.

## 60.1 Product scope and non-goals

### In scope

- Aggregate market-relevant news and official disclosures from multiple authorized sources.
- Organize information into clear market groups with cross-cutting tags for geography, sector, asset, event type, issuer, policy area and time horizon.
- Collect official economic releases, central-bank communications, corporate filings, exchange announcements, token/protocol announcements and licensed professional news where permitted.
- Normalize and deduplicate syndicated/updated stories; link multiple reports about the same event without deleting provenance.
- Extract entities, event types, claims, figures, dates and relevant affected instruments with supporting evidence.
- Generate separate short-, medium- and long-horizon market outlook snapshots for configurable markets and instruments.
- Provide evidence packets to AI research and AI trading agents under the policies in §59.
- Measure whether news and macro context improves decisions over price/technical baselines.
- Track provider health, rate limits, source freshness, source outages, content rights and data lineage.

### Explicit non-goals

- Do not build a crawler that ignores source terms, robots/access restrictions, paywalls, authentication or contractual restrictions.
- Do not assume public access means permission to store, redistribute, display full article text or use that text for model training.
- Do not equate article volume, social engagement, sentiment or source popularity with truth or likely price direction.
- Do not ask the LLM to invent missing facts, citations, market consensus, macro surprises or event outcomes.
- Do not turn a headline or an LLM opinion directly into an order. All executable paper actions remain subject to the existing session, action schema, idempotency and Risk Gate contract in §59.
- Do not start by fine-tuning or training a model on all collected articles. First establish permission, provenance, time correctness, evaluation data and measurable baseline value.

## 60.2 Target navigation and page responsibilities

Add only after auditing route ownership, existing `/intel`, `/calendar`, source settings and the TM Hub route registry. These are proposed canonical paths, not permission to create duplicate pages or services.

| Proposed route | Page | Responsibility |
|---|---|---|
| `/news` | News Desk | Unified feed with primary market-group tabs, language filters, source-quality labels, event clusters, recency and affected-market filters.
| `/news/events` | Market Events | Deduplicated events, affected entities/instruments, timeline, corroborating sources, revisions and impact evidence.
| `/news/sources` | Source Registry | Enable/disable connectors, view permitted uses, source tier, latency, freshness, error rate, rate limits, license status and last successful ingest. Admin-only actions use existing RBAC.
| `/calendar` | Economic & Corporate Calendar | Scheduled central-bank decisions, macro releases, earnings, corporate actions, token/network events and important exchange/regulatory dates. Reuse/extend an existing implementation if present.
| `/outlook` | Market Outlook | Evidence-backed outlook by market group/instrument and time horizon; bull/base/bear scenarios, confidence calibration, catalysts, counter-evidence and validity/expiry.
| `/research/news-impact` | News Impact Research | Historical event studies, forecast scorecards, ablation tests and news-vs-baseline comparisons. Reuse existing AI Research/Experiment UI where practical.
| `/intel` | Existing Market Intelligence | Keep the existing route as the main intelligence hub; add links/cards to News Desk, Outlook and Calendar rather than duplicating it.

Navigation groups should be user-workflow-oriented. Suggested placement:

```text
Markets
  Market Explorer                         /markets (if present)
  Market Intelligence                     /intel (existing)
  News Desk                               /news
  Market Events                           /news/events
  Market Outlook                          /outlook
  Economic & Corporate Calendar           /calendar

Administration & System
  Market Data Sources                     /system/data-sources (existing proposal)
  News Sources                            /news/sources (admin capability within the source registry)

Data & Research
  AI Research                             /research (existing target)
  Experiments                             /research/experiments (existing target)
  News Impact Research                    /research/news-impact
```

Menu items must be hidden or marked unavailable until their backend/API is actually implemented. Preserve existing route IDs and paths by default; register route changes through the existing TM Hub route mechanism and migration process. A menu item is never a substitute for server-side authorization.

## 60.3 Market taxonomy: top-level groups and cross-cutting tags

A story can belong to more than one group. For example, a US rate decision may affect global equities, crypto, gold, USD and Vietnam-market risk appetite. Use a primary domain plus many-to-many tags rather than forcing each story into a single exclusive category.

### Primary market groups

1. **Crypto & Digital Assets** — protocol/network updates, tokenomics/governance, exchange announcements, listings/delistings, stablecoin disclosures, custody/security incidents, institutional products and flows, regulatory decisions, ETF-related disclosures where relevant, mining/validator economics and material on-chain events from providers with appropriate rights.
2. **Global Equities** — US, Europe, Japan, China/Hong Kong, Korea, Taiwan, India, ASEAN and other configured markets; index-level news, company filings, earnings, guidance, buybacks/dividends, mergers, capital raises, sector developments and exchange/regulatory notices.
3. **Vietnam Equities & Capital Markets** — HOSE, HNX, UPCoM, listed issuers, official disclosure notices, corporate actions, earnings, bond-market notices, market structure, regulatory changes and market statistics.
4. **Macro & Central Banks** — policy-rate decisions, central-bank speeches/minutes, CPI/PCE/inflation, labor and employment, GDP, PMI, retail sales, trade data, fiscal policy, liquidity, sovereign yields and official macro revisions.
5. **FX, Gold, Rates & Commodities** — USD and major currency pairs, gold/XAU, oil, industrial/precious metals, agriculture, sovereign yields, real rates, dollar-liquidity conditions and supply/demand shocks. Market price feeds remain authoritative for observed prices; news explains context and possible catalysts.
6. **Regulation, Geopolitics & Systemic Risk** — laws and enforcement, sanctions, elections and public-policy changes, trade restrictions, conflicts, shipping/logistics disruptions, cyber/operational incidents and other cross-market risks.
7. **Company, Sector & Industry Intelligence** — issuer/sector-level events cross-linked to one or more equity markets, supply chains, technology, banks, energy, consumer, healthcare and other configured sectors.

### Cross-cutting classification dimensions

Every normalized item/event should support zero or more values for: `marketGroup`, `geography`, `exchange`, `assetClass`, `symbol`, `issuerId`, `sector`, `eventType`, `policyArea`, `language`, `sourceTier`, `severity`, `novelty`, `reliability`, `potentialImpactWindow`, `macroSeries` and `topicTags`. Store normalized IDs separately from original source strings.

Suggested event types include: `official_disclosure`, `earnings`, `guidance`, `corporate_action`, `listing_delisting`, `protocol_upgrade`, `security_incident`, `regulatory_action`, `central_bank_decision`, `macro_release`, `macro_revision`, `geopolitical_event`, `commodity_supply_shock`, `market_structure_change`, `fund_flow`, `analyst_commentary`, `rumor_unverified` and `correction`. Taxonomy must be versioned and extensible; avoid embedding all classification logic in frontend components.

## 60.4 Source hierarchy, registry and policy

“Trusted sources” must be represented as a policy-backed registry, not a hardcoded list of favorite websites. An official source is authoritative for what that institution published, but does not make every related interpretation or forecast certain.

### Recommended trust tiers

| Tier | Meaning | Examples / handling |
|---|---|---|
| `T0_PRIMARY` | Original issuer, regulator, exchange, government or statistical/central-bank publication | Preferred for factual event confirmation and official figures. Preserve the exact primary URL and release timestamp.
| `T1_LICENSED_NEWS` | Professional news provider or wire service accessed under a verified API/feed agreement | Useful for coverage, context and fast reporting. Respect the exact contract for display, storage, redistribution, excerpts, derived summaries and model use.
| `T2_SECONDARY` | Reputable specialist publications, research notes or analyst commentary | Label as commentary/secondary; link the primary document when available. Do not treat opinions as confirmed facts.
| `T3_UNVERIFIED_SOCIAL` | Social posts, chat groups, anonymous claims, or community reports without confirmation | Optional isolated discovery layer only. Mark unverified, require corroboration and prevent direct high-confidence trade impact. May be disabled entirely in early milestones.

Do not implement a single numeric “truth score” that hides these differences. Store source class and independent factors (authority, directness, corroboration, novelty, timestamp quality, correction history, and provider health). Source-quality metadata should explain why a claim is treated as confirmed, corroborated, unconfirmed or contradicted.

### Source Registry fields

A source record should include at least:

- `sourceId`, display name, provider/publisher, source type, canonical domain and source language(s);
- `transport`: official API, RSS/Atom, licensed news API, permitted page polling, webhook or manually curated source;
- `trustTier`, supported market groups, geographies, entity/event coverage and tags;
- `licenseStatus`, `termsUrl`, `allowedFetch`, `allowedStoreMetadata`, `allowedStoreFullText`, `allowedDisplay`, `allowedGenerateSummary`, `allowedInternalModelProcessing`, `allowedTrainingUse`, attribution rules, retention ceiling and redistribution restrictions;
- `pollInterval`, quota/rate limit, timeout, retry policy, concurrency limit and source-specific user agent/headers where required;
- last successful fetch, last item timestamp, last error, lag, consecutive errors, circuit-breaker state and health status;
- effective-from/effective-to, config version, created/updated actor and audit history.

The rights/permission fields must be explicit and conservative. Unknown permission means disallowed until reviewed, not silently allowed. License metadata must be checked before a connector is enabled, and a terms change should trigger a review state. Never place provider secrets in frontend payloads; use server-side credentials and the existing configuration/secret-management pattern.

### Initial source candidates for source audit

These are candidates for a connector audit, not a claim that each site exposes an unrestricted API or permits full-text storage/model training. Verify current access methods, limits and terms before activation.

| Domain | Candidate primary sources | Notes |
|---|---|---|
| US equities / corporate filings | SEC EDGAR submissions and XBRL APIs; issuer investor-relations pages; exchange/regulator notices | Prefer structured filings and official documents; respect access policy and request limits.
| US macro / monetary policy | Federal Reserve/FOMC releases; BEA and BLS releases; FRED/ALFRED time-series/vintage data | Record actual release times, units, revisions and historical vintages; do not mistake a current revised series for what was known earlier.
| Europe / central banks | ECB press-release RSS and ECB Data Portal; other official central-bank/statistical agencies by jurisdiction | Separate official release from third-party consensus forecasts.
| Vietnam securities | State Securities Commission (SSC); HOSE; HNX issuer/exchange disclosures; VSDC where relevant; issuer investor-relations pages | Audit available structured feeds/pages and the rights/access model; do not assume every official site exposes a public API.
| Vietnam macro / policy | National Statistics Office; State Bank of Vietnam; Ministry of Finance and other responsible ministries/agencies | Preserve Vietnamese original text, published time, reference period and revisions.
| Crypto | Official exchange announcement channels/APIs; foundation/protocol governance and release channels; issuer/stablecoin disclosures; applicable regulators | Official venue APIs and announcements can be useful for market mechanics. Do not treat an exchange's own announcement as neutral independent analysis.
| Global news coverage | Licensed professional news feeds/APIs; permitted RSS feeds; a discovery/coverage service such as GDELT where its current contract and fields fit | Aggregators can improve discovery/clustering, but their output is not automatically primary-source confirmation or a substitute for licensed reporting.
| Specialist research | Clearly licensed research APIs and publisher-authorized feeds | Separate factual news from opinion, estimates and promotional content.

Source examples/documentation to check during implementation: SEC EDGAR API documentation at `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`; FRED API at `https://fred.stlouisfed.org/docs/api/fred/`; Federal Reserve monetary-policy releases at `https://www.federalreserve.gov/monetarypolicy.htm`; ECB RSS at `https://www.ecb.europa.eu/home/html/rss.en.html`; ECB Data Portal API at `https://data.ecb.europa.eu/help/api/data`; Vietnam SSC at `https://ssc.gov.vn/`; HNX disclosure portal at `https://stoxvn.hnx.vn/vi-vn/thong-tin-cong-bo-ny-hnx.html`; Vietnam National Statistics Office monthly reports at `https://www.nso.gov.vn/en/monthly-report/`; Binance official developer docs at `https://developers.binance.com/en/docs/introduction`; Bybit official announcement API docs at `https://bybit-exchange.github.io/docs/v5/announcement`; GDELT Cloud API docs at `https://gdeltcloud.com/api-docs`.

The initial source audit deliverable must document the actual authentication/access method, whether polling is permitted, quotas, expected latency, data scope, historical coverage, license implications and fallback strategy for each selected source. Start with a small number of high-value, clearly authorized sources rather than dozens of fragile scrapers.

## 60.5 Ingestion and normalization pipeline

Implement one backend ingestion pipeline with source-specific adapters. Never let a frontend page or individual AI agent fetch and interpret arbitrary external websites independently.

```text
Source Registry / License Policy
        ↓
Scheduled Poller / Official API / RSS / Provider Webhook
        ↓
Provider-specific Adapter + Rate Limit + Retry / Circuit Breaker
        ↓
Immutable Raw Envelope (only content legally retainable)
        ↓
Canonical Normalization + Timestamp Validation
        ↓
URL / Content Fingerprint / Syndication Deduplication
        ↓
Story Cluster + Entity / Instrument Resolution
        ↓
Event Classification + Claim / Number Extraction
        ↓
Source Provenance + Corroboration / Contradiction Graph
        ↓
Evidence-backed Summary + Relevance / Impact Hypotheses
        ↓
News Desk / Market Events / Calendar / Market Outlook
        ↓
Research Evidence Set + AI Agent Context Packet
        ↓
Evaluation, Paper Session Audit and Feedback
```

Each connector must be idempotent. Re-fetching the same page or feed entry must not create duplicate `NewsItem` records or repeatedly trigger the same alert/agent event. Use bounded retries, exponential backoff with jitter, provider-specific rate limits, request timeouts, circuit breakers, per-source health and a dead-letter/review queue for malformed records. Do not retry permanent permission, invalid-credential or license errors indefinitely.

### Canonical ingestion envelope

Normalize incoming records into a versioned envelope. Example fields (not a demand to copy this exact shape if the repository already has a compatible model):

```ts
type NewsEnvelope = {
  schemaVersion: number
  sourceId: string
  providerItemId?: string
  sourceUrl: string
  canonicalUrl?: string
  title: string
  summary?: string            // only if provider/license permits
  bodyRef?: string            // pointer to authorized storage only
  language?: string
  author?: string
  publishedAt?: string        // source publication time
  sourceUpdatedAt?: string    // source correction/update time
  firstSeenAt: string         // first observation by TM Trading
  ingestedAt: string          // durable ingestion time
  processedAt?: string        // normalization/classification time
  sourceTimezone?: string
  contentHash?: string
  canonicalFingerprint: string
  marketGroups: string[]
  entityRefs: string[]
  eventTypes: string[]
  sourceTier: string
  licensePolicyVersion: string
  status: 'active' | 'corrected' | 'retracted' | 'unavailable'
}
```

Use ISO timestamps in UTC internally; preserve the original timezone and displayed local time where useful. Missing publication time must remain missing/low quality rather than being fabricated from ingestion time. Keep `publishedAt`, `firstSeenAt`, `ingestedAt`, `processedAt`, and any event-effective time distinct.

### Deduplication, syndication and updates

- Canonicalize URLs without removing meaningful query parameters that identify an article or filing.
- Deduplicate repeated feed IDs and exact content hashes.
- Use conservative title/text similarity to cluster syndicated or near-duplicate stories; similarity creates a cluster, not proof that the items have the same factual content.
- Preserve each publisher item and its source attribution inside the cluster. Never overwrite five independent reports with one source record.
- Track revised stories, corrections, deletions, retractions and materially changed numbers as versioned events.
- Separate a new article about an old event from a new event; allow the cluster to gain supporting/counter sources over time.
- Avoid counting the same syndicated wire story as many independent confirmations. Corroboration must estimate source independence.

### Language and translation

Preserve the source-language title and permitted source text. Store machine translations as derived fields with model/version metadata; never replace the original. For Vietnamese and English, prefer explicit multilingual entity aliases and market dictionaries. Translation must not silently change ticker symbols, decimal separators, currency units, negation, regulatory terms or time expressions. The source URL and language remain visible next to any translated summary.

## 60.6 AI extraction must produce evidence, not only prose

AI/NLP should convert each eligible item into structured, reviewable data. Its output is a derived assessment; the original source and exact permitted evidence remain authoritative.

### Required extraction object

```ts
type ExtractedNewsAssessment = {
  sourceItemId: string
  extractorModelVersion: string
  schemaVersion: number
  languageDetected?: string
  normalizedHeadline: string
  summary?: string
  claims: Array<{
    claimId: string
    claimType: 'fact' | 'quote' | 'estimate' | 'opinion' | 'rumor' | 'correction'
    claimText: string
    evidenceStart?: number
    evidenceEnd?: number
    sourceUrl: string
    confidence: number
    verification: 'primary_confirmed' | 'multi_source' | 'single_source' | 'unverified' | 'contradicted'
  }>
  entities: Array<{
    entityId?: string
    entityType: 'instrument' | 'issuer' | 'exchange' | 'protocol' | 'person' | 'organization' | 'country' | 'macro_series' | 'commodity'
    sourceText: string
    normalizedId?: string
    confidence: number
  }>
  eventType: string
  affectedMarkets: string[]
  potentialDrivers: string[]
  possibleDirectionByHorizon?: Record<string, 'bullish' | 'bearish' | 'mixed' | 'unknown'>
  impactConfidence: number
  counterEvidenceNeeded: string[]
  humanReviewRequired: boolean
}
```

The exact schema can be adapted to existing project conventions. Keep confidence bounded to `[0,1]`; it is a model confidence field, not automatically a calibrated probability that the market will rise or fall. Use separate forecast probability fields only after validation/calibration.

### Hallucination and prompt-injection protection

- Treat fetched headlines, article text, HTML, RSS fields, PDFs and embedded text as **untrusted input**, not system instructions. Do not execute instructions found inside external content.
- Use a strict output schema and validate every model result. Reject unknown fields, malformed IDs, unsupported citations and non-finite numbers.
- The model may only cite stored `NewsItem`/`MarketEvent` IDs and original source URLs already in the evidence packet. It cannot invent a link or represent an absent document as read.
- For critical claims, preserve a short permitted evidence excerpt or exact structured official figure and its source location; if licensing does not allow excerpt storage, preserve metadata and URL and retrieve/render only through an authorized mechanism.
- The model must be allowed to return “unknown / insufficient evidence / sources conflict.” Do not force a directional label.
- Distinguish facts directly stated by a source from inferred cause/effect, analyst opinion and AI hypothesis.
- Do not execute arbitrary HTML, scripts, attachments or source-provided commands. Sanitize renderable content and keep fetchers isolated from credentials/internal networks.

## 60.7 Macro and corporate event calendar

A news feed and an event calendar serve different jobs. The feed records unplanned and reported information; the calendar manages scheduled events and later links them to actual published outcomes. Both should use shared source, entity and event contracts.

For each scheduled macro release, where licensed/source-supported, capture:

- event key, jurisdiction, agency, series identifier, event name and importance label;
- scheduled time, timezone, source page, expected revision/version and event status;
- prior value, prior value as known before release, market consensus and consensus-provider/source, actual value, unit and release period;
- difference/surprise calculation, calculation method, scale/direction semantics and source timestamp;
- corrected/revised values and publication vintage;
- linked instruments/markets and historical event-study evidence, without asserting that historical reaction guarantees the next reaction.

Do not fabricate consensus when the official source only publishes the actual figure. If consensus data is available only from a licensed provider, store provenance and permission metadata. Keep “actual versus consensus”, “actual versus previous”, and “revision of previous” as distinct features. Their interpretation varies by series and policy regime.

Corporate/crypto event calendars should similarly distinguish planned date/time from actual event time and announcement time. All dates require timezone-aware storage and a normalized UTC instant where known. Uncertain/estimated event times should be labeled.

## 60.8 Outlook engine: short-, medium- and long-horizon assessments

`/outlook` is a dedicated synthesis product, not a chat response with a bullish/bearish label. Produce separate snapshots for market groups and, where enough evidence exists, for individual instruments. A market-group outlook must not be copied blindly to every constituent asset.

Suggested configurable default horizons:

| Horizon key | Illustrative range | Use |
|---|---|---|
| `intraday` | Next minutes to one trading session | Fresh events, scheduled releases, short-term risk and volatility context. Availability depends on feed latency and asset-market hours.
| `short_term` | 1–7 calendar days | Near-term catalysts, policy/data releases, trend context and event risk.
| `swing` | 1–4 weeks | Earnings cycle, sector/regulatory themes, macro shifts and developing market regimes.
| `long_term` | 1–6 months or project-configured | Structural trends, monetary/fiscal regime, industry/protocol fundamentals and longer-term risk scenarios.

These are product defaults, not universal financial definitions. Each forecast record must declare its exact start/end horizon, generation time, market-hours convention and expiry.

### Required outlook output

Each `MarketOutlookSnapshot` should include:

- market group, instrument/universe and explicit horizon;
- generation time, validity/expiry, price/data snapshot IDs and market-data quality state;
- an overall state such as `bullish`, `bearish`, `neutral`, `mixed` or `insufficient_evidence`;
- where sufficiently validated, calibrated scenario probabilities for bullish/base/bearish outcomes that sum to 1 within tolerance; otherwise store qualitative scenarios without pretending the values are calibrated;
- trend/regime context, volatility/event-risk assessment and evidence-backed catalysts;
- the three to five most important supporting items/events and counter-evidence, each linked to its `NewsItem`, `MarketEvent` or official macro series;
- source diversity, primary-source coverage, unresolved contradiction count and stale-data warnings;
- the model/prompt/taxonomy/source-set versions, evidence-set hash and feature/config hashes;
- what would strengthen/weaken the scenario, the main invalidation conditions and which upcoming events may change the assessment;
- limitations and uncertainty.

The interface must visually distinguish **observed facts**, **source-reported estimates**, **market consensus**, **AI interpretation** and **scenario/probability output**. Do not communicate false precision. Every summary should have a “why this view?”, “what contradicts it?” and “open source” path.

### Separate sentiment, event significance and price forecast

Do not merge these into one opaque score. Keep independent fields for:

- `sentiment`: stance expressed in the language of an article/source;
- `eventSeverity`: potential operational/fundamental/regulatory importance;
- `novelty`: how new the information is relative to the existing cluster;
- `sourceConfidence`: source/provenance quality;
- `marketRelevance`: relationship to this market/instrument/horizon;
- `impactHypothesis`: a conditional, explainable causal path;
- `directionalForecast`: predicted outcome distribution, if the model has been validated for this task.

A positive article can coincide with a falling price when expectations were higher, the news was already priced in, liquidity changed, or another event dominated. Therefore, direction cannot be derived by averaging positive/negative headline sentiment alone.

## 60.9 Impact model and cross-market propagation

The feature should describe plausible transmission paths instead of assigning generic impacts without evidence. Examples of relationships to research include:

- central-bank policy / inflation / employment → rate expectations, yields, currency, global equities, gold and crypto risk appetite;
- USD/liquidity/real-yield changes → potential pressure/support paths for gold and risk assets;
- major crypto exchange/protocol/regulatory events → directly affected tokens/venues first, then potential sector-wide effects if evidence supports it;
- Vietnam policy, currency, interest-rate, trade, credit and corporate disclosures → relevant listed issuers/sectors and the broader Vietnam market;
- company supply-chain/earnings events → the issuer, competitors, suppliers/customers, and sector indices only where entity relations are mapped and justified.

These are hypotheses to test, not universal directional rules. Model the entity/exposure graph with edges such as `issuer_of`, `listed_on`, `member_of_index`, `sector_exposure`, `supplies_to`, `regulated_by`, `protocol_native_asset`, `quote_currency` and `macro_sensitive_to`. Every edge should have a source, confidence and valid time range. Start with high-confidence explicit mappings and avoid automatically creating authoritative links from LLM output alone.

An `ImpactAssessment` should carry the path explanation, linked events, relevant market observations, horizon, assumptions, counter-evidence and model version. If the causal path is speculative or evidence is weak, label it “possible spillover” rather than “confirmed impact.”

## 60.10 AI Agent context integration and news-aware sessions

The news system should provide a bounded, queryable **News Evidence Packet** to the existing AI Agent runtime in §59. It must not create a parallel agent or alternate execution path.

For each analysis/decision context, select information according to:

1. market group, instrument, issuer/protocol and explicitly mapped exposures;
2. configured lookback window and horizon;
3. `firstSeenAt` / information-available time, not just article publication date;
4. source trust tier, confirmation state, correction/retraction state and source diversity;
5. event novelty, relevance and age decay;
6. token/context budget and deterministic ranking;
7. known data-quality gaps, clock skew and provider lag.

A packet should include a compact evidence table with IDs, headline, source, timestamps, source tier, claim status, linked events/entities, relevance explanation, permitted summary and canonical URL. Keep packet IDs and hashes in the session decision record so researchers can reproduce what the agent saw.

### AI agent rules

- Start with read-only `A0 Observe` and `A1 Propose` from §59. Enable `A2 Autonomous Paper` only after the existing Risk Gate, idempotency and session tests pass.
- The agent may request an outlook/evidence packet, ask for corroboration, compare conflicting sources and propose an experiment. It may not decide that an unknown/unverified social post is fact merely because several accounts repeat it.
- A news-based suggestion must cite evidence IDs and state the reasoning path and important counter-evidence.
- A packet with stale feeds, missing key providers, unresolved critical contradiction or insufficient primary-source coverage must return a degraded/uncertain status. Policies may block new news-dependent paper entries or require human review; they must not invent missing data. Any block is expressed through the established policy/Risk Gate interfaces, not hidden prompt language alone.
- News may modify a research feature or proposal but may not mutate an active strategy, switch autonomy level, disable Risk Gate, change risk limits or call an unrestricted execution tool.
- The session captures the exact evidence packet/hash, outlook snapshot/version, source-health snapshot and source-item IDs used for each decision.
- Never send private user data, credentials, account secrets or unrelated records to external model providers. Apply data-minimization and provider-specific processing policies.

### Context relevance and bounded retrieval

Do not send the full day’s news stream to every agent. Define a stable ranking/retrieval contract (for example, required primary-event matches first, then market/entity relevance, novelty, recency, corroboration and diversity) and version it. Retain excluded-item counts/reasons where needed for reproducibility. The same query with the same index snapshot, clock and config should return a reproducible ordering, subject to documented provider/model determinism limits.

## 60.11 Data models, collections and relationships

Before adding schemas, inspect existing `intelligence`, `scanner`, news/funding/OI/liquidation/regime modules, scheduler/queues, AI research and Mongo models. Extend/reuse compatible models instead of duplicating them. The following is a logical domain contract, not permission to create a second source of truth.

| Entity / collection concept | Minimum responsibility |
|---|---|
| `NewsSource` | Source metadata, trust tier, connector settings reference, licensing permissions and operational health. Secrets remain in the server-side secret store.
| `NewsItem` | Immutable normalized source item metadata, timestamps, source attribution, permitted text fields, content hash and correction/retraction status.
| `NewsItemRevision` or versioned item history | Preserve material title/body/number changes without losing what was previously known.
| `NewsStoryCluster` | Groups related/syndicated reports while retaining individual source items and source-independence metadata.
| `MarketEvent` | Canonical event view linking claims, entities, sources, event time/known time, status and affected markets.
| `NewsAssessment` | Versioned NLP extraction, factual/estimate/opinion classification, language/translation, entities and model confidence.
| `MacroSeries` / `MacroObservation` | Canonical series identity, unit, reference period, publication time, value and source/vintage/revision lineage.
| `MacroCalendarEvent` | Scheduled release, previous/consensus/actual/revision values and their separate provenance.
| `MarketOutlookSnapshot` | Horizon-specific assessment, scenarios/probabilities when validated, evidence hashes, state and expiry.
| `NewsEvidenceSet` | Frozen list of news/event/macro evidence available to a research run, including rights-safe references and hashes.
| `ImpactAssessment` | Explicit cross-asset impact hypothesis, exposure path, supporting/contrary observations and validation status.
| `NewsModelEvaluation` | Evaluation period, holdout definition, baseline, metrics, data snapshot/model version and result status.

### Required relationships

```text
NewsSource 1 ── N NewsItem
NewsItem N ── N NewsStoryCluster
NewsItem N ── N MarketEvent
MarketEvent N ── N Entity / Instrument / MacroSeries
MarketEvent 1 ── N NewsAssessment versions
MacroSeries 1 ── N MacroObservation vintages
MarketOutlookSnapshot N ── N NewsItem / MarketEvent / MacroObservation
NewsEvidenceSet N ── N NewsItem / MarketEvent / MacroObservation
NewsEvidenceSet 1 ── N Research Experiment / Forecast Evaluation
NewsEvidenceSet 1 ── N AI Agent decision / Trading Session event
ImpactAssessment N ── N MarketEvent / Market Observation
```

### Storage and indexing principles

- Use the existing MongoDB/Mongoose conventions unless repository evidence justifies a separate storage system.
- Keep legally retainable metadata and normalized records separate from external full text/raw payloads. If full text cannot be stored, persist only permitted metadata, evidence references and rights-compliant derived fields.
- Add indexes for `sourceId + providerItemId`, canonical URL/fingerprint, publication/first-seen time, market group/time, normalized entity/event references, status and outlook market/horizon/generation time. Use uniqueness where idempotency requires it.
- Add TTL/retention only where policy permits. Do not TTL-delete records still required by an active experiment, trading-session audit, legal hold or reproducibility rule; use an explicit retention exception policy.
- Store large permitted payloads outside hot query collections if volume warrants it; keep object references, hashes, schema version and rights metadata in Mongo.
- Maintain schema migrations/backfill rules; new fields must distinguish unavailable values from empty arrays/zero.

## 60.12 API contracts and realtime event types

Follow the repository’s current `/api/v1` conventions, auth middleware and response schema. Reuse the Hub app identity/RBAC. These are target resource responsibilities; exact paths should be reconciled with existing APIs before implementation.

### News Desk / sources

```text
GET    /api/v1/news                       list/filter normalized items or clusters
GET    /api/v1/news/:id                   get one item and its provenance
GET    /api/v1/news/clusters/:id          cluster detail and source reports
GET    /api/v1/news/events                list normalized market events
GET    /api/v1/news/events/:id            event detail, evidence and revisions
GET    /api/v1/news/sources               list visible source metadata/health
GET    /api/v1/news/sources/:id           source detail and permitted settings
POST   /api/v1/news/sources/:id/validate  validate connectivity/access/rights metadata
POST   /api/v1/news/sources/:id/enable    enable after authorization and policy validation
POST   /api/v1/news/sources/:id/disable   disable connector; preserve audit history
POST   /api/v1/news/ingestion/retry       enqueue authorized retry/reprocessing
```

Connector enable/disable, license changes and manual reprocessing are privileged audited actions. An API must not accept a caller-supplied URL for unrestricted server-side fetching; source onboarding must pass allowlist, SSRF protection, credential isolation and terms review.

### Calendar / outlook / research

```text
GET    /api/v1/calendar                  scheduled macro/corporate/crypto events
GET    /api/v1/calendar/:id              event and release provenance
GET    /api/v1/outlook                   list latest snapshots by market/horizon
GET    /api/v1/outlook/:id               immutable outlook detail and evidence
POST   /api/v1/outlook/generate          enqueue governed generation request
GET    /api/v1/research/news-impact      evaluation list / scorecards
POST   /api/v1/research/news-impact/run  create evaluation against selected evidence/data
GET    /api/v1/research/evidence-sets    news/macro evidence bundles
POST   /api/v1/research/evidence-sets    freeze a reproducible evidence set
```

Generation and evaluation endpoints should enqueue bounded jobs, return durable IDs and status, and avoid long synchronous requests. The client polls/subscribes to job state rather than assuming the model has finished. Respect existing queue/job services at `/resources/queues`; do not create an unrelated queue system.

### Internal domain events

Possible event types include:

```text
news.item.ingested
news.item.updated
news.item.corrected
news.item.retracted
news.cluster.updated
news.event.confirmed
news.event.disputed
news.source.degraded
news.source.recovered
macro.release.published
macro.release.revised
outlook.snapshot.ready
outlook.snapshot.expired
news.evidence-set.created
news.model-evaluation.completed
```

All events need a durable event ID, schema version, entity reference, UTC occurred-at and emitted-at timestamps, idempotency key, source/job correlation IDs and audit context. A correction/retraction must reach derived outlooks and active research views; do not silently leave an old outlook presented as current.

## 60.13 Historical evaluation, backtesting and research standards

News-driven research is especially vulnerable to look-ahead and survivorship bias. A historical article’s publication date alone does not prove TM Trading had the item at that time.

### Point-in-time availability rule

For replay/backtest, only use information that would have been available at the simulated timestamp according to a defensible availability record. Prefer the captured `firstSeenAt` or provider-provided availability time and archived source/version snapshots. If the system has no historical ingest/availability record, label the news feature as **not point-in-time safe** and exclude it from predictive backtests, or test it separately as a non-executable retrospective study. Do not infer availability from a current page’s publication label.

For macro series, preserve vintage/revision history and use the values known at the tested time rather than the latest revised value. For earnings/official disclosures, preserve the first known headline/value and subsequent correction timestamps. Replay must not access an article, correction, calendar outcome or consensus change published after its simulation clock.

### Evaluation protocol

1. Establish a price/technical baseline using the same instruments, time periods, costs, market hours and evaluation windows.
2. Test news-only and macro-only features separately, then test combined features.
3. Use walk-forward and strictly held-out periods with time-aware splits; avoid random shuffling across future/past data.
4. Evaluate multiple market regimes, including quiet periods, high-volatility events and low-coverage periods.
5. Record feature availability, provider outages, source mix, language/translation and evidence coverage.
6. Report uncertainty, sample count, missingness, calibration and confidence intervals where appropriate. Do not select only favorable event examples.
7. Keep the candidate immutable, compare it with the baseline, then validate in a forward-paper session according to §59.

### Metrics

Use metrics appropriate to task and class balance; no one metric is sufficient. Potential measures include:

- event classification precision/recall by class and severity;
- entity linking precision and false-symbol match rate;
- deduplication pairwise quality and cluster purity;
- source confirmation delay, ingestion latency, stale-feed rate and correction/retraction propagation time;
- forecast log loss/Brier score and calibration error only for forecasts that output probabilities;
- directional accuracy/balanced accuracy where meaningful, plus benchmark-relative performance;
- volatility/event-risk detection recall and false-alarm rate;
- incremental forecast value versus baseline, tested with news-feature ablation;
- paper-trading impact on risk/exposure/drawdown and simulated outcome under the same fill/cost model, without extrapolating simulator results to real-world guarantees.

Keep research findings separate from active strategy configuration. Promotion requires a new immutable version, signed-off evaluation record and explicit human approval; no self-modifying live policy.

## 60.14 Monitoring, freshness and graceful degradation

Each source has its own expected publishing cadence and freshness SLA; a central-bank RSS feed and a fast crypto venue announcement endpoint should not share one universal “stale after five minutes” rule. Configure per-source and per-domain thresholds.

Required measurements:

- fetch success/error counts, API quota/rate-limit events and provider latency;
- last successful fetch, most recent source publication time and ingestion lag distribution;
- duplicate rate, malformed item rate, unrecognized entity rate and unresolved cluster rate;
- extraction queue lag, failed model/schema-validation rate and human-review backlog;
- source coverage by market group/language/trust tier;
- license review status, retention-policy violation count and blocked-use attempts;
- outlook age, evidence age, primary-source coverage, source conflicts and expiry state.

If a provider is down, preserve last good records with an explicit stale/degraded label. Do not present “no news” when ingestion failed. A missing source is not evidence that no event happened. The outlook must show degraded coverage and may return `insufficient_evidence`. Recovery should backfill within provider terms, dedupe idempotently and document gaps that cannot be recovered.

## 60.15 Security, privacy, licensing and retention

- Use connector allowlists and defend against SSRF, redirects to private IPs, DNS rebinding, oversized responses, zip/XML bombs, unsafe attachments and unexpected content types.
- Store API credentials server-side only; rotate/revoke credentials through the supported secret/config path. Redact query tokens and private headers from logs.
- Enforce per-provider rights at ingest, storage, indexing, model-processing, display, export and training time—not only in the UI.
- Default to metadata + original attribution/link + rights-compliant summary. Full text and training usage require an explicit, documented permission path.
- Define separate retention schedules for raw provider payloads, normalized metadata, derived summaries, user-generated annotations, evaluation data and immutable session evidence. Respect deletion/correction obligations without silently breaking audit integrity; record a tombstone/policy event where permitted.
- Cache only as allowed by the source agreement; if cache/storage duration is restricted, enforce expiration automatically.
- Show required attribution and original link. Do not republish substantial excerpts or entire articles as if owned by TM Trading.
- Make model-provider sharing explicit: send only the minimum licensed/authorized text needed for the task and only to providers whose terms permit that processing.
- Retain a policy/config version with each AI assessment and outlook so a later rights-policy change can identify records or pipelines that need reprocessing or deletion.

## 60.16 Implementation milestones

Implement in slices, auditing the existing repo first. Do not create all routes/models at once.

### Slice A — Source audit and rights matrix

- Inventory existing news/intelligence/news-calendar/provider code, cron jobs, queues, Mongo schemas, `/intel`, AI Research and shared Hub integrations.
- For each proposed source, record endpoint/feed, authorization, rate limits, source authority, supported markets/languages, historical coverage and all rights flags.
- Select a minimal pilot set spanning crypto official announcements, global primary/macro sources and Vietnam official disclosures/statistics.
- Deliver `docs/news-source-audit.md`, `docs/news-taxonomy.md` and `docs/news-license-matrix.md`.

Acceptance: no connector can be enabled without a documented source record, owner, access method and permission policy. No second news pipeline is created if an existing one can be upgraded.

### Slice B — Ingestion and News Desk (read-only)

- Build/extend registry, normalized envelope, idempotent ingestion, dedupe and source health.
- Add `/news` with primary market groups, filters, source labels, link to source, loading/error/empty/degraded states and language preservation.
- Keep initial article display metadata/rights-safe summary only.

Acceptance: replayed feed items do not duplicate records; source citations open the correct original; provider failure is visible; rights restrictions are enforced server-side.

### Slice C — Event clusters, entities and calendar

- Add event normalization, issuer/instrument mapping, source corroboration and contradiction display.
- Add `/news/events`; extend `/calendar` only after auditing existing route/service.
- Version corrections and macro release observations/vintages where source data supports them.

Acceptance: one event may have multiple source items, all retained with provenance; correction/retraction status propagates; entity-link uncertainty is visible.

### Slice D — Evidence-backed summaries and outlook v1

- Add strict structured extraction with evidence IDs, confidence, source status and “unknown” behavior.
- Add `/outlook` for at least the initial pilot market groups with short-, swing- and long-horizon separation.
- Require source links, “supporting evidence”, “counter-evidence”, expiry and coverage state.

Acceptance: every factual claim can be traced to a permitted evidence source; fabricated citations/market consensus fail schema checks; unsupported groups return insufficient evidence instead of a generic prediction.

### Slice E — Research evaluation and agent integration

- Freeze `NewsEvidenceSet` records and link to the existing experiment/backtest/forward-paper flow.
- Add point-in-time-safety flags and a news-impact scorecard.
- Supply bounded evidence packets to A0/A1 agents; introduce A2 paper use only after validation and all §59 Risk Gate/session tests pass.

Acceptance: the agent can explain which evidence it used; historical tests reject future information; news feature value is compared against baseline; active strategies never mutate silently.

### Slice F — Expand coverage and harden operations

- Expand provider coverage only after per-source uptime, rights and extraction quality are proven.
- Add source diversity, macro/corporate revision handling, cross-market event research, alerting, retention and recovery tests.
- Add periodic source/rights review and data-quality reports.

Acceptance: outages, rate limits, corrections, license revocation, stale evidence, duplicate feed delivery and process restart are tested.

## 60.17 Tests and Definition of Done

### Connector and rights tests

- source auth/timeout/rate-limit/429/5xx, invalid payload and backoff behavior;
- idempotent re-ingest, duplicate URLs, near-duplicate clustering and source-independence counting;
- unknown/revoked license blocks prohibited storage/display/model/training;
- full-text fields cannot leak into public APIs when `allowedDisplay` is false;
- secrets/tokens do not appear in client payloads or logs;
- SSRF/redirect, malformed XML/HTML, oversized response and unsafe attachment handling.

### Evidence and AI tests

- every generated factual claim references a valid `NewsItem`/`MarketEvent`/official data point;
- prompt injection embedded in source text does not change system instructions or trigger tools;
- model output can abstain and handles contradictory reports/corrections;
- sentiment, event severity, source quality and directional forecast are separate fields;
- translation preserves source text, numbers, negation, currencies and tickers;
- outlook snapshot expires and becomes stale/degraded when its evidence or required data sources no longer satisfy the policy.

### Time correctness and research tests

- simulation clock cannot query news or macro revisions that were not yet available at that point;
- `firstSeenAt`, publication/update/ingestion times are never silently substituted for each other;
- corrected/retracted story lineage remains reproducible;
- revised macro series expose historical vintages;
- holdout/walk-forward tests do not mix future items, future article revisions or future consensus into past predictions;
- every evaluation records baseline, time range, universe, data/evidence hashes, model/config version and limitations.

### UI and integration tests

- market-group filters, instrument links, language/source tier filters and source attribution work;
- source health and “no data” versus “ingestion failed” are distinguishable;
- `/intel`, `/calendar`, `/news`, `/news/events`, `/outlook` and `/research/news-impact` do not duplicate data stores or conflict in route registry;
- Hub authentication, RBAC, app identity, dynamic routes and existing canonical routes remain intact;
- AI Agent/Session pages record evidence packet IDs and no news-derived action bypasses existing Risk Gate;
- all previous V3.4 tests continue to pass.

## 60.18 Required first deliverable for the coding agent

Before implementation, produce a concise repository audit with:

1. Existing news/intelligence/calendar/macro code, APIs, collections, jobs and available source adapters.
2. Canonical ownership of `/intel`, `/calendar`, route registry and any existing news feature.
3. Proposed initial sources and the rights/access matrix for each; clearly mark API/feed access or legal permission as unverified instead of assuming.
4. Current instrument/issuer/entity identifiers and how they map to crypto, global equities, Vietnam equities, FX and gold.
5. Proposed minimal schema migrations/indexes and event contracts, reusing existing code where possible.
6. A vertical-slice plan with tests and rollback strategy, beginning with source audit and read-only ingestion.
7. A point-in-time data plan for historical news/macro tests and a clear excluded-from-backtest rule for non-point-in-time-safe records.

Do not start by scraping every popular news website, training a custom model, or building every UI route. First create a lawful, reliable, observable feed of primary events; then normalize/corroborate them; then generate evidence-backed outlooks; then test whether those outlooks add value; only then pass bounded evidence into paper-trading agents.

**Final V3.5 direction:** TM Trading should combine market prices, technical context, official disclosures, licensed reporting and macro/event data into a versioned, timestamp-correct evidence layer. AI should explain what is known, what is uncertain, why a market could react, which evidence contradicts the view, and whether the added information has actually improved out-of-sample research results.

---

# 61. V3.6 — End-to-End Platform Integration, Real Bot Runtime, Pine Reuse, AI Gateway and MCP

## 61.1 Authority, current-state assumptions and objective

This section is the V3.6 integration contract. It exists because the application can have many valid pages and APIs while still failing as a usable product if data does not flow across them, long-running workers are missing, or visible bot/session rows are only seeded examples.

The current-state facts below come from the repository audit provided on 2026-10-19 and must be re-verified by the coding agent against the checked-out repository before edits:

- The existing terminal has a manual paper-order path through `POST /api/v1/orders`, alert/ticket persistence, `exec/risk.mjs`, `exec/paper.mjs`, and MongoDB paper order/position/fill collections.
- The terminal refreshes some panels after order submission and `SignalPanel` polls at 15 seconds, while several standalone screens only fetch once on mount. Symbol/account state does not propagate consistently across routes.
- Account ownership/schema work is in progress. Some `ownerId` fields and owner-filter helpers have been added, but remaining read/aggregate paths and legacy backfill still require completion. The `/trading/paper` default-account mismatch (`default` versus `paper`) is a known defect to resolve rather than reproduce.
- The indicator engine and method plugins exist, but the signal records do not yet attribute outputs to method/indicator/strategy versions and no internal service automatically generates the whole signal stream.
- `Strategy Lab` contains real registry/backtest observability mixed with seed-only strategy/bot/session examples. A durable bot supervisor/runtime and actual trading-session records were not present in the supplied audit.
- `tools/build.mjs` creates `.pine` artifacts, but the app does not yet expose general Pine import/runtime execution. A build artifact does not by itself mean Pine can run in the Node engine.

The coding agent must re-audit these facts first; do not blindly duplicate models or routes. Existing real services should be extended, and seed/test fixtures must be visibly separated from operational data.

### Completion definition

TM Trading is not considered operationally integrated merely because every page returns HTTP 200. At minimum, the following vertical slice must work with an authenticated test user and persisted records:

```text
Market Data Adapter
  -> normalized market event / candle
  -> shared indicator and method engine
  -> user's versioned strategy
  -> persisted signal + evidence context
  -> user's bot runtime evaluates the signal
  -> deterministic Risk Gate
  -> paper execution
  -> persisted order, fill, position and PnL updates
  -> session event timeline + journal
  -> AI analysis reads the same persisted facts
  -> research experiment/backtest links to the exact strategy/data/engine versions
```

Every step must have observable IDs, timestamps, status, errors and ownership. No stage may rely on a fake `running` record or hardcoded equity. Paper trading stays the default operating mode; real-money execution is outside this delivery and disabled by default.

## 61.2 Target logical architecture

Prefer a small number of explicit layers and contracts over pages that call unrelated implementations directly.

```text
Nuxt 4 UI
  |-- Trading workspace context (user, account, instrument, timeframe)
  |-- Contextual Assistant panel
  |-- Pages: Terminal / Signals / Orders / Positions / Accounts
  |           Strategy Lab / Backtest / Replay / Bots / Sessions
  |           News / Outlook / Journal / AI Providers
  v
Nuxt server API + TM Hub auth adapter + RBAC
  |-- Trading Domain Services
  |-- Strategy & Signal Services
  |-- Account / Order / Risk / Paper Execution Services
  |-- AI Gateway + Context Builder + Agent Orchestrator
  |-- Research / Evidence / Journal Services
  |-- MCP domain-tool facade (separate process or package)
  v
Durable contracts
  |-- MongoDB business records + event/outbox ledger
  |-- Existing queue/event infrastructure (audit before selecting)
  |-- Market data hot state + historical archive
  |-- Provider registry and encrypted secret store
  v
Workers / runtimes
  |-- Market ingestion/normalization
  |-- Per-user bot supervisor/runtime
  |-- Signal evaluation and paper execution workers
  |-- News/event ingestion and research jobs
  |-- Session recovery, monitoring and scheduled evaluation
```

Architectural rules:

1. The UI never becomes the source of truth for orders, positions, session status, risk decisions or balances. The server is authoritative.
2. API route files should validate/authenticate/authorize and call domain services; put business logic in shared server/engine services, not duplicated inside each page route.
3. The bot runtime and MCP server must call the same domain contracts as the UI. They must not create a parallel trading engine or write around Risk Gate.
4. Market reference data may be shared, but all user-created or user-specific strategy, signal configuration, runs, agent settings, sessions, orders, fills, positions, journals and evidence references must be ownership-scoped.
5. UI notifications/events are invalidation hints. Durable MongoDB records remain the source of truth.
6. Avoid introducing a second broker/data/news/queue implementation when an existing provider adapter can be extended.

## 61.3 Canonical identity, ownership and account scope

The authenticated user resolved through TM Hub is the only source of `ownerId`. Never trust a client-supplied `ownerId` as authorization.

- Every user-owned business record has `ownerId` and appropriate indexes.
- Every account-bound record also has `accountId`; where appropriate include `sessionId` and `botInstanceId`.
- An API request on an account-bound resource must prove both that the resource belongs to the current `ownerId` and that the requested `accountId` belongs to the same owner.
- An absent or invalid authenticated owner must fail closed for private resources; do not silently interpret missing identity as a shared/global query.
- Shared public market data may not need `ownerId`, but user subscriptions, watchlists, computed signals, settings and derived evidence do.
- Backtests, replay runs, experiments, strategy versions, AI-agent configuration and bot profiles are user-scoped per the product decision. Any internal compute cache must not turn into a cross-tenant read path.
- Logs, metrics, queues, cancellation, bulk actions, exports, search, aggregations and background job payloads must preserve the same ownership boundary—not only `findOne`/list endpoints.

### Migration requirements

1. Audit every model and every query/write/aggregate path for the domains above.
2. Produce a dry-run owner backfill report showing counts by collection, current owner coverage, orphaned rows and conflicts.
3. Verify the proposed root UUID maps to `root@example.com` through the actual TM Hub identity data before applying the migration. Never infer this from a UUID alone.
4. Back up first, apply an idempotent parameterized migration, and retain a migration report with before/after counts.
5. Do not turn on strict filters that hide legacy rows until the backfill plan is approved and test data is recoverable.
6. Add two-user isolation tests for list, get, create, edit, cancel, close, aggregate stats, chart queries, logs, sessions, files/evidence and MCP tools.

## 61.4 Canonical domain contracts and event lifecycle

Define one schema per domain event in a shared package/module. Use runtime validation (for example Zod or the project's existing validator) at boundaries. The names below are proposed contracts; adapt to actual naming conventions after audit.

| Event | Producer | Required consumers / effects |
|---|---|---|
| `market.bar.closed` | Market adapter/normalizer | Indicator state, signal evaluator, bar archive, relevant UI subscriptions |
| `market.data.quality_changed` | Market data monitor | Signal gate, bot runtime, chart status, session log |
| `signal.generated` | Signal engine | Signals page, bot strategy binding, notification, research journal |
| `signal.invalidated` | Signal engine/data correction | Signal page, bot runtime; must prevent use of invalid/stale signal |
| `bot.command.requested` | UI/API/MCP with authorized identity | Per-user runtime command handler |
| `bot.state.changed` | Bot supervisor | Bots page, sessions page, health monitor |
| `order.intent.created` | Manual terminal, strategy or permitted assistant proposal | Idempotent execution workflow and risk gate |
| `risk.decision.recorded` | Risk Gate | Audit/session timeline, UI, execution gating |
| `paper.order.accepted` / `paper.order.rejected` | Paper executor | Order list, session event timeline, notifications |
| `paper.fill.created` | Fill simulator | Position accounting, PnL, journal, trade statistics |
| `position.changed` | Position service | Terminal, positions/account screens, risk state and journal |
| `session.event.recorded` | Runtime and execution services | Session timeline, logs, research capture |
| `research.run.completed` | Backtest/replay worker | Runs page, experiment evaluator, AI summary context |
| `ai.assessment.completed` | AI gateway/task runner | Module assistant history, outlook/research, session evidence link |

Common envelope:

```ts
interface DomainEvent<TPayload> {
  eventId: string;             // globally unique/idempotency key
  eventType: string;
  schemaVersion: number;
  occurredAt: string;          // source/domain event time in UTC
  recordedAt: string;          // durable persistence time in UTC
  correlationId: string;      // trace a user action through services
  causationId?: string;        // triggering event/command
  ownerId?: string;            // required for user-scoped events
  accountId?: string;
  sessionId?: string;
  botInstanceId?: string;
  payload: TPayload;
}
```

Use the existing queue if one is already suitable. Otherwise, introduce a minimal durable outbox/worker pattern rather than adding a heavyweight event platform without need. Persist business state and its outgoing event atomically when the current Mongo deployment supports transactions; otherwise use an explicit idempotent recovery strategy and document its delivery guarantee. Consumers must tolerate retries and duplicate delivery.

Do not claim “exactly once” delivery. Design for at-least-once delivery plus stable idempotency keys, unique constraints and deduplication at state transitions.

## 61.5 One trading context shared across the UI

Create or extend a central `TradingWorkspaceContext` store (Pinia or the project's established equivalent), keyed to the authenticated user and invalidated on logout/user switch. It should carry only user-interface selection state, not replace server persistence:

- current `accountId`;
- current canonical `instrumentId`/symbol;
- venue/provider and timeframe;
- current chart window/crosshair where appropriate;
- optional active `strategyVersionId`, `botInstanceId` and `sessionId`;
- data-freshness and connection status.

Rules:

1. Choosing a symbol in the terminal should update the shared context and route query where useful; Signals, Orders, Positions, Replay and session detail can link back to that same symbol without inventing a second selection.
2. Choosing an account should update the workspace context, but every API still independently validates the account against the authenticated owner.
3. A mutation emits a typed server event or returns a revision/version that invalidates affected queries. `orders`, `fills`, `positions`, `accounts`, `signals`, `bot status` and session timeline must update without requiring a full-page reload.
4. Prefer existing app event infrastructure. For live status use WebSocket/SSE if available and appropriate; otherwise make polling interval, visibility handling, backoff and stale-state UI explicit. Never leave a permanent 15-second poll as the only correctness mechanism without reconnect handling.
5. A page should distinguish loading, empty, stale, degraded and hard-error states. A request that failed is not the same as a valid empty result.
6. Ensure account/symbol context is not reused across user identity changes and no stale private results flash during navigation.

## 61.6 The operational end-to-end paper bot flow

This is the minimum real workflow that must replace the current seed-only Strategy Lab view.

1. **Market ingestion:** provider adapter supplies data; normalizer assigns canonical instrument, venue, timeframe, event time, receive time and quality state.
2. **Bar building/storage:** validated candles are published consistently for realtime analysis, historical replay and research. Partial/current candles are distinguishable from closed/confirmed candles.
3. **Indicator evaluation:** execute native indicators and approved Pine-compatible indicators on the same normalized market series and declared calculation semantics.
4. **Strategy evaluation:** load immutable `strategyVersionId` and parameters; evaluate only on allowed market events and expected timeframe/closure mode.
5. **Signal persistence:** save signal with owner, strategy/version, indicator/method attribution, input data cutoff, bar/event IDs, condition result, timestamp, dedupe key and evidence snapshot.
6. **Bot policy:** a running bot bound to that strategy version decides whether the signal is in-scope, new, non-duplicate and permitted by its current state and session schedule.
7. **Risk Gate:** evaluate deterministic pre-trade checks using authoritative account risk state. AI output may not edit or bypass the result.
8. **Paper execution:** apply the explicitly configured fill/slippage/fee model. Mark an intent idempotently so retries/restarts cannot double-execute the same logical order.
9. **Accounting:** persist paper order, fills, positions, balance/equity, realized/unrealized PnL and risk-state changes using one shared accounting path.
10. **Session evidence:** write decision, rejection reason, source event, data quality, risk result, order/fill references, timestamps and any operator intervention to the session timeline.
11. **UI propagation:** the terminal, orders, positions, account, signals, bot and session screens all read these same records and receive invalidation events.
12. **Research feedback:** the journal and research layer consume actual trade/session evidence. AI can summarize and propose a candidate, but cannot silently mutate the version currently running.

A signal can create an order intent only when the bot profile explicitly binds that signal/strategy and its paper policy permits it. Signal display alone must never execute an order.

## 61.7 Per-user Bot Supervisor and durable runtime

The product decision is **one logically isolated runtime/supervisor per authenticated user**, able to manage that user's multiple bot instances and sessions. A runtime may be implemented by a worker, child process or isolated container depending on deployment and threat model; it does not imply that every single bot needs a separate OS process. Do not build one shared mutable runtime that can accidentally mix users' state.

### Runtime responsibilities

- Load only bot instances owned by its authenticated `ownerId` and permitted account/strategy versions.
- Start/pause/resume/stop bots through validated commands and durable state transitions.
- Maintain leases/heartbeats, liveness, current engine version, subscriptions and current strategy/version hashes.
- Observe market events without launching duplicate subscriptions for the same bot context.
- Persist state transitions before acknowledging success to the UI.
- Recover after process or host restart from durable session/runtime state and last committed event cursor.
- Use idempotency for command delivery, order intents, fills and session transitions.
- Detect stale/missing market data, drift, provider disconnects, excessive lag and invalid account state; move to `DEGRADED` or safe `PAUSED` rather than continuing blindly.
- Support user kill-switch and operator stop; stop accepting new entries immediately while handling any simulated positions according to an explicit policy.
- Emit a structured error, correlation ID and recovery action for every failure class.

### State machine

`DRAFT -> VALIDATING -> READY -> STARTING -> RUNNING <-> PAUSED`, with explicit branches to `DEGRADED`, `STOPPING`, `STOPPED`, `COMPLETED`, `FAILED` and `RETIRED` as appropriate. Do not expose `RUNNING` until the worker has acknowledged readiness and a fresh health/heartbeat record is stored.

### Seed-data separation

- All demo seed records must carry an explicit fixture/demo marker and never appear in operational bot/session lists unless a “Demo data” filter is selected.
- Runtime states, trades, equity and counts must be derived from actual persisted events; no canned equity curve or fabricated order counts in operational pages.
- Development fixtures may be used by tests and screenshots, but they must be resettable and never be presented as real sessions.
- If no runtime is connected, show `NOT RUNNING`/`UNAVAILABLE`, not a seeded `RUNNING` state.

## 61.8 Durable trading evidence and reproducibility

Audit existing collections first. Reuse or extend current models and avoid duplicating the existing `alerts`, `paper_orders`, `paper_fills`, `positions`, `accounts`, `sessions`, `runs`, strategy/version and journal records. Create new collections only if a required durable concept is missing.

Every operational decision/session should link, where relevant, to:

- `ownerId`, `accountId`, `botInstanceId`, `sessionId`;
- `strategyId`, immutable `strategyVersionId`, canonical parameter hash;
- engine/build version, indicator/method versions and enabled feature set;
- `instrumentId`, venue, timeframe, data-provider ID and market-data quality state;
- source market event IDs and the exact input cutoff;
- `signalId`, decision/intent ID and idempotency key;
- full Risk Gate result and rule/config version;
- order/fill/position references and accounting model version;
- UTC event/received/processed/persisted times;
- AI provider/model/profile/prompt/structured-output schema version when AI is involved;
- relevant news/evidence packet IDs and the as-of timestamp;
- execution timings, errors, retry counts and operator intervention.

Capture high-frequency market data at a scale-appropriate storage tier rather than bloating every Mongo document. Store provenance/manifests and compact event snapshots in Mongo; use the existing archive or a suitable compressed columnar format for large historical streams if the repo's actual needs justify it. Always preserve a stable pointer/hash to the exact dataset used by a run.

AI should work from actual records and be able to say “insufficient evidence.” Do not reconstruct a historical decision from current news, current indicator values or a newly computed strategy version if those differed at the time.

## 61.9 Indicator and strategy contract shared by live, replay and backtest

- Have one canonical calculation/evaluation contract for backtest, replay, live signal generation and live paper sessions.
- Define candle timestamp convention, timezone (UTC internally), confirmed versus forming candle behavior, missing-bar behavior, warmup windows, `na` handling, rounding, price precision and volume units.
- Define no-lookahead rules for multi-timeframe indicators and data requests.
- Version engine logic and config; a strategy version must reference immutable indicator/method/plugin version identifiers or content hashes.
- Avoid computing a similar indicator separately in the chart, signal service and backtest engine. UI may format outputs but must not redefine them.
- Every generated signal stores which indicators/method plugins contributed and the relevant parameter values. “Indicator exists in registry” must not imply it contributed to this particular signal.
- Use shared fixture datasets to compare output across live-bar processing, replay and backtest. A strategy that changes semantics across modes must fail validation.

## 61.10 Reusing existing TradingView Pine code

The repository audit says `tools/build.mjs` currently produces `pine/dist/*.pine`, while the production indicator registry does not yet execute arbitrary Pine source. First inspect whether those files are full readable source scripts, generated artifacts derived from the existing indicator engine, or merely display/export copies. Preserve the current build step until its consumers and tests have been identified.

### Import strategy

1. **Inventory:** list every `.pine` artifact/source, identify Pine version, `indicator()` versus `strategy()` versus `library()`, imported libraries, inputs, alerts, multi-timeframe requests, stateful arrays/objects, drawings and strategy order calls.
2. **Rights check:** verify the code is user-owned or that the applicable author/license grants the intended use. Public visibility on TradingView is not blanket permission to copy third-party private/protected scripts or remove attribution. TradingView's publishing rules require attribution and impose additional requirements for reusing open-source scripts. See `https://www.tradingview.com/support/solutions/43000590599-script-publishing-rules/` and `https://www.tradingview.com/pine-script-docs/writing/publishing/`.
3. **Compatibility analysis:** build an importer/parser report listing every syntax/function as `supported`, `needs adapter`, `unsupported` or `unsafe`; do not claim generic support based on a successful parse alone.
4. **Runtime option:** evaluate PineTS against a representative set of the user's scripts and test outputs. PineTS publishes support claims for Pine v5/v6 and multiple TA/multi-timeframe features, but its own roadmap still distinguishes current support from full Pine v6 compatibility. Verify actual coverage per script. Project links: `https://github.com/LuxAlgo/PineTS` and `https://github.com/LuxAlgo/PineTS/blob/main/LICENSE-COMMERCIAL.md`.
5. **License blocker:** PineTS currently publishes dual licensing under AGPL-3.0 and a commercial license. A closed-source or hosted product must resolve the AGPL obligations or obtain appropriate commercial terms before embedding the runtime. Do not add the dependency until that check is explicitly approved.
6. **Native port option:** for scripts owned by TM Trading's author, port high-value logic into the native `engine/indicators.mjs`/`engine/methods/` contracts and retain the Pine source as the reference artifact. This offers tighter control over Node execution, risk boundaries and backtest consistency, but requires tests per function and bar semantics.
7. **Parity harness:** for every imported/ported script, compare Pine/TradingView outputs with TM engine/Pine runtime on the same OHLCV data, symbol, session/timezone, timeframe, input values and bar-close semantics. Test warm-up, missing bars, `request.security`, repaint/lookahead, intrabar alert behavior and edge values. A mismatch must be disclosed, not silently ignored.
8. **Registration:** only mark an import `READY` after compatibility and parity gates pass. Store source hash, author/license, Pine version, compatibility report, adapter/runtime version and test fixture references.
9. **Strategy distinction:** importing an `indicator()` does not automatically import a valid `strategy()` order/fill model. Strategy execution must map to TM's strategy, risk and paper execution contract. Never allow imported code to emit broker orders directly.

Suggested UX: `/indicators/import` (or reuse the existing indicator catalog route) with upload/paste, metadata, rights confirmation, compatibility report, preview plots, parity test, save-as-draft and promotion to the approved registry. Do not create another indicator catalog if one already exists.

## 61.11 Unified AI Provider Gateway

The app needs one server-side AI Gateway for contextual assistance, agents, research, news interpretation and task automation. Modules should request a task from this gateway rather than implementing provider-specific calls independently.

### Provider categories must remain distinct

- **Inference gateway:** OpenRouter or another OpenAI-compatible aggregator routes model requests.
- **Local/unified API gateway:** the user's exact FreeLLMAPI deployment may expose an OpenAI-compatible base URL and a unified key. Configure the URL, capabilities and health dynamically; do not hardcode assumptions from a similarly named fork or treat every listed upstream as always free/available.
- **Agent runner/SDK:** OpenCode server/SDK can be used to start and manage coding/general-agent sessions where appropriate. It is not automatically identical to a generic model inference endpoint. Integrate via its supported SDK/server or a verified provider endpoint; never assume a local OpenCode CLI is a secure public API.
- **Direct inference provider:** optional providers or local models can be added through the same adapter interface later.

OpenRouter's documented chat completion endpoint supports standard request/response and streaming. OpenCode documents configurable providers/base URLs and a type-safe SDK/server API. FreeLLMAPI implementations differ, so confirm the exact repo/version/deployment and run a capability test. References: `https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request`, `https://dev.opencode.ai/docs/providers/`, `https://docs.opencode.ai/docs/sdk/`, and the exact FreeLLMAPI repository pinned in project docs.

### Adapter contract

```ts
interface AIProviderAdapter {
  id: string;
  validateConnection(): Promise<ProviderHealth>;
  listModels?(): Promise<ModelDescriptor[]>;
  getCapabilities(modelId: string): ModelCapabilities;
  generate(request: NormalizedAIRequest): AsyncIterable<NormalizedAIChunk>;
}
```

Capabilities should be discovered or configured per model and tested, not assumed uniformly: streaming, tool calling, JSON schema/structured output, vision/image input, context budget, cancellation, usage reporting, timeout and rate-limit behavior.

### Shared server API (proposed)

- `GET /api/v1/ai/providers` — list only safe metadata for providers available to this user.
- `POST /api/v1/ai/providers` — add/update a provider connection or base URL after validation.
- `POST /api/v1/ai/providers/:id/test` — check authentication, model listing and a minimal supported request.
- `GET /api/v1/ai/models` — return live/last-known model catalog with capability/freshness labels.
- `GET|POST /api/v1/ai/profiles` — user-scoped profiles that map task classes to provider/model/parameters/fallback policy.
- `POST /api/v1/ai/chat` — contextual interactive assistant endpoint with authenticated module context.
- `POST /api/v1/ai/tasks` and `GET /api/v1/ai/tasks/:id` — durable long-running research/analysis jobs where needed.
- `GET /api/v1/ai/usage` — user-scoped requests, latency, error/fallback and usage/cost data when supplied by provider.

Adapt to existing conventions instead of creating duplicate provider endpoints.

### Provider credential and reliability rules

- Store secret material in the project's encrypted secret mechanism or a separate encrypted store; never send API keys to the browser after save, and never place plaintext keys in logs, prompts, analytics or general config documents.
- Scope connection by `ownerId` or a deliberately configured app-level service identity. A shared app-level key must be explicitly distinguished from a user's own connection and have quotas/permissions.
- Keep `baseURL` server-side and restrict it to configured safe destinations. Defend custom endpoints against SSRF, redirect abuse and access to internal/cloud metadata networks.
- Add connection test, model test, latency/health, concurrency, token/cost budgets, rate-limit handling, timeout, cancellation and safe exponential backoff.
- Fallback may run only to a provider/model with compatible capabilities and privacy/rights policy. Never silently change to an unsuitable model for a tool call or a write action.
- Cache model catalogs with freshness, but mark unavailable/retired/stale entries; do not promise free-tier permanence. Preserve provider-reported errors instead of fabricating successful outputs.
- Record provider ID, model ID/version where available, prompt/template version, capability profile, latency, usage/cost if returned, status, fallback path and output artifact references for each consequential AI request.
- Treat provider responses as untrusted. Validate structured output against schemas and business constraints before use.

## 61.12 Contextual assistant available inside each module

Provide a reusable `ModuleAssistantPanel` (drawer/sidebar/popover appropriate to the existing UI) that gets context from the current authenticated page and selected record. Do not build separate one-off chat systems for Terminal, Strategy Lab, News and Sessions.

### Context bundle

Include the smallest useful permitted context:

- route/module and user's active account/instrument/timeframe;
- IDs and summaries of the selected signal, strategy/version, run, bot, session, news event or position;
- server-computed relevant data snapshots with as-of timestamps and freshness labels;
- evidence links/record IDs, validation results and known limitations;
- allowed tool list for the user's role and current autonomy level.

The client must not be allowed to submit arbitrary object contents as trusted facts. The server re-fetches referenced records and validates ownership before building the context.

### UX and expected behavior

- Terminal: explain chart state, selected indicators, signal context, paper order validation/rejection and risk messages; do not place an order solely because chat text says “buy/sell”.
- Signals/Indicators: explain indicator values and attribution, compare conditions, create a draft rule for review.
- Strategy Lab: explain backtest metrics and limitations, suggest controlled experiments, compare immutable versions.
- Runs/Replay/Sessions: summarize logs, state transitions, order/fill evidence, data gaps and differences against the baseline.
- News/Outlook: answer only from cited NewsItem/MarketEvent/MacroObservation/evidence records; show publication/as-of times, contrary evidence and uncertainty.
- Accounts/Positions: explain persisted figures and calculation rules, with clear paper/demo mode labels.
- Providers/Settings: diagnose connection/model capability/timeout errors without exposing secrets.

Every generated factual statement based on application data should cite clickable internal record IDs or source URLs where possible. The assistant must handle “not enough data,” stale data and contradictions. Use explicit labels for model-generated inference versus stored fact.

### Conversation and task records

Persist conversation metadata and messages under the user, with module/entity references, provider/model profile, consent/privacy policy, timestamps and tool/action audit. Apply retention controls. Do not keep large unredacted credential payloads or full proprietary provider responses by default.

## 61.13 MCP server for AI automation of TM Trading

Build a dedicated `tm-trading-mcp` package/service that exposes domain-level tools/resources/prompts to supported clients and internal AI agents. First audit whether the repository already has MCP code or a suitable shared package. Prefer the current TypeScript SDK line appropriate to the selected MCP spec and transport; official SDK documentation describes stdio for local child-process integrations and Streamable HTTP for remote services. Reference: `https://ts.sdk.modelcontextprotocol.io/v2/`.

### Architecture

```text
VS Code / Antigravity / OpenCode / approved AI host
             | MCP tools/resources/prompts
             v
       tm-trading-mcp
             | TM Hub authentication + scopes
             | Zod/schema validation + audit policy
             v
      Shared TM Trading domain services
             | same owner/account checks
             | same Risk Gate and idempotency
             v
        MongoDB / bot runtime / research jobs
```

Use local `stdio` transport for development tools that launch MCP as a child process. Use authenticated Streamable HTTP for approved remote integrations. Keep MCP transport and business logic separate.

### Initial read-only tools

- `market.get_snapshot`, `market.get_bars` — authorized market data and freshness/quality metadata.
- `indicators.list`, `indicators.get_values`, `indicators.check_compatibility`.
- `signals.list`, `signals.get` — current user's signals with source/version attribution.
- `news.search`, `news.get_event`, `outlook.get` — evidence-linked read access.
- `strategies.list`, `strategies.get_version`, `runs.list`, `runs.get_result`.
- `bots.list`, `sessions.list`, `sessions.get_detail`, `journal.search`.

### Controlled write/compute tools

- `strategies.create_draft`, `strategies.validate_draft` — draft only; immutable versions after promotion.
- `backtests.run`, `replay.run` — durable asynchronous tasks with limits and status polling.
- `bots.create_paper_draft`, `bots.validate`, `bots.start_paper`, `bots.pause`, `bots.resume`, `bots.stop`.
- `sessions.get_status`, `sessions.export_evidence`.
- `ai.analyze_session`, `research.create_experiment_draft`.

Write tools require authenticated user context, owner/account validation, per-tool scope, schema and resource limit checks, a stable idempotency key, and an auditable `actor=human|assistant|mcp-client` marker. Starting a bot or changing strategy bindings must require explicit user approval in the host/app unless a narrowly scoped policy has been enabled for paper-only operations. MCP must not expose real-money order submission as an initial capability.

### Never expose

- arbitrary Mongo query/aggregation, filesystem, shell or unrestricted URL fetch tools;
- provider credentials, encryption keys, session cookies or raw access tokens;
- user-supplied `ownerId` as a way to select a tenant;
- unrestricted custom code evaluation, arbitrary Pine execution or direct write access bypassing domain services;
- a way for AI, tools or prompts to disable Risk Gate or defeat account/session limits.

### Security and prompt injection

- Derive identity from a verified TM Hub token or a deliberately provisioned, revocable local integration credential scoped to one user. Never use one shared root token for all users.
- Re-check authorization on every tool call; token validation at connection time alone is insufficient if permissions can change.
- Support least-privilege scopes, rate limits, audit logs, token rotation/revocation and short expiration.
- Validate inputs and outputs, cap result sizes, redact private fields and defend any URL-based retrieval from SSRF.
- Treat news articles, external documents, indicator source files and tool-returned strings as untrusted data/instructions. They cannot grant themselves tool permissions or override the assistant's system policy.
- Separate read-only, compute, paper-session and administrative capabilities. Start with read-only; turn on writes individually after two-user and idempotency tests.

## 61.14 AI governance for strategy/bot workflows

Use the authority levels already introduced in §59. AI should not be trusted based on provider/model name alone.

- Observe: query authorized data and summarize.
- Propose: create a draft strategy/config/experiment with cited evidence.
- Simulate: run bounded backtest/replay and then paper session through deterministic risk checks.
- Promote: create a new immutable version after validation; human approval required.

The active bot must pin an immutable strategy version, data contract, execution model and risk profile. Research results must not mutate the active version behind the user's back. AI may recommend pausing a degraded bot, but the deterministic supervisor/risk safety policy must make and record the actual state transition.

For potentially consequential write tools, use two-stage intent: `prepare/preview` followed by explicit `confirm/execute`. The confirmation must show the target account, strategy version, mode, actions, limits and expected side effects. Never allow a prompt embedded in news or a Pine script to trigger tools directly.

## 61.15 Market/news providers and provider-health integration

The AI gateway is separate from the Market Data and News provider registry. They may share settings UI patterns but not the same credential schema or health semantics.

- Market-data provider health describes connectivity, event lag, missing bars, coverage and correction behavior.
- News provider health describes successful ingestion, source rights, source time, last seen item, dedupe/parse error and backlog.
- AI provider health describes connectivity, model availability, latency, error/rate-limit, tool/structured-output support and usage.

A common “Connections” UI can display these, but domain-specific health must remain clear. Never interpret a broken feed as “no market movement/no news”. A fallback provider must preserve source identity and quality metadata.

## 61.16 Navigation and module responsibility

Reuse registered routes and current page modules; extend, do not duplicate.

- Terminal/workspace: instrument/account context, chart, indicators, tickets and paper order feedback.
- Signals: generated signals, attribution, lifecycle and explanation; not an order execution engine.
- Accounts: per-user multi-account CRUD/switching and account-level risk/cash state.
- Orders/Fills/Positions: authoritative persisted records with shared context and realtime invalidation.
- Strategy Lab: strategy draft/version editor, validation, tests and comparison.
- Bots: bot profiles, strategy bindings, runtime status and commands.
- Sessions: real durable run/session timeline, context, decision trace, orders/fills/positions, quality and logs.
- Runs/Replay/Journal: reproducible experiment outputs and user notes, never seed masquerading as execution.
- Indicators/Import: native registry plus licensed, compatibility-tested Pine import.
- AI Providers: provider connections, model catalog, tests, profiles, budgets and recent errors.
- Assistant: reusable panel available within authorized modules.
- News/Outlook: retain §60's evidence-first workflow and link its evidence packets into sessions and research.
- MCP: separate integration interface; no duplicate web pages or hidden bypass path.

Route registry changes must be idempotent, preserve current route IDs and TM Hub ownership/auth semantics, and include migration tests for old bookmarked paths.

## 61.17 Implementation order — prioritize a working vertical slice

Do not implement every module simultaneously. Follow this order so each phase can be tested against a real end-to-end path.

### Phase A — Repository truth and architecture map

- Re-inspect existing models, route APIs, service imports, background processes, queues, auth adapter, UI query patterns and seed scripts.
- Build a route-to-service-to-model map and label each feature `operational`, `partial`, `read-only`, `seed-only`, `missing`.
- Produce `docs/web-app/system-integration-map.md`, `docs/web-app/data-ownership-map.md` and an updated implementation tracker.
- No sweeping rename/refactor before the current tests and flows are understood.

Acceptance: audit documents code-backed references and no claim of runtime execution is based only on a seed record.

### Phase B — Complete tenant and multi-account foundation

- Finish `ownerId` propagation on every private read/write/aggregate/cancel/close/export/background task.
- Finish legacy backfill with dry-run, verified identity mapping and rollback path.
- Fix `paper` versus `default` account mapping; implement account CRUD/switching safely.
- Scope all runs, strategies, agents, bots, logs and evidence by owner.
- Add two-user data isolation tests.

Acceptance: user A cannot enumerate, read, modify, stop or derive aggregate values from user B records; every account-bound mutation rejects foreign account IDs.

### Phase C — Canonical events and UI state propagation

- Define/validate domain event schemas and idempotency contracts.
- Add durable outbox or adapt the existing queue; add consumer retry/dead-letter reporting as needed.
- Add shared `TradingWorkspaceContext` and typed invalidation/realtime updates.
- Fix refresh/empty/stale/error handling on standalone Orders/Positions/Signals/Paper/Accounts screens.

Acceptance: one manual paper order changes the same persisted order/fill/position/account state everywhere without manual hard refresh, and restart does not lose the update.

### Phase D — Native signal engine and Pine inventory *(done — D1–D6, gated)*

- Build the internal market-data-to-indicator-to-strategy-to-signal service using the same calculation contracts as backtest/replay.
- Persist attribution, evidence, quality checks and idempotency.
- Disable new dependence on the shared TradingView webhook once replacement tests pass; preserve historical records.
- Inventory pine/dist/*.pine; add a compatibility report and representative parity tests before selecting runtime/port strategy. Compatibility report: docs/web-app/pine-compatibility.md (pm run pine:parity); parity tests: pm run indicator:parity. Decision: keep Pine as the reference/parity source, do NOT add a Pine runtime — port 	a.dmi and 	a.stoch into ngine/ta.mjs before mirroring those scripts natively.

Acceptance: a fixture or replay bar can deterministically produce a signal whose method/indicator/strategy version is queryable; duplicate events do not duplicate the signal; script import never executes unvalidated code.

### Phase E — Real per-user paper runtime

- Implement durable supervisor, commands, heartbeat/lease, recovery and actual session creation.
- Wire signal subscriptions to bot instances and Risk Gate to paper executor.
- Make accounting idempotent; persist every accepted/rejected risk decision, order, fill, position and session event.
- Remove seed-only data from operational views or add clear demo mode and fixtures.

Acceptance: run an integration scenario through signal -> bot -> risk -> paper order -> fill -> position -> account metrics -> session evidence. Restart the worker mid-session and prove no duplicate order/fill occurs. **DONE** — `engine/botSupervisor.mjs`, `services/botRuntimeStore.mjs`, `services/botWorker.mjs`, `services/botSignalBridge.mjs`, `tools/bot-worker.mjs`, commands API; evidence in `engine/test-db.mjs` sections 11–14 (138 checks, 0 fail).

### Phase F — Evidence storage and research feedback

- Attach market/data/strategy/risk/engine manifests to every run and session.
- Link `Journal`, `NewsEvidencePacket`, `Experiment`, backtest and session evidence.
- Enable AI to analyze completed persisted sessions and create experiment drafts.
- Add baseline-versus-candidate evaluations and strict point-in-time controls.

Acceptance: one session can be reconstructed from persisted evidence and the AI analysis cites actual record IDs; experiments do not mutate the active strategy. **DONE** — ngine/manifest.mjs (v1 manifests on sessions/runs), ngine/evidenceGraph.mjs + GET /api/v1/sessions/[id]/evidence (journal/news/experiment links, deterministic digest, citation allowlist), POST /api/v1/sessions/[id]/analysis (advisory i_proposals draft bound to the frozen set), ngine/pointInTime.mjs (strict cut-off audit in sufficiency + graph), independentArms acceptance gate (candidate ≠ baseline); evidence in ngine/test-db.mjs §15 (156 checks, 0 fail).

### Phase G — AI provider gateway

> Architecture: **D35** — connections are app-owned; TM Hub is catalog metadata
> plus an optional enable/disable overlay, never a required key broker/proxy.
> See `docs/web-app/adr-ai-providers-local-first.md` and `phase-g-plan.md`.

- Implement provider adapter interface, secure credentials, capability registry, model catalog, health tests, profiles/budgets and request audit.
- Connect OpenRouter, the exact configured FreeLLMAPI deployment, and OpenCode via its supported SDK/server or a verified API-compatible endpoint.
- Add controlled fallback only for compatible models and privacy/risk policies.

Acceptance: provider outages and invalid keys are visible; model capabilities are tested; no secret is returned to the browser or stored in plaintext logs.

### Phase H — Contextual in-module assistant

- Build a reusable panel and server-generated context bundles for Terminal, Signals, Strategy Lab, Runs, Sessions, News/Outlook and Provider Settings.
- Start read-only; add draft creation after ownership validation and structured-output tests.
- Add references to internal records and source items for verifiable statements.

Acceptance: asking an assistant in Session detail produces an explanation based only on that authorized session; switching user/account cannot leak a previous context.

### Phase I — MCP tool server

- Implement read-only tools/resources and host-specific local stdio configuration.
- Add authenticated remote Streamable HTTP only if a remote use case is necessary.
- Add bounded backtest/replay task tools, then paper-only bot control tools with preview/confirmation/idempotency.
- Test permissions, token revocation, injection-resistant tool descriptions, size limits and audit.

Acceptance: supported IDE/AI clients can retrieve actual authorized TM Trading records and invoke safe paper-only workflows without any direct database access or bypass of Risk Gate.

## 61.18 Required test matrix and Definition of Done

### Cross-module integration

- Manual paper order and automated paper bot order both update the same canonical order/fill/position/account services.
- Signal generation is deterministic on a fixed dataset and links to the exact strategy/indicator/method versions.
- Orders, fills, positions, signals, accounts, bots and sessions share the same user/account scope.
- Current symbol/timeframe/account navigation is consistent across compatible pages.
- A server/worker restart preserves session state and resumes or pauses according to explicit policy.

### Multi-tenant correctness

- Two users, two accounts, same symbol and strategy name: no list/detail/aggregate/export/MCP cross-read or cross-mutation.
- Missing/expired token fails closed; logout or identity switch clears private client state.
- Cancellations, close-position, risk patch, account changes and stop-bot commands re-check ownership at execution time.
- Queued jobs retain a verified owner context, and stale/revoked ownership cannot perform new writes.

### Runtime correctness

- Duplicate `market.bar.closed`, signal delivery, bot command and retry do not duplicate actions.
- Risk rejection creates no fill; every rejection has a reason code.
- Data staleness, gaps, out-of-order bars, provider disconnect, worker lag and risk-state read failure degrade/pause the bot safely.
- Fill/accounting math handles precision, fees, slippage, partial fills and close/reversal according to the simulator's declared model.
- Seed fixtures never appear as an operational trading session by default.

### AI and provider correctness

- Capability checks reject unsupported tools/structured output rather than assuming it worked.
- Fallback preserves privacy and capability constraints.
- Provider failures, rate limits, token/cost data and cancellations are persisted when available.
- Context builder filters private data by owner and account; AI factual claims cite authorized records or abstain.
- News/Pine/provider content injection cannot alter authorization, disable Risk Gate or trigger unapproved writes.

### Pine compatibility

- No imported source is executed before static compatibility/rights checks and isolated test.
- Outputs match reference fixtures within declared numerical tolerance and bar semantics.
- Multi-timeframe, repaint/lookahead, bar-close and unavailable function behavior are tested or clearly marked unsupported.
- PineTS licensing decision is recorded before introducing it into a closed-source/networked deployment.

### MCP correctness

- Every tool invocation is authenticated/authorized and audited.
- Write tool actions have user confirmation where required, stable idempotency keys and clear target summary.
- MCP cannot run arbitrary shell/DB queries or create live-money orders.
- Oversized results and malformed inputs are bounded/validated; tokens/secrets never appear in resource outputs or logs.

### Gates

After each phase, run the repository's relevant unit and integration tests, `npm run test:app`, `npm run docs:check`, and `npm run typecheck` in the repository's intended order. Restart the dev server only after the final typecheck if the repo workflow requires it, then smoke-test the actual routes and worker health. Do not commit unless explicitly asked.

## 61.19 Required coding-agent deliverables

Before coding, return a short, fact-based audit table with:

1. Existing page/API/service/model for each workflow, including actual read/write behavior.
2. Missing transitions from market data to signal, signal to bot, bot to order, order/fill to position/account and session to research.
3. All seed/example/mock-only records and how they are excluded from operations.
4. All `ownerId` and `accountId` gaps, aggregate paths and migration counts/risks.
5. Existing event bus, queues, WebSocket/SSE, job runner and secrets mechanism that can be reused.
6. Pine artifact/source inventory, likely Pine version/features and rights/license status; evaluate runtime/port options without adding a dependency yet.
7. Current AI provider configs/connections and the exact FreeLLMAPI repo/version/base URL. Never print secret values.
8. Current MCP integrations, if any, and target clients/transport requirements.
9. Smallest vertical slice and its tests/rollback plan.

Implementation must proceed phase by phase with verified tests. For each phase report: modified paths, domain flow now operational, tests/gates run and results, remaining limitations, migrations performed or not performed, and whether any seed-only behavior remains. Never report “bot running” unless a real worker has acknowledged its state and a persisted heartbeat exists.

## 61.20 Final V3.6 product rule

A complete TM Trading is one coherent system, not a set of pages that each display plausible numbers. For every meaningful action, the user should be able to answer:

- Which authenticated user and account own it?
- Which actual market data and timestamps were used?
- Which indicator/method/strategy version produced the signal or decision?
- Which deterministic risk rules accepted or rejected the intent?
- What did the paper execution engine actually persist?
- Where are the resulting order, fill, position, PnL and session logs?
- Which AI provider/model analyzed the records, what evidence did it cite, and what did it propose?
- Can the exact process be replayed and tested after a restart or later strategy change?

If these questions cannot be answered from persisted records and traceable IDs, that path is not yet production-ready.

