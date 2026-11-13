# TM Trading V5.0 — Central Intelligence Dashboard & Controlled Cleanup

> Date: 2026-11-13 · Repository: tuanjmnh/tm-trading · Target: one web dashboard, Modal/Slideover interactions, independent read/analysis workers.
> This document supersedes older product/UI plans when they conflict. V4.2 service reliability and data integrity requirements remain in force. This is a specification, not proof of implementation.

## 1. Product decision

TM Trading is a single-screen crypto market intelligence and signal research dashboard. Primary goals: observe the market, inspect research events, follow a watchlist, review source-linked news and AI summaries, receive informational alerts, and manage data/AI/notification workers.

Product boundary: information-first and read-only. Do not expose live/demo order placement, amendment/cancellation, private exchange trading credentials, order tickets, portfolio balances, open-position management or autonomous execution. Legacy execution modules must be audited and decommissioned from the active product; do not blindly delete them.

## 2. Repository baseline

Read-only inspection of main on 2026-11-13 found existing modules: app, server, services, engine, market, realtime, ai, notify, shared, exec, simulation, pine, tests, tools and docs. Reuse these; do not create parallel engines, supervisors, data buses, provider registries or overlay systems.

Current route groups include index.vue, operations.vue, markets, news, watchlist, intelligence, outlook, alerts, trading, data-research, ai-agents, admin-system, strategy-lab, test-center and shared-resources. The V4 audit counted 79 page routes at its audit date; recount before migration.

Reusable wrappers already exist: app/components/base/ResponsiveModal.vue and ResponsiveSlideover.vue, plus ConfirmModal.vue and FormModal.vue. Audit feature-level overlays before adding any new library.

Existing runtime foundation includes services/supervisor.mjs, workerHost.mjs, readiness.mjs, workerProbes.mjs, registry.mjs, operationsView.mjs and server/plugins/service-supervisor.ts. V4.2 audits describe Nitro-embedded loops. Use those audits; do not create a second supervisor or run embedded and external copies simultaneously.

Known cleanup candidates from static inspection:
- Root README describes an automated trade desk and references V3.9 while docs index points to V4.2.
- Root AGENTS still describes execution-oriented product scope.
- pnpm-lock.yaml, pnpm-workspace.yaml and pnpm-specific .npmrc coexist with docs that say npm is the package manager. Choose one canonical manager.
- index.vue and operations.vue are large page files; split into panel components.
- app/pages/trading and app/components/trading contain order/position/account/trade-ticket surfaces.
- tools includes tmp-* files and one-off scripts; scan references before removal.
- nuxt.config.ts includes wildcard API CORS and a hard-coded AUTH_JWT_SECRET fallback; replace with explicit allowed origins and fail-closed production secret validation.
- Nuxt uses ssr:false but also contains API/WebSocket behavior; do not assume a static host can host API and persistent workers.

Read before coding: docs/web-app/tm-trading-roadmap-v4.2.md, v4.2-delivery-plan.md, v4-product-scope-audit.md, v4-route-migration-map.md, v4.2-service-inventory.md, v4.2-operations-control-audit.md, v4.2-drills.md, ui-design-system.md, ui-test-findings.md, system-integration-map.md and docs/README.md.

## 3. Single Dashboard information architecture

Main authenticated route: `/`. Keep login and password recovery separate. Global header: product label, symbol search, notification bell, freshness/system health indicators, user menu and one Control Center button. Avoid a large navigation tree.

