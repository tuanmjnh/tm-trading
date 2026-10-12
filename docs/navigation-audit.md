# Navigation Audit — TM Trading V3.3 (§58.8)

> First deliverable required by roadmap §58.8 before any menu refactor.
> Authority: `docs/tm-trading-roadmap-v3.3.md` §57 (IA) and §58 (migration rules).
> Status legend: **implemented** = page + working API/service; **partial** = API/service exists but no
> page (or page without API); **planned** = no page and no API endpoint yet; **missing** = expected, nothing exists.

## 1. Method & sources

Inspected, not assumed:

- Route seed: `../tm-hub/scripts/seed/data.ts` → `createTradingRoutes(context)`, `createTradingRoles(context)`, `createTradingConfigs(context)`.
- Seed application wiring: `../tm-hub/scripts/seed/apps/tm-trading.ts` (route sync via `seedSystemRoute` + `cleanOldRoutes`), `../tm-hub/scripts/seed/index.ts`.
- Seed/update semantics: `../tm-hub/scripts/seed/shared.ts` → `seedSystemRoute` (upsert by `(app_id,id)`), `cleanOldRoutes` (deletes ids absent from the new list), `seedRole` (rewrites `allowed_routes`).
- Hub route API: `../tm-hub/server/api/v1/auth/routes.get.ts` (returns `system_routes` with `is_deleted=false`; **does not filter `is_visible`**; prunes by RBAC `required_permission`/`allowed_routes`).
- App shell: `app/layouts/default.vue`, `app/composables/useNavMenu.ts`, `app/middleware/auth.global.ts`.
- Local pages: `app/pages/**` (43 `.vue`).
- Server API surface: `server/api/v1/**` and `server/routes/**`.
- i18n: `i18n/locales/en.json`, `i18n/locales/vi.json` (`nav.*`).
- Design reference (labels only): `private/stitch_tm_trading_ui_template/*_tm_trading_v3/code.html` (sidebar already matches §58.2).

## 2. Current route inventory — `createTradingRoutes`

