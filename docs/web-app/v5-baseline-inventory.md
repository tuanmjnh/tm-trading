# TM Trading V5.0 — Baseline Inventory & Cleanup Disposition

> Audit date: 2026-11-13  
> Source branch inspected: `main`  
> Target refactor branch: `refactor/central-intelligence-dashboard-v5`  
> Method: read-only GitHub tree/file inspection. No local install, app runtime, browser test, DB query, provider test or test suite was executed. This is a static baseline, not a runtime verification report.

## 1. Audit outcome

The repository is a substantial existing application, not a greenfield project. It already contains a Nuxt 4 SPA, multiple market/research domains, AI provider and briefing modules, market-data services, a service supervisor foundation, a shared Modal/Slideover layer, realtime infrastructure, tests and extensive V4.x documentation.

The safest cleanup is **experience consolidation and lifecycle separation**, not deletion or replacement of the backend. V5.0 should make the Dashboard much simpler while retaining only the backend capabilities required to produce trustworthy information.

### Scope actually inspected

- Repository metadata and root tree.
- `README.md`, `AGENTS.md`, `.agents/AGENTS.md`, `docs/README.md`, `package.json`, `nuxt.config.ts`, `.npmrc`, `.env.example`, `vercel.json`.
- Route-group directory listings for `app/pages`, `app/pages/markets`, `app/pages/trading`, `app/pages/data-research`.
- Directory listings for `server/plugins`, `server/modules`, `server/api`, `services`, `engine`, `exec`, `market`, `realtime`, `simulation`, `shared`, `notify`, `docs/web-app`, `tools`, `pine`, `tests`.
- Existing `ResponsiveModal.vue` and `ResponsiveSlideover.vue`.
- Existing V4.2 roadmap, product scope audit, route migration map, service inventory and operations control audit (selected ranges).

Not inspected exhaustively: every Vue page implementation, every API handler, every dynamic import, all Mongoose models, all Hub routes in the live database, production environment variables, actual deploy settings and current uncommitted working tree.

## 2. Existing architecture map

Top-level domains present on `main`:

| Directory | Observed role | V5.0 disposition |
|---|---|---|
| `app/` | Nuxt 4 SPA, pages, components, composables, layout and auth middleware | REFACTOR presentation to one Dashboard; preserve shared UI/auth |
| `server/` | Nitro APIs, middleware, plugins, route handlers and utilities | KEEP API/control contracts; move continuous work out of Nitro incrementally |
| `services/` | Supervisor, worker host, readiness, scanners, market/news/AI/notification services | KEEP and consolidate process ownership |
| `engine/` | Signal/indicator/evidence/research domain modules and stores | KEEP deterministic research domain after dependency audit |
| `market/` | Market events, clock, quote/orderbook/candle stores, quality and provider integration | KEEP read-only data plane |
| `realtime/` | Event envelope, subscriptions and recovery | KEEP; ensure bounded event delivery |
| `ai/` | Provider gateway, agent/review/research/briefing modules | KEEP useful evidence-based analysis; retire autonomous execution coupling |
| `notify/` | Outbox, router, policy, sender and service | KEEP informational notification path |
| `shared/` | Shared types, utilities, RBAC and stubs | KEEP; avoid duplication of TM Hub-owned data |
| `exec/` | Legacy execution/risk/paper/exchange-demo implementation | QUARANTINE/DECOMMISSION from active V5.0 product; no active order-execution path |
| `simulation/` | Simulation, replay and account/order domain | REVIEW; keep only if it supports non-execution historical research |
| `pine/` | Pine Script source parts and shared definitions | OPTIONAL RESEARCH TOOL; not the product center |
| `tests/` | Extensive unit/integration-oriented test files | KEEP; adjust product-scope expectations, never delete failing tests to make green |
| `tools/` | Build, smoke, typecheck, docs checks, backup, probes and maintenance | KEEP useful tooling; review temporary artifacts |
| `docs/` | V3.x/V4.2 roadmaps, audits, runbooks and indicator specs | CONSOLIDATE authority/index; preserve technical history |

## 3. UI routes found

Top-level page groups observed:

- `app/pages/index.vue` — current Dashboard entry.
- `app/pages/operations.vue` — large Operations page.
- `app/pages/discover.vue`, `intelligence.vue`, `outlook.vue`, `watchlist.vue`, `tools.vue`.
- `app/pages/markets/`: `index.vue`, `calendar.vue`, `coin.vue`, `explorer.vue`, `funding.vue`, `lowcap.vue`, `scanner.vue`, `volatility.vue`.
- `app/pages/trading/`: `index.vue`, `accounts.vue`, `orders.vue`, `paper.vue`, `positions.vue`, `signals.vue`.
- `app/pages/data-research/`: data, research and journal areas.
- `app/pages/news/`: news, events and source-related views (directory contents must be rechecked before migration).
- `app/pages/alerts/`: alert rules/history/inbox areas (recheck exact files before migration).
- `app/pages/ai-agents/`.
- `app/pages/admin-system/`: users/roles/permissions/routes/configs/logs/provider/source/health/Hub areas.
- `app/pages/strategy-lab/`, `app/pages/test-center/`, `app/pages/sessions/`, `app/pages/shared-resources/`.

### Route consolidation target

| Current group | Target | Action |
|---|---|---|
| `index.vue` | Main Dashboard | REFACTOR into shell + panels |
| markets | Market Pulse panel and detail Slideovers | MERGE UX; preserve read APIs/services |
| news | News & Events panel and detail Slideover | MERGE UX; preserve source/license/dedupe contracts |
| watchlist | Watchlist panel | MERGE UX; preserve watchlist data and ownership |
| intelligence/outlook | AI Market Briefing and Intelligence detail | MERGE UX; preserve provenance/history |
| alerts | Control Center → Alerts & Notifications | MERGE UX; preserve alert rules and delivery history |
| operations | Control Center → Services/Diagnostics | MERGE UX; preserve observability |
| admin-system | Control Center → App Settings/Providers; Hub admin remains permission-gated | MERGE/RESTRICT, do not duplicate Hub IAM |
| trading | Research-only signal history where useful; no order/account execution screens | HIDE/DECOMMISSION execution UI |
| data-research | Optional advanced research detail, not a primary navigation workspace | REVIEW; merge key summaries into details |
| strategy-lab/test-center/sessions | Optional research history only | REVIEW; hide from default navigation |
| auth routes | Login/recovery | KEEP as separate routes |

Do not delete a route until there is a replacement, a route-registry update and a verified redirect/deep-link path.

## 4. Existing overlay components

Found:

- `app/components/base/ResponsiveModal.vue`
- `app/components/base/ResponsiveSlideover.vue`
- `app/components/base/ConfirmModal.vue`
- `app/components/base/FormModal.vue`

The responsive wrappers already support open/modelValue state, loading/disabled behavior, dismissible behavior, slot customization and mobile handling. Existing feature-specific overlays exist under AI providers, dashboard, operations, trading, media, roles and routes.

Disposition:

- KEEP the base wrappers.
- Audit existing consumers and unify on them when behavior matches.
- Add one typed overlay coordinator; do not create another overlay library.
- Consolidate feature-level confirm wrappers only after prop/slot behavior and tests are compared.
- Enforce one active primary overlay and dirty-form protection.

## 5. Existing service/runtime inventory (selected)

Files observed under `services/` include:

- Lifecycle/runtime: `supervisor.mjs`, `supervisorStore.mjs`, `workerHost.mjs`, `readiness.mjs`, `workerProbes.mjs`, `registry.mjs`, `operationsView.mjs`, `orchestratorGuard.mjs`, `slo.mjs`, `telemetry.mjs`, `heartbeat.mjs`.
- Market/intelligence: `binance.mjs`, `scanner.mjs`, `funding.mjs`, `liquidation.mjs`, `crossScan.mjs`, `regime.mjs`, `confluence.mjs`, `signalProducer.mjs`, `signalStore.mjs`.
- News: `news.mjs`, `newsEvents.mjs`, `newsExtract.mjs`, `newsReview.mjs`, `newsStore.mjs`.
- AI: `aiAgentWorker.mjs`, `aiReviewWorker.mjs`, `agentHeartbeat.mjs`.
- Notification: `telegram.mjs`, `outboxDrain.mjs`, `outbox/`-related modules under `notify/`.
- Runtime support: `run.mjs`, `store.mjs`, `atomicFile.mjs`, `reconcile.mjs`, `commandInbox.mjs`.

