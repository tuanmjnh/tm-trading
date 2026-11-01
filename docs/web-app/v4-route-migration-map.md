# V4 Route Migration Map

> **Authority:** `tm-trading-roadmap-v4.2.md` §1 (target IA), §1.1 (navigation rules),
> §10.3 (avoid page proliferation), §16.2 (keep TM Hub), §16.14.
> **Method:** read of `tm-hub/scripts/seed/data.ts` (`createTradingRoutes`, line 595) and a
> read-only query of `system_routes` for `tm-trading_ghfseu` on 2026-10-31. Both agree:
> **72 routes, 71 visible, 11 top-level entries (2 leaves + 9 groups)**.
> **Companion:** `v4-product-scope-audit.md`, `v4.2-service-inventory.md`.

## 1. Why the route registry is the hard constraint

Navigation is **not** derived from the filesystem. It is fetched at runtime from TM Hub:

```
Hub `system_routes` (app_id = tm-trading_ghfseu)
  -> GET /api/v1/apps/:appId/routes
  -> useNavMenu() -> filtered by permission + by "does the page file exist"
```

Three consequences that govern every row below:

1. **Creating a page does not create a menu entry.** A new workspace needs a route row in
   `createTradingRoutes`, then a seed run.
2. **The seed is destructive.** `cleanOldRoutes(appId, currentRouteIds)` in
   `tm-hub/scripts/seed/shared.ts` deletes every `system_routes` row for the app whose `id`
   is not in the seed array. A route added through the Hub admin UI is removed on the next
   `pnpm seed --app=trading`.
3. **Seeding is a production change here.** `resolveSeedContext()` resolves app ids from the
   `apps` table and rewrites `../tm-trading/.env` (`NUXT_PUBLIC_HUB_APP_ID`,
   `AUTH_JWT_SECRET`). The local hub and the deployed hub
   (`https://tm-hub-app.vercel.app`) share Supabase project `gnqvrmaucvzzpgednc`. There is no
   sandbox: a seed run mutates the live route table that the deployed app reads.

**Rule:** every route change is a *paired change*:

| Layer | File | Must change together |
| --- | --- | --- |
| Menu contract | `tm-hub/scripts/seed/data.ts` (`createTradingRoutes`) | route id, path, parent, sort, visibility |
| Page | `app/pages/**` | must resolve, or nav hides the row |
| Local nav contract | `tests/nav-contracts.test.ts` | `EXPECTED_VISIBLE_LEAF_PATHS` mirrors visible leaves by hand |
| Labels | `i18n/locales/en.json`, `i18n/locales/vi.json` | `nav.*` key for the label |
| Deep links | `server/middleware/legacy-redirect.ts` | 301 for every path that moves |

## 2. Target IA (V4.2 §1 + §16.2)

```
PRIMARY MARKET WORKSPACES (6 top-level leaves, no groups)
  Overview                 /
  Discover                 /discover
  Watchlist & Signals      /watchlist
  Intelligence             /intelligence
  Alerts                   /alerts
  Operations               /operations

ADVANCED / RESEARCH (1 group, collapsed by default)
  Strategy Lab             /strategy-lab
  Pine Indicator Tests     /test-center
  Paper & Demo Trading     /trading
  Data & Research          /data-research
  AI Agents                /ai-agents
  Provider / Model Profiles

PLATFORM & ADMINISTRATION (1 group, permission-gated)
  Users / Roles / Routes / Configs / Logs / Health
  Shared Connections / Media / Import / Queues
  Profile / Settings / Docs / Hub Integration

TOOLS (1 group, unchanged, non-primary)
  Text / Icons / Encode / Random / Editor
```

Top-level entries drop from **11 to 9** (6 leaves + 3 groups). Visible leaves drop from
**71 to roughly 55**, because 16 leaves become tabs inside a workspace while keeping their
route rows as deep links.

## 3. Disposition legend

| Code | Meaning | Seed change |
| --- | --- | --- |
| `KEEP` | id + path + page survive unchanged | none |
| `REBUILD` | id + path survive; page is rewritten for the V4 contract | none |
| `TAB` | route row survives as a deep link; the leaf is also reachable as a tab in a workspace | none (UI only) |
| `REGROUP` | id + path survive; only `parent_id`/`sort` change | parent/sort |
| `REDIRECT` | old path 301s to a new path; route row removed or hidden | remove + legacy redirect |
| `HIDE` | row stays but `is_visible: false` until the capability is real | visibility |
| `NEW` | route row does not exist yet; must be added | add row + page + test + i18n |