| id | path | label key | icon | sort | parent | is_visible | Status | Page / API evidence |
|---|---|---|---|---|---|---|---|---|
| `home` | `/` | `nav.home` | `i-lucide-house` | 0 | — | true | implemented | `app/pages/index.vue` |
| `group_workspace` | `#workspace` | `nav.workspace` | `i-lucide-terminal` | 1 | — | true | scaffolding | pseudo-group, no page |
| `trade_terminal` | `/trade` | `nav.trade_terminal` | `i-lucide-candlestick-chart` | 10 | group_workspace | true | implemented | `app/pages/trading/index.vue` + terminal components |
| `trade_replay` | `/replay` | `nav.replay` | `i-lucide-history` | 11 | group_workspace | true | implemented | `app/pages/test-center/replay.vue`; `server/api/v1/replay/sessions/**` |
| `group_execution` | `#execution` | `nav.execution` | `i-lucide-briefcase` | 2 | — | true | scaffolding | pseudo-group |
| `exec_positions` | `/positions` | `nav.positions` | `i-lucide-layers` | 20 | group_execution | true | implemented | `app/pages/trading/positions.vue`; `server/api/v1/positions/**` |
| `exec_accounts` | `/accounts` | `nav.accounts` | `i-lucide-wallet` | 21 | group_execution | true | implemented | `app/pages/trading/accounts.vue`; `server/api/v1/accounts/index.get.ts` |
| `group_intel` | `#intel` | `nav.intel` | `i-lucide-radar` | 3 | — | true | scaffolding | pseudo-group |
| `intel_signals` | `/signals` | `nav.signals` | `i-lucide-radio` | 30 | group_intel | true | implemented | `app/pages/trading/signals.vue`; `server/api/v1/signals/index.get.ts` |
| `intel_market` | `/intel` | `nav.market_intel` | `i-lucide-gauge` | 31 | group_intel | true | implemented | `app/pages/markets/index.vue`; `server/api/v1/intel/**` |
| `group_research` | `#research` | `nav.research` | `i-lucide-flask-conical` | 4 | — | true | scaffolding | pseudo-group |
| `research_runs` | `/runs` | `nav.runs` | `i-lucide-activity` | 40 | group_research | true | implemented | `app/pages/test-center/runs/index.vue`; `server/api/v1/runs/**` |
| `research_journal` | `/journal` | `nav.journal` | `i-lucide-book-marked` | 41 | group_research | true | implemented | `app/pages/data-research/journal.vue`; `server/api/v1/journal/index.get.ts` |
| `group_resources` | `#resources` | `nav.resources` | `i-lucide-folder` | 5 | — | true | scaffolding | pseudo-group |
| `resources_media` | `/resources/media` | `nav.media` | `i-lucide-images` | 50 | group_resources | true | implemented | `app/pages/shared-resources/index.vue` (Hub media) |
| `resources_inbox` | `/resources/inbox` | `nav.inbox` | `i-lucide-inbox` | 51 | group_resources | true | implemented | `app/pages/alerts/inbox.vue` (Hub inbox) |
| `resources_notifications` | `/resources/notifications` | `nav.notifications` | `i-lucide-bell` | 52 | group_resources | true | implemented | `app/pages/alerts/history.vue` (Hub notifications) |
| `resources_connections` | `/resources/connections` | `nav.connections` | `i-lucide-cable` | 53 | group_resources | true | implemented | `app/pages/shared-resources/connections.vue` (Hub connections) |
| `resources_import` | `/resources/import` | `nav.import` | `i-lucide-file-up` | 54 | group_resources | true | implemented | `app/pages/shared-resources/import.vue` (Hub import) |
| `resources_queues` | `/resources/queues` | `nav.queues` | `i-lucide-list-ordered` | 55 | group_resources | true | implemented | `app/pages/shared-resources/queues.vue` (Hub queues) |
| `group_admin` | `#administration` | `nav.administration` | `i-lucide-shield-check` | 6 | — | true | scaffolding | pseudo-group |
| `admin_users` | `/administration/users` | `nav.users` | `i-lucide-users` | 60 | group_admin | true | implemented | `app/pages/admin-system/index.vue` (Hub IAM) |
| `admin_roles` | `/administration/roles` | `nav.roles` | `i-lucide-shield-check` | 61 | group_admin | true | implemented | `app/pages/admin-system/roles.vue` (Hub IAM) |
| `admin_permissions` | `/administration/permissions` | `nav.permissions` | `i-lucide-key-round` | 62 | group_admin | true | implemented | `app/pages/admin-system/permissions.vue` (Hub IAM) |
| `admin_routes` | `/administration/routes` | `nav.routes` | `i-lucide-route` | 63 | group_admin | true | implemented | `app/pages/admin-system/routes.vue` (Hub route registry) |
| `admin_configs` | `/administration/configs` | `nav.configs` | `i-lucide-sliders` | 64 | group_admin | true | implemented | `app/pages/admin-system/configs.vue` (Hub remote config) |
| `admin_logs` | `/administration/logs` | `nav.logs` | `i-lucide-scroll-text` | 65 | group_admin | true | implemented | `app/pages/admin-system/logs.vue` (Hub logs) |
| `group_system` | `#system` | `nav.system` | `i-lucide-cog` | 7 | — | true | scaffolding | pseudo-group |
| `system_profile` | `/system/profile` | `nav.profile` | `i-lucide-user` | 70 | group_system | true | implemented | `app/pages/system/profile/*` |
| `system_docs` | `/system/docs` | `nav.docs` | `i-lucide-book-open` | 71 | group_system | true | implemented | `app/pages/admin-system/docs.vue` |
| `system_settings` | `/system/settings` | `nav.settings` | `i-lucide-settings` | 72 | group_system | true | implemented | `app/pages/system/settings/*` |
| `group_utilities` | `#utilities` | `nav.utilities` | `i-lucide-wrench` | 8 | — | true | scaffolding | pseudo-group |
| `utilities_text` | `/utilities/text` | `nav.utilities_text` | `i-lucide-file-text` | 80 | group_utilities | true | implemented | `app/pages/tools/index.vue` |
| `utilities_icons` | `/utilities/icons` | `nav.utilities_icons` | `i-lucide-smile` | 81 | group_utilities | true | implemented | `app/pages/tools/icons.vue` |
| `utilities_encode` | `/utilities/encode` | `nav.utilities_encode` | `i-lucide-binary` | 82 | group_utilities | true | implemented | `app/pages/tools/encode.vue` |
| `utilities_random` | `/utilities/random` | `nav.utilities_random` | `i-lucide-dices` | 83 | group_utilities | true | implemented | `app/pages/tools/random.vue` |
| `utilities_editor` | `/utilities/editor` | `nav.utilities_editor` | `i-lucide-pen-tool` | 84 | group_utilities | true | implemented | `app/pages/tools/editor.vue` |

