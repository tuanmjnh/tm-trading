# System Integration Map

> **Authority:** roadmap `docs/web-app/tm-trading-roadmap-v3.6.md` §61 (V3.6 End-to-End
> Platform Integration). This is the **Phase A** deliverable (§61.17 Phase A).
> **Purpose:** record, from repository code, how the UI, server API, domain services,
> durable records, workers and external providers are actually wired — so that later
> phases extend real paths instead of duplicating them.
> **Method:** static repository audit on 2026-10-19 (routes, utils, models, plugins,
> scripts, services). No runtime execution claim is made from a seed row; every claim
> below cites a file path or command. Items that could not be confirmed from source are
> marked `UNVERIFIED`.

## 1. Runtime topology

| Process | Entry | Port | Notes |
|---|---|---|---|
| Dashboard (Nuxt 4, `ssr:false`) | `npm run dev` → `tools/nuxt-dev.mjs` | 4001 | UI + Nitro server API (`server/api/**`) |
| Market plane | `npm run market:watch` → `tools/dev.mjs market:watch` | — | Binance/Bybit/OKX providers → canonical events |
| Periodic services | `npm run services` → `services/run.mjs watch` | — | news, macro, funding, liquidation, scanner, regime, confluence, reconcile, heartbeat |
| TradingView webhook receiver | `npm run notify` → `server/webhook.mjs` | — | legacy inbound alert path (retire per §61 Phase D) |
| Engine CLI | `npm run engine:run` → `engine/run.mjs` | — | backtest |
| AI | `npm run ai:agent` / `ai:brief` / `ai:review` | — | provider gateway + agent |

**Nuxt server plugins (boot-time):**

| Plugin | Role |
|---|---|
| `server/plugins/process-guard.ts` | process lifecycle guard |
| `server/plugins/news-registry.ts` | seeds the default news source registry from `engine/newsIngest.mjs` `PILOT_SOURCES` |
| `server/plugins/evidence-backfill.ts` | evidence backfill on boot |

**Kill-switch / dev recipe:** two dev trees on `:4001` fight and `npm run typecheck`
runs `nuxt prepare` (which deletes `.nuxt/dist` → live 503). Kill with
`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` filtered on `tools/nuxt-dev`
or `nuxt.mjs dev --port 4001`, then start exactly one and confirm `0` "Restarting Nuxt".

## 2. Identity, auth and tenancy adapter

- **Authentication:** `server/middleware/auth.ts` verifies the TM Hub JWT offline
  (HS256, `AUTH_JWT_SECRET`) and stores
  `event.context.auth = { sub, appId, email, name, roles[], permissions[] }`.
  Hub is the only identity source (§61.3). Login is performed client-side by
  `useAuth`/`useHub` against TM Hub `POST /api/v1/auth/login` with
  `X-App-Id: tm-trading_ghfseu`.
- **Tenancy helper:** `server/utils/owner.ts` — `ownerIdOrNull(event)`,
  `requireOwnerId(event)` (throws `401 error.unauthorized` on missing identity —
  fails closed), `ownerFilter(event)`. `requireOwnerId` is auto-imported inside
  `server/api/**` and `server/utils/**`.
- **Identity verification (done):** the root hub user payload returned by the hub
  login API is `{ id: "62da4efe-34b4-4a6b-b4ae-967942ecaf53", email: "root@example.com",
  roles: ["root"] }`, confirming the `sub`↔email mapping used for backfill (see
  `data-ownership-map.md`).
- **Authorization:** `server/utils/authz.ts`, `permissions.ts`, `permission-validate.ts`,
  `scope.ts` (route allow-list from the hub token).
- **Unscoped surfaces:** routes that do not call `requireOwnerId` (see §4) still rely on
  the global auth middleware (valid token required) but do **not** filter by owner yet.

## 3. Route → service → model map

Legend: **[S]** = owner-scoped today; **[U]** = authenticated but not owner-scoped;
**[G]** = global/shared reference data. Chain is `route → server/utils/*.ts →
server/utils/engineModel.ts → engine/models/*.mjs`.

### 3.1 Trading core (private)

