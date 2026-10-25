# Implementation Tracker — V3.6 §61

> **Authority:** roadmap `docs/web-app/tm-trading-roadmap-v3.6.md` §61.17 (implementation
> order) and §61.19 (deliverables). Phase A deliverable.
> **Legend:** `operational` = a user action persists and is re-read from durable records
> on a wired path · `partial` = some steps exist but a required producer/consumer is
> missing or seed-fed · `read-only` = reads real records, no write path · `seed-only` =
> visible data written only by a seed script · `missing` = no code path.
> **Companion:** `system-integration-map.md` (wiring), `data-ownership-map.md` (ownership).
> Audited 2026-10-19 from source; not from runtime observation.

## 1. Feature status

| # | Feature | Page(s) | API | Service/model | Status | Notes |
|---|---|---|---|---|---|---|
| 1 | Paper order entry (manual) | `trading/index`, `trading/orders` | `POST /api/v1/orders`, `POST /api/v1/paper/orders` | `orders.*`, `exec/paper.mjs` | partial (owner-scoped) | persists `paper_orders`/`alerts`; accounting idempotency across restart unproven |
| 2 | Orders list/cancel | `trading/orders` | `GET /api/v1/orders`, `[id]/cancel`, `cancel-all` | `paperOrders.*` | operational (owner-scoped) | polls 10 s; no realtime invalidation |
| 3 | Fills | `trading/orders` | `GET /api/v1/fills` | `paperFills.*` | operational (owner-scoped) | polls 10 s |
| 4 | Positions list/modify/close | `trading/positions` | `GET /api/v1/positions`, `PATCH [id]`, `[id]/close` | `positions.*`, `positionActions.*` | operational (owner-scoped) | live quote enrichment via `livePositions` |
| 5 | Accounts | `trading/accounts` | `GET /api/v1/accounts`, `GET /api/v1/paper/accounts*` | `accounts.*`, `paperAccount.*` | partial (owner-scoped) | read + per-account views; **no CRUD/switch** (Phase B) |
| 6 | Risk status | `trading/index` | `GET /api/v1/risk/status` | `risk.loadRiskStatus` | operational (owner-scoped) | reads `risk_state`/`positions` |
| 7 | Signals | `trading/signals` | `GET /api/v1/signals` | `signals.listSignals` | read-only (owner-scoped) | no attribution to strategy/method version; no internal generator |
| 8 | Alert rules | `alerts/index` | `GET/POST/PATCH/DELETE /api/v1/alert-rules` | `alertRules.*` | operational (owner-scoped) | CRUD scoped to `ownerId`; `alertRules.mjs` passes `rule.ownerId` |
| 9 | Alert inbox/history | `alerts/inbox`, `alerts/history` | `GET /api/v1/signals` | `signals` | read-only | — |
| 10 | Journal | `data-research/journal` | `GET /api/v1/journal` | `journal.*` | read-only (owner-scoped) | `filterJournal`/`journalQuery` keyed by `ownerId` |
| 11 | Sessions timeline | `sessions/index`, `[id]` | `/api/v1/sessions*` | `sessions.*` | partial (owner-scoped) | CRUD + move/events exist; **no real runtime feeds them** |
| 12 | Strategy Lab — profiles/versions | `strategy-lab/*` | `/api/v1/strategies*` | `engineModel`, `strategyService.mjs` | seed-only | registry/backtest observability is real; profiles/versions are seeded |
| 13 | Bots — profiles/instances | `strategy-lab/bots/*` | `/api/v1/bots/*` | `engineModel` | seed-only | instances are seed rows; a `state:'running'` row has no worker (§61.7 violation) |
| 14 | AI agents | `ai-agents/index` | `/api/v1/ai-agents*` | `aiAgents.*` | partial (owner-scoped) | lifecycle endpoints + utils scoped per owner; no supervisor |
| 15 | Runs / backtests | `test-center/runs/*` | `/api/v1/runs*` | `reports.*`, `testRuns.*`, `engine/store.mjs` | partial (owner-scoped) | Mongo `runs` owner-scoped; `reports/*.ndjson` series still shared (limitation) |
| 16 | Replay | `test-center/replay` | `/api/v1/replay/sessions*` | `replaySessions.*`, `replayBroker.*` | partial (owner-scoped) | in-memory process-level; filtered by stamped `ownerId` |
| 17 | Forward test | `test-center/forward` | polling | `signals` | read-only | polls 15 s |
| 18 | Indicators catalog | `strategy-lab/indicators/*` | `/api/v1/indicators*` | `indicators.*` | read-only (global) | registry-backed |
| 19 | Indicator runs | — | `/api/v1/indicator-runs*` | `indicators.*`, `methods.*` | partial (owner-scoped) | computes on demand; runs saved/loaded per owner |
| 20 | Methods | `strategy-lab/methods` | `/api/v1/methods*` | `methods.*` | read-only (global) | — |
| 21 | Research experiments | `data-research/research/experiments/*` | `/api/v1/research/experiments*` | `research.*` | partial (owner-scoped) | CRUD/run/decide scoped per owner |
| 22 | Evidence sets / export | `data-research/research/evidence/*` | `/api/v1/research/evidence-sets*` | `evidenceSets.*`, `evidenceExport.*` | partial (owner-scoped) | scoped per owner; export is pure |
| 23 | News | `news/*` | `/api/v1/news*` | `newsStore.*` | operational (global) | ingestion via `services/news.mjs` |
| 24 | Outlook | `outlook` | `/api/v1/outlook*` | `newsStore.*` | read-only (global) | — |
| 25 | Macro calendar | `markets/calendar` | `/api/v1/calendar*` | `macroCalendar.*` | read-only (global) | — |
| 26 | Market explorer/scanner | `markets/*` | `/api/v1/markets/*`, `intel/*` | `marketRest.*`, `intel.*` | operational (global) | hot stores + providers |
| 27 | Data center | `data-research/data/*` | `/api/v1/data/*` | `dataCenter.*` | read-only (global) | — |
| 28 | Realtime market stream | `trading/index` | `ws://…/ws/market` | `realtime-hub.*`, `market/*` | operational (global) | `useMarketStream.ts`; `/ws/v3` unused by UI |
| 29 | Per-user bot runtime | — | — | — | **missing** | §61.7 |
| 30 | Canonical domain events / outbox | — | — | — | **missing** | §61.4 |
| 31 | Trading workspace context | — | — | — | **missing** | §61.5; only `useTerminalPrefs` (localStorage) |
| 32 | AI provider gateway | — | `/api/v1/ai/*` (agents only) | `ai/gateway.mjs` | partial | gateway/agent/review exist; no provider CRUD/models/usage endpoints |
| 33 | Contextual in-module assistant | — | — | — | **missing** | §61.12 |
| 34 | MCP tool server | — | — | — | **missing** | no MCP code in repo (§61.19 item 8) |
| 35 | Pine import/runtime | `strategy-lab/indicators/*` | — | `tools/build.mjs` → `pine/dist/*.pine` | partial | 11 built artifacts; no import/runtime execution |