### Orphan pages (page exists, no route record)

| page | path | note |
|---|---|---|
| `app/pages/shared-resources/import.vue` | `/shared-resources/import` | canonical Import page. The byte-identical duplicate under `administration/` was deleted (see §10). |
| `app/pages/test-center/runs/compare.vue` | `/test-center/runs/compare` | reachable from `/test-center/runs`; §57.3/§58.2 want it visible → registered as `test_compare`. |
| `app/pages/test-center/runs/[id].vue` | `/test-center/runs/:id` | detail route, correct to keep out of the sidebar. |
| `app/pages/tools/index.vue`, `app/pages/tools.vue` | `/tools` | landing/tab host; children carry the menu. |

## 3. Ownership — Hub/shared core vs local Trading code

| Capability | Owner / source of truth | Where consumed | Evidence |
|---|---|---|---|
| Login / session / tokens | TM Hub | App shell (no local duplicate page) | `app/composables/useAuth.ts`, `app/middleware/auth.global.ts` → `useHub().hubFetch('/api/v1/auth/*')` |
| App identity / registry | TM Hub | `X-App-Id: tm-trading_8pmp33` | `AGENTS.md`; `.env` `NUXT_PUBLIC_HUB_APP_ID` |
| Users / roles / permissions (RBAC) | TM Hub | `/admin-system/{users,roles,permissions}` | `app/pages/admin-system/*` + Hub API |
| Dynamic routes / menu registry | TM Hub `system_routes` via `GET /api/v1/auth/routes` | sidebar + middleware | `useNavMenu.ts`, `auth.global.ts`, Hub `routes.get.ts` |
| Remote configuration | TM Hub `app_configs` | `/administration/configs`, `/configs/public` | `server/api/v1/configs/public.get.ts` |
| Shared media | TM Hub media service | `/resources/media` | `app/pages/shared-resources/index.vue` |
| Inbox / notifications | TM Hub notification/messaging | `/resources/{inbox,notifications}` | pages + Hub providers |
| Generic connections | TM Hub connections service | `/resources/connections` | page (+ `app/pages/accounts` is **not** this) |
| Import / queues | TM Hub shared core | `/resources/{import,queues}` | pages |
| Logs | TM Hub observability | `/administration/logs` | page |
| Profile / docs / settings | Hub session + local shell prefs | `/system/*` | pages |
| Utilities | local | `/utilities/*` | pages + `app/components/utilities/*` |
| Market data plane | **local** (`market/`, `server/api/v1/markets`) | distinct from generic connections | `server/api/v1/markets/**`, `market/**` |
| Trading domain (signals, runs, replay, positions, orders, paper, strategies, indicators, methods, research) | **local** (`engine/`, `exec/`, `simulation/`) | planned pages | `server/api/v1/**`, `tests/*` |

## 4. Target V3.3 mapping (current → target group)

| current | target group (§58.2) | action |
|---|---|---|
| `home` `/` | 1 Overview | keep visible |
| `intel_market` `/intel` | 2 Markets | keep, re-parent `group_markets` |
| `trade_terminal` `/trade` | 3 Trading | keep, re-parent `group_trading` |
| `intel_signals` `/signals` | 3 Trading | keep, re-parent |
| `exec_positions` `/positions` | 3 Trading | keep |
| `exec_accounts` `/accounts` | 3 Trading (after audit) | keep |
| `trade_replay` `/replay` | 5 Test Center | keep, re-parent |
| `research_runs` `/runs` | 5 Test Center | keep, label → Historical Runs |
| — `/runs/compare` | 5 Test Center | **register** `test_compare` (page exists) |
| `research_journal` `/journal` | 6 Data & Research | keep, re-parent |
| `resources_media` `/resources/media` | 8 Shared Resources | keep, re-parent |
| `resources_import` `/resources/import` | 8 Shared Resources | keep |
| `resources_connections` `/resources/connections` | 8 Shared Resources | keep |
| `resources_queues` `/resources/queues` | 8 Shared Resources | keep |
| `resources_inbox` `/resources/inbox` | 7 Alerts & Notifications | keep |
| `resources_notifications` `/resources/notifications` | 7 Alerts & Notifications | keep, canonical, label → Notification History |
| `admin_*` | 9 Administration & System | keep |
| `system_profile/docs/settings` | 9 Administration & System | keep |
| `utilities_*` | Secondary Tools | keep functionality, de-emphasize (own group last) |
| pseudo-groups `group_workspace/execution/intel/research/resources/admin/system/utilities` | — | **replaced** (see §6 rollback) |