Dashboard panels:
1. Market Overview: market regime, breadth, BTC/ETH reference changes, key activity metrics, Fear & Greed and active source freshness. Every value needs source and asOf timestamp.
2. Signal Center: central event table with asset, event type, timeframe, descriptive context, deterministic quality, detected time, source, freshness and status. Filters by event category, asset, timeframe, watchlist and freshness. Newest first; paginate/virtualize.
3. Watchlist: selected assets, observed price, 24h change, volume/volatility context, latest event and freshness. Only organize/observe assets; no order controls.
4. Market Pulse: tabs for movers, abnormal volume, volatility, funding observations, OI observations, sourced liquidation observations, top assets and low-liquidity research. Clearly label vendor estimates versus venue-reported data.
5. AI Briefing: evidence-based summary with generated time, time range, source links, input snapshot/version, facts versus interpretation, missing/stale data and provider metadata. AI must not invent values or modify deterministic signals.
6. News & Events: headline, publisher, published/ingested time, topic tags, event category and cluster status.
7. System Health: overall status and concise worker/freshness warnings; detailed logs remain in Control Center.

Use compact tables/lists and restrained KPI strips. One failing panel must not blank the whole Dashboard. No metric is shown as current if its evidence is stale.

## 4. Modal and Slideover standard

Use existing ResponsiveModal for quick edits, short forms, selecting a provider/model, simple alert rules and confirmations. Use ResponsiveSlideover for signal/asset/news/briefing details, service details, provider/data-source configuration and long forms.

Create one typed overlay registry/host with stable names and typed payloads. Only one primary overlay at a time. No modal-on-modal-on-slideover. Include dirty-form guard, loading/disabled states, error retention, focus trap/restoration, Escape/keyboard behavior, accessible labels and mobile fullscreen.

Optional deep links: `/?panel=signal&item=<id>`, `/?panel=asset&symbol=<symbol>`, `/?panel=news&item=<id>`, `/?panel=control&section=services`. Never place secrets/tokens in URLs; validate permissions and show graceful not-found states.

Keep index.vue as a thin composition shell. Split panels into dashboard, signal, intelligence and control-center components. Reuse compatible existing components instead of mass renaming.

## 5. Control Center

One Slideover with tabs:
- Services: desired/observed/readiness state, deployment host, heartbeat, last successful work, output freshness, dependencies, restart count, operation ID, redacted error summary. Controls for data/analysis/notification workers only: start/stop/restart, bounded probe, logs and operations history.
- Data Sources: enablement, capabilities, rate limits, freshness, latency, last success, fallback priority and masked credential presence.
- AI Providers: models, defaults by category, fallback chain, timeouts, retries, usage budget and explicit bounded health test.
- Alerts & Notifications: informational rules, Telegram/sink status, deduplication, delivery attempts and retry history.
- Storage & Retention: usage and retention for market records, signals, news, summaries, logs and operations.
- Application Settings and Diagnostics: safe redacted config, build/Git revision, API/DB/realtime/worker health and correlation IDs.

Service state must be separate:

    Desired: RUNNING | STOPPED
    Observed: STARTING | RUNNING | STOPPING | STOPPED | FAILED | UNKNOWN
    Readiness: READY | DEGRADED | NOT_READY | UNKNOWN

RUNNING means process exists/responds. READY means functional readiness. Market Worker requires provider connected, subscriptions active, first valid event, acceptable freshness, schema quality and functioning output. Scanner must complete a bounded scan and publish a valid result. AI must pass an explicit bounded provider check. Notification requires a valid destination and successful delivery/probe.

Control API returns 202 plus operationId; requires identity and capability; uses idempotency keys; records actor/action/result; enqueues work rather than spawning arbitrary processes. UI waits for observed terminal state. Never use fixed sleep + stale heartbeat as success. One supervisor owns each process group with leases/fencing. Secrets must not be inherited by arbitrary children.

## 6. Backend and deployment

    Browser -> Nuxt SPA -> Read/Control API -> TM Hub + DB + durable inbox
                                      |
                                      +-> SSE/WebSocket or bounded polling
                                                |
                                                v
                             independent Node.js workers:
                             Market / Intelligence / News / AI / Notifications

Browser never accesses DB, worker ports or provider secrets directly. API handlers validate identity, authorization and schemas, read models, enqueue bounded work and return operation IDs. Workers are independent Node processes with graceful shutdown, bounded concurrency, timeout/cancellation, retry with backoff, durable checkpoints, structured logs and readiness probes.