## 4. Full disposition table (72 routes at the S0 baseline)

The tables below are the **plan** written at S0. Section 4.6 records what actually shipped.

### 4.1 Primary workspaces

| # | Route id | Path | Visible | Page exists | V4 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `home` | `/` | yes | yes | Overview | `REBUILD` — market state now, not a runs board |
| 2 | `operations_center` | `/operations` | yes | yes | Operations | `REBUILD` — control plane (S2) |
| 3 | — | `/discover` | — | — | Discover | `NEW` — id `discover`; absorbs 4 & 6 as tabs |
| 4 | `intel_market` | `/markets` | yes | yes | Discover | `TAB` — default tab; path kept for deep links |
| 5 | `market_explorer` | `/markets/explorer` | yes | yes | Discover | `TAB` — Top Coins filter |
| 6 | `market_scanner` | `/markets/scanner` | yes | yes | Discover | `TAB` — Movers / Volatility |
| 7 | — | `/watchlist` | — | — | Watchlist & Signals | `NEW` — id `watchlist` |
| 8 | `intel_signals` | `/trading/signals` | yes | yes | Watchlist & Signals | `TAB` — Futures Signals tab |
| 9 | `test_forward` | `/test-center/forward` | yes | yes | Watchlist & Signals | `TAB` — Signal History tab |
| 10 | — | `/intelligence` | — | — | Intelligence | `NEW` — id `intelligence` |
| 11 | `intel_news` | `/news` | yes | yes | Intelligence | `TAB` — News & Events default tab |
| 12 | `news_events` | `/news/events` | yes | yes | Intelligence | `TAB` — News & Events |
| 13 | `market_calendar` | `/markets/calendar` | yes | yes | Intelligence | `TAB` — News & Events (macro) |
| 14 | `news_outlook` | `/outlook` | yes | yes | Intelligence | `TAB` — Market Outlook (read-only today) |
| 15 | `alert_rules` | `/alerts` | yes | yes | Alerts | `REBUILD` — tabbed: Rules / Telegram / History |
| 16 | `resources_notifications` | `/alerts/history` | yes | yes | Alerts | `TAB` — Delivery History |
| 17 | `resources_inbox` | `/alerts/inbox` | yes | yes | Alerts | `TAB` — Inbox |

### 4.2 Advanced / Research