### New target routes (hidden until page + tests land)

| proposed | target group | Status | Evidence / dependency |
|---|---|---|---|
| `/markets` | Markets | implemented | Markets index is Intel (`app/pages/markets/index.vue`); Market Explorer implemented at `/markets/explorer` (`app/pages/markets/explorer.vue`) on `/instruments/**` + `/venues` + `/market-sources/health` (2026-10-11) |
| `/scanner` | Markets | implemented | `app/pages/markets/scanner.vue` + `useMarketScanner` merges scanner-service snapshots (mover/flow/accum) into one symbol candidate list and joins the Instrument Catalog; reads `/api/v1/intel` + `/instruments`, deep-links `/trading?instrument=` (2026-10-11) |
| `/calendar` | Markets | implemented | `app/pages/markets/calendar.vue` + `useMarketCalendar` render the intel `news` stream (scored headlines written by `services/news.mjs`) grouped by UTC day, with the token-unlock window from the same intel snapshot as context; new read-only `/api/v1/news` endpoint (2026-10-11) |
| `/paper` | Trading | implemented | `app/pages/trading/paper.vue` (account equity/risk/exposure/PnL + risk gate); APIs `/paper/accounts*`, `/risk/status` (2026-10-11) |
| `/orders` | Trading | implemented | `app/pages/trading/orders.vue` (lifecycle + cancel guarded by `cancelable`); APIs `/orders/**` (2026-10-11) |
| `/strategies` | Strategy Lab | implemented | `app/pages/strategy-lab/index.vue`; API `/strategies/**` (Slice 2) |
| `/indicators` | Strategy Lab | implemented | `app/pages/strategy-lab/indicators.vue`; APIs `/indicators/**`, `/indicator-runs/**` (Slice 2) |
| `/methods` | Strategy Lab | implemented | `app/pages/strategy-lab/methods.vue`; API `/methods/**` (Slice 2) |
| `/bots`, `/bots/instances` | Strategy Lab | implemented | `app/pages/strategy-lab/bots/index.vue`, `bots/instances.vue`; APIs `/bots/profiles*`, `/bots/instances*` (Slice 2) |
| `/lab/new` | Test Center | implemented | builder merged into `/test-center` (`app/pages/test-center/index.vue`; test-run contract via `/runs` POST) (Slice 3) |
| `/forward-tests` | Test Center | implemented | `app/pages/test-center/forward.vue` (`useForwardTests`) (Slice 3) |
| `/data`, `/data/{datasets,recordings,quality,lineage}` | Data & Research | implemented | `app/pages/data-research/data/*`; APIs `/data/{datasets,recordings,quality,lineage}` (Slice 4) |
| `/research` | Data & Research | implemented | `app/pages/data-research/research/index.vue`; APIs `/research/proposals`, `/research/trades` (Slice 5) |
| `/research/experiments` | Data & Research | implemented | `app/pages/data-research/research/experiments*.vue`; API `/research/experiments/**` (Slice 5) |
| `/alerts` | Alerts & Notifications | implemented | `app/pages/alerts/index.vue` (rule CRUD: create/edit/toggle/delete); APIs `/alert-rules/**`; engine `engine/alertRules.mjs` + service `services/alertRules.mjs` (2026-10-12) |
| `/system/data-sources` | Administration & System | implemented | `app/pages/admin-system/data-sources.vue` (per-venue provider probes); API `/market-sources/health` |
| `/health` | Administration & System | implemented | `app/pages/admin-system/health.vue` (DB + D9 service heartbeats); API `/health.get.ts` |
| `/administration/apps` | Administration & System | planned | no local page (Hub-owned) |

## 5. Conflicts, duplicates, missing pages, misleading labels

