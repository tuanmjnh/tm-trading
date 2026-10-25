# User tenancy plan (ownerId)

Status: **P4 complete (2026-10-19)** — identity plumbing, the trading read/write
slice, every per-user model, compound unique indexes, the strict per-owner
filters, the multi-tenant paper executor and the webhook producer are done;
legacy rows are backfilled (676 owned / 0 unassigned). In-app alerts (the
alert-rules engine writes owner-scoped `alerts` rows) and account
CRUD/switching (create/rename/archive/delete + an account switcher scoping the
orders/positions/fills views) also ship. Still open: the known limitations
below.

## Decisions (locked by the product owner)

1. **Alerts are in-app only.** TradingView is no longer a signal source for this
   app: `server/webhook.mjs` and the `tradingview` source retire, and every
   `alerts` row is created by an authenticated user (the trade ticket, the alert
   rules engine, follow-up closes).
2. **One instance per user.** The paper executor and the periodic services run
   per owner, not as one shared process for everybody.
3. **Scope everything by user.** Including backtest runs — a run belongs to the
   account that started it.

## Identity source

tm-hub is the only identity provider. The client authenticates against the hub
(`POST /api/v1/auth/login`, `GET /api/v1/auth/me`), and the server verifies the
hub JWT **offline** with the shared secret, then stores the payload on the
request context:

- `server/middleware/auth.ts` — verifies every `/api/**` request, enforces that
  the token's `appId` matches this app, and writes `event.context.auth`.
- `server/modules/token/jwt.ts` — the verified claim set:
  `sub, appId, email, name, roles[], permissions[], allowedRoutes[]`.
- `server/utils/request.ts` — `AuthPayload`, the same shape (`requireAuthPayload`
  is available for routes that must re-verify).

**`sub` is the tenant key** and is exposed to routes through
`server/utils/owner.ts` (`requireOwnerId`, `ownerIdOrNull`, `ownerFilter`).

## Two different axes: `ownerId` does NOT replace `account`

| Axis | Meaning | Example |
|---|---|---|
| `ownerId` | the hub user that owns the data (tenant) | `62da4efe-…` |
| `account` / `accountId` | a paper/broker sub-book **inside** one owner | `paper`, `paper-main` |

A user may have several accounts; a user never shares an account with another
user. Keeping the two separate is what lets "many accounts per user" ship later
without a second migration.

## Collection classification

**Per-user (scoped by `ownerId`)** — trading data:

`alerts`, `positions`, `paper_orders`, `paper_fills`, `paper_accounts`,
`risk_state`, `trading_sessions`, `journal`, plus (later) `strategy_profiles`,
`strategy_versions`, `bot_profiles`, `bot_instances`, `alert_rules`, `equity`,
`ai_agents`, `ai_agent_versions`, `ai_agent_actions`, `experiments`,
`experiment_runs`, `ai_proposals`, `evidence_sets`, `indicator_runs`, `runs`.

**Shared / reference (never scoped)** — market and engine data:

`candles`, `datasets`, `market_feed`, `intel`, `trades`, `news_*`, `macro_*`,
`market_events`, `market_outlooks`.

## What this pass changed (P1)

- **`server/utils/owner.ts` (new)** — resolves the tenant from
  `event.context.auth.sub`; `requireOwnerId(event)` throws 401 when absent.
- **Models** (`engine/models/*.mjs`) — added `ownerId` (indexed, nullable) to
  `alert`, `position`, `order`, `fill`, `account`, `riskState`, `session`.
  Nullable keeps legacy rows readable until the backfill runs.
- **Dedupe keys** — `engine/keys.mjs` `alertKey()` now folds `ownerId` into the
  canonical payload **only when present**, so two accounts can place a
  byte-identical order in the same second without one being rejected as a
  duplicate. Pre-tenancy keys (and webhook alerts) stay byte-identical.