| # | Route id | Path | Visible | Page exists | V4 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 18 | `group_strategy_lab` | `#strategy-lab` | yes | n/a | Advanced/Research | `REGROUP` — relabel to Advanced & Research; becomes the single advanced group |
| 19 | `strat_library` | `/strategy-lab` | yes | yes | Advanced | `KEEP` (`SEED_ONLY` data — label it) |
| 20 | `strat_indicators` | `/strategy-lab/indicators` | yes | yes | Advanced | `KEEP` |
| 21 | `strat_methods` | `/strategy-lab/methods` | yes | yes | Advanced | `KEEP` |
| 22 | `strat_bot_profiles` | `/strategy-lab/bots` | yes | yes | Advanced | `KEEP` — absorbs instances as a tab |
| 23 | `strat_bot_instances` | `/strategy-lab/bots/instances` | yes | **no** (`index.vue` missing) | — | `HIDE` — drift; `/strategy-lab/bots/instances/[id]` still resolves detail links |
| 24 | `test_new` | `/test-center` | yes | yes | Advanced | `KEEP` — Pine demo tests |
| 25 | `research_runs` | `/test-center/runs` | yes | yes | Advanced | `KEEP` |
| 26 | `trade_replay` | `/test-center/replay` | yes | yes | Advanced | `KEEP` |
| 27 | `test_compare` | `/test-center/runs/compare` | yes | yes | Advanced | `KEEP` |
| 28 | `test_sessions` | `/sessions` | yes | yes | Advanced | `REGROUP` — path is under `group_test_center` but sits at root; recommend `/test-center/sessions` + `REDIRECT` from `/sessions` |
| 29 | `trade_terminal` | `/trading` | yes | yes | Advanced | `KEEP` — Paper & Demo |
| 30 | `trade_paper` | `/trading/paper` | yes | yes | Advanced | `KEEP` |
| 31 | `trade_orders` | `/trading/orders` | yes | yes | Advanced | `KEEP` |
| 32 | `exec_positions` | `/trading/positions` | yes | yes | Advanced | `KEEP` |
| 33 | `exec_accounts` | `/trading/accounts` | yes | yes | Advanced | `KEEP` |
| 34 | `data_center` | `/data-research/data` | yes | yes | Advanced | `KEEP` |
| 35 | `data_datasets` | `/data-research/data/datasets` | yes | yes | Advanced | `KEEP` |
| 36 | `data_recordings` | `/data-research/data/recordings` | yes | yes | Advanced | `KEEP` |
| 37 | `data_quality` | `/data-research/data/quality` | yes | yes | Advanced | `KEEP` |
| 38 | `data_lineage` | `/data-research/data/lineage` | yes | yes | Advanced | `KEEP` |
| 39 | `research_ai` | `/data-research/research` | yes | yes | Advanced | `KEEP` |
| 40 | `research_experiments` | `/data-research/research/experiments` | yes | yes | Advanced | `KEEP` |
| 41 | `research_journal` | `/data-research/journal` | yes | yes | Advanced | `KEEP` |
| 42 | `research_agents` | `/ai-agents` | yes | yes | Advanced | `KEEP` — AI agent admin |
| 43 | `research_news_impact` | `/data-research/research/news-impact` | yes | yes | — | `HIDE` — page is a static shell with no data binding |
| 44 | `system_ai_providers` | `/admin-system/ai-providers` | yes | yes | Advanced | `REGROUP` — parent moves to Advanced; path kept (roadmap §16.2 lists "Provider / Model Profiles" under Advanced/Research) |

### 4.3 Platform & Administration

| # | Route id | Path | Visible | Page exists | V4 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 45 | `group_shared_resources` | `#shared-resources` | yes | n/a | Platform | `REGROUP` — parent becomes `group_admin_system` or stays nested |
| 46 | `resources_media` | `/shared-resources` | yes | yes | Platform | `KEEP` |
| 47 | `resources_import` | `/shared-resources/import` | yes | yes | Platform | `KEEP` |
| 48 | `resources_connections` | `/shared-resources/connections` | yes | yes | Platform | `KEEP` |
| 49 | `resources_queues` | `/shared-resources/queues` | yes | yes | Platform | `KEEP` |
| 50 | `group_admin_system` | `#admin-system` | yes | n/a | Platform | `REGROUP` — becomes the single Platform & Administration group |
| 51 | `admin_users` | `/admin-system` | yes | yes | Platform | `KEEP` |
| 52 | `admin_roles` | `/admin-system/roles` | yes | yes | Platform | `KEEP` |
| 53 | `admin_permissions` | `/admin-system/permissions` | **no** | yes | Platform | `KEEP` — already hidden |
| 54 | `admin_routes` | `/admin-system/routes` | yes | yes | Platform | `KEEP` |
| 55 | `admin_configs` | `/admin-system/configs` | yes | yes | Platform | `KEEP` |
| 56 | `system_data_sources` | `/admin-system/data-sources` | yes | yes | Operations | `TAB` — market data source health belongs with Operations; path kept |
| 57 | `system_health` | `/admin-system/health` | yes | yes | Operations | `TAB` — link from Operations; path kept |
| 58 | `system_health_enhanced` | `/admin-system/health-enhanced` | yes | **no** | — | `HIDE` — drift; no page file exists |
| 59 | `admin_logs` | `/admin-system/logs` | yes | yes | Platform | `KEEP` |
| 60 | `system_profile` | `/admin-system/profile` | yes | yes | Platform | `KEEP` |
| 61 | `system_docs` | `/admin-system/docs` | yes | yes | Platform | `KEEP` |
| 62 | `system_hub_integration` | `/admin-system/hub-integration` | yes | yes | Platform | `KEEP` |
| 63 | `system_settings` | `/admin-system/settings` | yes | yes | Platform | `KEEP` |