- **`/accounts` (`exec_accounts`)**: audit — implementation is an execution/portfolio account view (`server/api/v1/accounts/index.get.ts`), **not** Hub app connections. Keep as Trading → Accounts; do not merge with `/resources/connections`.
- **`/resources/notifications` vs `/notifications`**: only `/resources/notifications` exists. Keep it canonical; do not register both (§58.2 note). Label clarified to "Notification History".
- **`/administration/logs` vs `/logs`**: only `/administration/logs` exists locally. Keep canonical.
- **`/resources/queues` vs bots/test runs**: queues page is shared Hub job infra; keep distinct (§58.3).
- **`/runs` naming**: route id `research_runs`, name `runs`; label was "Backtest". Relabel to "Historical Runs" for the Test Center; path unchanged (compatibility).
- **`/resources/import` vs administration import**: two import surfaces exist (`administration/import.vue` orphan + `/resources/import`). Only `/resources/import` is in the registry and target; leave the orphan as a deep link.
- **Missing pages for partial APIs**: none remain — `/markets` (explorer), `/scanner`, `/calendar`, `/orders`, `/paper`, `/strategies`, `/indicators`, `/methods`, `/research`, `/research/experiments`, `/alerts` all have real pages now (Slices 2–5 + the 2026-10-11/10-12 leaves below). Still Coming Soon by design (no working service/API, §58.5): `/admin-system/apps` (Hub-owned).
- **Hidden enforcement gap**: Hub returns `is_visible:false` routes unfiltered; the sidebar only filtered top-level `isVisible`. Milestone 1 makes `isVisible` filtering recursive (leaf + group).

## 6. i18n

Reused keys (already present in both locales): `home, markets, trade_terminal, signals, positions, accounts, market_intel, runs, replay, journal, resources, media, inbox, notifications, connections, import, queues, administration, users, roles, permissions, routes, configs, logs, system, profile, docs, settings, tools, utilities, utilities_text, utilities_icons, utilities_encode, utilities_random, utilities_editor, trading, orders`.

Missing keys to add under `nav` (both `en.json` and `vi.json`): `market_explorer, scanner, news_calendar, paper, strategy_lab, strategies, indicators, methods, bot_profiles, bot_instances, test_center, new_test, historical_runs, forward_tests, replay_training, compare_validation, data_research, data_center, datasets, market_recordings, data_quality, data_lineage, ai_research, experiments, alerts_notifications, alert_rules, notification_history, shared_resources, admin_system, applications, market_data_sources, health`.

Relabeled existing keys: `nav.market_intel` → "Market Intelligence"; keep key to avoid churn elsewhere.

## 7. Migration plan

Seed changes (`../tm-hub/scripts/seed/data.ts`):

1. Replace `createTradingRoutes` with the §58.2 hierarchy using **deterministic IDs**. Existing leaf ids/paths are preserved verbatim (compatibility contracts). Unimplemented routes are inserted with `is_visible:false`.
2. New groups use `group_<domain>`; every group/leaf gets a stable `sort` and lucide icon.
3. Update `createTradingRoles` admin `allowed_routes` to the new id set (root stays `['*']`).

App changes:

4. `app/utils/navTree.ts`: pure, dependency-free selection logic (`selectNavRoutes`, `flattenVisiblePaths`, `navAllows`) — testable without Nuxt.
5. `app/composables/useNavMenu.ts`: use `selectNavRoutes`; honor `isVisible:false` recursively.
6. `app/middleware/auth.global.ts`: `flattenPaths` skips `isVisible:false` nodes so hidden routes behave as before (redirect home, not 404).

Idempotency / safety:

- `seedSystemRoute` upserts by `(app_id,id)` → re-running never duplicates.
- `cleanOldRoutes` deletes ids absent from the new list → replacement groups are removed and their `allowed_routes` references are rewritten in the same run by `seedRole`. No FK constraints on route ids exist; only role JSON.
- Rollback: `git checkout -- scripts/seed/data.ts` (tm-hub) then `pnpm seed:trading`; or `pnpm seed:trading:reset` to rebuild.

## 8. Tests

- `tests/navigation-menu.test.ts`: pure selection logic — local-page filtering, group pruning, `isVisible` hidden recursively, top-level hidden names, `#` groups skipped, `navAllows` membership (exact / `:param` / prefix / root / `*`).
- `tests/nav-contracts.test.ts`: every **visible** leaf registered in the §58.2 tree resolves to a real page file (compatibility contract regression).
- Existing suites must stay green (`npm run test:app`, `npm run test`, `npm run typecheck`, `npm run verify`).

## 9. Slice status