| Route | Server util | Engine model(s) | Scope |
|---|---|---|---|
| `GET /api/v1/paper/accounts` | `paperAccount.listPaperAccounts` | `paper_accounts`, `positions` | [S] |
| `GET /api/v1/paper/accounts/[id]` | `paperAccount.paperAccount` | `paper_accounts`, `positions` | [S] |
| `GET /api/v1/paper/accounts/[id]/orders` | `paperOrders.listPaperOrders` | `paper_orders` | [S] |
| `GET /api/v1/paper/accounts/[id]/positions` | `positions.listPositions` | `positions` | [S] |
| `POST /api/v1/paper/orders` | `orders.*` | `paper_orders`, `alerts` | [S] (ownerId passed) |
| `POST /api/v1/paper/orders/[id]/cancel` | `paperOrders.cancelPaperOrder` | `paper_orders` | [S] |
| `POST /api/v1/paper/positions/[id]/close` | `paper*`/`engineModel` | `positions` | [S] |
| `PATCH /api/v1/paper/positions/[id]/risk` | `engineModel` | `positions` | [S] |
| `GET /api/v1/orders` | `paperOrders.listPaperOrders` | `paper_orders` | [S] |
| `POST /api/v1/orders` | `orders.*` | `paper_orders`, `alerts` | [S] |
| `POST /api/v1/orders/[id]/cancel` | `paperOrders`, `engineModel` | `paper_orders` | [S] |
| `POST /api/v1/orders/cancel-all` | `paperOrders`, `engineModel` | `paper_orders` | [S] |
| `GET /api/v1/fills` | `paperFills.listPaperFills` | `paper_fills` | [S] |
| `GET /api/v1/positions` | `positions`+`livePositions`+`paperAccount`+`engineModel` | `positions`, `paper_accounts` | [S] |
| `PATCH /api/v1/positions/[id]` | `positionActions.modifyPositionAction` | `positions` | [S] |
| `POST /api/v1/positions/[id]/close` | `positionActions.closePositionAction` | `positions`, `alerts` | [S] |
| `GET /api/v1/accounts` | `accounts.listAccounts` | `positions`, `equity` | [S] |
| `GET /api/v1/risk/status` | `risk.loadRiskStatus` | `risk_state`, `positions` | [S] |
| `GET /api/v1/journal` | `journal.listJournal` | `journal` | [U] ⚠ |
| `GET /api/v1/signals` | `signals.listSignals` | `signals` | [S] |
| `GET/POST /api/v1/sessions`, `[id]`, `[id]/move`, `[id]/events` | `sessions.*` | `trading_sessions` | [S] |

⚠ `journal` is per-user by product decision (§61.3) but `journal.listJournal` does not
accept `ownerId` yet — Phase B gap.

### 3.2 Strategy Lab / Bots (private, **unscoped**)

| Route | Server util | Engine model(s) | Scope |
|---|---|---|---|
| `GET /api/v1/strategies`, `[id]`, `[id]/versions` | `engineModel.strategyProfileModel/strategyVersionModel` | `strategy_profiles`, `strategy_versions` | [U] ⚠ seed-only |
| `POST /api/v1/strategies/[id]/versions` | `engineModel` | `strategy_versions` | [U] ⚠ |
| `POST /api/v1/strategies/[id]/activate-paper` | `engineModel` | `strategy_profiles` | [U] ⚠ |
| `GET /api/v1/bots/profiles`, `[id]` | `engineModel.botProfileModel` | `bot_profiles` | [U] ⚠ seed-only |
| `GET /api/v1/bots/instances`, `[id]` | `engineModel.botInstanceModel` | `bot_instances` | [U] ⚠ seed-only/fake `running` |
| `GET/POST /api/v1/ai-agents`, `[id]/*` (start/pause/resume/...) | `aiAgents.*` | `ai_agents`, `ai_agent_versions`, `ai_agent_actions` | [U] ⚠ |
| `GET /api/v1/ai/agents` | `aiAgents.aiAgentsStatus` | `ai_agents` | [U] ⚠ |
| `GET /api/v1/ai/providers` | `aiProviders.*` | `ai_provider_connections` | [U] Phase G; redacted only |
| `POST /api/v1/ai/providers/connections`, `PATCH/DELETE /connections/[id]` | `aiProviders.*` | `ai_provider_connections`, `ai_provider_audit` | [U] Phase G; secret is write-only |
| `POST /api/v1/ai/providers/connections/[id]/test` | `aiProviders.*`, `ai/providerStore.mjs` | `ai_provider_connections`, `ai_provider_audit` | [U] Phase G; persists health |

⚠ `strategy_profiles`, `strategy_versions`, `bot_profiles`, `bot_instances`,
`ai_agents` have **no `ownerId` field** today (Phase B gap).

### 3.3 Research / Evidence (private, **unscoped**)