### 4.4 Tools

| # | Route id | Path | Visible | Page exists | V4 | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 64 | `group_tools` | `#tools` | yes | n/a | Tools | `KEEP` — last group |
| 65 | `utilities_text` | `/tools` | yes | yes | Tools | `KEEP` |
| 66 | `utilities_icons` | `/tools/icons` | yes | yes | Tools | `KEEP` |
| 67 | `utilities_encode` | `/tools/encode` | yes | yes | Tools | `KEEP` |
| 68 | `utilities_random` | `/tools/random` | yes | yes | Tools | `KEEP` |
| 69 | `utilities_editor` | `/tools/editor` | yes | yes | Tools | `KEEP` |

### 4.5 Remaining routes (completes the 72)

The tables above cover 66 routes. These six complete the set.

| Route id | Path | Visible | Page exists | V4 | Action |
| --- | --- | --- | --- | --- | --- |
| `news_sources` | `/news/sources` | yes | yes | Intelligence | `HIDE` — source registry is admin detail, reachable from the News tab, not a primary leaf |
| `group_markets` | `#markets` | yes | n/a | — | `REDIRECT` children to Discover, then delete the row |
| `group_trading` | `#trading` | yes | n/a | — | `REGROUP` children under Advanced, then delete the row |
| `group_test_center` | `#test-center` | yes | n/a | — | `REGROUP` children under Advanced, then delete the row |
| `group_data_research` | `#data-research` | yes | n/a | — | `REGROUP` children under Advanced, then delete the row |
| `group_alerts` | `#alerts` | yes | n/a | — | `REDIRECT` children into `/alerts` tabs, then delete the row |

Deleting a group row is safe only after its children have a new `parent_id`; otherwise
`useNavMenu` renders orphaned leaves.

### 4.6 As-delivered state (V4.2 S4 complete)

Verified against the live `system_routes` table (`app_id = 'tm-trading_ghfseu'`) after the
S4d seed run:

| Metric | S0 baseline | After S4d |
| --- | --- | --- |
| seeded rows | 72 | 69 |
| visible rows | 71 | 53 |
| visible leaves | 58 | 49 |
| top-level visible entries | 11 groups | 9 |

Top-level order by `sort`: `home` 0, `operations_center` 1, `discover` 2, `watchlist` 3,
`intelligence` 4, `alert_rules` 5, `group_advanced` 6, `group_admin_system` 7,
`group_tools` 8.

Seven group rows were deleted: `group_markets`, `group_trading`, `group_strategy_lab`
(replaced by `group_advanced`), `group_test_center`, `group_data_research`,
`group_alerts`, and `group_shared_resources` (its children fold into `group_admin_system`).

Three deviations from the plan in §5–§6, all deliberate:

1. **Tabs are hidden, not redirected.** Every route that became a workspace tab
   (`/markets`, `/markets/scanner`, `/markets/explorer`, `/markets/calendar`, `/news`,
   `/news/events`, `/outlook`, `/trading/signals`, `/test-center/forward`,
   `/alerts/history`, `/alerts/inbox`) stays a real page and is seeded with
   `is_visible: false`. Deep links and their query params keep working; a 301 would have
   thrown them away and forced a tab re-selection on every bookmark.
2. **Hidden rows are parentless.** `selectNavRoutes` (`app/utils/navTree.ts`) drops a node
   that has children but no *surviving* children. A hidden tab row left under a visible
   leaf would therefore delete that leaf from the nav, so hidden tab rows are seeded with
   `parent_id: null`.
3. **`/alerts` uses path-based tabs.** The three alert surfaces are independently routable
   pages that each own their `BasePage` (Rules, Delivery History, Inbox), so
   `app/components/alerts/Tabs.vue` navigates between paths instead of `?tab=` — same
   deep-link guarantee, no shell page needed.

## 5. New route rows added (S4 — delivered)

| id | path | label key | icon | parent | permission | status |
| --- | --- | --- | --- | --- | --- | --- |
| `discover` | `/discover` | `nav.discover` | `i-lucide-compass` | null | null | done |
| `watchlist` | `/watchlist` | `nav.watchlist` | `i-lucide-star` | null | null | done |
| `intelligence` | `/intelligence` | `nav.intelligence` | `i-lucide-brain-circuit` | null | null | done |
| `group_advanced` | `#advanced` | `nav.advanced` | `i-lucide-flask-conical` | null | null | done |