- **Slice 1 (this deliverable)** — audit doc + §58.2 menu presentation + i18n + hidden-route enforcement. Implemented routes only are visible; new trading-domain pages remain hidden with `is_visible:false`.
- Slices 2–5 (Strategy Lab, Test Center, Data Center, AI Research) build the hidden routes into real pages and flip `is_visible` to `true` once their tests pass.
- **Slice 6 — shared-core placement and polish**:
  - **Placement** lives in the Hub seed (`../tm-hub/scripts/seed/data.ts`, `createTradingRoutes`): Media/Inbox/Notifications/Connections/Import/Queues are under **Shared Resources** + **Alerts & Notifications**; users/roles/permissions/apps/routes/configs/data-sources/health/logs/profile/docs/settings under **Administration & System**; utilities under the secondary **Tools** group (last). Leaf ids are stable; only `parent_id`/`sort`/`path` moved (§10).
  - **Validation performed in this repo**: every route seeded visible resolves to a page (`tests/nav-contracts.test.ts`, full target-IA leaf set) and every §58.2 group/leaf label resolves in both locales (`tests/nav-i18n.test.ts`).
  - **Admin visibility** is not local presentation logic: the Hub `GET /api/v1/auth/routes` prunes by `required_permission`/`allowed_routes`, and the sidebar additionally drops `is_visible:false` subtrees and any route without a local page (`app/utils/navTree.ts`), so an unimplemented or unauthorized item never surfaces as a link.
  - **Mobile**: the sidebar collapses under `lg`; the bottom action/info bar (`app/components/nav/BottomNav.vue`) is presentation-only and menu-agnostic, so it needs no per-route change.
  - Active-state highlighting is delegated to Nuxt UI `UNavigationMenu` (`to` on leaves); it has no route-specific local override that the reorg invalidates.
- **Closure evidence (2026-10-11)** — V3.3 §58 slices 1–6 complete. tm-trading: `typecheck` PASS 4/4, `npm test` 2254/0 (16 suites), `test:app` 613/0 (144 suites), `nuxt build` OK. tm-hub placement seed committed (`984b4ca`, `typecheck:seed` exit 0). `docs:check` retains 26 pre-existing failures (missing `market:*`/`indicator:*`/`terminal:*`/`paper:*`/`replay:*`/`research:*` docs), unrelated to §58.
- **§58.10 acceptance verification (2026-10-11)** — the remaining acceptance criteria re-checked against code + live runtime, and locked by `tests/nav-acceptance.test.ts`:
  - **#6 provider health ≠ connections** — `server/api/v1/market-sources/health.get.ts` probes each market venue (`VENUE_IDS`); the generic catalogue stays Hub-backed (`app/pages/shared-resources/connections.vue`). Both are surfaced separately: `app/pages/admin-system/data-sources.vue` (per-venue probes) and `app/pages/admin-system/health.vue` (DB + D9 service heartbeats), via `useSystemHealth()`. The two §4 rows for `/system/data-sources` and `/health` move from **partial** → **implemented**.
  - **#7 distinct entities** — `server/utils/engineModel.ts` maps StrategyProfile/StrategyVersion, BotProfile/BotInstance, Experiment/ExperimentRun, AiProposal, Dataset, Candle, MarketFeed to distinct model files; Bot Profile vs Bot Instance is an explicit contract.
  - **#8 test-run provenance** — `startTestRun` echoes the D1 stamp (engineVersion/paramsHash) + `seriesId`; research arms carry `strategyVersionId` (version ↔ experiment traceability).
  - **#9 AI guardrails** — proposals only; `server/utils/research.ts` persists an experiment doc and "never touches a preset, a profile or the risk gate"; no `ai/*.mjs` writes a strategy version.
  - **#10 idempotent seed** — `seedSystemRoute` upserts by `(app_id,id)`; `cleanOldRoutes` deletes only ids absent from the new list.
  - **#12 evidence** — this section *is* the evidence; no status is marked done without it.
