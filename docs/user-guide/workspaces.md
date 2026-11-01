# Workspaces

This chapter describes every workspace in the current navigation, in the order
the sidebar shows them. Each section states the **capability status** from the
legend in [README.md](README.md#capability-status-legend).

> The V4 roadmap compacts these 11 groups into 6 primary workspaces plus
> Advanced/Research and Platform & Administration. That consolidation is planned,
> not shipped. This chapter documents what you see **today**.

---

## 1. Overview — `/`

**Status: Partial.**

The landing page is currently a **runs and risk board**, not a "market state now"
summary. It surfaces recent backtest runs, risk state, intel snapshots, bots and
research counters.

What you can rely on:

- recent runs and their status;
- the current risk state;
- top intel movers, if the scanner service has run.

What it does not do yet: give you a single "what matters right now" view across
market, news and signals. That is the V4 Overview rebuild.

---

## 2. Operations — `/operations`

**Status: Read-only dashboard plus a real service control plane (V4.2 S2).**

This is the operator's page: system health, service state, bot instances,
positions, alerts and AI agents in one console. The default tab is now
**Service control plane**.

| You can | Notes |
| --- | --- |
| See database status and overall health | `healthy` or `degraded`, derived from Mongo/Supabase reachability plus service overdue flags |
| See every service with its state | The control plane table: desired vs observed, READY / DEGRADED / FAILED, heartbeat age, last output. "Never started" is shown as its own state, not as "stopped" |
| Inspect one service in detail | Opens a drawer with the readiness checks, the last cycle's workload, the per-process telemetry and the operation history |
| Start / stop / restart / reset / probe / run-once a service | **Root only.** Returns `202 Accepted` with an operation id, then shows the live phase until it finishes. A planned service or one hosted by another process can only be probed |
| Re-probe the legacy heartbeat table | Re-reads the heartbeat file; it does **not** contact the services |
| Run all services once | Spawns `services/run.mjs once` and returns immediately |
| Start/stop queued or running bot instances | Enqueues a command; the bot supervisor applies it |

The control plane updates **live**: it subscribes to a server-sent event stream
(the badge shows *Live*), and falls back to a 15 s poll only while the stream is
down (*Polling*).

| Still not available | Why it matters |
| --- | --- |
| Control when the supervisor is not running | Commands are queued, but nothing performs them until the supervisor runs; a queued command expires after its deadline |
| Prove a legacy "Run all services once" result from that button alone | The button now reports what it *queued* (an operation per service); the outcome appears in the Service control plane table |

**Migration note:** the control plane enqueues commands for the V4.2 supervisor
(`node services/supervisor.mjs run`). Until that process is running — and until
`npm run services` still owns the same services — the table can be read safely but
a start/stop command will wait in the queue. Do not run the supervisor and the
legacy orchestrator on the same service at the same time. See
[operations.md](operations.md#9-the-supervisor-v42-s13-terminal-only).

Full detail and the reason for each gap: [operations.md](operations.md).

---

## 3. Markets

The Markets group is the market-intelligence surface. Five pages plus news.

### 3.1 Market Intel — `/markets`

**Status: Available.**

A snapshot table of the market: movers, money flow, accumulation, funding,
open interest, liquidation estimates and regime. Written by the `scanner`,
`funding`, `regime` and `liquidation` services into the `intel` collection.

- Rows are **snapshots**, replaced each cycle. They are not history.
- If the services have not run, the table is empty rather than wrong.
- Telegram alerts fire only for genuinely new events (deduplicated by key).

### 3.2 Market Explorer — `/markets/explorer`

**Status: Available.**

Browse the instrument universe with filters. Backed by the market catalog and
venue metadata. Useful for finding a symbol before adding it to a rule or a bot.

### 3.3 Scanner — `/markets/scanner`

**Status: Available.**

Volatility and unusual-activity scanner. Configured by `SCANNER_MIN_QUOTE_VOL`,
`SCANNER_TOP_N`, `SCANNER_ALERT_PCT` and `SCANNER_INTERVAL`.

- The scanner is **relative**: a "top mover" is top within the scanned universe,
  not across all markets.
- A low-liquidity symbol can appear as a mover and still be untradeable.

### 3.4 Calendar — `/markets/calendar`

**Status: Read-only, and empty without `FRED_API_KEY`.**

Macro calendar events. The `macro` service fetches FRED vintages; without a key it
skips cleanly and the calendar stays empty.

### 3.5 News — `/news`

**Status: Available.**

The news desk: ingested items, source health, deduplication and AI extraction
results. Written by the `news` and `newsExtract` services.

- Items are deduplicated by content hash.
- Source health tells you which feeds are failing.
- AI extraction only runs when an AI key is configured and the item is eligible.

### 3.6 News Events — `/news/events`

**Status: Available.**

Clustered market events derived from news items. Use this when you want "what
happened" rather than "what was published".

### 3.7 News Sources — `/news/sources`

**Status: Available (administrative detail).**

The source registry: enable/disable feeds and inspect their health. This is an
admin surface, not a primary workspace; the V4 plan hides it from the main menu
and reaches it from the News tab.

### 3.8 Market Outlook — `/outlook`

**Status: Read-only.**

AI-generated market outlook records. Today this is a **single-horizon** view
written by the daily brief; the SHORT / MEDIUM / LONG contract from the roadmap is
not implemented yet. Treat it as commentary, not a forecast you can size a
position on.

---

## 4. Trading

> **Boundary:** execution is demo/paper only. A signal is not an order, an alert
> is not an order, and an AI summary is not an instruction. Every demo order still
> passes the Risk Gate.

### 4.1 Trade Terminal — `/trading`

**Status: Available (paper/demo).**

Chart, quotes, method output, journal context and replay entry in one screen. This
is the closest thing to a classic terminal, but it operates on paper accounts.

### 4.2 Signals — `/trading/signals`

**Status: Partial.**

Native futures research signals produced by the `signals` service from closed
bars. Each signal is idempotent per owner and signal key.

What is thin: attribution and outcome history. You can see a signal, but the
"was it useful over 1h / 4h / 1d" view is not built yet.

### 4.3 Paper — `/trading/paper`

**Status: Available.**

Paper account setup and manual paper trading. Uses the configured paper market.
No real funds, no broker connection.

### 4.4 Orders — `/trading/orders`

**Status: Available.**

Paper order list and fills. Order-layer idempotency uses `clientOrderId`, so a
retried submit does not double-fill.

### 4.5 Positions — `/trading/positions`

**Status: Available.**

Open paper positions with live quote marks where the market plane is running.

### 4.6 Accounts — `/trading/accounts`

**Status: Partial.**

Per-account views exist; create/update/archive is limited. Treat this as
inspection rather than full account management.

---

## 5. Strategy Lab

**Status: Mostly Read-only / Placeholder.**

| Page | Status | What it is |
| --- | --- | --- |
| Strategies `/strategy-lab` | Placeholder | Strategy profiles and versions. Rows come from a seed script, not from a user workflow. |
| Indicators `/strategy-lab/indicators` | Read-only | The indicator registry (Pine ↔ engine parity metadata). |
| Methods `/strategy-lab/methods` | Read-only | The method registry: VSA, price action, trend, order flow. |
| Bot Profiles `/strategy-lab/bots` | Partial | Profile CRUD plus instance launch. The supervisor loop exists; instance management is partly seeded. |
| Bot Instances detail `/strategy-lab/bots/instances/[id]` | Partial | Per-instance detail. The list route is currently hidden because no `index.vue` exists. |

**Reading the registry pages:** they describe what the engine can compute. They do
not mean a strategy is validated. Parameter optimisation was deliberately skipped
because the random-entry baseline showed VSA is not distinguishable from random
entries — see the measurement-honesty rule in the repo's agent guidance.

---

## 6. Test Center

| Page | Status | Notes |
| --- | --- | --- |
| New Test `/test-center` | Partial | Backtest launcher |
| Historical Runs `/test-center/runs` | Partial | Mongo `runs`, owner-scoped |
| Run detail `/test-center/runs/[id]` | Partial | Report + equity series |
| Compare `/test-center/runs/compare` | Partial | Side-by-side runs |
| Forward Tests `/test-center/forward` | Read-only | Polls `signals` every 15 s |
| Replay `/test-center/replay` | Partial | In-memory sessions; not durable across restarts |
| Sessions `/sessions` | Partial | Replay/bot session list |

**Rule when comparing runs:** never compare runs with a different
`engineVersion` or `paramsHash`. The report will warn you; believe it. Mixing
stamps produces a confident, meaningless result.

---

## 7. Data & Research

| Page | Status | Notes |
| --- | --- | --- |
| Data Center `/data-research/data` | Read-only | Dataset manifest and retention |
| Datasets | Read-only | Registered datasets |
| Recordings | Read-only | Market recordings |
| Quality | Read-only | Quality flags from `reconcile` |
| Lineage | Read-only | Upstream/downstream of a dataset |
| AI Research `/data-research/research` | Partial | Research workspace |
| Experiments | Partial | Experiment create/run/report via CLI-backed services |
| Journal `/data-research/journal` | Read-only | Executed-trade journal |
| AI Agents `/ai-agents` | Partial | Agent lifecycle endpoints; the heartbeat loop currently runs inside the web process |
| News Impact | Placeholder | Static shell with no data binding; hidden from the menu |

**Journal vs signals:** the journal records what was actually executed (paper). It
is not a list of ideas. If you want ideas, use Signals.

---

## 8. Alerts

### 8.1 Alert Rules — `/alerts`

**Status: Available.**

Create rules that evaluate against the intel event stream. The `alertRules`
service runs every 5 minutes (`ALERT_RULES_INTERVAL`) and routes matches through
the notification router with a dedupe window.

### 8.2 Notification History — `/alerts/history`

**Status: Read-only.**

One row per delivery attempt, from `notification_logs`. A failed attempt is
recorded as failed — it is never shown as delivered.

### 8.3 Inbox — `/alerts/inbox`

**Status: Read-only.**

In-app notifications from the Hub and from signal events.

**Delivery reality check:** Telegram is fire-and-forget today. There is no outbox,
no retry and no backoff. If Telegram is down when an alert fires, that delivery is
lost. The rule itself keeps working. This is scheduled to change in V4.2.

---

## 9. Shared Resources

**Status: Available (Hub-owned).**

| Page | Purpose |
| --- | --- |
| Media `/shared-resources` | Cloudinary-backed media library |
| Import `/shared-resources/import` | Bulk import |
| Connections `/shared-resources/connections` | Generic Hub connection records |
| Queues `/shared-resources/queues` | Shared queue administration |

> A connection record in **Connections** is a Hub integration record. It does
> **not** prove a market-data feed is healthy. Use Operations for feed health.

---

## 10. Administration & System

**Status: Available (Hub-owned), except where noted.**

| Page | Purpose |
| --- | --- |
| Users `/admin-system` | Hub users assigned to this app |
| Roles `/admin-system/roles` | Role definitions and route grants |
| Permissions `/admin-system/permissions` | Permission catalogue (hidden from the menu by seed) |
| Routes `/admin-system/routes` | The live route registry (read/write, but see the warning below) |
| Configs `/admin-system/configs` | App configuration, including secrets |
| AI Providers `/admin-system/ai-providers` | Provider connections, models, keys, budgets |
| Data Sources `/admin-system/data-sources` | Market data source health |
| Health `/admin-system/health` | Heartbeat-derived health |
| Logs `/admin-system/logs` | Audit and system logs |
| Profile `/admin-system/profile` | Your profile, security, sessions, push |
| Docs `/admin-system/docs` | In-app documentation |
| Hub Integration `/admin-system/hub-integration` | Hub connection status |
| Settings `/admin-system/settings` | Appearance and system settings |

> **Do not add routes through the Routes page.** The route registry is owned by
> the `tm-hub` seed. `cleanOldRoutes()` deletes any route that is not in
> `createTradingRoutes` on the next seed run. A route added in the UI survives
> until someone seeds — then it disappears. See
> [operations.md](operations.md#6-seeding-and-the-route-registry).

**Health page caveat:** `/admin-system/health` is derived from the same heartbeat
file as Operations. It is not a live probe. `/admin-system/health-enhanced` is
seeded as visible but has no page; the menu hides it at runtime.

---

## 11. Tools

**Status: Available (local utilities).**

Text tools, icon browser, encoder/decoder, random generator and a scratch editor.
They are client-side conveniences with no backend dependency. They are not part of
the trading workflow and are intentionally last in the menu.

---

## 12. Pages that are hidden on purpose

| Route | Why hidden |
| --- | --- |
| `/admin-system/permissions` | Catalogue is managed through roles; hidden by seed |
| `/admin-system/health-enhanced` | Seeded visible, but no page file exists |
| `/strategy-lab/bots/instances` | Only the `[id]` detail page exists |
| `/data-research/research/news-impact` | Static shell with no data binding |

If you need one of these, fix the underlying page or binding first, then flip
`is_visible` in the seed. Do not add a menu entry for a page that cannot resolve.
