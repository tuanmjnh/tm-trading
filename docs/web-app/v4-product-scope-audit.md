# V4 Product Scope Audit

> **Authority:** `tm-trading-roadmap-v4.2.md` §13 Phase 0, §14, §16.15-A.
> **Method:** source inspection on 2026-10-31 (`app/pages`, `server/api`, `services/`,
> `engine/models`, `shared/types`) plus a read-only query of the Hub `system_routes`
> table for `tm-trading_ghfseu`. Not runtime-verified; no browser session was used.
> **Companion:** `v4-route-migration-map.md`, `v4.2-service-inventory.md`,
> `v4.2-operations-control-audit.md`.

## Legend

| Status | Meaning |
| --- | --- |
| `WORKING` | A user action reads/writes durable records through a wired API and a real producer exists. |
| `PARTIAL` | Some steps exist; a required producer or consumer is missing, or the path is seeded/polled. |
| `READ_ONLY` | Reads real records; no write path. |
| `SEED_ONLY` | Visible rows are written only by a seed script. |
| `UNAVAILABLE` | Page exists but its backend capability is absent or unreachable. |
| `NOT_IMPLEMENTED` | No page and no backend. |

## 1. Page inventory (79 route files)

### 1.1 Overview and Operations

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/index.vue` | `useRuns`, `useRisk`, `useIntel`, `useBots`, `useResearch` | `PARTIAL` — it is a runs/risk board, not “market state now” | Overview `/` (rebuild) |
| `app/pages/operations.vue` | `useSystemHealth`, `useIntel`, `useBots`, `useAiAgents`, `useMarketStream`, `useSignals`, `usePositions`, `usePaperAccounts` | `READ_ONLY` — header states “read-only by contract” | Operations (control plane in S2) |

### 1.2 Markets (Discover + Intelligence sources)

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/markets/index.vue` | `useIntel`, `useMarketStream` | `WORKING` — reads `intel` snapshots written by funding/scanner/regime/liquidation | Discover / Overview |
| `app/pages/markets/explorer.vue` | `useMarketCatalog`, `useSystemHealth` | `WORKING` | Discover (Top Coins) |
| `app/pages/markets/scanner.vue` | `useMarketScanner` | `WORKING` — `services/scanner.mjs` | Discover (Movers/Volatility) |
| `app/pages/markets/calendar.vue` | `useMacroCalendar`, `useMarketCalendar` | `READ_ONLY` — `services/macro.mjs` writes only with `FRED_API_KEY` | Intelligence (News & Events) |
| `app/pages/news/index.vue` | `useNewsDesk` | `WORKING` — `services/news.mjs` + `newsStore.mjs` | Intelligence (News & Events) |
| `app/pages/news/events.vue` | `useNewsDesk` | `WORKING` — `services/newsEvents.mjs` clustering | Intelligence (News & Events) |
| `app/pages/news/sources.vue` | `useNewsDesk` | `WORKING` — source registry + validation | Intelligence → admin detail |
| `app/pages/outlook.vue` | `useNewsDesk` | `READ_ONLY` — `news_market_outlooks` | Intelligence (Market Outlook) |

### 1.3 Trading / paper / demo (advanced)

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/trading/index.vue` | `useMarketStream`, `useIntel`, `useJournal`, `useMethods`, `useNewsDesk`, `useReplay` | `WORKING` | Advanced (Paper & Demo) |
| `app/pages/trading/signals.vue` | `useSignals` | `PARTIAL` — native producer exists; attribution/outcome history thin | Watchlist & Signals |
| `app/pages/trading/paper.vue` | `usePaperAccounts` | `WORKING` | Advanced (Paper) |
| `app/pages/trading/orders.vue` | `usePaperOrders` | `WORKING` | Advanced (Paper) |
| `app/pages/trading/positions.vue` | `usePositions`, `useMarketStream` | `WORKING` | Advanced (Paper) |
| `app/pages/trading/accounts.vue` | `useAccounts`, `usePaperAccounts` | `PARTIAL` — per-account views, CRUD limited | Advanced (Paper) |

### 1.4 Strategy Lab (advanced/research)

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/strategy-lab/index.vue` | `useStrategies` | `SEED_ONLY` — profiles/versions from `scripts/seed-strategy-lab.mjs` | Advanced (Research) |
| `app/pages/strategy-lab/indicators/index.vue` | `useIndicators` | `READ_ONLY` — registry-backed | Advanced (Pine & Indicators) |
| `app/pages/strategy-lab/indicators/[id].vue` | `useIndicators` | `READ_ONLY` | Advanced |
| `app/pages/strategy-lab/methods.vue` | (static) | `READ_ONLY` | Advanced |
| `app/pages/strategy-lab/bots/index.vue` | `useBots`, `useBotsLive` | `PARTIAL` — runtime exists (`botWorker`), instances partly seeded | Advanced (Demo bots) |
| `app/pages/strategy-lab/bots/[id].vue` | `useBots` | `PARTIAL` | Advanced |
| `app/pages/strategy-lab/bots/instances/[id].vue` | `useBots` | `PARTIAL` | Advanced |
| `app/pages/strategy-lab/[id].vue` | `useStrategies` | `SEED_ONLY` | Advanced |