Nitro plugins observed:

- `server/plugins/service-supervisor.ts`
- `server/plugins/bot-runtime.ts`
- `server/plugins/ai-agent-runtime.ts`
- `server/plugins/ai-review-runtime.ts`
- `server/plugins/process-guard.ts`
- `server/plugins/evidence-backfill.ts`
- `server/plugins/news-registry.ts`

Rules:

1. Treat V4.2 service inventory and drills as the technical reference.
2. Do not create a competing supervisor.
3. Do not delete embedded plugins first; migrate a worker, validate external process readiness and then flip its kill switch.
4. Preserve bootstrap/migration hooks and process guard unless audit proves them obsolete.
5. Nuxt restart must not be required for worker lifecycle actions.
6. Functional readiness must include dependency state, successful output and freshness, not PID alone.

Suggested eventual worker groups: Market, Intelligence/Scanner, News, AI and Notification. Group services first; split further only on measured need.

## 6. Security and deployment findings to verify/fix

| Finding from source inspection | Risk | Required action |
|---|---|---|
| `nuxt.config.ts` contains `Access-Control-Allow-Origin: *` for API routes | Broad browser origin access; unsuitable with credentials | Replace with explicit allow-list and test preflight |
| `nuxt.config.ts` uses a hard-coded fallback for `AUTH_JWT_SECRET` | Weak production secret configuration | Fail closed in production; validate secret presence/strength |
| `vercel.json` rewrites all paths to SPA fallback | May conflict with API paths when UI/API split | Test route precedence and deployment target |
| Nuxt configured with `ssr: false` and Nitro WebSocket feature | Static UI deploy does not automatically include API/realtime capability | Separate frontend and API deployment contracts |
| `.npmrc` contains pnpm-oriented settings while agent docs say npm; pnpm lock/workspace are present | Non-deterministic installs and lockfile ambiguity | Inspect CI, package manager version and actual lockfile usage; choose one canonical tool |
| Provider secrets and Hub config are in runtimeConfig/server env | Must remain server-side | Check Nuxt public/private runtimeConfig and logs for leakage |

Do not infer a current secret leak solely from a fallback in source. Inspect runtime configuration and deployment settings before deciding whether rotation is required.

## 7. Temporary/legacy artifact candidates

These paths were visible in the repository tree and need an explicit reference scan:

- `nuxt.config.bak.txt`
- `tools/tmp-bot-create.mjs`
- `tools/tmp-inspect-bot-data.mjs`
- `tools/tmp-params.json`
- `tools/tmp-proposal.json`
- `ai/test.mjs`, `ai/test-review.mjs`, `services/test.mjs`, `engine/test*.mjs` (these may be valid test harnesses; do not treat all `test*` files as temporary)
- Empty `gitkeep` files where directories no longer need placeholders.
- Pine dist outputs if generated and intentionally not tracked.

No deletion is authorized by this inventory alone. Search imports, package scripts, CI, dynamic references, tests and data dependencies first.

## 8. Package manager and build audit

Observed:

- Root `package.json` defines a large script set for Nuxt, Pine, services, AI, tests, drills, backup and typecheck.
- Root tree has `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- `.npmrc` contains `shamefully-hoist` and `only-built-dependencies`, which require package-manager-specific interpretation.
- Existing instructions disagree on npm vs pnpm.

Required:

1. Inspect CI workflows, Vercel/build configuration, developer environment and lockfile history.
2. Choose npm or pnpm; do not remove a lockfile until build reproducibility is proven with the chosen manager.
3. Pin manager/version via `packageManager` in package.json if appropriate.
4. Reinstall from clean checkout and run lockfile verification.
5. Only then prune unused dependencies.

Static review did not run install/build/typecheck/tests. Do not record PASS based on this report.

## 9. File disposition checklist

| Area | Initial status | Next action |
|---|---|---|
| Dashboard `app/pages/index.vue` | REFACTOR | Split into named dashboard panels; keep page thin |
| Operations `app/pages/operations.vue` | MERGE | Place service and diagnostics views into Control Center |
| Market/news/watchlist/intelligence/alerts pages | MERGE UX | Move to panels and Slideovers; keep service APIs/data |
| Admin-system | RESTRICT/MERGE | Hub-owned IAM remains permission-gated; app-level configuration in Control Center |
| Trading pages/components | HIDE/DECOMMISSION | Keep only read-only research content if justified |
| Engine/market/services/AI/notify | KEEP/REFACTOR | Preserve useful signal/data/evidence capabilities |
| Exec/simulation | QUARANTINE/REVIEW | Exclude from active product; archive only after reference/data/test audit |
| Pine | OPTIONAL KEEP | Supporting research tool, not primary UX |
| Tools tmp artifacts | REVIEW | Archive/delete only after scan |
| Tests | KEEP | Fix tests; do not delete assertions to force green |
| Docs | CONSOLIDATE | V5.0 product authority; V4.2 service reliability reference |

A candidate may be deleted only when there are no import/string/dynamic references, no route/CI/script/deployment references, no test/fixture dependency, no data migration requirement, no unresolved deep link, a recorded disposition and a rollback path.

## 10. Reports the implementation agent must produce

- `docs/web-app/v5-baseline-inventory.md` — update this report with the complete inventory.
- `docs/web-app/v5-route-migration-map.md` — every current route, destination panel/overlay, redirect and permission.
- `docs/web-app/v5-component-disposition.md` — each component KEEP/REFACTOR/MERGE/ARCHIVE/DELETE_AFTER_TEST.
- `docs/web-app/v5-service-runtime-map.md` — process, dependencies, owner, output, host, health/readiness and migration step.
- `docs/web-app/v5-cleanup-report.md` — all deleted/archived items with reference/test/data evidence.

## 11. What has and has not been changed in the V5.0 branch

### Documentation branch (commits before the implementation pass)

- Added `docs/web-app/tm-trading-central-dashboard-v5.0.md`.
- Updated root `README.md` product description and V5.0 documentation reference.
- Added V5.0 authority and product boundary to root `AGENTS.md` and `.agents/AGENTS.md`.
- Updated `docs/README.md` to identify V5.0 as product/UI authority and V4.2 as a technical reliability reference.

### Implementation pass (2026-11-13, on `refactor/central-intelligence-dashboard-v5`)

Starting SHA `f8a6edc`. Verified with `pnpm run typecheck` (PASS), `pnpm test`
(18 suites / 2509 pass / 0 fail), `node tests/run-tests.mjs` (1840 tests, 1 pre-existing
skip) and `npx nuxt build` (complete).

**Changed:**

- `app/pages/index.vue` rewritten as a thin Dashboard shell; 12 new components under
  `app/components/dashboard/`; two new composables (`useAppOverlay`, `useDashboardFeed`).
- `i18n/locales/{en,vi}.json` gained the `dash.*` namespace (197 keys each).
- Navigation: `app/utils/navTree.ts` + `app/composables/useNavMenu.ts` hide the groups
  whose content moved to the Dashboard (their pages stay routable).
- Routes: `server/utils/legacy-redirect.ts` now retires `/trading*`, `/trade`,
  `/orders`, `/positions`, `/accounts`, `/paper`, `/signals`, `/intel`, `/scanner` to
  `/`, and sends `/operations` to the Control Center panel.
- Security: wildcard CORS removed from `nuxt.config.ts`; per-origin allow-list in
  `server/middleware/api-guards.ts`; production JWT secret fails closed.
- Package manager: pnpm declared in `package.json`; docs corrected.
- Deleted: `nuxt.config.bak.txt` and four `tools/tmp-*` artifacts (reference-scanned).
- Added reports: `v5-route-migration-map.md`, `v5-component-disposition.md`,
  `v5-service-runtime-map.md`, `v5-cleanup-report.md`.

**Still unchanged / not verified:**

- No collection, index, document or production data was touched.
- No deployment target was modified; worker restart isolation and lease fencing on a
  second host remain unverified (see `v5-service-runtime-map.md` §7).
- No browser acceptance run: this pass had no session against a running app with a live
  Hub login. The build, typecheck and 1840-test app suite are the evidence recorded.
- `exec/` and `simulation/` are untouched; the execution UI is unreachable but present.
- The TM Hub `system_routes` catalog still advertises the hidden groups; trimming it is
  an operator step (route map §6).