- **Writes stamp the owner** — `server/api/v1/orders/index.post.ts` (ticket),
  `server/api/v1/paper/orders/index.post.ts`,
  `server/api/v1/paper/positions/[id]/close.post.ts`.
- **Reads are owner-scoped** — `server/utils/signals.ts`,
  `server/utils/paperOrders.ts`, `server/utils/paperFills.ts`,
  `server/utils/positions.ts`, `server/utils/accounts.ts`,
  `server/utils/paperAccount.ts`; their routes
  (`/api/v1/signals`, `/api/v1/orders`, `/api/v1/fills`, `/api/v1/positions`,
  `/api/v1/accounts`, `/api/v1/paper/accounts*`) pass `requireOwnerId(event)`.
- **Cancel is scoped** — `cancelPaperOrder()` takes `ownerId` in its params, so
  single cancel and `POST /api/v1/orders/cancel-all` can only reach the caller's
  own book (the sweep used to be global).
- **Position actions are scoped** — `server/utils/positionActions.ts`
  (`close`/`modify`, incl. the partial-close child doc) and the two routes
  `server/api/v1/positions/[id].patch.ts` +
  `server/api/v1/positions/[id]/close.post.ts`. A position id from another
  account now reads as 404 instead of being closeable.
- **Risk panel is scoped** — `server/utils/risk.ts` (`loadRiskStatus`) reads the
  day counters, the last-known halt and the open-position count for one owner
  only (`GET /api/v1/risk/status`).
- **Trading sessions are scoped** — `server/utils/sessions.ts`
  (`startSession`/`moveSession`/`logSessionEvent`/`getTradingSession`/
  `listSessions`) and the `server/api/v1/sessions/**` routes.
- **Paper-account bug fixed** — `server/utils/paperAccount.ts` used to read the
  literal account `'default'`, which no writer creates (the executor writes
  `'paper'`), so `/trading/paper` silently fell back to `RISK_EQUITY`. The id
  `'default'` is now a sentinel meaning **"the caller's active account"**
  (newest `paper_accounts` row for the owner, else the account of their most
  recent position), and `GET /api/v1/paper/accounts` lists the owner's real
  accounts instead of one hard-coded row.

Known gaps after P1: `exec/paper.mjs` and `services/run.mjs` still write without
an owner (phase P3), and sessions created through the research flow
(`server/utils/evidenceSets.ts`) have no request context, so they are created
without an owner until P3 threads one through.

## Legacy data

`npm run backfill:owner -- --owner <hub-user-id>` (`scripts/backfill-owner.mjs`)
assigns every row that has no `ownerId` to one account. `--dry-run` reports
without writing; `--only alerts,positions` narrows the collection list. Shared
collections are not touched.

## Phase B — done

- **P2 — index migration done.** Global single-field uniques became compound with
  `ownerId` (no key values re-derived): `alerts.ownerId+alertKey`,
  `positions.ownerId+account+source+externalId`, `paper_orders` ×2,
  `paper_fills.ownerId+fillId`, `paper_accounts.ownerId+accountId`,
  `journal.ownerId+key`, `alert_rules.ownerId+ruleKey`,
  `risk_state.ownerId+account+utcDay`,
  `ai_agent_actions.ownerId+agentId+idempotencyKey`. Old indexes are dropped by
  `syncIndexes()` (`npm run test:db`).
- **P3 — multi-tenant executor + producer done.** `exec/paper.mjs` threads
  `ownerId` through the whole cycle (account row, session, alerts, orders, fills,
  positions, snapshots, risk state) and gained a multi-tenant orchestration:
  `listPaperDesks(m)` enumerates distinct `(ownerId, accountId)` from
  `paper_accounts`, and `runAllCycles()` runs one cycle per desk
  (`--all`, optional `--owner <sub>`). `services/*` only emit the **global**
  `intel` stream; the per-owner fan-out is `services/alertRules.mjs`, which
  already passes `rule.ownerId`. `server/webhook.mjs` (TradingView) stamps the
  configured `WEBHOOK_OWNER_ID` on every `alerts`/`signals` row (unset → null).