### 1.5 Test Center (advanced/research)

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/test-center/index.vue` | `useTestRuns`, `useReplay`, `useStrategies` | `PARTIAL` | Advanced |
| `app/pages/test-center/runs/index.vue` | `useRuns` | `PARTIAL` — Mongo `runs` owner-scoped; ndjson series shared | Advanced |
| `app/pages/test-center/runs/[id].vue` | `useRuns`, `useResearch` | `PARTIAL` | Advanced |
| `app/pages/test-center/runs/compare.vue` | `useRuns` | `PARTIAL` | Advanced |
| `app/pages/test-center/forward.vue` | `useForwardTests` | `READ_ONLY` — polls `signals` every 15 s | Watchlist & Signals |
| `app/pages/test-center/replay.vue` | `useReplay` | `PARTIAL` — in-memory process-level sessions | Advanced |
| `app/pages/sessions/index.vue` | `useSessions`, `useReplay`, `useBots` | `PARTIAL` — no real runtime feeds all events | Advanced |
| `app/pages/sessions/[id].vue` | `useSessions`, `useResearch` | `PARTIAL` | Advanced |

### 1.6 Data & Research

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/data-research/data/index.vue` | `useDataCenter` | `READ_ONLY` | Advanced (Datasets) |
| `app/pages/data-research/data/datasets.vue` | `useDataCenter` | `READ_ONLY` | Advanced |
| `app/pages/data-research/data/recordings.vue` | `useDataCenter` | `READ_ONLY` | Advanced |
| `app/pages/data-research/data/quality.vue` | `useDataCenter` | `READ_ONLY` | Advanced |
| `app/pages/data-research/data/lineage.vue` | `useDataCenter` | `READ_ONLY` | Advanced |
| `app/pages/data-research/research/index.vue` | `useResearch`, `useStrategies` | `PARTIAL` | Advanced (AI Research) |
| `app/pages/data-research/research/experiments/index.vue` | `useResearch` | `PARTIAL` | Advanced |
| `app/pages/data-research/research/experiments/[id].vue` | `useResearch` | `PARTIAL` | Advanced |
| `app/pages/data-research/research/evidence/index.vue` | `useResearch` | `PARTIAL` | Advanced |
| `app/pages/data-research/research/evidence/[id].vue` | `useResearch` | `PARTIAL` | Advanced |
| `app/pages/data-research/research/news-impact.vue` | (static shell) | `UNAVAILABLE` — no data binding in the page | Intelligence (News & Events) |
| `app/pages/data-research/journal.vue` | `useJournal` | `READ_ONLY` | Advanced |
| `app/pages/ai-agents/index.vue` | `useAiAgents`, `useAiAgentsLive` | `PARTIAL` — lifecycle endpoints, no dedicated supervisor | Advanced (AI Research) |