For a personal/free-first deployment: one static frontend, one API/control host, one MongoDB deployment, one Node worker host under one supervisor; object storage/managed queue only when justified. Cloudflare Pages or Vercel can be evaluated for the SPA, but validate Nuxt output and fallback. Do not assume edge/serverless runtimes can host permanent Node workers, Mongoose connections or persistent WebSockets. A personal always-on PC costs no hosting but stops when asleep/offline; free cloud VMs are not guaranteed capacity or uptime. Do not add Redis/microservices without measured need.

Keep TM Hub authoritative for app identity, auth/session, RBAC, route catalog and shared config. TM Trading owns market observations, research events, watchlists, news, AI results, service operations and application-owned delivery records. Avoid duplicate user/role/config collections.

## 7. Evidence/data contracts

Preserve existing engine/signalContract.mjs and stored schema where possible. A research event needs stable ID, owner scope, event type, asset/symbol/timeframe, observedAt, ingestedAt, source/provider/method, status, quality state/reason, evidence values, producer version and data snapshot ID.

Store UTC. Keep observedAt separate from ingestedAt. Keep forming observations separate from confirmed/closed-period observations. Preserve source, input snapshot and version. Never silently rewrite past evidence; mark revisions/invalidations explicitly.

AI is a summarization/research layer, not source of truth. Persist provider/model, prompt version, input snapshot IDs and evidence refs. Separate facts from interpretation and state missing/stale inputs. Never let AI alter deterministic event values or fabricate sources.

Realtime: prefer SSE for one-way updates; use WebSocket only if needed. Include sequence IDs/cursors, reconnect recovery, polling fallback, bounded payloads and coalescing. Do not broadcast raw high-frequency updates for every symbol to every browser.

## 8. Security and cost

P0:
- Remove weak JWT production fallback; required secrets fail closed.
- Replace wildcard CORS with per-environment origin allow-list.
- Provider credentials remain server-only and are masked in UI.
- Redact secrets from logs/errors/diagnostics.
- Capability-based authorization for sensitive actions.
- Audit config and service-control mutations.
- Request IDs, idempotency keys, rate limits and Zod validation.
- Enforce owner/tenant isolation on every query and mutation.
- No credentials in URLs, local storage or source control.

Budget controls: provider timeouts and request budgets, AI usage/output caps, cache reference data, demand-driven subscriptions, bounded retention/logs, quota warnings, graceful degraded state, no retry storms and deduplicated notifications.

## 9. Controlled cleanup phases

Do not perform a giant delete/rewrite commit.

### Phase 0 — Baseline
- Create branch from latest main and record starting SHA.
- Confirm clean git status.
- Inventory files, routes, API endpoints, processes, models/collections.
- Map routes -> composables -> APIs -> services -> collections.
- Run current verification and preserve exact output; record skips.
- Do not use production secrets or claim tests without execution.

### Phase 1 — Scope and docs
- Update README.md, AGENTS.md, .agents/AGENTS.md and docs index to V5.0.
- Preserve V4.2 reliability and data-integrity rules.
- Mark V3.x/V4.2 as historical/technical where appropriate.
- Ensure all agent instructions describe an information-first read-only product.

### Phase 2 — Single Dashboard
- `/` is the only normal workspace.
- Move supported content into Dashboard panels and overlays.
- Hide old menu entries only after content is available in Dashboard.
- Redirect legacy deep links to a supported panel selection where possible.
- Update TM Hub route registry and local guards together.
- Do not delete page files in the first migration pass.

### Phase 3 — Overlay unification
- Audit feature overlays; use common wrappers.
- Add one typed overlay manager.
- Standardize loading, save/cancel, dirty guard, errors and mobile behavior.
- Consolidate duplicate confirm modals only after consumer tests.

### Phase 4 — Retire execution UI
- Remove order-entry actions and account/order/position screens from active UX.
- Do not expose exchange private trading credentials.
- Do not connect the new Dashboard to order submit/amend/cancel APIs.
- Preserve research signals, public market data and evidence.
- Audit exec/, simulation/, trading routes/components and API references before archiving/deleting.

