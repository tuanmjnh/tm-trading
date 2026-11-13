# TM Trading V5.0 — Component Disposition

> Implementation date: 2026-11-13 · Branch: `refactor/central-intelligence-dashboard-v5`
> Scope: `app/components` (127 `.vue` files), `app/composables` (70 `.ts` files),
> `app/pages/index.vue`. Evidence for every DELETE/ARCHIVE claim is a reference scan
> (`grep -r`) plus the test suites named in §6.

## 1. New components (V5.0 Dashboard)

Created under `app/components/dashboard/`. All are lazy-loaded from `app/pages/index.vue`
via the `Lazy` prefix; only the shell is eager.

| Component | Role | Notes |
|---|---|---|
| `MarketOverviewStrip.vue` | Regime, Fear & Greed, BTC/ETH 24h, breadth | Every tile shows source + `asOf`; stale snapshot is labelled |
| `SignalCenterPanel.vue` | Unified event table | Filters (category / freshness / watchlist / search), sort, cursor "load more", mobile cards, empty/loading/error states |
| `WatchlistPanel.vue` | Observe-only symbol list | Add via modal, remove inline, opens Asset detail |
| `AddAssetModal.vue` | Quick edit (Modal, per V5.0 §4) | Validates uppercase symbol, refuses duplicates |
| `MarketPulsePanel.vue` | Movers / top assets / volatility / volume / funding / OI / liquidation / low-liquidity | Tabs inside the panel; venue-reported vs estimate labelled |
| `AiBriefingPanel.vue` | Evidence-linked horizons (short/swing/long) | Labelled "rules-based, not AI-generated" because no AI brief is persisted |
| `NewsEventsPanel.vue` | Headlines + sourced market events | Opens News detail |
| `SystemHealthStrip.vue` | Overall state + 5 worker groups | Uses supervisor readiness, never a PID |
| `SignalDetailSlideover.vue` | Event detail + provenance | Fetches the stored engine record when one exists |
| `AssetDetailSlideover.vue` | Asset quote context + latest events | No invented price: `—` when absent from the snapshot |
| `NewsDetailSlideover.vue` | News item + revision trail | Reads `/api/v1/news/:id?detail=full` |
| `ControlCenterSlideover.vue` | Services / Sources / AI / Alerts / Storage / Settings / Diagnostics | Real command flow (202 → poll terminal state), masked secrets |
| `SymbolSearch.vue` | Header symbol search | Opens the Asset detail slideover; suggestions come from the same snapshot/watchlist (no second symbol list) |

Supporting composables:

| File | Role |
|---|---|
| `app/composables/useAppOverlay.ts` | One typed overlay registry: single primary overlay, typed payloads, dirty guard, query deep links |
| `app/composables/useDashboardFeed.ts` | The Dashboard read model: composes existing APIs, computes freshness, dedupes rows, bounded poll |

## 2. Reused as-is

| Component | Reason |
|---|---|
| `app/components/base/ResponsiveModal.vue`, `ResponsiveSlideover.vue`, `ConfirmModal.vue`, `FormModal.vue` | The V5.0 overlay standard. No second overlay library was added. |
| `app/components/gridList/Index.vue` | Table/grid primitive with mobile cards, sort emit, virtual scroll container |
| `app/components/shared/MetricRibbon.vue` | KPI strip (compact, single row) |
| `app/components/admin/EmptyState.vue` | Empty state used by every panel |
| `app/components/operations/ServiceDetailDrawer.vue`, `ServiceActionButton.vue`, `ServiceSloBadge.vue` | Still used by `/operations` (kept routable) and reusable for the Control Center |
| `app/components/watchlist/ListsTab.vue` | Still used by `/watchlist` (hidden from menu, reachable) |
| `app/components/ai-providers/*` | Provider editing stays on `/admin-system/ai-providers`; the Control Center only lists/tests |

## 3. Merged (behaviour moved, file kept)

| Component / page | Moved into |
|---|---|
| `app/pages/index.vue` (old 1018-line page) | Rewritten as a thin shell (~180 lines); the risk-gate, sessions, proposals and backtest cards it held are removed from the product surface (see §4) |
| `app/pages/operations.vue` (2494 lines) | Control Center → Services/Diagnostics. Page kept, route redirects to the overlay |
| `app/pages/markets/*` views | Market Pulse tabs + Asset detail |
| `app/pages/news/*` views | News & Events panel + News detail |
| `app/pages/watchlist.vue` | Watchlist panel |
| `app/pages/intelligence.vue`, `app/pages/outlook.vue` | Market Briefing panel |
| `app/pages/alerts/*` | Control Center → Alerts (rule editing and delivery history stay on the pages) |

## 4. Removed from the active product surface

| Item | Disposition | Evidence |
|---|---|---|
| Risk-gate / halted-account / paper PnL cards on the Dashboard | REMOVED (not re-wired) | V5.0 §1 product boundary: no portfolio/position/execution views on the active surface. `useRisk()` and `/api/v1/risk/status` still exist for the server-side gate |
| Live bot sessions + AI proposals cards on the Dashboard | REMOVED | V5.0 §1: autonomous execution is not an active-product surface. `/strategy-lab/*` and `/data-research/research` remain routable |
| Backtest runs card on the Dashboard | REMOVED | `/test-center/runs` remains a research page |

## 5. Hidden from navigation (retained)

`DASHBOARD_REPLACED_PREFIXES` (in `app/utils/navTree.ts`) hides: `/markets`, `/news`,
`/watchlist`, `/intelligence`, `/outlook`, `/alerts`, `/operations`, `/discover`.
Their components and pages are untouched.

Execution UI (`app/components/trading/*`, `app/pages/trading/*`) is unreachable because
`/trading*` redirects to `/`. The files are **not deleted** — V5.0 §9 requires a
dependency/data/test review first, and server routes still import `exec/`.

## 6. Delete / archive decisions

Nothing under `app/` was deleted in this pass.

| Candidate | Decision | Reason |
|---|---|---|
| `app/components/trading/*` | ARCHIVE LATER | Still imported by `/trading/*` pages, which remain in the tree for rollback |
| `app/pages/trading/*` | KEEP (unrouted) | Rollback path; deleting now would also orphan `usePaperOrders`, `usePositions`, `useAccounts` |
| `app/components/operations/ServiceDetailDrawer.vue` | KEEP | Used by `/operations` |
| Duplicate confirm wrappers | NOT CONSOLIDATED | Their prop/slot behaviour differs per consumer; V5.0 §3 says consolidate only after consumer tests |

Root-level temporary artifacts that WERE deleted are listed in
`docs/web-app/v5-cleanup-report.md`.

## 7. Verification used for this document

- `pnpm run typecheck` — PASS (server/app/shared/node).
- `node tests/run-tests.mjs` — 1840 tests, 1839 pass, 1 pre-existing skip.
- `pnpm test` — 18 suites, 2509 pass, 0 fail.
- `pnpm run drills` — 7/7 service reliability drills pass.
- `npx nuxt build` — BUILD complete (`.output/`), every panel emitted as its own chunk.