- **Remaining API-backed leaves (2026-10-11)** — the last Markets/Trading-domain stubs with working APIs were implemented and are locked by `tests/nav-acceptance.test.ts`:
  - **`/markets/explorer`** — `app/pages/markets/explorer.vue` + `useMarketCatalog` over `/instruments` (+`/venues`, `/market-sources/health`): search by canonical/native symbol, base/quote, venue; type + status filters; per-venue provider-health dots and an "up/total" availability column; rows deep-link the terminal via `/trading?instrument=<engineSymbol>` (§57.4 B — the terminal reads `route.query.instrument`, falling back to the first served symbol). No second symbol list exists.
  - **`/markets/scanner`** — `app/pages/markets/scanner.vue` + `useMarketScanner` over `/api/v1/intel` (scanner-service mover/flow/accum snapshots) + the Instrument Catalog. `app/utils/scanner.ts:mergeScannerCandidates` is a PURE projection: one symbol-centric candidate row per symbol (union of signals, richest 24h change, de-duped reasons, catalog join by venue-native/engine symbol), no recomputation (D1). Type filter + symbol search; scanner-service heartbeat expiry badge; season/regime-filter shown as CONTEXT only (full regime panel stays on Market Intelligence). Terminal deep-link is regex-guarded (`/^[A-Z0-9]{5,20}$/`) so a mis-scraped native symbol (e.g. non-ASCII `龙虾USDT`) never produces a broken `/trading` route.
  - **`/trading/paper`** — `app/pages/trading/paper.vue` + `usePaperAccounts` over `/paper/accounts/:id` (the §20 server projection) + `/risk/status`: equity/balance/realized/daily/unrealized, notional/margin/free/utilization/max-drawdown, kill-switch (halted + reason) per account, UTC day. Dashboard never recomputes (D1/D12).
  - **`/trading/orders`** — `app/pages/trading/orders.vue` + `usePaperOrders` over `/orders` (+`/orders/:id/cancel`): §17.2 lifecycle list with status/symbol filters and global meta counts; the Cancel action is offered only when the server says `cancelable` and stays compare-and-swap guarded server-side (D14).
  - **`/markets/calendar`** — `app/pages/markets/calendar.vue` + `useMarketCalendar` render the intel `news` event stream (scored, de-duped headlines written by `services/news.mjs`) via the new read-only `/api/v1/news` endpoint (`server/utils/news.ts` mirrors `signals.ts`: engine model + fail-soft `meta.mongo='down'`). `app/utils/calendar.ts` `groupNewsByDay` / `filterNews` are PURE projections (UTC-day buckets newest-first, level + free-text filters) — no re-scoring (D1). The token-unlock window (`regime.unlocks48h`) is surfaced as CONTEXT only; the full regime panel stays on Market Intelligence (§58.6).
  - Gates re-run after these pages: `typecheck` PASS 4/4, `test:app` green, `npm test` green, `nuxt build` OK.

## 10. Route re-home — pages mirror the menu groups (§58.2)

> Follow-up to Slice 1. The sidebar tree (§58.2) and `app/pages` no longer matched, so every page was
> moved under a folder whose name equals its menu group. Leaf **route ids are stable** (compatibility
> contract); only `path` changed. Legacy paths 301-redirect to the new ones.

Folder → URL prefix mapping (`app/pages/<folder>` ↔ menu group):

| menu group | URL prefix | group index page |
|---|---|---|
| Overview | `/` | `app/pages/index.vue` |
| Markets | `/markets` | `app/pages/markets/index.vue` (intel) |
| Trading | `/trading` | `app/pages/trading/index.vue` (terminal) |
| Strategy Lab | `/strategy-lab` | `app/pages/strategy-lab/index.vue` |
| Test Center | `/test-center` | `app/pages/test-center/index.vue` (was `/lab/new`) |
| Data & Research | `/data-research` | `app/pages/data-research/data/index.vue`, `app/pages/data-research/research/index.vue` |
| Alerts & Notifications | `/alerts` | `app/pages/alerts/index.vue` |
| Shared Resources | `/shared-resources` | `app/pages/shared-resources/index.vue` (was `/resources/media`) |
| Administration & System | `/admin-system` | `app/pages/admin-system/index.vue` (was `/administration/users`) |
| Tools (secondary) | `/tools` | `app/pages/tools/index.vue` (host: `app/pages/tools.vue`) |

### Path changes (id unchanged)