| Route | Server util | Engine model(s) | Scope |
|---|---|---|---|
| `GET/POST /api/v1/research/experiments`, `[id]`, `[id]/run|move|decide` | `research.*` | `experiments`, `experiment_runs` | [U] ⚠ |
| `GET/POST /api/v1/research/evidence-sets`, `[id]`, `[id]/export` | `evidenceSets.*`, `evidenceExport.*` | `research_evidence_sets` | [U] ⚠ |
| `GET /api/v1/sessions/[id]/evidence` | `evidenceGraph.*`, `evidenceSets.*` | `trading_sessions`, `research_evidence_sets`, `journal`, `news_evidence_sets`, `experiments` | [U] ⚠ Phase F reconstruction + strict PIT |
| `POST /api/v1/sessions/[id]/analysis` | `sessionAnalysis.*`, `evidenceGraph.*` | `ai_proposals` (draft only) | [U] ⚠ Phase F advisory; never writes a strategy |
| `GET/POST /api/v1/research/news-evaluations`, `news-evidence/*` | `newsEvidence.*` | `news_model_evaluations`, `news_evidence_sets` | [U] ⚠ |
| `GET /api/v1/research/proposals`, `trades`, `strategies/[id]` | `research.*` | `ai_proposals`, `trades` | [U] ⚠ |
| `GET/POST /api/v1/runs`, `[id]`, `[id]/lineage` | `reports.*`, `testRuns.*`, `lineage.*` | `runs` (ndjson + collection) | [U] ⚠ products of `engine/store.mjs` |
| `POST/GET /api/v1/replay/sessions*` | `replaySessions.*`, `replayBroker.*` | in-memory + `runs` | [U] ⚠ |

### 3.4 Indicators / Methods / Market data

| Route | Server util | Model / source | Scope |
|---|---|---|---|
| `GET /api/v1/indicators`, `[id]` | `indicators.*` (registry) | static registry + engine | [G] |
| `GET/POST /api/v1/indicator-runs`, `[id]` | `indicators.*`, `methods.*`, `marketRest.*` | `indicator_runs` | [U] ⚠ |
| `GET /api/v1/methods`, `events` | `methods.*` | engine method plugins | [G] |
| `GET /api/v1/markets/[instrument]/*` (candles/orderbook/trades/funding/OI) | `marketRest.*` | external + hot stores | [G] |
| `GET /api/v1/instruments/*`, `universe` | `instruments.*`, `marketUniverse.*` | static catalog | [G] |
| `GET /api/v1/market-sources/health` | `instruments.*`, `marketRest.*` | provider probes | [G] |
| `GET /api/v1/data/*` (datasets/quality/lineage/recordings) | `dataCenter.*` | `datasets`, `candles`, `market_feed` | [G] |
| `GET /api/v1/intel/*`, `confluence/[symbol]` | `intel.*`, `methods.*`, `engineModel` | `intel`, hot state | [G] |

### 3.5 News / Macro / Outlook (global evidence, shared)

| Route | Server util | Model |
|---|---|---|
| `GET /api/v1/news`, `[id]`, `sources`, `events/*` | `newsStore.*` | `news_items`, `news_sources`, `news_market_events` |
| `POST /api/v1/news/sources/[id]/validate`, `ingestion/retry` | `newsStore.*` | `news_sources`, `news_dead_letters` |
| `GET /api/v1/outlook`, `[id]` | `newsStore.*` | `news_market_outlooks` |
| `GET /api/v1/calendar`, `[id]` | `macroCalendar.*` | `news_macro_calendar` |

### 3.6 Misc / infrastructure

| Route | Util | Notes |
|---|---|---|
| `GET /api/v1/health` | `intel.loadServicesStatus`, supabase | service heartbeats |
| `GET /api/v1/venues` | `instruments` | venue catalog |
| `GET /api/v1/configs/public` | supabase admin | public config |
| `GET /api/icons` | static | icon pipeline (CSS mask) |

## 4. Cross-cutting infrastructure inventory (§61.19 item 5)

| Capability | Current state | Reusable? |
|---|---|---|
| Event bus | `market/eventBus.mjs` — **in-process, market topics only** (emitted from `market/index.mjs`) | Partial: market plane only |
| Durable outbox / queue | **None** (no BullMQ/Agenda/pg-boss; no `outbox` collection) | No — must add minimal outbox (§61.4) |
| WebSocket | `server/routes/ws/market.ts`, `server/routes/ws/v3.ts`; `server/utils/realtime-hub.ts` + `market-socket.ts`; `realtime/*.mjs` (`envelope`, `subscriptions`, `recovery`) | Yes for market; no app-domain channels yet |
| SSE | none found | — |
| Job runner | `services/run.mjs` (watch/once) + `tools/dev.mjs` tasks + `engine/experimentService.mjs`/`strategyService.mjs` CLIs | Partial |
| Dead-letter | `news_dead_letters` model + `services/newsReview.mjs` + `engine/newsFetch.mjs` | Yes (news only) |
| Secrets at rest | `server/utils/crypto.ts`, `server/modules/config/encryption.ts`, `registry.ts`, `service.ts` | Yes — reuse for AI/provider creds (§61.11) |
| Realtime consumer | only `app/composables/useMarketStream.ts`; **no UI consumes `/ws/v3`** | — |

