# Phase C plan — canonical events and UI state propagation

Status: **done (2026-10-19)**. C1–C5 done. This doc decomposes roadmap §61.17 **Phase C**
("Canonical events and UI state propagation", `tm-trading-roadmap-v3.6.md`) into
independently verifiable steps, mirroring how Phase B was split into P1–P4.

## Acceptance (from the roadmap)

> One manual paper order changes the same persisted order/fill/position/account
> state everywhere without manual hard refresh, and restart does not lose the
> update.

## Steps

### C1 — Trading domain-event contract (done)

`engine/tradingDomainEvents.mjs` (pure). The vocabulary, the deterministic
durable id (`tde_<sha1>`), the schema version, the required `ownerId` (tenancy
§61.3), the idempotency key and the view-invalidation map the rest of Phase C
consumes. Mirrors `engine/newsDomainEvents.mjs`, so the trading domain gets the
same "durable event id + schema version + entity ref + occurred/emitted stamps +
idempotency key" contract the news domain already has.

Tests: `tests/tradingDomainEvents.test.ts`.

### C2 — Durable outbox + retry/dead-letter reporting (done)

`engine/models/tradingDomainEvent.mjs` (collection `trading_domain_events`) and
`services/workspaceStore.mjs` (the write side). `publishTradingEvent` /
`emitTradingEvent` upsert on the deterministic `_id` with `$setOnInsert`, so a
re-emit never duplicates a row NOR resets delivery state; `pendingForOwner`
serves the per-owner reconciliation read (undelivered rows never expire);
`markDelivered` / `markFailed` / `outboxStats` are the delivery + dead-letter
reporting. Verified in `engine/test-db.mjs` (section 9).

### C3 — Writers emit events

Wire the existing writers to the outbox via `emitTradingEvent`, all owner-scoped.
Split so the pure/simulation core stays Mongo-free:

**C3a — account + signal writers (done).** The two writers that already own a
Mongo handle publish directly, best-effort (a miss never fails the mutation):

- `server/utils/paperAccount.ts` CRUD → `account.created` / `renamed` /
  `archived` / `unarchived` / `deleted`. Server code reaches the store through a
  `workspaceStore()` resolver in `server/utils/engineModel.ts` (dynamic import
  from `process.cwd()`, same reason as the other engine resolvers), and the
  `models.emit` seam keeps the unit suite off Mongo.
- `services/alertRules.mjs` (the in-app signal write) → `signal.received`.

**C3b — order / fill / position writers (done).** The pure builders
`simulation/order.mjs` (`createPaperOrder`) and `simulation/fills.mjs`
(`buildFillRecord`) stayed dependency-free; the Mongo-owning executor
(`exec/paper.mjs`) publishes through a local `emit()` helper — `order.created`
(only on the first insert), `order.risk-rejected` (gate / bad ladder / fill
refusal), `order.expired` (stale sweep), `order.filled` / `order.partially-filled`,
`fill.recorded`, `position.opened` / `position.updated` / `position.closed` — all
owner-scoped. The store is reached by a runtime `import()` so the offline paper
suite keeps a DB-free import graph, and an ownerless legacy desk publishes
nothing. Pinned by `tests/tradingEventWriters.test.ts`.

### C4 — Shared `TradingWorkspaceContext` + realtime invalidation (done)

- Server: `GET /api/v1/workspace/events` (owner-scoped `pendingForOwner`, returns
  the batch of undelivered events + the union of invalidated view ids) and
  `POST /api/v1/workspace/events/ack` (owner-guarded `markDeliveredForOwner` — a
  caller can never ack another user's rows).
- Client: `app/composables/useTradingWorkspace.ts` — one shared context. It
  drains the outbox on a visibility-aware 5s poll, bumps a per-view version
  counter for events relevant to the selected account (`useAccountScope`), then
  acks the batch. The trade screens (`orders`, `positions`, `accounts`, `paper`,
  `signals`) `watch(workspaceVersion('<view>'), refresh)` — no manual hard
  refresh. Only the per-book views are account-scoped: an order/position/fill for
  another book never reloads `orders`/`positions`, but the `accounts` list (every
  book), the `paper` overview and `signals` always refresh. Pinned by
  `tests/workspaceEvents.test.ts`. Verified live: creating a paper account through
  the API made the open `/trading/accounts` screen show the new row within one
  poll, with no hard refresh.

### C5 — Refresh / empty / stale / error handling (done)

Every standalone trading screen is now honest about its state and shares one
resource-state primitive instead of ad-hoc flags:

- `app/composables/useResourceState.ts` — `run(fn)` owns `loading` / `error` /
  `lastUpdated` and never throws. `hasError` distinguishes a failed load from an
  empty result; `isStale` is true only when a refresh failed while earlier data
  is still on screen (so the failure flags the data, it does not blank it).
- `app/components/shared/RefreshNotice.vue` — a non-blocking stale strip
  (`shrink-0` sibling, so it cannot trigger the flex-height trap) with a retry.
- The five screens (`orders`, `positions`, `accounts`, `paper`, `signals`) use
  the helper: an error state (with retry) replaces the empty state when the load
  failed and there is nothing to show, and the stale strip appears when a refresh
  fails over existing data. Standard locale keys live under `common.*`.
- Acceptance is proven end to end at the durable layer: `engine/test-db.mjs`
  section 9 emits the canonical event set of ONE manual paper order
  (`account.created` → `order.created` → `fill.recorded` → `order.filled` →
  `position.opened`) for a single owner, asserts the union invalidates
  `orders` + `positions` + `accounts`, acks the whole batch, and confirms the
  rows stay durable in Mongo (a restart replays nothing and loses nothing).
  `tests/workspaceEvents.test.ts` pins the client contract (per-view watchers,
  scoped-view rule, resource-state + error/stale surfaces).

## Touch points

- `engine/tradingDomainEvents.mjs`, `engine/newsDomainEvents.mjs` (pattern ref).
- `engine/models/tradingDomainEvent.mjs`, `engine/models/index.mjs`, `engine/test-db.mjs`.
- `services/workspaceStore.mjs`, `services/store.mjs`, `services/run.mjs` (scheduling), `services/alertRules.mjs`.
- `simulation/order.mjs`, `simulation/fills.mjs`, `exec/paper.mjs`.
- `server/utils/engineModel.ts` (workspaceStore resolver), `server/utils/paperAccount.ts`, `server/utils/paperOrders.ts`, `server/utils/paperFills.ts`.
- `server/api/v1/workspace/events.get.ts`, `server/api/v1/workspace/events/ack.post.ts`.
- `app/composables/useTradingWorkspace.ts`, `app/composables/useAccountScope.ts`, `app/composables/useVisibleInterval.ts`.
- `app/composables/useResourceState.ts`, `app/components/shared/RefreshNotice.vue` (C5), `i18n/locales/{en,vi}.json` (`common.*`).
- `tests/tradingDomainEvents.test.ts`, `tests/tradingEventWriters.test.ts`, `tests/workspaceEvents.test.ts`, `tests/paperAccountCrud.test.ts`.
- `app/pages/trading/{orders,positions,accounts,paper,signals}.vue`.
- `docs/web-app/implementation-tracker.md` (Phase C checklist).