### 1.7 Alerts

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/alerts/index.vue` | `useAlertRules` | `WORKING` — CRUD + `services/alertRules.mjs` every 5 min | Alerts (Alert Rules) |
| `app/pages/alerts/history.vue` | `useHub` (`notification_logs`) | `READ_ONLY` | Alerts (Delivery History) |
| `app/pages/alerts/inbox.vue` | `useHub` / signals | `READ_ONLY` | Alerts (Inbox) |

### 1.8 Shared resources and administration (Hub-owned)

| Page | Data path | Status | V4 target |
| --- | --- | --- | --- |
| `app/pages/shared-resources/index.vue` | `useMediaStore`, `useCloudinary` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/shared-resources/import.vue` | `useHub` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/shared-resources/connections.vue` | `useHub` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/shared-resources/queues.vue` | `useHub` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/admin-system/index.vue` (users) | `useUsers`, `useHub` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/admin-system/roles.vue` | `useAdminRoles` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/admin-system/permissions.vue` | `useHub` | `WORKING` (Hub) — route hidden in seed | Platform & Administration |
| `app/pages/admin-system/routes.vue` | `useAdminRoutes` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/admin-system/configs.vue` | `useAppConfig` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/admin-system/logs.vue` | `useHub` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/admin-system/ai-providers.vue` | `useAiProviders` | `WORKING` — Phase G | Platform & Administration |
| `app/pages/admin-system/data-sources.vue` | `useSystemHealth` | `PARTIAL` — probe + run-once only | Operations |
| `app/pages/admin-system/health.vue` | `useSystemHealth` | `PARTIAL` — heartbeat-derived | Operations |
| `app/pages/admin-system/hub-integration.vue` | `useHub`, `useNavMenu` | `WORKING` | Platform & Administration |
| `app/pages/admin-system/docs.vue` | `useHub` | `WORKING` | Platform & Administration |
| `app/pages/admin-system/settings/index.vue` | `useAppConfig`, `useColorMode` | `WORKING` | Platform & Administration |
| `app/pages/admin-system/settings/system.vue` | (static) | `WORKING` | Platform & Administration |
| `app/pages/admin-system/profile/*` (4 pages) | `useAuth`, `useHub`, `usePasskey`, `useWebPush` | `WORKING` (Hub) | Platform & Administration |
| `app/pages/tools/*` (5 pages) | static utilities | `WORKING` | Platform & Administration (Tools) |

### 1.9 Authentication

| Page | Status | Notes |
| --- | --- | --- |
| `app/pages/login.vue`, `register.vue`, `forgot-password.vue`, `reset-password.vue` | `WORKING` | Delegated to Hub `POST /api/v1/auth/login` |

## 2. Capability audit (roadmap §4–§7)