## 2. Vertical slice acceptance state (§61.1)

`market → candle → indicator → strategy → signal(+evidence) → bot → risk → paper → order/fill/position/PnL → session/journal → AI → research`

| Stage | State |
|---|---|
| market → candle | partial (in-process bus, not persisted per owner) |
| candle → indicator/strategy | partial (engine/method plugins exist, no driving service) |
| → persisted attributed signal | **missing** |
| signal → bot decision | **missing** (no runtime) |
| bot → risk → paper | partial (gate + executor exist, not bot-driven) |
| → accounting | partial |
| → session timeline/journal | partial |
| → AI analysis of stored facts | missing |
| → research links to versions | partial |

## 3. Phase checklist (§61.17)

- [x] **Phase A** — repository truth and architecture map *(this doc + `system-integration-map.md` + `data-ownership-map.md`)*
- [x] **Phase B** — complete tenant and multi-account foundation *(ownerId on all per-user models, compound unique indexes, strict per-owner filters, multi-tenant paper executor + webhook producer, 637-row backfill applied; account CRUD/switching and in-app alerts shipped — see the "Phase D" section of `user-tenancy-plan.md`)*
- [x] **Phase C** — canonical events and UI state propagation *(done — C1 contract + C2 durable outbox + C3 writers + C4 workspace invalidation (server endpoint + `useTradingWorkspace`) + C5 honest screen state (`useResourceState` + `RefreshNotice`) and the single-order acceptance test; steps in `phase-c-plan.md`)*
- [x] **Phase D** — native signal engine and Pine inventory *(done — D1 signal identity/attribution contract + D2 internal generator + D3 idempotent persistence (partial unique index + `signals` store) + D4 Pine inventory report + D5 native read path (source switch on the Signals page; webhook marked legacy inbound, historical `alerts` preserved) + D6 compatibility report / parity matrix with the runtime/port decision (`pine-compatibility.md`); steps in `phase-d-plan.md`)*
- [x] **Phase E** — real per-user paper runtime *(done — E1 supervisor contract (`engine/botSupervisor.mjs`) + E2 durable owner lease and `bot_commands` inbox (`services/botRuntimeStore.mjs`) + E3 worker/CLI (`services/botWorker.mjs`, `tools/bot-worker.mjs`) + E4 native signal → `source:'bot'` alert bridge + E5 commands API with a fresh ownership check + E6 demo separation (`demo:true`, excluded from operational lists) + E7 signal→risk→order→fill→position→metrics→session evidence and restart-no-duplicate in `engine/test-db.mjs` sections 11–14; steps in `phase-e-plan.md`)*
- [x] **Phase F** — evidence storage and research feedback *(done — F1 versioned manifests (ngine/manifest.mjs, sessions/runs) + F2 evidence links/graph (ngine/evidenceGraph.mjs, GET /api/v1/sessions/[id]/evidence) + F3 advisory AI analysis (POST /api/v1/sessions/[id]/analysis, citations verified against the graph) + F4 strict point-in-time (ngine/pointInTime.mjs) and independentArms baseline guard + F5 offline suites and ngine/test-db.mjs §15 (156 checks, 0 fail); steps in phase-f-plan.md)*
- [ ] **Phase G** — AI provider gateway *(in progress — D35 app-owned connections: catalog/redaction/fallback in `engine/aiProviders.mjs`, AES-GCM in `engine/aiProviderCrypto.mjs`, owner-scoped store + health in `ai/providerStore.mjs`, redacted API `/api/v1/ai/providers*`, settings UI, provider audit, JSON import/export (FreeLLMAPI + tm-trading) with dry-run preview, model discovery for unsaved credentials, per-user `sessionAnalysis` resolver (system/CLI services use global env by design), `engine/test-db.mjs` §16; Google AI (Gemini) verified live — chat + agent tool loop, with the Gemini `thought_signature`/`extra_content` passthrough in `ai/gateway.mjs`; structured-output exercise and other real deployments remain; see `docs/web-app/phase-g-plan.md` and `adr-ai-providers-local-first.md`)*
- [ ] **Phase H** — contextual in-module assistant
- [ ] **Phase I** — MCP tool server

## 4. Seed-only data to separate (§61.19 item 3)

`strategy_profiles`, `strategy_versions`, `bot_profiles`, `bot_instances`,
`paper_accounts` written by `scripts/seed-strategy-lab.mjs` with `createdBy:'seed'`.
These must not appear in operational lists without an explicit "Demo data" filter, and
no `bot_instances` row may be reported as `running` unless a persisted heartbeat exists
(§61.7).