**Client state:** the only Pinia store is `app/stores/apps.ts` (hub app registry, not
trading). Terminal selection lives in `app/composables/useTerminalPrefs.ts`
(localStorage `tm-term:v1`). There is **no** `TradingWorkspaceContext` (§61.5 gap).

**Polling cadence (no realtime):** `OrdersPanel.vue`/`FillsPanel.vue` 10 s;
`SignalPanel`/`test-center/forward.vue` 15 s; `trading/index.vue` replay 1500 ms /
intel 60 s; standalone pages fetch once on mount. `useVisibleInterval.ts` exists.

## 5. Seed-only / demo / mock inventory (§61.19 item 3)

| Source | What it writes | How it is marked | Excluded from operations? |
|---|---|---|---|
| `scripts/seed-strategy-lab.mjs` | `strategy_profiles`, `strategy_versions`, `bot_profiles`, `bot_instances`, `paper_accounts` | `_id` prefixes `tm-vsa-*`, `bot-*`, `paper-main`; `createdBy:'seed'` | **No automatic filter** — writes to the same collections the operational API reads |
| same script | a `bot_instances` row with `state:'running'`, `paperEquity:10231.55`, `counts:{signals:128,orders:34,trades:11}` | `createdBy:'seed'` | ⚠ appears as a "running" bot with no worker — §61.7 violation |
| `scripts/dev-hub-stub.mjs` | local hub stub for login | dev only | yes (localhost) |
| `ai/test.mjs`, `ai/test-review.mjs`, `*-test.mjs` fixtures | in-memory | test only | yes |

**Consequence:** Strategy Lab, Bots and Sessions show seeded rows without a
"Demo data" filter. This is the primary seed-masquerade risk §61 flags.

## 6. Missing transitions (§61.19 item 2)

| Transition | Status | Evidence |
|---|---|---|
| Market data → canonical event/candle | **partial** | `market/index.mjs`, `market/candleBuilder.mjs` publish to in-process bus; not persisted per user |
| Candle → indicator/method evaluation | **partial** | `engine/methods/*`, `indicators` registry exist; no service drives the whole stream |
| Indicator → persisted signal (attributed) | **partial** | `engine/signalEngine.mjs` generates attributed signals from bars through the method contract; `services/signalStore.mjs` persists them idempotently on (ownerId, signalKey); the dashboard reads them via `server/utils/nativeSignals.ts` + `app/components/trading/EngineSignalsPanel.vue` (source switch, D5). Still missing: a service that drives the generator over the live stream |
| Signal → bot decision | **done** (Phase E) | `services/botSignalBridge.mjs` maps native entry signals to `source:'bot'` alerts (`bot_<instanceId>_<signalKey>`); the owner supervisor (`services/botWorker.mjs`) runs `exec/paper.mjs`, so Risk Gate → order → fill → position → metrics stay on the one executor path |
| Bot → Risk Gate → paper order | **partial** | `exec/risk.mjs`, `exec/paper.mjs`, `POST /api/v1/orders` / `paper/orders` exist; not driven by a bot runtime |
| Order/fill → position/account | **partial** | `positions`, `paper_accounts`, `equity` updated on manual paper flow; accounting idempotency not proven |
| Session → durable evidence/journal | **done** (Phase F) | the paper executor writes `trading_sessions` with a v1 manifest; journal rows link by upstream fill identity; a sealed session freezes into a hash-verified `research_evidence_sets` row |
| Session → research | **done** (Phase F) | `GET /api/v1/sessions/[id]/evidence` reconstructs the graph (journal/news/experiments, deterministic digest); `POST /api/v1/sessions/[id]/analysis` writes an advisory `ai_proposals` draft whose citations are checked against that digest |
| Provider connection → model request | **done** (Phase G request resolver) | stored owner-scoped row is decrypted inside `ai/providerStore.mjs`, filtered by adapter/capabilities, and returned only to the gateway; no route serializes it |
| Events/outbox for UI invalidation | **done** | durable trading_domain_events outbox (Phase C) + workspace events/ack endpoints + `app/composables/useTradingWorkspace.ts` |

## 7. Feature status legend (used by `implementation-tracker.md`)

- **operational** — a user action persists and is re-read from durable records on a wired path.
- **partial** — some steps exist but a required consumer/producer is missing or seed-fed.
- **read-only** — reads real records; no write path.
- **seed-only** — the visible data is written only by a seed script.
- **missing** — no code path exists.

See `docs/web-app/implementation-tracker.md` for the per-feature verdicts and
`docs/web-app/data-ownership-map.md` for the ownership/backfill detail.
