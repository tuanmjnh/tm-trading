# Phase D plan — native signal engine and Pine inventory

Status: **done (2026-10-19)**. D1–D6 all complete and gated. This doc
doc decomposes roadmap §61.17 **Phase D** ("Native signal engine and Pine
inventory", `tm-trading-roadmap-v3.6.md`) into independently verifiable steps,
mirroring how Phase B (P1–P4) and Phase C (C1–C5) were split.

## Acceptance (from the roadmap)

> A fixture or replay bar can deterministically produce a signal whose
> method/indicator/strategy version is queryable; duplicate events do not
> duplicate the signal; script import never executes unvalidated code.

## What already exists (do not rebuild)

- `engine/indicators.mjs` — native indicator registry (`INDICATORS`,
  `calculateIndicator`, each definition carrying an `id` + `version`).
- `engine/methods/` — strategy plugins behind the `analyze(bars, opts) ->
  { events, scores, setups }` contract (`METHOD_CONTRACT`), with
  `engine/methods/all.mjs` as the single registration point.
- `engine/version.mjs` — `ENGINE_VERSION`, `canonicalParams`, `paramsHash`,
  `stableStringify` (the identity layer a signal must reuse, not reinvent).
- `simulation/replay.mjs` — deterministic replay (`normalizeReplayBars`,
  `createReplayPlayer`) and `replay:create` / `replay:run` / `replay:test`.
- `pine/dist/*.pine` — 11 generated scripts; `tools/pine-ref.json` is the lint
  reference.

The gap (from `system-integration-map.md`): signals have **no**
method/indicator/strategy attribution and there is **no internal generator** —
only the TradingView webhook / manual entry. Phase D closes exactly that.

## Steps

### D1 — Signal identity and attribution contract (done)

`engine/signalContract.mjs` (pure, mongoose-free). The vocabulary
(`SIGNAL_EVENT_TYPES`), the contract version, the required attribution
(`method`, `methodVersion`, `strategyVersion`, `engineVersion`, `paramsHash`,
plus a sorted `indicatorRefs` list), and the deterministic durable id
(`signalKey`, `sig_<sha1>`) that makes re-emitting the same bar event
idempotent. Reuses `stableStringify` from `engine/version.mjs` so the key is
order-independent, and includes `ownerId` only when present (same rule as
`engine/keys.mjs alertKey`, so pre-tenancy keys stay identical).

Tests: `tests/signalContract.test.ts` (vocabulary in sync with the persisted
`signal` model, deterministic key, owner-scoped key, missing attribution
rejected).

### D2 — Internal signal generator (done)

`engine/signalEngine.mjs` (pure). One function,
`generateSignals({ bars, method, params, symbol, tf, ownerId, strategyVersion,
engineVersion, indicatorRefs })`, runs the chosen method through the SAME
`analyze()` contract the backtester and replay use (`engine/methods/all.mjs`),
then maps each `events[i]` to an attributed signal via `signalContract`. The
setup plan (`entry`/`sl`/`tp`/`dir`) is copied into `meta` when the method
produced one for that bar. `paramsHash` is computed with `canonicalParams`, so
two equivalent parameter sets never produce two different signal identities.

Tests: `tests/signalEngine.test.ts` (a controlled VSA fixture deterministically
produces `SV` then `ST LONG` with a stable key; a second call is byte-identical
— duplicate events do not duplicate the signal; a method-agnostic stub proves
the mapper is independent of VSA; an unknown event type fails loudly).

### D3 — Idempotent signal persistence (done)

The attribution fields are added to `engine/models/signal.mjs`, with a **partial**
unique index on `(ownerId, signalKey)` (partial so legacy webhook rows, which have
no `signalKey`, are never blocked against each other) plus an index that makes
`attribution.strategyVersion` queryable. `services/signalStore.mjs` writes with
`$setOnInsert` so a duplicate event is a no-op that never resets a row — the same
durable-outbox discipline Phase C used for trading events. Verified in
`engine/test-db.mjs` section 10: a controlled VSA fixture produces two attributed
signals, re-publishing them keeps the row count at two, the version is queryable
by `strategyVersion` and `paramsHash`, another owner gets its own rows, and a
legacy row without a `signalKey` still writes.

### D4 — Pine inventory (done)

`scripts/pine-inventory.mjs` walks `pine/dist/*.pine`, extracts per-script
metadata (Pine `//@version`, indicator vs strategy, input / `alertcondition` /
`plotshape` counts, size, first header comment) and renders
`docs/web-app/pine-inventory.md`. Run `npm run pine:inventory` to regenerate.
Tests: `tests/pineInventory.test.ts` pins the committed report to the actual
files (so an added or edited script without regeneration fails), and guards that
no source file ever `import`s a `.pine` file — a script is treated as data, it is
never executed by the engine.

### D5 — Retire new dependence on the TradingView webhook

Once D2–D3 replacement tests pass, make the native generator the default signal
source for the dashboard and mark `server/webhook.mjs` (`npm run notify`) as a
legacy inbound path in the maps. Historical `alerts` rows are preserved, never
rewritten or deleted.

**Done.** The dashboard now reads engine output directly:

- `server/utils/nativeSignals.ts` + `server/api/v1/signals/native.get.ts` serve
  the attributed rows from collection `signals` (filter
  `{ ownerId, signalKey: { $type: 'string' } }`, so only native — never legacy —
  rows), cursor-paginated on `{ ts: -1, _id: -1 }` and fail-soft when Mongo is
  down.
- `app/composables/useNativeSignals.ts` and
  `app/components/trading/EngineSignalsPanel.vue` render it; the Signals page
  carries a source switch (Webhook (legacy) vs Engine (native)) and the ribbon,
  footer, toolbar and CSV export follow the active source.
- `server/webhook.mjs` carries a **LEGACY INBOUND** banner and keeps `npm run
  notify` working; no file on the native path imports it (`tests/nativeSignals.test.ts`).

### D6 — Representative parity (done)

The compatibility report (`docs/web-app/pine-compatibility.md`) is generated by
`npm run pine:parity`, documenting the coverage of every Pine primitive by the
native engine. Gaps are named and disclosed. Parity tests (`npm run
indicator:parity`) are fully integrated into the verify gate.

## Touch points

- `engine/signalContract.mjs`, `engine/signalEngine.mjs` (new, D1/D2).
- `engine/version.mjs`, `engine/keys.mjs`, `engine/methods/index.mjs`,
  `engine/methods/all.mjs`, `engine/indicators.mjs` (reused).
- `engine/models/signal.mjs`, `services/signalStore.mjs`, `engine/test-db.mjs` (D3).
- `scripts/pine-inventory.mjs`, `docs/web-app/pine-inventory.md` (D4).
- `server/utils/nativeSignals.ts`, `server/api/v1/signals/native.get.ts`,
  `app/composables/useNativeSignals.ts`,
  `app/components/trading/EngineSignalsPanel.vue`, `app/pages/trading/signals.vue`,
  `shared/types/signals.ts`, `i18n/locales/en.json`, `i18n/locales/vi.json` (D5).
- `server/webhook.mjs` (D5, legacy banner only).
- `scripts/pine-parity.mjs`, `docs/web-app/pine-compatibility.md` (D6).
- `tests/signalContract.test.ts`, `tests/signalEngine.test.ts`,
  `tests/signalStore.test.ts`, `tests/pineInventory.test.ts`,
  `tests/nativeSignals.test.ts`, `tests/pineParity.test.ts`.
- `docs/web-app/implementation-tracker.md` (Phase D checklist).
