# TM Trading — Crypto Market Intelligence, AI Research & Pine Demo Validation Platform

> Version: **4.2**  
> Date: **2026-10-31**  
> Supersedes: Product scope, primary navigation and UI/UX direction from V3.x and V4.0 where explicitly clarified by Section 16; service lifecycle, reliability, Operations control and truthful readiness rules are governed by Section 17.  
> V4.1 clarification: TM Trading is a **Crypto Market Intelligence + AI Research + Alerting platform**, retaining the TM Hub/shared-core platform capabilities. Pine-based exchange-demo testing is a small supporting validation feature—not a full trading-system product. Section 16 is authoritative for language choices, AI-provider architecture, Hub/core retention, Pine reuse and demo-test scope.  
> V4.2 operations update: Section 17 is authoritative for background-service lifecycle, supervisor architecture, real health/readiness verification, start/stop/restart/reset controls, asynchronous UI loading, recovery and Operations UX. A service must never be shown as ON/READY merely because a control request was accepted or a process exists.
> Technical carry-forward: Reuse working market-data, exchange adapters, AI gateway, news, scanner, funding/OI/liquidation, alert, Telegram, tenancy and runtime contracts from V3.9 where applicable. This is a roadmap/specification, not evidence that features are already implemented.

---

## 0. Product decision — narrow the application

TM Trading must stop growing as a collection of loosely related trading pages. Its primary product is now:

**A crypto-first Market Intelligence, Coin Discovery, Futures Signal and Alerting Workbench.**

The application should help the user:

1. Understand what is happening across the crypto market now.
2. Detect unusual price, volume, volatility, funding, open-interest and liquidation activity.
3. Discover and research liquid top coins and carefully filtered low-cap candidates.
4. Follow a selected watchlist and receive explainable futures research signals.
5. Combine official news, market events, Fear & Greed, on-chain observations and liquidity information into a coherent asset view.
6. Deliver selected alerts, digests and AI summaries to Telegram.
7. Preserve the underlying evidence so later analysis can evaluate which signals and information were useful.

### 0.1 Product hierarchy

**Primary user experience:** discover, inspect, understand, follow and receive alerts.

**Supporting services:** market-data ingestion, news ingestion, scanners, indicator/method calculations, AI summarization, alert rules, Telegram delivery, data storage and Operations.

**Advanced/secondary capability:** indicator bots and AI bots operating against exchange DEMO APIs for controlled testing, strategy validation and data collection. These remain supported backend capabilities, but must not dominate the primary navigation or turn the product into a full-time manual order-entry terminal.

**Execution boundary:** keep exchange execution restricted to explicitly configured DEMO/test environments in this roadmap. A research signal is not an order, a Telegram alert is not an order, and an AI summary is not an execution instruction. Any demo order must still use the existing server-side Risk Gate and exchange-specific adapter.

### 0.2 What not to build now

Do not expand the product into:

- a TradingView clone with a large standalone charting workspace;
- a generic portfolio/accounting suite for every asset class;
- a separate page for every indicator, metric or coin category;
- a large AI-agent directory as the main user experience;
- a social network, copy-trading marketplace or token promotion board;
- MT5, Exness, Forex broker or EA execution integration (these belong to the user's separate application);
- hidden-gem rankings presented as recommendations or guarantees;
- arbitrary on-chain, liquidity or derivatives data presented without source, timestamp and methodology.

---

## 1. Target information architecture — compact navigation

The left navigation should contain only the main workflows. Secondary functions are tabs, filters, detail-modal sections or admin-only tools.

```text
TM TRADING

1. Overview                    /

2. Discover                    /discover
   ├─ Market Movers             (tab/filter)
   ├─ Volatility Scanner        (tab/filter)
   ├─ Funding & Open Interest   (tab/filter)
   ├─ Top Coins                 (tab/filter)
   └─ Low-cap Discovery         (tab/filter)

3. Watchlist & Signals          /watchlist
   ├─ Watchlist                 (default tab)
   ├─ Futures Signals           (tab)
   └─ Signal History            (tab)

4. Intelligence                 /intelligence
   ├─ News & Events              (tab)
   ├─ Fear & Greed               (tab)
   ├─ On-chain                   (tab)
   ├─ Liquidity                  (tab)
   └─ Market Outlook             (tab)

5. Alerts                       /alerts
   ├─ Alert Rules                (tab)
   ├─ Telegram Delivery          (tab)
   └─ Delivery History           (tab)

6. Operations                   /operations   (operator/admin visibility)

Settings                       /settings (existing canonical route)
```

### 1.1 Navigation rules

- Do not expose `/news/events`, `/news/sources`, `/outlook`, `/scanner`, `/signals`, `/funding`, `/onchain`, `/fear-greed` as separate top-level items if their content can be shown as tabs or filters in the five primary workspaces above.
- Preserve existing route IDs and paths where possible. Use route aliases, redirects or tab state only after auditing the current TM Hub route registry and direct-link requirements.
- Do not delete working backend services or historical data merely because their page is hidden or merged into another workspace.
- Administration of providers, source registries, exchange connections and advanced controls remains permission-gated under Settings or Operations.
- Keep Strategy Lab, AI Agent administration and exchange-demo sessions accessible through an Advanced/Research area or contextual links, not in the default compact navigation.
- Hide unfinished pages and menu entries. A visible tab must resolve to a real, tested API and meaningful empty/error state.

---

## 2. Core screen UX — data first, details on demand

The default interaction model is:

**Compact data table/card → click row/item → detail modal or responsive drawer.**

The application should not navigate to a new full page for every coin, news item, signal or on-chain event.

### 2.1 Overview `/`

Purpose: answer “What matters in the market right now?” within one screen.

Recommended layout:

1. **Market strip:** BTC/ETH market state, total market cap, total market volume, BTC dominance and configured reference indexes. Each value shows source and `asOf` time on hover/detail.
2. **Market mood:** Fear & Greed value and history sparkline, with publisher/method/source timestamp.
3. **Top movers:** compact gainers/losers and abnormal-volume list.
4. **Derivatives pulse:** funding outliers, open-interest changes, liquidation bursts and basis anomalies.
5. **Watchlist signals:** most recent valid signals for selected coins; show side, timeframe, freshness and strategy/version.
6. **News pulse:** a short list of material, deduplicated market events with AI summaries and source links.
7. **On-chain / liquidity alerts:** only high-severity or material changes, not a noisy feed of every transfer.
8. **Telegram status:** connection/delivery health and recent failures.

Avoid large decorative KPI cards. Use compact tiles with trend context, table rows and small sparklines. Prioritize content density without making values hard to scan.

### 2.2 Discover `/discover`

Use one unified scanner workspace with a segmented tab/filter selector:

- **Movers:** biggest absolute and relative changes across configured windows (e.g. 5m, 15m, 1h, 4h, 24h).
- **Volatility:** realized range/volatility, ATR%, volume ratio, breakout from recent range, abnormal spread and liquidity checks.
- **Funding:** current funding, next settlement time, funding interval, historical percentile and cross-venue comparison where instrument mappings are valid.
- **Open Interest:** absolute/percentage OI changes, price/OI relationship and source quality.
- **Liquidations:** observed liquidation events and supported liquidation-cluster/heatmap data; clearly distinguish measured venue events from vendor-estimated zones.
- **Top Coins:** ranking by selected metric such as market cap, turnover, depth or watchlist popularity. Do not mix ranking methodologies.
- **Low-cap Discovery:** filtered universe for research candidates, with explicit liquidity, spread, age, market-cap/FDV, volume, holder concentration, unlock and contract-risk fields where sources support them.

Every scanner supports saved filters, column selection, sort, timeframe, venue, quote currency, minimum liquidity and exclusion rules. Do not subscribe to every high-frequency channel for every listed asset. Use backend scanner snapshots and demand-driven subscriptions.

### 2.3 Watchlist & Signals `/watchlist`

The user can create multiple watchlists, for example:

- Futures focus
- Spot research
- High volatility
- Low-cap watch
- Funding watch

The default table should include symbol, venue/source, last price, 24h change, current volatility, volume ratio, funding/next funding, OI change, latest signal and data freshness.

Tabs:

- **Watchlist:** user-selected instruments and compact live metrics.
- **Futures Signals:** generated only for enabled symbols/strategies/timeframes; show valid/expired/invalidated state.
- **Signal History:** historical signals and subsequent observed outcome, without rewriting the original decision.

A signal detail modal must show the actual indicator/method evidence, strategy version, timeframe, trigger policy (closed bar/intrabar), generated time, expiry/invalidation, relevant market/news/funding context and subsequent price path. Do not let an LLM invent entry/SL/TP values. These fields must come from deterministic strategy output and be labelled as research/paper context.

### 2.4 Intelligence `/intelligence`

One workspace with tabs rather than separate standalone products:

- **News & Events:** official and licensed sources, deduplicated event clusters, category, affected assets, source tier and AI summary.
- **Fear & Greed:** current index, historical trend, source/method, update timestamp and known limitations.
- **On-chain:** exchange inflow/outflow, netflows, large transfers, whale activity, active addresses, stablecoin flows, TVL and other metrics supported by configured providers.
- **Liquidity:** venue order-book depth/imbalance, large resting-liquidity areas where observable, liquidation maps/estimated clusters when licensed, and large liquidation events.
- **Market Outlook:** evidence-backed market summaries with separate short/mid/long horizons and explicit uncertainty/counter-evidence.

Each data type must declare whether it is directly observed, provider-derived, model-estimated or AI-interpreted. Never display an estimated liquidation heatmap as an actual order book.

### 2.5 Alerts `/alerts`

One place to manage:

- volatility/volume alerts;
- funding threshold or funding percentile alerts;
- OI spikes and price/OI divergence;
- futures signal alerts for watchlist instruments;
- news/event alerts by category and affected asset;
- on-chain large transfer/netflow anomalies;
- liquidity/large liquidation alerts;
- daily/periodic market digest.

Telegram is a delivery channel, not the alert engine. Alert evaluation and deduplication happen server-side. Users should be able to enable/disable each category, select symbols/watchlists, set severity and cooldown, choose instant vs digest delivery and inspect delivery history.

### 2.6 Operations `/operations`

Keep Operations as the technical control room, not a second market dashboard. It should show actual ingestion workers, scanner jobs, news/on-chain connectors, AI summarization jobs, Telegram delivery, exchange-demo workers and queue health.

Recommended sections:

- Worker status: running, idle, degraded, failed, disabled.
- Last heartbeat and last successful work item (not just process uptime).
- Queue depth, oldest queued job, retries and dead-letter count.
- Provider freshness, latency, rate limit and error state.
- Last successful Telegram delivery and failure reason.
- Active demo bot/session state, isolated from signal/alert status.
- Recent correlated errors and action history.

A process showing `running` without a recent successful work timestamp must be marked `IDLE` or `DEGRADED`, not healthy.

---

## 3. Universal detail modal / drawer

All primary data entities should open the same reusable detail-shell component with entity-specific sections.

### 3.1 Entities that open details

- Coin / instrument
- Market scanner row
- Futures signal
- News item / event cluster
- Funding anomaly
- Open-interest anomaly
- On-chain event / wallet flow
- Liquidity zone / liquidation event
- Alert rule / delivery record
- Bot / demo session (advanced access)

### 3.2 Coin detail modal

Recommended tabs:

1. **Overview:** price, market cap, 24h stats, liquidity, spread, venues, source freshness.
2. **Chart:** selected timeframes, volume and enabled overlays; lazy-load when modal opens.
3. **Spot:** spot venue pairs, order-book/depth summary where supported.
4. **Futures:** perpetual contracts by venue, mark/index/last, funding, next settlement, OI, basis and contract status.
5. **Signals:** active and historical research signals, strategy/method attribution.
6. **News:** related event clusters and official disclosures.
7. **On-chain:** provider-supported observations, source, time and methodology.
8. **Liquidity:** observed depth and separate estimated liquidity/liquidation zones.
9. **Alerts:** quick configuration for this coin/watchlist.

Do not eagerly load every tab. Load the overview first, then fetch tab details on demand and cache with freshness metadata.

### 3.3 Other detail modals

**Signal:** summary → evidence → indicator/method values → strategy version → market context → outcome history.

**News/event:** AI summary → source list → original links → claims/entities → affected assets → timeline/revisions → related signals.

**On-chain event:** event type → source/provider → transaction reference if available → involved entity labels and confidence → baseline/anomaly calculation → related price/volume reaction.

**Liquidity event:** observed vs estimated classification → venue/instrument → price bands → timestamp/window → methodology → confidence/data limits.

### 3.4 Interaction and accessibility

- Desktop: wide modal or right-side drawer (roughly 720–960px depending on content); avoid narrow centered dialogs for tables/charts.
- Mobile: full-height bottom sheet or full-screen detail view.
- Preserve list scroll position, filters, sorting and selected row when closing.
- Support keyboard navigation, Escape to close, focus trapping/restoration and accessible labels.
- Make details deep-linkable using stable entity IDs in URL query/hash where feasible; browser Back should close the modal before leaving the workspace.
- Use skeleton loading, explicit empty states, stale states and error retry actions.
- Do not open a new browser tab for internal entity details.

---

## 4. Core market data and analytics services

The UI is a projection of backend services. It must not calculate authoritative scanner ranks, signals, PnL or anomaly classifications in the browser.

### 4.1 Market data pipeline

```text
Exchange / market-data providers
        ↓
Provider adapters + connection managers
        ↓
Canonical instrument mapping
        ↓
Timestamp / sequence / quality validation
        ↓
Market event bus
        ├─ quote / ticker
        ├─ trades
        ├─ candles (forming + closed)
        ├─ order-book state
        ├─ funding observations
        ├─ open-interest observations
        └─ liquidation events
                ↓
        Recorder + current-state projections
                ↓
        Scanner / Signals / Intelligence / Telegram
```

Use direct exchange sources as the authority for venue-specific price, mark, funding, OI, order book and execution context. Cross-venue values are comparison/reference data and must retain venue identity.

### 4.2 Data freshness contract

Every displayed observation must have:

```ts
interface DataProvenance {
  source: string
  venue?: string
  instrumentId?: string
  eventTime: number
  ingestTime: number
  asOf: number
  quality: 'valid' | 'delayed' | 'stale' | 'gap' | 'estimated' | 'unavailable'
  methodology?: string
}
```

Rules:

- Show a freshness label or timestamp for every live market metric.
- Stale data must not be presented with a green/live state.
- A missing metric is `N/A`/`UNAVAILABLE`, not zero.
- Provider fallback must emit a source-change event and visibly identify the new source.
- Do not mix mark price from one exchange with OI/funding from another without an explicit cross-venue comparison label.

### 4.3 Volatility and movers scanner

For each instrument and configured window, compute only metrics with a defined formula and sufficient data:

- absolute and percentage price change;
- realized range / realized volatility;
- ATR and ATR percentage;
- volume and volume ratio against a comparable baseline;
- spread and top-of-book depth where available;
- breakout/range expansion state;
- abnormality percentile/z-score with baseline period and warmup state.

Avoid one opaque `pump score`. If a composite score is shown, list its components, weights, time horizon and version. Include false-positive filters for low liquidity, spread spikes, stale feeds, exchange-specific outages and newly listed instruments with insufficient history.

### 4.4 Funding and derivatives monitor

Normalize each venue's contract metadata and preserve venue semantics:

- current/published funding rate;
- next funding timestamp and actual funding interval;
- historical rate and percentile;
- open interest and absolute/percentage changes;
- mark/index/last price and basis where available;
- liquidation observations and data-source limits.

Funding rate observation is not the same as a funding payment. If a connected demo account exposes actual funding cash flows, store them separately. Do not infer a universal eight-hour funding interval.

### 4.5 Top coins and low-cap / hidden-gem discovery

A candidate is a research result, not a buy recommendation.

**Top coin universe:** rank using clearly named measures (market cap, liquidity, turnover, volume, derivatives depth, etc.) and allow users to select the ranking method.

**Low-cap discovery:** configurable screens can consider:

- market cap and fully diluted valuation (FDV), with source and update age;
- 24h/7d turnover and volume-to-market-cap ratio;
- spread, order-book depth and venue count;
- token age/listing history and recent unlock schedule where available;
- holder concentration, top-holder changes and exchange flows where supported;
- contract verification, ownership/admin controls and security-provider flags where available;
- abnormal volatility, wash-trading/manipulation risk indicators and insufficient-data flags.

Do not invent missing circulating supply, market cap, holders, unlocks or contract audit status. If critical screening data is missing or stale, lower eligibility or mark `INSUFFICIENT DATA` rather than filling from an LLM guess.

A transparent candidate profile may show component scores, risk flags and why an asset was included/excluded. Do not call it “AI guaranteed gem” or imply likely returns.

### 4.6 Fear & Greed

Store value, timestamp, source, calculation methodology and historical series. If using a third-party index, preserve the provider's definition. If TM later builds its own composite sentiment index, version its features/weights and show it as a separate TM index rather than relabeling a third-party score.

### 4.7 On-chain intelligence

Build provider adapters around supported datasets, for example:

- exchange inflow/outflow and netflow;
- large transfers and whale activity;
- active/new addresses and transaction count;
- stablecoin supply/flows;
- TVL and protocol flows;
- holder concentration and distribution changes;
- token unlock/vesting events where data is licensed.

Every on-chain item carries chain, asset/contract, transaction reference where available, provider, entity-label confidence, observation time and anomaly baseline. Do not equate a large transfer to an exchange with a confirmed sell.

### 4.8 Liquidity and liquidation intelligence

Keep four data classes distinct:

1. Direct order-book levels observed on a specific venue.
2. Aggregated visible liquidity across venues, with aggregation timestamp and venue list.
3. Actual liquidation events from venue feeds where supported.
4. Vendor/model-estimated liquidation or liquidity zones.

Only show “large liquidity zone” when the method, source, threshold and time window are visible. Order-book walls can be cancelled; show persistence/age and do not imply that displayed resting orders will execute.

---

## 5. Futures research signals and watchlist workflow

Signal generation remains deterministic and versioned.

### 5.1 Signal pipeline

```text
Fresh market event
  → canonical market snapshot
  → native indicators / imported-and-ported Pine logic
  → method / confluence engine
  → configured strategy rules
  → signal validation + deduplication
  → persist immutable signal + evidence
  → UI stream + optional Telegram notification
```

### 5.2 Signal record minimum

```ts
interface FuturesResearchSignal {
  signalId: string
  ownerId: string
  watchlistId?: string
  instrumentId: string
  venue: string
  contractType: string
  timeframe: string
  side: 'LONG' | 'SHORT'
  status: 'ACTIVE' | 'EXPIRED' | 'INVALIDATED' | 'SUPERSEDED'
  triggerPolicy: 'CLOSE_ONLY' | 'INTRABAR'
  strategyId: string
  strategyVersionId: string
  indicatorEvidence: unknown[]
  methodEvidence: unknown[]
  marketSnapshotId: string
  generatedAt: number
  expiresAt?: number
  invalidation?: unknown
  sourceQuality: string
}
```

Use the current repository's equivalent schemas where possible; do not duplicate models solely to match this illustrative contract.

### 5.3 Signal lifecycle

- A forming-candle signal is provisional and must be visibly labelled.
- The default production research policy is `CLOSE_ONLY` unless a strategy explicitly supports intrabar calculation and its repaint/reversal behavior is tested.
- Expire or invalidate a signal deterministically; never silently rewrite its original evidence.
- A new signal does not automatically supersede an older one unless the strategy's rule defines that transition.
- Measure subsequent outcomes at documented horizons for research, not as proof that the signal predicts future returns reliably.

### 5.4 Bot roles in V4

- **Scanner workers:** continuously evaluate broad universes for events and candidates.
- **Indicator/method workers:** calculate signals for configured watchlists and strategies.
- **AI analyst workers:** summarize evidence, rank attention priority transparently and explain anomalies; they do not invent deterministic signal values.
- **Exchange-demo execution bots:** advanced controlled experiments only, still governed by V3.9 Section 63–64 and Risk Gate. They are not required to operate the discovery/alerting product.

---

## 6. News, AI summaries and cross-market context

News remains important but becomes a tab in Intelligence and a contextual layer inside coin details.

Required behaviors:

- prioritize official announcements, exchange notices, project disclosures, regulator and macro-statistics sources, and licensed news feeds;
- deduplicate syndicated versions while retaining original source provenance;
- summarize in Vietnamese and/or English according to user preference;
- identify event type, affected assets, event time, publication time, source tier and confidence;
- separate confirmed facts, source claims, AI interpretation and unknowns;
- show counter-evidence and conflicting reports;
- link each summary to source URLs or permitted source excerpts;
- respect each provider's terms, license, content retention and redistribution conditions.

AI must not convert headline sentiment directly into a futures signal. News/event context may be passed into the signal detail or AI analysis packet with strict as-of timestamps.

---

## 7. Telegram notification system

Telegram is a first-class output channel for the product.

### 7.1 Alert categories

- market volatility and abnormal volume;
- top gainers/losers or configured mover thresholds;
- funding extremes and upcoming funding settlement;
- OI spike/divergence;
- futures research signal for watchlist coins;
- low-cap candidate passes or risk-flag changes;
- large on-chain transfer/netflow anomaly;
- observed liquidation burst or provider-estimated liquidity zone;
- material news/event and AI market digest;
- daily/weekly crypto market summary.

### 7.2 User controls

- per-category enable/disable;
- per-watchlist and per-symbol selection;
- threshold and severity settings;
- instant vs digest delivery;
- cooldown, quiet hours and max messages per period;
- language and concise/detailed formats;
- delivery test and recent failure history.

### 7.3 Delivery correctness

- deduplicate using a stable alert key;
- use an outbox/queue for retryable delivery;
- use exponential backoff and dead-letter visibility;
- distinguish `queued`, `sent`, `delivered/accepted` only where Telegram/API provides evidence, and `failed`;
- avoid duplicate notification storms after reconnect/reprocessing;
- never include exchange API secrets, private account data or sensitive credentials in Telegram messages.

Suggested message layout:

```text
[TM Trading] FUNDING ANOMALY
BTCUSDT · Bybit Perpetual
Funding: value + percentile vs 30d history
Next settlement: timestamp/countdown
OI change: value + window
Price move / volume: values + windows
Data source / as-of: venue + timestamp
Open in TM Trading: deep link to detail modal
```

The template must render only fields actually supported by the source.

---

## 8. AI assistant — embedded, contextual, not another sprawling module

Do not add a prominent standalone AI chat page as a primary navigation item.

Provide a compact assistant entry point in the header and contextual “Ask AI about this” action inside every detail modal.

Context examples:

- coin modal: summarize price/funding/OI/news/on-chain evidence for this asset;
- funding row: explain historical percentile, venue differences and next settlement;
- signal modal: explain deterministic indicator/method evidence and possible invalidation;
- news modal: summarize verified facts and affected assets;
- low-cap candidate: explain screening components and missing/risk data;
- Operations error: explain the error from sanitized logs and suggest a safe diagnostic step.

AI response contract:

- include source IDs/URLs and `asOf` timestamp for factual claims;
- clearly distinguish stored facts from model interpretation;
- show uncertainty and missing data;
- do not claim a provider is healthy without recent probe evidence;
- do not invent price, funding, market cap, holder, liquidity or PnL values;
- do not directly trigger exchange orders from a natural-language answer;
- use the existing AI Provider Gateway and per-user/provider budgets.

The assistant can create drafts of filters, watchlists, alert rules or research queries. Sensitive changes require explicit user confirmation and server-side authorization.

---

## 9. Backend architecture — one set of domain services

Avoid one bespoke backend for each page. Reuse a domain-oriented service layer:

```text
Nuxt UI
  ├─ REST snapshot/query APIs
  └─ authenticated realtime subscriptions
           ↓
TM Trading API / Realtime Gateway
           ↓
Domain services
  ├─ Instrument & Watchlist Service
  ├─ Market Data Service
  ├─ Scanner / Discovery Service
  ├─ Derivatives / Funding / OI Service
  ├─ News / Event / Macro Service
  ├─ On-chain Intelligence Service
  ├─ Liquidity / Liquidation Service
  ├─ Signal / Indicator / Method Service
  ├─ Alert Rule & Notification Service
  ├─ Telegram Delivery Service
  ├─ AI Gateway / Summary Service
  └─ Advanced Demo Bot / Session Service
           ↓
Durable event and storage layer
```

### 9.1 Realtime transport

- REST provides initial snapshots, historical queries and recovery.
- WebSocket streams high-value market and user workspace updates.
- SSE may remain for Operations logs/health if the current implementation is stable.
- All streams require authentication and owner-scoped authorization.
- Use demand-driven channel subscriptions; do not fan out every exchange tick to every browser.
- Browser reconnect must request a fresh snapshot and resume from a sequence/cursor where the event contract supports it.

### 9.2 Storage policy

Reuse the current MongoDB models for user configuration, watchlists, alerts, news metadata, signal records, source registry, Telegram deliveries, sessions and audit data.

For market history:

- keep hot current state in memory/Redis where operationally justified;
- use compressed columnar files/Parquet for historical market recordings where appropriate;
- consider ClickHouse only when query volume/retention/aggregation benchmarks justify a dedicated analytical store;
- do not store every high-frequency tick as an unbounded MongoDB document stream;
- define retention, compaction, partitioning, recovery and export policies.

### 9.3 Jobs and services

Workers must run independently from the Nuxt page lifecycle. Every worker reports heartbeat, last successful work item, event counts, error counts, queue lag, provider freshness and restart count. Use the existing queue/runtime when adequate; add Redis/BullMQ only where durable scheduling/retry/concurrency is needed and where deployment operations can support Redis reliably.

### 9.4 Multi-tenancy

- `ownerId` comes from the authenticated TM Hub identity, never from arbitrary browser payload fields.
- User watchlists, alert rules, Telegram destinations, AI preferences and private events are owner-scoped.
- Shared market observations may be calculated once and safely projected to authorized users, but user-specific signals and alert decisions remain separately scoped.
- Any cached result must include all authorization and configuration dimensions that affect its content.

---

## 10. UI system and presentation standards

### 10.1 Visual principles

- Market terminal aesthetic, but calm and information-dense rather than decorative.
- Use compact typography, consistent number alignment and tabular numerals.
- Prefer tables for comparative data; use cards only for high-priority summaries or mobile layouts.
- Use red/green for market direction only; use neutral colors for ordinary metadata.
- Avoid attention-grabbing colored badges for every value.
- Display units explicitly: %, USDT, USD, token, contracts, USD notional, funding interval.
- Show source and freshness next to data without overwhelming the table; full provenance is in the modal.
- Provide configurable density: comfortable / compact.
- Support desktop widescreen first, then responsive tablet/mobile drawers.

### 10.2 Table behavior

- sticky header and optional pinned symbol column;
- saved column presets per workspace;
- server-side filtering/sorting/pagination for large universes;
- virtualize long lists;
- preserve sort/filter when modal opens/closes;
- animate only changed cells subtly and avoid continuous flashing;
- show skeleton, empty, stale, partial and provider-error states distinctly.

### 10.3 Avoid page proliferation

Before creating a route, ask whether the feature is better represented as:

1. a column in an existing table;
2. a filter or preset;
3. a tab inside a workspace;
4. a section in a detail modal;
5. an admin-only setting in Operations.

A new standalone page is justified only when it represents a distinct repeated workflow that cannot be made clear in the current workspace.

---

## 11. Data truth, quality and anti-noise policy

The system's value depends on not overwhelming the user with false discoveries.

- Every scanner has explicit universe, timeframe, baseline and threshold definitions.
- Every anomaly has severity, baseline, source, evidence, first-seen and last-seen timestamps.
- Every event is deduplicated and has a cooldown/resolve lifecycle.
- Every low-cap candidate includes risk and missing-data flags.
- Every provider outage degrades the relevant data panel without silently substituting a non-equivalent source.
- Every AI summary references the evidence available at generation time.
- Backfilled or corrected source data must not silently rewrite the evidence used for an old signal; record revisions and lineage.
- Avoid sending Telegram for every small metric update. Use materiality thresholds, persistence checks and event grouping.

Suggested event lifecycle:

```text
DETECTED → QUALIFYING → ACTIVE → UPDATED → RESOLVED / EXPIRED
```

For low-confidence/noisy events, store them for later analysis but do not notify by default.

---

## 12. Product metrics and acceptance criteria

### 12.1 User experience

- User can open Overview and understand market state without visiting multiple pages.
- User can filter movers/funding/OI/low-cap candidates in one Discover workspace.
- Clicking a coin opens one detail modal with spot, futures, news, on-chain, liquidity and alert context.
- Clicking a signal opens its evidence and immutable strategy version without losing the watchlist state.
- Telegram delivery settings and history are available in one place.
- Browser Back closes the modal before leaving the workspace where URL-based modal state is enabled.

### 12.2 Data correctness

- Every metric exposes source, as-of time and quality.
- Scanner values match deterministic calculation fixtures.
- Funding interval comes from venue/instrument metadata, never a hardcoded universal interval.
- Cross-venue comparison never merges account balances, position PnL or funding cash flows.
- Low-cap filters never fabricate missing circulating supply, FDV, holder or liquidity data.
- On-chain anomaly alerts include provider methodology and do not infer intent from transfer size alone.
- Observed order-book liquidity and estimated liquidation levels are separate data types.

### 12.3 Realtime and reliability

- Initial REST snapshot plus realtime stream produces a consistent view.
- Reconnect and resync do not duplicate alerts or lose durable events.
- Stale feeds are visibly stale and cannot drive a valid fresh signal unless the strategy explicitly allows the defined quality state.
- Worker health reflects last successful work, not only process uptime.
- Telegram retry does not produce duplicate messages for the same alert key.
- Every backend worker can be stopped/restarted without losing user configuration or historical records.

### 12.4 AI quality

- AI factual summaries link back to source evidence.
- AI never manufactures missing market/on-chain/funding metrics.
- Summary quality can be evaluated against a baseline without AI.
- Historical evaluation uses as-of data and prevents future leakage.

---

## 13. Migration plan from V3.9

Do not delete or rewrite working backend services as part of the UI consolidation.

### Phase 0 — Route and capability inventory

- Audit existing routes, route IDs, menus, APIs, Mongo models and services.
- Map each current page to Overview, Discover, Watchlist & Signals, Intelligence, Alerts, Operations or Advanced.
- Mark every feature `WORKING`, `PARTIAL`, `SEED_ONLY`, `READ_ONLY`, `UNAVAILABLE` or `NOT_IMPLEMENTED` based on live evidence.
- Identify duplicate pages and duplicate API/domain logic.
- Produce `docs/web-app/v4-product-scope-audit.md` and `docs/web-app/v4-route-migration-map.md`.

### Phase 1 — UI consolidation only

- Implement the compact navigation and unified workspaces using existing API services.
- Build the reusable detail modal/drawer shell.
- Merge News/Events/Outlook/On-chain/Fear&Greed/Liquidity into Intelligence tabs where their backend capability exists.
- Merge Scanner/Mover/Funding/OI/Top/Low-cap into Discover tabs and filters.
- Keep unfinished capabilities hidden or explicitly marked unavailable.
- Do not change signal mathematics or execution behavior in this phase.

### Phase 2 — Data contract and reliability

- Normalize provenance/freshness/quality for every visible market metric.
- Verify market event subscriptions, REST bootstrap, cursor resync and worker health.
- Fix duplicate/missing/stale data and source identity issues.
- Ensure per-user watchlists, rules and Telegram destinations are tenant-safe.

### Phase 3 — Scanner and intelligence quality

- Consolidate volatility/movers/funding/OI scanners.
- Add or complete top coin and low-cap discovery criteria.
- Integrate Fear & Greed, news/events, on-chain and liquidity data using source adapters and capability flags.
- Add noise controls, anomaly baselines and evidence-backed event clusters.

### Phase 4 — Signal and Telegram workflow

- Connect watchlists to deterministic futures research signals.
- Ensure signal attribution, lifecycle, expiry and outcome history.
- Complete per-user alert rules and Telegram outbox/delivery history.
- Run shadow evaluation before enabling notifications broadly.

### Phase 5 — Advanced demo bots and AI research

- Keep the V3.9 Bybit/Binance/OKX demo adapters available as an advanced/testing layer.
- Keep exchange-demo execution out of the default discovery flow.
- Ensure all demo bot decisions and outcomes can be traced to stored market evidence.
- Use historical data for AI research with dataset lineage and out-of-sample evaluation.

---

## 14. Mandatory first deliverable for the coding agent

Before changing files, the coding agent must produce a repository-backed report with:

1. Existing route/page inventory and target V4 route mapping.
2. Existing backend capabilities for volatility, funding, OI, liquidation, news, Fear & Greed, on-chain, liquidity, watchlists, signals and Telegram.
3. For each capability: exact source files, APIs, model/collection, worker/scheduler, realtime event, UI consumer and test coverage.
4. Actual data source and current freshness/quality behavior.
5. Which pages can be merged as tabs/modal details without breaking deep links or TM Hub route permissions.
6. Which functions are seed-only, mock, unconsumed, partially wired or not implemented.
7. A phased migration plan that preserves working services and historical data.

Do not begin by redesigning every page at once. Complete one vertical workflow at a time and demonstrate it with real source data.

### Required end-to-end vertical slices

**Slice A — Movers:** exchange feed → canonical market events → volatility/mover scanner → Discover table → coin detail modal.

**Slice B — Funding/OI:** venue funding/OI feed → normalized observations → anomaly detection → Telegram alert → alert detail modal.

**Slice C — News:** authorized source → ingestion/deduplication → AI summary with source evidence → Intelligence tab → Telegram digest.

**Slice D — Watchlist signal:** user watchlist → indicator/method engine → immutable futures research signal → Watchlist & Signals table → signal detail modal → optional Telegram delivery.

**Slice E — On-chain/liquidity:** provider data → validated event/estimate classification → anomaly rule → Intelligence tab/modal → Telegram alert with provenance.

Each slice must include fresh/stale/error states, tenant isolation, retry/idempotency and tests.

---

## 15. Final product rule

TM Trading V4 is not a sprawling list of trading tools. It is a focused crypto market intelligence and alerting platform with a small number of high-utility workspaces.

The user should spend most of their time in:

- Overview to see what matters;
- Discover to find unusual or relevant assets;
- Watchlist & Signals to follow selected coins;
- Intelligence to understand news, sentiment, on-chain and liquidity context;
- Alerts to control Telegram delivery.

Operations and advanced demo bots support reliability and research behind the scenes. The UI shows real data only, explains provenance and freshness, and opens a detail modal when the user asks to inspect an item.

**Do not add another page, metric or AI agent unless it improves one of these core workflows and can be supported by real, testable data.**

---

# 16. Product & Architecture Clarification — V4.1 Authority

> **Why this section exists:** The V4.0 consolidation correctly reduced UI sprawl, but the product owner clarified that the simplification must not remove the TM Hub/shared-core platform, and that exchange-demo trading should remain a small Pine-indicator validation workflow. TM Trading's main value is collecting and connecting market evidence, supporting multi-provider AI analysis, and producing explainable market outlooks and research signals. This section takes precedence over any broader or conflicting interpretation in earlier sections.

## 16.1 Final product definition

TM Trading is:

**A crypto-first Market Intelligence, Data Research, Multi-Provider AI Analysis and Alerting application, with a lightweight Pine-based exchange-demo test harness.**

The product has four user-facing outcomes:

1. **Discover:** detect unusual coins, market movements, volume, funding, OI, liquidity and on-chain changes.
2. **Understand:** combine market, derivatives, news, sentiment, token and on-chain evidence into short-, medium- and long-horizon research briefs.
3. **Follow & alert:** maintain watchlists, view deterministic spot/futures research signals and send selected findings to Telegram.
4. **Validate:** run user-owned Pine indicators or approved native ports against exchange demo/test environments to observe whether their signals behave as expected. This is not a full broker, portfolio or production execution platform.

The system should help the user understand evidence and uncertainty. AI-generated outlooks and signals are research outputs, not guarantees or personalized financial advice. In this roadmap, automated execution is restricted to explicitly configured demo/test environments.

## 16.2 Keep the TM Hub and shared core platform

V4.0's compact primary navigation is a presentation change only. It must not delete, replace or duplicate TM Hub/core capabilities.

Keep and continue using the existing Hub-owned or shared-core modules according to their current ownership contracts, including where present:

- authentication, session and user identity;
- Application Registry, `appId` and application credentials;
- IAM, users, roles, permissions and RBAC;
- dynamic route/menu registry and app route mapping;
- remote configuration and app-scoped configuration inheritance;
- shared connections/grants where the Hub owns the integration;
- shared notifications, inbox and delivery integrations;
- media gateway, import and shared resource services;
- shared queues and operational administration where already implemented;
- profile, system settings, docs, audit/system logs and health tooling.

Rules:

1. Do not build a second login, user store, role engine, permission registry, application registry or dynamic route registry inside TM Trading.
2. Do not delete Hub pages/routes just because they are not part of the daily crypto workflow.
3. Preserve existing route IDs, paths, permissions, app identity and deep links unless a tested migration explicitly changes them.
4. Put Hub/core administration under a compact **Platform & Administration** group, footer section, or permission-gated settings navigation. It remains accessible to authorized operators but does not crowd the market workflow.
5. Use TM Hub's dynamic route registry for menu management. The frontend may group and label routes more clearly, but must not create a duplicate navigation database.
6. Distinguish generic Hub connections from market-data/exchange adapters. A generic connection record does not prove a market-data feed is healthy.
7. Keep app-owned AI provider credentials and request budgets under the TM Trading app's secret-management boundary, unless a specific provider integration is explicitly granted and owned by the Hub. The Hub may publish provider metadata/configuration or a kill-switch request, but must not silently become a mandatory inference proxy.

Target navigation layers:

```text
PRIMARY MARKET WORKSPACES
  Overview
  Discover
  Watchlist & Signals
  Intelligence
  Alerts
  Operations

ADVANCED / RESEARCH
  Pine Indicator Tests (demo only)
  AI Research & Evidence
  Provider / Model Profiles
  Historical Data & Dataset Tools (where implemented)

PLATFORM & ADMINISTRATION (TM HUB / SHARED CORE)
  Users / Roles / Permissions
  Apps / Routes / Configs
  Shared Connections / Notifications / Inbox
  Media / Import / Queues
  Profile / Settings / Docs / Logs / Health
```

This is a menu placement guide, not a request to create every route anew. Reuse existing working pages and route records.

## 16.3 Keep exchange-demo testing deliberately small

Do not turn TM Trading into a large generic trading terminal or a second portfolio-management application.

The required demo feature is a **Pine Indicator Demo Test** workflow:

```text
Select approved Pine indicator / native port
        ↓
Select supported coin + timeframe + exchange demo environment
        ↓
Load exchange market data and instrument metadata
        ↓
Evaluate indicator with verified Pine-compatible semantics
        ↓
Create deterministic signal event
        ↓
Apply demo-only test policy + server-side safety validation
        ↓
Optionally submit a demo order through the selected exchange adapter
        ↓
Reconcile exchange order / fill / position / account state
        ↓
Persist result, costs, evidence and indicator version
        ↓
Review in a compact test result / history view
```

Minimal domain objects should be preferred over a sprawling bot platform:

- `PineIndicatorDefinition` or reuse the existing indicator registry;
- immutable indicator/source version and source hash;
- `PineDemoTestProfile` containing symbol, venue, timeframe, input values, trigger policy, demo account reference and test configuration;
- `PineDemoTestRun` containing lifecycle, timestamps, market-data source, indicator version, emitted signals and result summary;
- exchange-sourced demo order/fill/position references, with locally persisted snapshots and event history.

Reuse existing bot/session/order models if their semantics fit. Do not create duplicate collections merely to match these illustrative names.

The test UI only needs:

- list of approved indicators/scripts;
- compatibility and parity status;
- test configuration (symbol, timeframe, venue, demo account, trigger policy and fee context);
- Start / Pause / Stop for a demo test run;
- live status, last processed bar/tick, signal count and errors;
- order/fill/position/PnL summary sourced from the selected demo exchange;
- test history and a result detail modal.

Do not build a generic bot marketplace, complex visual strategy builder, full manual order terminal, multi-agent bot swarm or extensive portfolio suite as part of this feature. Keep the existing Risk Gate and idempotency controls for all demo order submission.

## 16.4 Pine reuse — compatibility, not blind execution

Pine indicators and Pine strategies must be distinguished:

- An `indicator()` script calculates series, plots and/or emits alert conditions. It does not itself submit orders to an exchange.
- A `strategy()` script uses TradingView's own broker emulator for its strategy orders and simulated fills. Those simulated fills are not the same as sending an order to an exchange demo API. TradingView documents this separation in its Pine strategy and broker-emulator documentation.
- TM Trading must map approved signal outputs to its own demo execution adapter only after validating signal semantics, idempotency and demo-only account configuration.

Import options:

1. **Preferred for user-owned, high-value scripts:** port the calculation logic into the existing TypeScript/Node indicator/method engine, preserving the original Pine file and running golden parity fixtures against matching TradingView outputs.
2. **Compatibility proof-of-concept:** evaluate PineTS on a representative subset. Current public package documentation advertises native Pine v5/v6 execution, but its feature matrix still distinguishes full v6 compatibility from implemented features. Its published dual AGPL-3.0/commercial licensing must be reviewed before use in a closed-source or hosted product. Do not add it to production before a legal/license decision and parity benchmark.
3. **Unsupported scripts:** generate an explicit compatibility report (`supported`, `needs adapter`, `unsupported`, `unsafe`) and offer manual porting. Never silently approximate unsupported Pine functions.

Parity gates must cover:

- historical vs realtime/forming bar behavior;
- closed-bar vs intrabar trigger policy;
- `request.security` and timeframe alignment;
- lookahead/repainting and pivot confirmation delay;
- `var`/`varip`, arrays, stateful functions and warm-up;
- session/timezone and missing candle behavior;
- strict comparison boundaries and NaN/null handling;
- signal deduplication and one-signal-per-bar semantics.

Only scripts with an approved rights/ownership status and passing fixtures can be enabled for demo testing. Never execute arbitrary uploaded Pine code with unrestricted filesystem, network or process access.

References:
- TradingView Pine execution model: https://www.tradingview.com/pine-script-docs/language/execution-model/
- TradingView strategies/broker emulator: https://www.tradingview.com/pine-script-docs/concepts/strategies/
- PineTS: https://github.com/LuxAlgo/PineTS
- PineTS license: https://github.com/LuxAlgo/PineTS/blob/main/LICENSE

## 16.5 Market data remains the foundation shared by every module

Every module must consume the same normalized, timestamped, provenance-aware observations rather than implementing its own exchange fetch logic.

```text
Exchange / market-data providers
        ↓
Provider adapters + connection manager
        ↓
Canonical instruments and symbol mappings
        ↓
Timestamp / sequence / quality validation
        ↓
Shared market event and snapshot services
        ├── Discover / Movers / Volatility
        ├── Funding / OI / Liquidation
        ├── Watchlists / Indicator calculations
        ├── Futures and Spot research context
        ├── AI evidence packets
        ├── Telegram alert rules
        └── Pine Demo Test runner
```

Retain Bybit, Binance and OKX adapters from V3.9 where verified. Each venue remains a distinct data source. Cross-venue aggregation is allowed only with explicit venue metadata and compatible units/contract mappings.

Every observation should include `source`, `venue` where relevant, `eventTime`, `ingestTime`, `asOf`, `quality` and a canonical `instrumentId`. Missing data is not zero. Stale or estimated data must not be labelled as live/observed.

## 16.6 Unified evidence and context service

Introduce or consolidate a shared **Market Evidence / Context Service**. It should assemble a time-bounded evidence packet for a market, instrument, watchlist or research question.

Supported evidence categories include:

- spot and futures prices, OHLCV and volume;
- volatility, spread, market depth and turnover;
- funding rates, funding interval and historical percentile;
- open interest and changes, basis and liquidations where available;
- market cap, circulating supply, FDV and token metadata where licensed/reliable;
- official news, licensed news and event clusters;
- Fear & Greed and other sourced sentiment observations;
- on-chain flows, large transfers, stablecoin activity, holder/protocol metrics where supported;
- observed order-book liquidity and separately classified estimated liquidity/liquidation zones;
- indicator/method outputs and historical signal outcomes;
- selected historical datasets and demo-test evidence.

The evidence service must not send the entire database into an LLM prompt. It should query only the relevant instrument, period, categories and authorized user scope; summarize large histories into deterministic features; attach provenance, timestamps, data gaps and contradiction markers; and enforce token/context budgets.

## 16.7 Multi-provider AI Gateway and task profiles

TM Trading should support multiple model providers without coupling any feature to one vendor.

### Provider architecture

```text
Module / scheduled job / AI assistant
        ↓
AI Task API
        ↓
Task profile + authorization + budget
        ↓
AI Gateway
  ├── OpenRouter adapter
  ├── Direct provider adapters (where configured)
  ├── OpenAI-compatible custom endpoint adapter
  │     └── FreeLLMAPI only after endpoint/capability verification
  ├── Local inference adapter (optional, e.g. compatible local server)
  └── OpenCode connector (optional agent/runtime integration, not the default LLM transport)
        ↓
Normalize result + validate schema + persist request audit
```

OpenRouter may be used as a general inference gateway because it documents an OpenAI-compatible API and provider/model routing. Direct provider APIs should remain available where a model feature, privacy boundary, latency or cost justifies it.

OpenCode should be treated accurately as a multi-provider coding/agent runtime with its own server and SDK, not simply as an interchangeable model API key. It can be connected through its documented server/SDK when TM Trading needs an external agent session or coding workflow. Do not make core scheduled market analysis depend on a developer's local OpenCode desktop/CLI process.

FreeLLMAPI must be implemented as a custom adapter only after the exact deployed service is tested for:

- endpoint and authentication format;
- `/models` behavior and model identifiers;
- chat-completions or responses compatibility;
- streaming and timeout behavior;
- structured JSON output;
- tool/function calling;
- rate limits, quotas, error semantics and data handling terms.

Do not assume OpenAI compatibility from the provider name alone.

### Task profiles

Use model profiles by task, not one model for every job:

- `news.extract`: extract facts/entities/event time from source content;
- `news.summarize`: summarize one source/event cluster with citations;
- `market.snapshot.explain`: explain deterministic market metrics;
- `asset.outlook.short`: short-horizon evidence synthesis;
- `asset.outlook.medium`: medium-horizon evidence synthesis;
- `asset.outlook.long`: long-horizon evidence synthesis;
- `market.regime.synthesis`: broad market regime summary;
- `signal.explain`: explain deterministic indicator/method output;
- `research.review`: analyze historical signal/demo-test outcomes;
- `assistant.contextual`: answer a user's question about the current module/entity.

Each task profile declares provider/model, required capabilities, temperature/policy, maximum tokens, timeout, retries, cost limit, data classification and fallback policy. Fallback is allowed only when the alternative model supports the same output schema/tool capability and security boundary.

Record provider, model, model/version if available, prompt version, evidence packet ID/hash, request time, latency, token usage, cost and validation status. Encrypt credentials at rest and never send private exchange API credentials into model prompts.

## 16.8 AI market outlook — short, medium and long horizons

Create a shared research service that can generate:

1. **Market-wide outlook:** crypto market state and important cross-asset context.
2. **Asset outlook:** an individual coin's spot/futures context.
3. **Watchlist outlook:** a comparison of selected instruments.
4. **Event impact brief:** a structured explanation of a news/on-chain/derivatives event.

Horizon definitions must be configurable and visible. Suggested initial policy:

- short: intraday to 7 days;
- medium: 1 to 4 weeks;
- long: 1 to 6 months.

These are analysis windows, not guaranteed prediction horizons. Each output should use an explicit schema:

```ts
interface MarketOutlook {
  outlookId: string
  scope: 'MARKET' | 'ASSET' | 'WATCHLIST'
  instrumentId?: string
  marketType?: 'SPOT' | 'FUTURES' | 'BOTH'
  horizon: 'SHORT' | 'MEDIUM' | 'LONG'
  stance: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'MIXED' | 'INSUFFICIENT_DATA'
  summary: string
  supportingEvidence: EvidenceReference[]
  opposingEvidence: EvidenceReference[]
  keyEvents: EvidenceReference[]
  assumptions: string[]
  uncertainty: string[]
  invalidationConditions: string[]
  generatedAt: number
  evidenceAsOf: number
  providerModel: string
  promptVersion: string
}
```

The UI must distinguish deterministic measurements from LLM interpretation. Do not display a model-generated probability or confidence percentage unless it has been calibrated and validated against historical outcomes; otherwise use qualitative uncertainty and evidence coverage.

Spot and futures analyses must not be conflated. Futures context includes funding, OI, basis, liquidation and contract metadata; spot context emphasizes spot market liquidity, volume, supply/token and on-chain data. Missing futures or on-chain coverage should be shown explicitly.

## 16.9 Spot and futures research signals

Signals should be deterministic outputs of the indicator/method/rule engine. AI can explain, compare or summarize them, but must not fabricate numerical entry/stop/target values.

- Spot research signal: trend/momentum/volume/market quality context and its observed validity conditions.
- Futures research signal: directional setup with venue/contract/timeframe, funding/OI/basis/liquidation context, trigger policy and expiry/invalidation. Any future demo test must pass the demo execution policy and Risk Gate.
- A research signal is not a live order. Telegram messages must be labelled as research/demo context and link to the evidence modal.
- If data is stale, inconsistent, insufficient or cross-venue mappings are invalid, do not emit a valid signal.
- Store original signal evidence immutably and measure outcomes at defined horizons without rewriting the original record.

## 16.10 AI assistant inside modules

Retain one shared contextual assistant, not a separate chatbot implementation per page.

Context is resolved server-side from the selected entity and the authenticated user's permissions. Examples:

- Discover: explain why a coin appears in a scanner result and identify missing data;
- coin modal: summarize spot/futures, news, funding/OI, on-chain and liquidity evidence;
- Intelligence: summarize event clusters and compare corroborating/conflicting sources;
- Watchlist & Signals: explain indicator/method evidence and signal validity;
- Alerts: draft alert-rule changes and explain delivery history;
- Operations: diagnose sanitized service/worker failures;
- Pine Demo Test: explain compatibility/parity failures and test outcomes.

The assistant must cite internal record IDs/source URLs and `asOf`, distinguish facts from interpretation, admit insufficient evidence and avoid direct execution from a free-form answer.

## 16.11 Recommended implementation languages and stack

### Primary stack — TypeScript + Node.js

Use TypeScript for new application and service code:

- Nuxt 4 + Vue 3 + TypeScript for UI;
- Nitro/server APIs and domain services in TypeScript;
- Node.js workers for market adapters, scanners, news ingestion, indicator evaluation, alert rules, Telegram and demo adapter orchestration;
- existing `.mjs` engine modules remain in place and are wrapped with typed contracts incrementally.

Do not rewrite the entire existing JavaScript ESM engine to TypeScript solely for consistency. Migrate only when a file is being materially changed and tests can protect behavior. Keep one canonical indicator/method implementation shared by scanner, signal, historical evaluation and Pine demo testing.

### Python — optional research worker, not a second application backend

Use Python only when there is a clear need for:

- feature engineering and statistical analysis;
- training/evaluating ML models;
- notebooks and offline research workflows;
- batch data-quality analysis or model evaluation libraries.

Python workers communicate through versioned jobs/events/REST with the Node services. They must not independently mutate core trading collections or become an alternative source of truth. Python is not required for the first release of market scanning, AI summaries or Telegram delivery.

### Avoid unnecessary language/platform changes

- Do not move the application to a native desktop stack.
- Do not rewrite Node market adapters in Go/Rust/C++ without measured bottlenecks.
- Do not add Electron/Tauri just to keep background services alive; workers must be independent of the browser/UI lifecycle.
- Do not add a separate Python trading engine that duplicates the Node indicator implementation.
- Keep MQL5/MT5/Exness/Forex/EA execution out of this project; those belong to the separate application.

## 16.12 Reusable core services and boundaries

Keep one service per domain, consumed by multiple screens:

```text
platform/
  tm-hub-client / auth / route / config contracts (reuse existing)

market/
  adapters/{bybit,binance,okx}
  instrument-catalog
  connection-manager
  normalizer
  quality
  recorder
  snapshots

intelligence/
  news/
  sentiment/
  onchain/
  liquidity/
  derivatives/
  evidence/
  outlook/

analysis/
  indicators/ (reuse existing engine)
  methods/ (reuse existing engine)
  signals/
  scanner/
  research/

ai/
  gateway/
  providers/
  task-profiles/
  context-builder/
  assistants/

alerts/
  rules/
  dedupe/
  outbox/
  telegram/

demo-tests/
  pine-compatibility/
  profiles/
  runner/
  exchange-adapters/
  reconciliation/
```

This is a conceptual boundary map. The coding agent must map it to current actual folders and avoid creating duplicate parallel structures.

## 16.13 Data storage for long-term research and training

The product's accumulated data is a core asset. Preserve:

- raw/normalized market recordings with retention and source metadata;
- news/event source references, versions and AI summary lineage;
- on-chain and derivatives observations with provider/method provenance;
- indicator outputs and signal records with source/strategy versions;
- AI task inputs as evidence packet references/hashes, prompt/model versions and validated outputs;
- Pine demo test profiles/runs, exchange order/fill/position snapshots and all associated costs where exposed by the demo API;
- alert trigger and Telegram delivery outcomes.

Create immutable dataset manifests containing schema version, time range, instruments/universe, providers, quality report, event-time policy, feature versions, label-generation method and source hashes.

AI training is a separate, gated research workflow:

```text
Collected evidence
  → quality/rights filtering
  → point-in-time feature construction
  → label/outcome generation
  → train/validation/test split by time
  → baseline evaluation
  → candidate model/strategy experiment
  → out-of-sample review
  → approved research artifact
```

Do not claim that prompt-based analysis or saving `ai_learning_rules` is equivalent to fine-tuning/training a model. Prevent future leakage, survivorship bias, duplicated observations and labels based on data unavailable at decision time. Keep the active analysis model and its version unchanged until a candidate has been evaluated and approved.

## 16.14 UI and navigation clarification

Keep V4.0's data-first workspaces and modal-first interaction model. Add a compact, permission-gated **Platform & Administration** navigation group for Hub/core functions that must remain accessible.

Do not remove existing core pages, route records, shared components, APIs or permissions during UI consolidation. The migration should:

1. map each existing route to a primary workspace, Advanced/Research or Platform/Admin;
2. preserve stable route IDs and paths by default;
3. hide only redundant menu entries, not the underlying capability;
4. keep settings and provider configuration discoverable;
5. avoid duplicating Hub features inside TM Trading;
6. support deep links from Telegram and AI summaries into the relevant modal/detail state.

## 16.15 Phased implementation order

### Phase A — Reconfirm existing product/core inventory

- Audit V4.0 UI, V3.9 exchange adapter/runtime, V3.6 AI provider and Hub contracts.
- Map all Hub/core routes and classify them as `HUB_OWNED`, `SHARED`, `TRADING_OWNED`, `DUPLICATE`, `LEGACY`.
- Mark capability as `WORKING`, `PARTIAL`, `SEED_ONLY`, `READ_ONLY`, `UNAVAILABLE` or `NOT_IMPLEMENTED` using code/runtime evidence.
- Produce a migration map before editing route seeds or deleting code.

### Phase B — Shared evidence/data contracts

- Verify canonical market and source provenance.
- Connect market, news, derivatives, on-chain and sentiment observations to one evidence/context service.
- Ensure freshness and quality states are consistent.

### Phase C — Multi-provider AI and outlook

- Implement provider capability registry and adapters.
- Validate OpenRouter, direct providers and custom OpenAI-compatible endpoints.
- Evaluate FreeLLMAPI with contract tests before listing it as supported.
- Add task profiles and short/medium/long market/asset outlook schemas.
- Add evidence citations, model/prompt version and cost telemetry.

### Phase D — Signals and alert delivery

- Reuse current indicators and user-owned Pine logic.
- Ensure deterministic signal outputs for spot/futures research contexts.
- Connect watchlists and alert rules to Telegram outbox/delivery history.

### Phase E — Minimal Pine Demo Test harness

- Audit Pine scripts and rights.
- Select native port or licensed runtime path after parity proof.
- Implement one supported indicator end-to-end on one exchange demo environment first.
- Reconcile demo orders/fills/positions from the venue API and persist a test report.
- Extend to other supported demo venues only after adapter conformance tests.

### Phase F — UI consolidation and Hub/core preservation

- Keep V4.0 primary workspaces.
- Restore/retain compact Platform & Administration navigation.
- Add contextual AI actions and modal details.
- Ensure the user never loses access to existing Hub/core management capabilities.

### Phase G — Historical research/training readiness

- Dataset manifests, point-in-time snapshots, feature/label lineage and time-based splits.
- Backtest/historical signal outcome analysis and model evaluation.
- Candidate approval and rollback records.

## 16.16 Acceptance criteria

V4.1 clarification is complete only when:

- all existing TM Hub/core capabilities remain accessible and no duplicate IAM/config/route system exists;
- primary UI remains compact and data-first;
- market, news, derivatives, on-chain and sentiment data share normalized provenance/freshness contracts;
- the AI Gateway can route to more than one verified provider/model and records model/prompt/evidence lineage;
- short/medium/long outlooks can be generated from a bounded, permission-scoped evidence packet;
- outlooks distinguish confirmed facts, deterministic measurements and AI interpretation;
- spot and futures research signals are clearly separated and have deterministic evidence;
- selected Pine indicators pass compatibility/parity tests before being used in a demo test;
- demo test execution is restricted to verified demo/test endpoints and never silently falls back to live endpoints;
- orders/fills/positions are reconciled from the selected demo venue, with local evidence retained;
- Telegram notifications link to the relevant signal/event detail and are deduplicated;
- historical data can be assembled into versioned datasets without future leakage;
- no MT5, Exness broker, Forex CFD or MQL5/EA execution path has been reintroduced;
- the implementation status is updated only with passing tests and runtime evidence.

## 16.17 Explicit non-goals after V4.1 clarification

Do not build:

- a full manual trading terminal or portfolio/accounting application;
- a large generic bot marketplace or complex autonomous agent swarm;
- a new execution engine duplicating the exchanges' demo execution;
- an independent per-page market/news/on-chain data pipeline;
- an arbitrary Pine code execution sandbox with broad privileges;
- a multi-provider “LLM consensus” on every market tick;
- a full model-training platform before the evidence/dataset layer is reliable;
- desktop-only rewrite or multiple backend languages without measured need;
- MT5/Exness/Forex/EA capabilities in TM Trading.

**Final V4.1 product rule:** keep the core platform and TM Hub intact; make market evidence and multi-provider AI analysis the main product; make Pine-to-exchange-demo testing a small, reliable validation feature; and let every UI workspace consume the same trustworthy data and domain services.

# 17. Background Services Reliability, Operations Control Plane & Verified Lifecycle — V4.2 Authority

> **Purpose:** Make all background services dependable, observable and genuinely controllable from the UI. The user must be able to start, stop, restart, reset and inspect each service, and the UI must wait until the backend confirms the requested lifecycle transition or reports a truthful failure/timeout.
>
> **Authority:** This section is mandatory for every background service in TM Trading, including market-data adapters, scanners, news ingestion, funding/OI/liquidation collectors, on-chain collectors, sentiment jobs, AI analysis workers, Telegram delivery, alert processors, Pine demo-test workers, dataset recorders and maintenance jobs. It does not replace TM Hub; it defines how TM Trading services consume Hub identity/config/permission capabilities.
>
> **Core rule:** `command accepted` ≠ `process started` ≠ `service ready` ≠ `service doing useful work`. These are separate states and must be represented separately in backend records and UI.

## 17.1 Product requirement

Background services are first-class managed resources, not invisible scripts started by Nuxt hooks or developer terminals.

Operations must allow authorized operators to:

1. Inspect the desired state and observed state of every registered service.
2. Start a stopped service and wait for verified readiness.
3. Stop a running service and wait for graceful shutdown confirmation.
4. Restart a service through a controlled stop → drain → start → readiness sequence.
5. Reset a service only through a documented, service-specific reset procedure.
6. Run a health/dependency/data probe without changing the service lifecycle.
7. Inspect heartbeat, last successful work, input freshness, output freshness, errors, queue backlog and dependencies.
8. View the complete history of control actions and their outcomes.

Do not expose fake controls that merely change a database status field. Every action must reach a real supervisor/worker control plane and be verified against observed runtime state.

## 17.2 Service inventory and ownership

Create/maintain a service registry. Audit current workers before adding new ones. A registry record should include:

```ts
interface ManagedServiceDefinition {
  serviceId: string
  displayNameKey: string
  category:
    | 'market-data'
    | 'scanner'
    | 'intelligence'
    | 'ai'
    | 'alerts'
    | 'telegram'
    | 'demo-test'
    | 'storage'
    | 'maintenance'
  scope: 'system' | 'tenant' | 'account' | 'session'
  executionMode: 'continuous' | 'scheduled' | 'on-demand'
  dependencies: string[]
  supportedActions: Array<'start' | 'stop' | 'restart' | 'reset' | 'probe' | 'run-once'>
  readinessPolicyId: string
  healthPolicyId: string
  configSchemaVersion: string
}
```

Examples of managed service families:

- Exchange market-data connections: Bybit, Binance, OKX (only adapters configured and supported by the app).
- Instrument catalog synchronization.
- Market scanner and volatility/funding/OI/liquidation collectors.
- News and event ingestion / deduplication.
- On-chain and sentiment ingestion.
- Evidence packet and market-outlook workers.
- AI scheduled analysis/research workers.
- Signal generation and alert rules.
- Telegram outbox delivery.
- Market recording and dataset jobs.
- Pine compatibility/demo-test runner.

Do not create a separate OS process for every tiny scheduled task by default. Use a supervised worker pool with explicit service identity and isolation appropriate to workload. Tenant/account/session jobs must always carry server-derived owner context and be isolated by authorization and data filters. Shared market ingestion can be system-scoped and fan out normalized data; user-specific watchlists, alert rules and private configuration remain tenant-scoped.

## 17.3 Desired state vs observed state

Persist desired state separately from observed runtime state:

```ts
type DesiredServiceState = 'RUNNING' | 'STOPPED'
type ObservedServiceState =
  | 'STOPPED'
  | 'STARTING'
  | 'INITIALIZING'
  | 'READY'
  | 'DEGRADED'
  | 'STOPPING'
  | 'FAILED'
  | 'UNKNOWN'

type ServiceHealth = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN'
```

Rules:

- `READY` means the service has passed its specific readiness checks, not merely that a PID or worker record exists.
- `DEGRADED` means the process may exist but a material dependency, input feed, output path or work-progress condition is unhealthy.
- `FAILED` means startup/runtime failure has been observed and recorded.
- `UNKNOWN` means the control plane cannot currently verify the runtime; never render this as healthy.
- A service with desired state `RUNNING` but observed state `STOPPED`, `FAILED` or `UNKNOWN` is a control-plane mismatch and should raise an Operations warning.
- A one-shot task may finish as `COMPLETED`; it should not be forced into a permanent `READY` state.

The API must return both desired and observed state, health, `lastHeartbeatAt`, `lastSuccessfulRunAt`, `lastInputAt`, `lastOutputAt`, `lastErrorAt`, `lastErrorCode`, queue/backlog metrics and the current operation ID where applicable.

## 17.4 Real readiness and health checks — never PID-only

Implement three separate checks:

**Liveness:** Is the worker process/instance responding to its supervisor heartbeat and lease?

**Readiness:** Has initialization completed and can this service safely accept its intended workload?

**Functional health/progress:** Is it actually doing useful work with fresh inputs and valid outputs?

Examples:

| Service | Minimum readiness proof | Functional health/progress proof |
|---|---|---|
| Exchange market feed | Auth/connection where required; subscription acknowledged | Recent valid event for an actively subscribed symbol; sequence/gap/freshness checks pass |
| News ingestion | Sources/config loaded; scheduler initialized | At least one recent successful fetch/parse cycle for enabled sources; errors and source age visible |
| Funding/OI collector | Venue/instrument subscriptions initialized | Recent timestamped observation for the configured universe; missing venue metrics marked unavailable, not zero |
| Scanner | Universe and rule config loaded | A scan completed within its schedule; input freshness and output record count reported |
| On-chain collector | Provider credentials/capabilities verified | Recent successful response for the configured chains/assets; rate-limit and provider coverage shown |
| AI analysis worker | Provider adapter initialized and capability check passed | A scheduled test/job completed successfully; schema validation, latency, usage and errors recorded |
| Telegram delivery | Bot/API identity check passed; destination configuration valid | Outbox can be consumed; last delivery result and pending/dead-letter counts visible; send a test only on explicit operator request |
| Signal engine | Indicator/method registry loaded and warmed up | Evaluation cycle completed on fresh bars; emitted/no-signal counts and reason codes available |
| Dataset recorder | Storage writable and manifest initialized | Recent expected records persisted; byte/row counts and storage errors visible |
| Pine demo-test runner | Demo endpoint/account explicitly verified; supported script/profile loaded | Test cycle/session events reconciled; never infer readiness from a local config flag |

Readiness thresholds must be per service and configurable. Avoid one generic `isHealthy` boolean for all services.

## 17.5 Supervisor architecture

A dedicated supervisor/control plane must own service lifecycle. Do not make the Nuxt page lifecycle the owner of critical workers.

Conceptual flow:

```text
Operations UI
    │ REST command + idempotency key
    ▼
Service Control API
    │ authorization + validation + audit
    ▼
Durable Control Command / Outbox
    ▼
Supervisor / Worker Manager
    │ start / drain / stop / restart / reset
    ▼
Real Worker Process or Worker Instance
    │ heartbeat + readiness + functional metrics
    ▼
Service State Store + Operation History
    │
    ├── REST snapshot / recovery
    └── SSE or WebSocket state updates
             ▼
        Operations UI
```

Requirements:

- A dedicated supervisor must survive a browser refresh and must not depend on a single Nuxt development-server PID for production service continuity.
- Development mode may use an embedded supervisor only when clearly identified as `DEVELOPMENT_EMBEDDED`, with safeguards against duplicate hot-reload instances and stale leases.
- Each worker/service instance has a stable `serviceInstanceId`, lease, heartbeat sequence, version/build identifier and owner/scope metadata.
- Supervisor commands are persisted before acknowledgement and are idempotent.
- A lease prevents duplicate active instances for the same service/scope unless horizontal replicas are explicitly configured.
- Worker exit, lost heartbeat, expired lease and failed readiness must update observed state and create an auditable event.
- Graceful stop drains in-flight work and prevents new work before termination. After a configurable grace period, the supervisor may escalate to forced termination and must record that escalation.
- Restart must preserve durable offsets/checkpoints and must not replay non-idempotent actions without dedupe.
- Use an existing durable queue/outbox if it already meets these semantics. Add Redis/BullMQ only after measuring need; never add a second queue system beside an equivalent existing one without an ADR.

## 17.6 Start / stop / restart / reset semantics

These commands are not interchangeable.

**START**
1. Validate permission, dependencies, config and scope.
2. Create `operationId` and persist command.
3. Set observed state `STARTING` / `INITIALIZING`.
4. Supervisor starts or claims the worker.
5. Worker initializes dependencies and emits readiness proof.
6. Supervisor evaluates service-specific readiness.
7. Only then set observed state `READY` (or `DEGRADED` if allowed but unhealthy) and complete the operation.

**STOP**
1. Persist command and set `STOPPING`.
2. Stop accepting new jobs/subscriptions.
3. Drain in-flight work and persist checkpoints/outbox state.
4. Close provider sockets and release leases.
5. Confirm process/worker termination and lease release.
6. Set `STOPPED` and complete operation.

**RESTART**
- Execute controlled STOP then START; keep the original service identity but create a new `serviceInstanceId`/generation.
- Do not report success until the restarted instance passes readiness.

**RESET**
- Must be explicitly defined per service. Default meaning is `restart + reinitialize ephemeral runtime state/checkpoint according to a reviewed reset policy`.
- Reset must NOT silently delete historical market data, trades, signals, news, datasets, AI evidence, credentials or user configuration.
- Destructive data cleanup is a separate admin-only maintenance operation with preview, backup, explicit confirmation and audit.
- For queue reset, specify whether to retry, quarantine or discard pending/dead-letter jobs; default is preserve/quarantine, not delete.
- For market data reset, rebuild volatile subscriptions/cache from authoritative snapshots; do not erase historical recordings.
- For a provider reset, refresh connection/session state and resubscribe; do not expose or rewrite secrets.

**PROBE / HEALTH CHECK**
- Must not alter desired lifecycle state.
- Report dependency connectivity, capability, latency, freshness and last successful functional result.

**RUN ONCE**
- For scheduled/on-demand services, create a durable job record and return its job/operation ID. Do not start a permanent service as a side effect.

## 17.7 Asynchronous operation contract for UI loading

Control actions are asynchronous. The button click must not optimistically mark the service as started/stopped.

Recommended API shape:

```ts
interface ServiceOperation {
  operationId: string
  serviceId: string
  scopeKey: string
  action: 'start' | 'stop' | 'restart' | 'reset' | 'probe' | 'run-once'
  status: 'QUEUED' | 'IN_PROGRESS' | 'WAITING_READINESS' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED'
  requestedAt: number
  startedAt?: number
  completedAt?: number
  targetState?: DesiredServiceState
  observedState?: ObservedServiceState
  progress?: { phase: string; percent?: number; messageKey?: string }
  error?: { code: string; safeMessage: string; retryable: boolean }
}
```

Proposed routes (adapt to current API conventions; do not duplicate existing endpoints):

```text
GET    /api/v1/operations/services
GET    /api/v1/operations/services/:serviceId
GET    /api/v1/operations/services/:serviceId/operations/:operationId
POST   /api/v1/operations/services/:serviceId/start
POST   /api/v1/operations/services/:serviceId/stop
POST   /api/v1/operations/services/:serviceId/restart
POST   /api/v1/operations/services/:serviceId/reset
POST   /api/v1/operations/services/:serviceId/probe
POST   /api/v1/operations/services/:serviceId/run-once
GET    /api/v1/operations/events   (SSE or existing authenticated stream)
```

Every mutation must:

- require authenticated TM Hub identity and the appropriate RBAC permission;
- derive `ownerId`/scope from server-side identity and registered service metadata;
- validate `serviceId`, dependencies, parameters and allowed action;
- require an idempotency key and prevent conflicting concurrent operations;
- create an audit record containing actor, action, reason, scope, config version, operation ID and result;
- avoid returning process secrets, API keys, tokens, environment variables or raw command lines.

The initial HTTP response should return `202 Accepted` plus `operationId` when work continues asynchronously. The UI then observes the operation through SSE/WebSocket or polls its operation endpoint as a recovery fallback.

## 17.8 UI behavior — loading until confirmed terminal state

For every row/card action:

- On click, disable conflicting controls for that service/scope and show an inline spinner plus the current phase (`Queued`, `Starting`, `Connecting`, `Subscribing`, `Checking readiness`, `Draining`, `Stopping`, `Reinitializing`).
- Keep the progress/loading state until the operation becomes `SUCCEEDED`, `FAILED`, `TIMED_OUT` or another terminal status.
- For START, `SUCCEEDED` requires observed state `READY` or an explicitly permitted target state with a visible warning. A process `spawn` event is not sufficient.
- For STOP, `SUCCEEDED` requires observed state `STOPPED`, worker exit/termination confirmation and lease release.
- For RESTART, loading remains active through both stop and start/readiness phases.
- For RESET, loading remains active through the service-specific reset, reinitialization and health verification.
- Never set the status badge from the button click response alone. The status comes from the latest server-observed service state.
- If the request times out, show `UNCONFIRMED`/`UNKNOWN` or `DEGRADED`, not success. Continue reconciliation in the background and let UI refresh the operation status.
- On browser refresh/reopen, restore in-flight operation state from the operation API; do not leave a spinner forever based only on local memory.
- Show a clear error and a safe retry action when retryable. Do not automatically issue repeated start/reset commands while an operation is unresolved.
- Provide accessible labels, `aria-busy`, keyboard support and reduced-motion behavior.

The UI may use SSE for Operations events, with REST snapshots for initial state and reconnect recovery. If SSE is already used in `/operations`, extend its event schema rather than building a second competing stream. WebSocket is appropriate if bidirectional streaming is truly required, but lifecycle commands should still use authenticated domain APIs.

## 17.9 Operations page information architecture

The Operations workspace should be a focused service control center, not a generic log dump.

Top status strip:
- system control-plane health;
- count of healthy / warning / critical / stopped services;
- active control operations;
- stale data-source count;
- queue backlog/dead-letter count;
- latest successful scan/news/AI/Telegram cycles.

Main service table:

| Column | Required meaning |
|---|---|
| Service | Human-readable name, category and service ID on detail |
| Scope | System / tenant / account / session, masked to current user's permissions |
| Desired | RUNNING or STOPPED |
| Observed | STARTING / READY / DEGRADED / STOPPING / STOPPED / FAILED / UNKNOWN |
| Health | HEALTHY / WARNING / CRITICAL / UNKNOWN |
| Last heartbeat | Actual heartbeat time and age |
| Last successful work | Last completed useful cycle, not just process start |
| Data freshness | Latest relevant input/output timestamps |
| Workload | Queue/backlog, active jobs, last duration and lag where meaningful |
| Actions | Start / Stop / Restart / Reset / Probe / Run once, only when supported and authorized |

Filters: category, state, health, scope, provider, owner (admin-only), active operation and stale services.

Service detail modal/drawer tabs:
- Overview: lifecycle, health, dependencies and readiness checklist.
- Activity: recent operation timeline and functional work cycles.
- Logs: structured logs with correlation/trace IDs and safe redaction.
- Jobs: queue, retries, dead-letter and checkpoints.
- Data: last input/output events, freshness and quality samples.
- Configuration: sanitized effective configuration, version and source (Hub/app/tenant) with permission controls.
- Audit: who performed start/stop/restart/reset and the result.

Avoid a separate full page for every small service unless its diagnostics materially require one. Use detail modal/drawer for the standard path, consistent with V4.0's modal-first UI.

## 17.10 Dependency graph and safe orchestration

Each service declares dependencies and downstream consumers. Examples:

```text
Exchange public feed
   ├── market normalizer
   ├── candle builder
   │     ├── indicator engine
   │     └── scanner
   └── market recorder

News source collectors
   └── event normalizer/deduper
          ├── evidence/context builder
          └── AI summary worker

Alert rules + signal events
   └── durable notification outbox
          └── Telegram delivery worker
```

Rules:

- Starting a service may require dependencies to be READY; report which dependency blocks startup.
- Stopping a dependency must warn about affected consumers and either require a confirmed cascade or reject while dependent services are actively processing.
- Do not silently stop all dependent services without showing the impact list.
- A service restart should not restart unrelated services.
- Dependency cycles must be rejected at registry validation time.
- Keep desired state and dependency policy explicit (`REQUIRE_READY`, `DEGRADED_ALLOWED`, `OPTIONAL`).

## 17.11 Fault handling and recovery

Implement and test:

- worker crash and non-zero exit;
- heartbeat gap and lease expiry;
- start command duplicated or delivered late;
- stop during active job;
- restart while an operation is already pending;
- dependency unavailable or degraded;
- API provider rate limit / authentication failure;
- socket connection open but no data arriving;
- queue backlog growth / retry storm;
- storage unavailable or write failure;
- Nuxt server restart while external workers continue;
- browser disconnect/reconnect while operation is in progress;
- control-plane restart while command is queued or executing.

Use exponential backoff with jitter for retryable external failures, circuit breakers for repeatedly failing providers, bounded queues, dead-letter/quarantine and operator-visible recovery instructions. Never retry non-idempotent side effects blindly.

## 17.12 Security and authority boundaries

- TM Hub remains the source for login, identity, RBAC and app access. Do not create duplicate service administration roles or an independent user system.
- Only authorized roles can control system-scoped services. Tenant/account-scoped services must be owner-scoped.
- Secrets are stored through existing secure configuration/connection mechanisms and never returned in service status/log API.
- `reset`, cascade stop and destructive maintenance require elevated permission and explicit confirmation showing the impact.
- The AI assistant/MCP may inspect service health by default. It may start/stop/restart only within an explicit tool scope and approval policy. It must never expose raw shell/process-kill tools or bypass the control API.
- Every control mutation is auditable and attributable to human, scheduler, admin automation or approved AI/MCP actor.

## 17.13 Metrics and operational SLOs

Track at minimum:

- service uptime and desired/observed state mismatch duration;
- heartbeat age and lease renewals;
- startup/readiness/stop/restart duration;
- functional cycle success/failure rate;
- last successful work age;
- input/output freshness and event lag;
- queue depth, oldest job age, retry count and dead-letter count;
- provider connection uptime, reconnect count, latency and rate-limit count;
- AI request success, timeout, structured-output validation and usage/cost;
- Telegram delivery success/failure and outbox age;
- storage write latency/failure and recorder coverage.

Define per-service targets and warning/critical thresholds. Do not invent one global realtime SLA for all sources; different providers and data classes have different publication intervals. UI must show the applicable expected update interval and classify `FRESH`, `DELAYED`, `STALE`, `MISSING` or `UNKNOWN` based on that service's policy.

## 17.14 Acceptance tests — actual service operation, not UI theatre

A service-control feature is not complete until automated/integration tests prove:

1. Start from STOPPED creates an operation; UI remains loading until readiness passes; observed state becomes READY.
2. A worker that spawns but never passes readiness stays INITIALIZING/DEGRADED and never shows READY.
3. Stop blocks new jobs, drains active work, releases lease and only then becomes STOPPED.
4. Restart waits for stop and new readiness; a single click cannot create duplicate instances.
5. Reset follows the documented service policy and preserves durable history/configuration.
6. Duplicate and concurrent control requests are idempotent/serialized.
7. A provider socket that connects but emits no fresh event becomes DEGRADED/STALE.
8. A scanner with a live heartbeat but no successful scan is not marked functionally HEALTHY.
9. Browser refresh restores in-flight operation progress and terminal result.
10. SSE/WebSocket disconnect falls back to REST operation reconciliation without losing state.
11. Unauthorized users cannot control system services or inspect other tenants' service/job data.
12. A failed dependency blocks or degrades dependents according to explicit policy.
13. Nuxt restart does not kill or duplicate dedicated external workers.
14. All operations and state changes have correlation IDs and audit records.
15. UI displays a real error/timeout state, never optimistic success.

## 17.15 Implementation phases

### Phase O0 — Inventory and truth audit
- Enumerate every current service, process, embedded plugin, cron, scheduled job and queue consumer.
- Map service ID → code entrypoint → process owner/supervisor → dependencies → persistence → UI/API → current evidence of useful work.
- Mark `WORKING`, `PARTIAL`, `EMBEDDED_DEV_ONLY`, `SEED_ONLY`, `BROKEN` or `NOT_IMPLEMENTED`.
- Identify duplicate supervisors, stale heartbeat files, orphan processes and services incorrectly coupled to Nuxt lifecycle.

### Phase O1 — Lifecycle contract and service registry
- Add registry definitions and state models.
- Separate desired state, observed state, health and functional progress.
- Add readiness/health probes per service.
- Add operation history and audit schemas.

### Phase O2 — Supervisor and durable control commands
- Implement one authoritative supervisor/control plane suitable for the current deployment.
- Persist commands before acknowledgement.
- Implement idempotency, leases, graceful drain, stop escalation and restart recovery.
- Ensure Nuxt is a client/control API host, not the only owner of continuous work.

### Phase O3 — Operations API and UI
- Add/extend service list/detail/control/probe/run-once APIs.
- Build service table, detail drawer and operation timeline.
- Implement true asynchronous loading and state reconciliation.
- Preserve the current V4.0 compact UI and TM Hub/core navigation.

### Phase O4 — Roll out service by service
- Start with a low-risk scanner/news worker.
- Then Telegram outbox, funding/OI, on-chain and market-data adapters.
- Then AI analysis and signal workers.
- Finally Pine demo-test runner and any higher-impact control surface.
- Do not migrate every service at once; run old/new side by side only when duplicate processing is prevented.

### Phase O5 — Resilience and failure drills
- Test crash, rate-limit, stale data, storage failure, queue overload, dependency failure, supervisor restart and browser reconnect.
- Measure startup/stop latency and recovery correctness.
- Publish per-service runbooks and operational thresholds.

## 17.16 Implementation boundaries

- Keep Node.js/TypeScript as the primary service runtime, preserving existing ESM engine modules.
- Do not introduce a new language or orchestration platform solely to obtain start/stop buttons.
- Reuse SSE already present for Operations events if it meets authentication, ordering and reconnect requirements; otherwise extend it or add an authenticated stream.
- Use REST snapshots as the source for recovery and streaming as an update channel.
- Reuse MongoDB/current durable storage for service records if suitable. Add Redis/BullMQ only with a documented need (throughput, distributed scheduling, delayed jobs, retries or backpressure) and an ADR.
- Do not run critical continuous services as unmanaged child processes spawned by a request handler.

## 17.17 Definition of Done

V4.2 service operations are complete only when:

- every visible service row maps to a real registered worker/service or is explicitly labelled unavailable;
- Start/Stop/Restart/Reset buttons invoke real authorized control operations;
- the UI remains loading until the service reaches the requested verified state or a terminal failure/timeout is reported;
- readiness verifies actual service-specific dependencies and functional data/work progress;
- a live process with stale input or no useful work is shown DEGRADED, not healthy;
- control operations survive browser refresh and are recoverable after API/supervisor restart;
- duplicate commands cannot create duplicate workers or repeat side effects;
- service history/config/data are preserved across safe restart/reset;
- TM Hub identity, RBAC, route registry and shared-core integrations remain intact;
- integration tests exercise real worker lifecycle and failure cases;
- documentation includes service inventory, dependency map, runbooks, reset semantics, health policies and verified evidence;
- all project test, documentation and typecheck gates pass.

**Final V4.2 rule:** Operations is a truthful control plane for real background services. It must show not only whether a process exists, but whether the service is initialized, connected, receiving fresh data, completing useful work, persisting outputs and able to stop/reset safely. The UI must wait for verified completion and must never claim success optimistically.