`group_advanced` replaced `group_strategy_lab` as the container: same children, new id,
path `#advanced`, sort 6. The old group id is gone from the seed (it was only ever a hash,
never a URL, so no redirect is involved).

## 6. Redirect map (S4) — as delivered: no new redirects

S4 shipped **without** the redirects planned here. Every former leaf is still a real page,
so the seed hides it (`is_visible: false`) and the URL keeps working:

| Former leaf | Still served at | Nav row |
| --- | --- | --- |
| `/markets` | `/markets` (Discover → Market) | hidden |
| `/markets/scanner` | `/markets/scanner` (Discover → Scanner) | hidden |
| `/markets/explorer` | `/markets/explorer` (Discover → Top Coins) | hidden |
| `/markets/calendar` | `/markets/calendar` (Intelligence → Macro Calendar) | hidden |
| `/news` | `/news` (Intelligence → News Desk) | hidden |
| `/news/events` | `/news/events` (Intelligence → Market Events) | hidden |
| `/outlook` | `/outlook` (Intelligence → Market Outlook) | hidden |
| `/trading/signals` | `/trading/signals` (Watchlist → Futures Signals) | hidden |
| `/test-center/forward` | `/test-center/forward` (Watchlist → Signal History) | hidden |
| `/alerts/history` | `/alerts/history` (Alerts → Delivery History) | hidden |
| `/alerts/inbox` | `/alerts/inbox` (Alerts → Inbox) | hidden |

`/news/sources` stays hidden (S4a) and is reachable from the News Desk. The pre-existing
§58.2 re-homes in `server/middleware/legacy-redirect.ts` are untouched, and no rule in that
file matches any path above — all eleven returned `200` (no 301/404) when requested
directly from the running app.

Rationale: a 301 discards the query string and forces the target shell to re-derive which
tab the user meant. Keeping the URL means bookmarks, docs links and the browser back button
all keep working, and the tab strips simply highlight the active tab by path.

**Do not redirect** `/admin-system/*` wholesale: those are Hub-owned deep links that users
and the Hub admin UI both reference. `system_data_sources` and `system_health` were left in
Platform & Administration for the same reason — moving them into `/operations` tabs would
break those deep links for no navigation gain.

## 7. Seed drift to fix before S4

| Drift | Evidence | Fix |
| --- | --- | --- |
| `/admin-system/health-enhanced` visible, no page | `system_health_enhanced` in seed; no page file under `app/pages/admin-system/` | `is_visible: false` (or delete the row) |
| `/strategy-lab/bots/instances` visible, no `index.vue` | only `app/pages/strategy-lab/bots/instances/[id].vue` | `is_visible: false`; keep the detail page |
| `/data-research/research/news-impact` static shell | page has no composable/data binding | `is_visible: false` until bound |
| `/admin-system/permissions` hidden but page exists | `is_visible: false` | intentional; document it |

These four are exactly the class of defect §1.1 forbids: "A visible tab must resolve to a
real, tested API and meaningful empty/error state."

## 8. Ordering — all four steps delivered

1. **S4a** — done: the four drift rows fixed by visibility only (see §7).
2. **S4b** — done: `/discover`, `/watchlist`, `/intelligence` shipped as tab shells that
   *reuse* the existing page components (`app/components/workspace/Shell.vue`), plus the 3
   route rows, i18n namespaces and `nav-contracts` entries; 9 reused leaves hidden.
3. **S4c** — done: `/` rebuilt around market state (regime, sentiment, dominance, risk
   gate) with the backtest totals moved into the runs-card badges; `/alerts` gained the
   path-based tab strip; `MetricRibbon` compacted to a single-row strip; group children
   reparented and `system_ai_providers` moved under Advanced & Research.
4. **S4d** — done: the seven retired group rows deleted, `EXPECTED_VISIBLE_LEAF_PATHS`
   refreshed to the 49 delivered visible leaves.

Every step was a paired change and every step ended with `pnpm seed --app=trading` run
deliberately, after diffing the route list.