| Capability | Producer | Storage | API | UI consumer | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Market quotes / candles | `market/*` plane, `market/binance` provider | in-memory + `candles`, `market_feed` | `/api/v1/markets/[instrument]/*`, `/ws/market` | markets, trading | `market-feed`, `market-socket`, `realtime-socket` | `PARTIAL` (Binance-first, no Bybit/OKX public feed) |
| Movers / volatility scanner | `services/scanner.mjs` | `intel` (snapshot + events) | `/api/v1/intel`, `/api/v1/markets/*` | markets/scanner | `crossScanner`, `regime-zone` | `WORKING` |
| Funding | `services/funding.mjs` | `intel`, `market_feed` | `/api/v1/markets/[instrument]/funding` | markets, operations | `quality`, `reconcile` | `WORKING` |
| Open interest | `services/funding.mjs` (same cycle) | `intel` | `/api/v1/markets/[instrument]/open-interest` | markets | `quality` | `WORKING` |
| Liquidations | `services/liquidation.mjs` + WS `!forceOrder` | `intel`, `data/liq-events.ndjson`, `market_feed` | `/api/v1/intel` | markets | `fidelity` | `PARTIAL` (observed events + REST estimate mixed, not classified) |
| News ingestion | `services/news.mjs`, `newsExtract.mjs` | `news_items`, `news_item_revisions`, `news_sources`, `news_dead_letters` | `/api/v1/news*` | news, outlook | `news`, `newsFetch`, `newsHardening`, `newsOps` | `WORKING` |
| News clustering / events | `services/newsEvents.mjs` | `news_market_events`, `news_domain_events` | `/api/v1/news/events` | news/events | `newsEvents`, `newsDomainEvents` | `WORKING` |
| Fear & Greed | none | none | none | none | none | `NOT_IMPLEMENTED` |
| On-chain | none | none | none | none | none | `NOT_IMPLEMENTED` |
| Liquidity depth / estimated zones | partial: orderbook API only | in-memory | `/api/v1/markets/[instrument]/orderbook` | trading | `market-socket` | `PARTIAL` (no observed/estimated classification) |
| Watchlists | none | none | none | none | none | `NOT_IMPLEMENTED` |
| Futures research signals | `services/signalProducer.mjs` | `signals` | `/api/v1/signals`, `/api/v1/signals/native` | trading/signals, test-center/forward | `signalContract`, `signalEngine`, `signalStore`, `nativeSignals` | `PARTIAL` (no watchlist scope, no outcome horizons) |
| Alert rules | `services/alertRules.mjs` | `alert_rules`, `alerts` | `/api/v1/alert-rules*` | alerts | `inAppSignals`, `notify` | `WORKING` |
| Telegram delivery | `services/telegram.mjs`, `notify/*` | `notification_logs` | none (server-side only) | alerts/history | `notify` | `PARTIAL` (no outbox, no retry/backoff, no delivery state machine) |
| AI summaries | `ai/daily-brief.mjs`, `services/newsExtract.mjs` | `news_assessments`, `ai_proposals` | `/api/v1/ai/*` | ai-agents, news | `aiResearch`, `newsResearch` | `PARTIAL` |
| AI provider gateway | `ai/gateway.mjs`, `ai/providerStore.mjs` | `ai_provider_connections`, `ai_provider_models`, `ai_provider_audit` | `/api/v1/ai/providers*` | admin-system/ai-providers | `aiProviders`, `aiProviderModels`, `aiProviderHub` | `WORKING` (Phase G, Gemini verified live) |
| Contextual assistant | `server/api/v1/assistant/*`, `server/utils/moduleAssistant.ts` | `ai_assistant_conversations` | `/api/v1/assistant/ask` | (no page surface) | `assistant`, `assistantConversations` | `PARTIAL` (API only, no UI entry point) |
| Market outlook | `news_market_outlooks` (written by brief) | `news_market_outlooks` | `/api/v1/outlook*` | outlook | `newsOutlook` | `READ_ONLY` (no SHORT/MEDIUM/LONG schema) |
| Pine demo test | adapters + Risk Gate; no profile/run | `exchange_demo_connections`, `exchange_order_mappings`, `exchange_events` | `/api/v1/exchange-demo/*` | none | `pineParity`, `pineInventory` | `NOT_IMPLEMENTED` (workflow) |

## 3. Cross-cutting findings

1. **Provenance is not a contract.** Freshness is computed per panel; there is no
   shared type with `source / venue / eventTime / ingestTime / asOf / quality`.
   A missing metric and a zero are indistinguishable in several tables.
2. **One page per metric.** The 11 top-level navigation groups and 79 route files
   are the direct cause of the “sprawling tools” problem §0 describes.
3. **Two signal sources.** `alerts` (webhook legacy) and `signals` (native) coexist;
   the UI reads both without a single canonical label.
4. **Telegram is fire-and-forget.** `sendTelegram` returns a boolean; nothing records
   `queued/sent/failed`, so delivery history cannot be audited.
5. **Seed/page drift.** Two visible seed routes have no page
   (`/admin-system/health-enhanced`, `/strategy-lab/bots/instances`), and
   `news-impact` is a static shell. See the route migration map.
6. **No tenant-scoped watchlist/alert destination model.** `alert_rules` is
   owner-scoped, but there is no watchlist entity and no per-user Telegram
   destination record.
7. **Assistant exists only as an API.** `POST /api/v1/assistant/ask` has no UI
   entry point, so §8/§16.10 is unimplemented from the user's perspective.

## 4. What this audit means for S1–S4

- S1 must add the provenance contract before any table is rebuilt, otherwise the
  new workspaces inherit the same ambiguity.
- S4 must rebuild Overview and merge pages into tabs; the page inventory above is
  the merge list, and every `SEED_ONLY`/`PARTIAL` page must stay hidden or be
  labelled unavailable.
- S5 has three genuine greenfield capabilities: Fear & Greed, on-chain, watchlists.
  They must not be faked with seeded data.