| id | old path | new path |
|---|---|---|
| `intel_market` | `/intel` | `/markets` |
| `market_explorer` | `/markets` | `/markets/explorer` |
| `market_scanner` | `/scanner` | `/markets/scanner` |
| `market_calendar` | `/calendar` | `/markets/calendar` |
| `trade_terminal` | `/trade` | `/trading` |
| `intel_signals` | `/signals` | `/trading/signals` |
| `trade_paper` | `/paper` | `/trading/paper` |
| `trade_orders` | `/orders` | `/trading/orders` |
| `exec_positions` | `/positions` | `/trading/positions` |
| `exec_accounts` | `/accounts` | `/trading/accounts` |
| `strat_library` | `/strategies` | `/strategy-lab` |
| `strat_indicators` | `/indicators` | `/strategy-lab/indicators` |
| `strat_methods` | `/methods` | `/strategy-lab/methods` |
| `strat_bot_profiles` | `/bots` | `/strategy-lab/bots` |
| `strat_bot_instances` | `/bots/instances` | `/strategy-lab/bots/instances` |
| `test_new` | `/lab/new` | `/test-center` |
| `research_runs` | `/runs` | `/test-center/runs` |
| `test_forward` | `/forward-tests` | `/test-center/forward` |
| `trade_replay` | `/replay` | `/test-center/replay` |
| `test_compare` | `/runs/compare` | `/test-center/runs/compare` |
| `data_center` | `/data` | `/data-research/data` |
| `data_datasets` | `/data/datasets` | `/data-research/data/datasets` |
| `data_recordings` | `/data/recordings` | `/data-research/data/recordings` |
| `data_quality` | `/data/quality` | `/data-research/data/quality` |
| `data_lineage` | `/data/lineage` | `/data-research/data/lineage` |
| `research_ai` | `/research` | `/data-research/research` |
| `research_experiments` | `/research/experiments` | `/data-research/research/experiments` |
| `research_journal` | `/journal` | `/data-research/journal` |
| `alert_rules` | `/alerts` | `/alerts` (unchanged; now a real rule list — `/alert-rules/**`) |
| `resources_notifications` | `/resources/notifications` | `/alerts/history` |
| `resources_inbox` | `/resources/inbox` | `/alerts/inbox` |
| `resources_media` | `/resources/media` | `/shared-resources` |
| `resources_import` | `/resources/import` | `/shared-resources/import` |
| `resources_connections` | `/resources/connections` | `/shared-resources/connections` |
| `resources_queues` | `/resources/queues` | `/shared-resources/queues` |
| `admin_users` | `/administration/users` | `/admin-system` |
| `admin_roles` | `/administration/roles` | `/admin-system/roles` |
| `admin_permissions` | `/administration/permissions` | `/admin-system/permissions` |
| `admin_apps` | `/administration/apps` | `/admin-system/apps` |
| `admin_routes` | `/administration/routes` | `/admin-system/routes` |
| `admin_configs` | `/administration/configs` | `/admin-system/configs` |
| `admin_logs` | `/administration/logs` | `/admin-system/logs` |
| `system_data_sources` | `/system/data-sources` | `/admin-system/data-sources` |
| `system_health` | `/health` | `/admin-system/health` |
| `system_profile` | `/system/profile` | `/admin-system/profile` |
| `system_docs` | `/system/docs` | `/admin-system/docs` |
| `system_settings` | `/system/settings` | `/admin-system/settings` |
| `utilities_text` | `/utilities/text` | `/tools` |
| `utilities_icons` | `/utilities/icons` | `/tools/icons` |
| `utilities_encode` | `/utilities/encode` | `/tools/encode` |
| `utilities_random` | `/utilities/random` | `/tools/random` |
| `utilities_editor` | `/utilities/editor` | `/tools/editor` |

### Redirects

`server/middleware/legacy-redirect.ts` 301-redirects every legacy prefix above to its new location,
preserving dynamic sub-paths (`/runs/abc` → `/test-center/runs/abc`) and the query string. It is a
Nitro middleware rather than `routeRules.redirect` because route rules cannot re-emit a captured
segment.

- **Collision**: `/markets` — the legacy explorer path and the new Markets index (intel) are the same
  URL, so it is **not** redirected; the new page wins. `/alerts` is unchanged for the same reason.
- **`/utilities/text` precedence**: the old Text-tool page is now the Tools **index** (`/tools`), so an
  exact rule must precede the generic `/utilities` prefix rule — otherwise the prefix rewrite sends it
  to the non-existent `/tools/text`. Guarded by `tests/legacy-redirect.test.ts` (every redirect target
  must resolve to a page file).

### Impact

- `../tm-hub/scripts/seed/data.ts`: `path` values updated, ids unchanged. `createTradingRoles`
  `allowed_routes` uses **ids**, so it needed no change (root stays `['*']`).
- Internal links/hrefs across `app/**` updated to the new paths.
- `tests/nav-contracts.test.ts`: `EXPECTED_VISIBLE_LEAF_PATHS` mirrors the new visible leaves.
- Orphan Import page under `administration/` (byte-identical duplicate of the Shared Resources
  Import page, unreferenced) deleted.
- The old `utilities/index.vue` redirect page removed; the folder was renamed to `tools/`, and
  `/utilities` now redirects via middleware.