### Phase 5 — Dashboard read model
- Compose panels from existing domain APIs.
- Add one aggregate read model only if needed.
- Normalize loading/empty/stale/partial/error states.
- Keep business logic out of Vue page components.
- Bound request counts and paginate/virtualize rows.

### Phase 6 — Independent services
- Re-read V4.2 service inventory and drills.
- Choose one supervisor; API is command producer, not process spawner.
- Move continuous workers out of Nitro one at a time.
- Use embedded kill switches for cutover.
- Verify readiness/freshness, leases/fencing, graceful stop, recovery and outbox.
- Keep process-guard and one-time bootstrap hooks unless proven obsolete.

### Phase 7 — Data/storage
- Build collection ownership map and reference scan.
- Backup before migrations; use expand/migrate/verify/contract.
- Add indexes from measured query patterns.
- Retain provenance and owner isolation.
- Never drop collections in the same deployment that stops writes.

### Phase 8 — Build/cleanup
- Standardize package manager from lockfile/workspace evidence.
- Remove unused packages only after import/build scan.
- Remove tmp scripts/data only after reference/value checks.
- Keep Pine source parts separate from generated dist if retained.
- Run typecheck, build, unit/integration/browser tests and deployment preview tests.

## 10. File disposition defaults

| Area | Default | Rule |
|---|---|---|
| app/pages/index.vue | REFACTOR | Thin Dashboard composition shell |
| app/pages/operations.vue | MERGE | Move details into Control Center |
| app/pages/markets/* | MERGE | Market Pulse and detail overlays; keep producers |
| app/pages/news/* | MERGE | News & Events; preserve license/dedup logic |
| watchlist/intelligence/outlook/alerts | MERGE | Move into Dashboard/Control Center, preserve records |
| app/pages/admin-system/* | RESTRICT/MERGE | Hub-owned admin stays permission-gated |
| app/pages/trading/* | HIDE/DECOMMISSION | Audit order/account/position UI; preserve research signal view if needed |
| app/components/trading/* | SPLIT | Read-only research vs retired execution UI |
| strategy-lab/test-center | REVIEW | Retain only used research/quality features |
| engine/market/services | KEEP/REFACTOR | Preserve reliable deterministic and data services |
| ai/notify | KEEP/REVIEW | Evidence-based analysis and informational alerts |
| exec/ | QUARANTINE | No active product wiring to execution |
| simulation/ | REVIEW/ARCHIVE | Historical research playback only if useful |
| tools/tmp-* | REVIEW | Archive/delete only after reference scan |
| tests/ | KEEP | Do not delete failing tests to make CI green |
| docs/ | CONSOLIDATE | One current authority; retain historical evidence |

Safe-delete requirements: no imports/string/dynamic references; no route registry/CI/script/deployment references; no tests or fixtures depend on it; no persisted data migration required; deep links have redirects; deletion is documented; rollback exists.

## 11. UI design and performance

Use Nuxt UI v4 and Tailwind v4 already installed unless measured issue justifies replacement. Dark-first professional dashboard, compact restrained surfaces, clear hierarchy, neutral borders, subtle elevation, strong colors only for semantic state. Avoid excessive glow, gradients and oversized KPI cards. Color is never the only status cue.

Desktop: 12-column grid, Signal Center as primary region, details from right. Tablet: two columns where useful, no horizontal overflow. Mobile: single column, fullscreen Slideover, most important table fields first, avoid nested scrolling. Lazy-load noncritical details, cancel closed overlay requests, debounce search, virtualize lists, coalesce realtime events and avoid synchronized duplicate polling.

## 12. Test/acceptance matrix

- Dashboard: initial load, empty, partial failure, stale, refresh, desktop/mobile.
- Signal Center: sort/filter/pagination/dedupe/provenance.
- Signal detail: evidence/source/time/version/invalidation/stale state.
- Watchlist: CRUD, ownership isolation, reorder and empty state.
- AI: source refs, provider failure, timeout, budget, stale inputs.
- News: source link, dedupe, published vs ingested time, license.
- Overlay: one at a time, close/back, dirty guard, error retention, keyboard, mobile.
- Control Center: permissions, accepted vs completed, operation history, audit trail.
- Services: web restart isolation, worker restart isolation, duplicate guard, dependency loss, stale heartbeat.
- Realtime: connect/disconnect/reconnect/cursor recovery/polling fallback.
- Security: CORS, missing secret fail-closed, no secrets in browser/logs, capability checks.
- Deployment: clean build, SPA fallback, API routing, realtime and environment isolation.
- Cleanup: no dangling route/import/test/script/deployment reference.
- Product boundary: no execution UI or order action exposed.

Record exact install/typecheck/test/build/docs/browser/worker-drill/deployment commands and results. Static inspection is not a PASS. Use NOT RUN/BLOCKED/SKIPPED with reasons. Completion requires one Dashboard, one Control Center, common overlays, documented route disposition, correct evidence, independent workers, TM Hub authority, no active execution surface, recorded test/security evidence and aligned README/AGENTS/docs.

## 13. Commit plan

1. docs: establish V5 Dashboard authority
2. chore: record baseline and route inventory
3. refactor(ui): add typed overlay coordinator
4. refactor(ui): compose Dashboard panels
5. refactor(ui): move details into Slideovers
6. refactor(ui): add Control Center
7. refactor(nav): redirect legacy routes and trim menu
8. chore(scope): retire execution UI from active product
9. refactor(runtime): extract first worker from Nitro
10. refactor(runtime): migrate remaining workers
11. fix(security): enforce secret validation and CORS allow-list
12. chore(cleanup): remove verified dead code/dependencies
13. test: add V5 acceptance coverage

Do not combine route rewrite, DB migration, supervisor migration and package-manager change in one commit. Every commit explains changes, preserved behavior, tests, limitations and rollback.

## 14. Coding-agent instructions

Read this file, AGENTS files, V4.2 roadmap/audits/drills, UI findings, package/lockfiles/deployment config, base overlays and TM Hub route registry before editing.

Create evidence-based reports:
- docs/web-app/v5-baseline-inventory.md
- docs/web-app/v5-route-migration-map.md
- docs/web-app/v5-component-disposition.md
- docs/web-app/v5-service-runtime-map.md
- docs/web-app/v5-cleanup-report.md

For each candidate choose KEEP, REFACTOR, MERGE, REDIRECT, HIDE_FROM_NAV, ARCHIVE or DELETE_AFTER_TEST. Every delete needs search/reference evidence and test impact. First deliver a vertical slice: Dashboard shell, Market Overview, Signal Center, Signal Detail Slideover, Control Center entry point and source/freshness/error model. Then migrate Watchlist, News and AI Briefing.

Reuse existing engines/services/providers/TM Hub client. Do not duplicate signal generation or supervisor. Do not break data contracts without migration/adapters. Do not remove tests because a feature is hidden. Remove active execution UI and connectivity from product scope.

Final report must list commit SHA, changed files, Dashboard/overlay architecture, route dispositions, worker migration/readiness evidence, security fixes, exact test results/skips, verified deployment targets, known limitations and rollback. Never claim a deployment/provider/browser/worker test unless actually observed.

## 15. Final definition

TM Trading V5.0 is a single-dashboard market intelligence and signal research application. The user sees important information on one page. A row opens details. Configuration opens a Slideover. A short action opens a Modal. One Control Center manages sources, AI providers, alerts and service health. Nuxt serves the web experience; APIs coordinate requests; independent Node workers collect/process/publish information; TM Hub remains the shared identity and permission layer.

Success is not the number of pages or services. Success is trustworthy information in one place, details that are easy to inspect, and a reliable backend that does not depend on the web request lifecycle.