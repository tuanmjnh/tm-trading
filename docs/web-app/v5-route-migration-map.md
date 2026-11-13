# TM Trading V5.0 — Route Migration Map

> Implementation date: 2026-11-13 · Branch: `refactor/central-intelligence-dashboard-v5`
> Authority: `docs/web-app/tm-trading-central-dashboard-v5.0.md`
> Every row states what a user gets today. A route marked REDIRECT is enforced by
> `server/utils/legacy-redirect.ts` (+ `server/middleware/legacy-redirect.ts`, 301).
> A route marked HIDDEN_FROM_NAV still resolves; it is filtered out of the sidebar by
> `DASHBOARD_REPLACED_PREFIXES` in `app/utils/navTree.ts`.

## 1. Route counts (measured, this branch)

| Surface | Count |
|---|---|
| Nuxt page files under `app/pages` | 87 |
| Nitro API route files under `server/api` | 190 |
| Menu membership | owned by TM Hub `system_routes` (not local) |

The V4 audit counted 79 routes; the tree has since grown. No page file was deleted in
this pass — the V5.0 plan forbids deleting page files before content is available.

## 2. Primary surfaces

| Route | Disposition | Screen / behaviour today |
|---|---|---|
| `/` | **KEEP (rewritten)** | The single Dashboard: System Health strip, Market Overview, Signal Center, Watchlist, Market Pulse, News & Events, Market Briefing, plus one overlay host. |
| `/login` | KEEP | Hub login. |
| `/register`, `/forgot-password`, `/reset-password` | KEEP | Recovery flows. |
| `/operations` | **REDIRECT** → `/?panel=control&section=services` | The Operations page is now the Control Center slideover. |
| `/trading` and `/trading/*` | **REDIRECT** → `/` | Execution workspace (order ticket, orders, positions, paper accounts) retired from the active product. Files kept for audit/rollback. |
| `/trade`, `/orders`, `/positions`, `/accounts`, `/paper` | **REDIRECT** → `/` | Old aliases of the retired execution workspace. |
| `/signals` | **REDIRECT** → `/` | Webhook signal list; the Signal Center owns this read now. |
| `/intel`, `/scanner` | **REDIRECT** → `/` | Market intel / scanner are Dashboard panels (Market Overview, Market Pulse). |

## 3. Groups replaced by a Dashboard panel or overlay

All of these remain **routable** (deep links, advanced inspection, rollback) but are
**hidden from the menu**, because their content is on the Dashboard:

| Group | Primary destination on `/` |
|---|---|
| `/markets` (`index`, `explorer`, `scanner`, `volatility`, `funding`, `lowcap`, `coin`, `calendar`) | Market Pulse tabs + Asset detail slideover |
| `/news` (`index`, `events`, `sources`) | News & Events panel + News detail slideover |
| `/watchlist` | Watchlist panel (+ Add symbol modal) |
| `/intelligence` | Market Briefing panel + News/Events tabs |
| `/outlook` | Market Briefing horizons (short / swing / long) |
| `/alerts` (`index`, `inbox`, `outbox`, `history`) | Control Center → Alerts; page kept for rule editing and delivery history |
| `/operations` | Control Center → Services / Diagnostics (redirect, see §2) |
| `/discover` | Dashboard entry point |

Permission model is unchanged: TM Hub remains the identity/RBAC authority and the
global middleware still requires a token for these paths. Hiding a menu entry does not
grant access and does not revoke it.

## 4. Kept, out of the main menu (advanced / administration)

| Group | Disposition | Reason |
|---|---|---|
| `/admin-system/*` (users, roles, permissions, routes, configs, logs, apps, settings, profile, health, docs, ai-providers, data-sources, hub-integration) | KEEP, permission-gated | Hub-owned IAM and app configuration. Control Center links to these instead of duplicating them. |
| `/data-research/*` (data, research, journal) | KEEP | Research record retention; linked from Control Center → Storage. |
| `/strategy-lab/*`, `/test-center/*` | KEEP | Research/quality tooling retained per V5.0 §10 (`REVIEW`), not part of the Dashboard. |
| `/ai-agents` | KEEP | Agent registry; informational only. |
| `/shared-resources/*`, `/sessions/*`, `/tools*`, `/admin-system/profile/*` | KEEP | Unchanged. |
| `/trading/signals` | **HIDDEN + REDIRECT** | The research signal read survives inside the Signal Center, not as an execution page. |

## 5. Query-state contract (deep links)

| URL | Opens |
|---|---|
| `/?panel=signal&item=<feed-key>` | Signal / observation detail slideover |
| `/?panel=asset&symbol=BTCUSDT` | Asset detail slideover |
| `/?panel=news&item=<news-id>` | News detail slideover |
| `/?panel=control&section=services\|sources\|ai\|alerts\|storage\|settings\|diagnostics` | Control Center slideover on that tab |

Parsing/serialising lives in `app/composables/useAppOverlay.ts` (`overlayFromQuery`,
`overlayToQuery`). Unknown values fall back to a safe default; a missing item renders a
graceful not-found state. No secret, token or credential is ever placed in a URL.

## 6. Still required outside this repository

The TM Hub `system_routes` catalog still advertises the hidden groups. Hiding is
enforced client-side by `DASHBOARD_REPLACED_PREFIXES`, which is deliberate: it keeps
deep links working while the catalog is trimmed. To finish the migration:

1. `cd ../tm-hub && pnpm seed --app=trading` after removing/`is_visible:false`-ing the
   row for every group listed in §3.
2. Re-check `/admin-system/routes` for orphan entries.
3. Remove the corresponding prefix from `DASHBOARD_REPLACED_PREFIXES` only after the
   Hub catalog no longer returns it (otherwise the menu regains the entry).

## 7. Rollback

- Redirects: revert the `/trading*`, `/operations`, `/intel`, `/scanner`, `/signals`
  rows in `server/utils/legacy-redirect.ts`.
- Menu hiding: empty `DASHBOARD_REPLACED_PREFIXES` in `app/utils/navTree.ts`.
- Dashboard: `git revert` the Dashboard commit; the previous `app/pages/index.vue`
  is preserved in history and all panels are additive components.