- **Filters are now strict.** Every per-user read/write/aggregate includes
  `ownerId`; `scripts/backfill-owner.mjs` was extended with `market_snapshots`,
  `news_evaluations`, `news_evidence_sets`, `equity` and the 637 legacy rows were
  assigned to the single desk owner (676 owned / 0 unassigned).
- **Tests** — `tests/tenancy-isolation.test.ts` pins the seam: doc writers stamp
  the owner, the journal read path never crosses owners, `risk_state` lookups are
  owner-scoped, and `listPaperDesks` enumerates/dedupes desks per owner.

## Known limitations

- **`_id`-keyed collections cannot be owner-scoped without re-keying.** These
  derive `_id` from a global natural key, so two owners would collide on the same
  `_id`: `strategy_versions` (`strategyId@version`), `evidence_sets`
  (`ev_<kind>_<sourceId>`), `ai_agents` (`agentId`), `ai_proposals`,
  `experiments`, `experiment_runs`, `notification_logs` (`notifyId:at`),
  `trade_context`, `news_evidence_sets`, `news_evaluations`. Reads/writes carry
  `ownerId`, but the deterministic `_id` remains a cross-owner collision risk
  until owner-scoped id derivation ships.
- **File-based run series are shared.** `server/utils/reports.ts`
  (`reports/runs.ndjson`, `reports/trades.ndjson`) is a single artifact, not
  per-owner; `runs/index.get.ts` and `runs/[id].get.ts` still serve it as a
  shared view. The Mongo `runs` collection (via `runs/index.post.ts`) *is*
  owner-scoped.
- **Replay is in-memory and process-level.** `replaySessions.ts` filters by the
  `ownerId` it stamped; there is no persistence, and the replay risk-gate owner
  scoping is not yet threaded.
- **`equity` has no production writer** (only `engine/test-db.mjs`); it is a
  read-only projection.

## Phase D — in-app alerts + account management (done)

1. **In-app alerts.** `services/alertRules.mjs` writes a durable, owner-scoped
   `alerts` row per match (`toInAppAlertDoc`, source `alert-rule`), idempotent on
   `{ ownerId, alertKey }`. `action` is deliberately `null`, so a rule signal is
   inert to the paper executor (`exec/paper.mjs` fires only on `action: 'ENTRY'`,
   D7). The Signals view reads the same `alerts` collection, so signals are
   generated in-app without TradingView.
2. **Account CRUD.** `server/utils/paperAccount.ts` exposes
   `createPaperAccount` / `updatePaperAccount` / `deletePaperAccount`, routed at
   `POST` + `PATCH`/`DELETE /api/v1/paper/accounts/:id`. Every filter carries the
   caller's `ownerId`, so a foreign id is a plain `accounts.errNotFound`. A
   rename or delete that would orphan positions/orders/fills/risk rows is refused
   (`accounts.errInUse`) — archive is the safe, reversible alternative, and it
   upserts a seed row so a position-only account can still be archived. The
   multi-tenant executor skips archived desks (`listPaperDesks` filters
   `archived: { $ne: true }`).
3. **Account switcher.** `app/composables/useAccountScope.ts` persists the
   selected account (`tm-account:v1`, with an "All" sentinel) and
   `app/components/trading/AccountSwitcher.vue` renders it. The orders and positions
   views scope their default query to the selection and re-fetch on change;
   `app/pages/trading/accounts.vue` manages the `paper_accounts` specs on top of
   the derived activity grid.
4. **Tests** — `tests/paperAccountCrud.test.ts` pins the guards (owner isolation,
   duplicate, invalid id/currency/balance, "book in use" refusal, rename clash,
   archive upsert), `tests/inAppSignals.test.ts` pins `toInAppAlertDoc`, and
   `tests/tenancy-isolation.test.ts` pins that archived desks are never traded.
