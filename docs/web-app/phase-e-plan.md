# Phase E plan — real per-user paper runtime

Status: **done (2026-10-20)**. This doc decomposes roadmap §61.17 **Phase E**
("Real per-user paper runtime", `tm-trading-roadmap-v3.6.md`) plus the runtime
contract in §61.7 into independently verifiable steps, mirroring how Phase C
(C1–C5) and Phase D (D1–D6) were split.

## Outcome

All seven steps shipped. Evidence: `npm run test:db` → 138 pass / 0 fail
(sections 11–14 cover lease exclusivity, command idempotency, boot recovery,
guarded instance/session transitions, the signal→alert bridge, and the full
signal→risk→order→fill→position→metrics→session chain with replay dedupe).
Offline contracts: `tests/botSupervisor.test.ts` (21), `tests/botRuntimeStore.test.ts`
(5), `tests/botSignalBridge.test.ts` (11). CLI: `npm run bot:worker`
(`run|status|command|stop`), `npm run bot:status`.

## Deliberate limits (unchanged, documented in code)

- One active instance per `(ownerId, accountId)` — the executor is account-wide,
  so a second start is rejected with `account_busy`.
- A worker restarting with a different supervisor nonce cannot adopt a live
  lease; set a stable `BOT_SUPERVISOR_NONCE` (CLI defaults to `hostname()`).
- Seed instances carry `demo: true` and never appear in operational lists.
- `exec/paper.mjs` accepts `opts.quoteFor` / `opts.fetchKlines` overrides used
  only by the integration test; production keeps the REST path.

## Acceptance (from the roadmap)

> Run an integration scenario through signal -> bot -> risk -> paper order ->
> fill -> position -> account metrics -> session evidence. Restart the worker
> mid-session and prove no duplicate order/fill occurs.

## What already exists (do not rebuild)

- `exec/paper.mjs` — paper executor: `runCycle` / `runAllCycles`, `--watch`
  loop, per-desk sessions, restart recovery (stale actives superseded),
  order-layer idempotency (`clientOrderId(alertKey)`), fill/position/account
  writes, desk halt enforcement, heartbeat to `logs/services.json`.
- `exec/risk.mjs` — Risk Gate (`checkOrder`, `checkModify`,
  `checkPartialClose`, `halt`, `resume`) with reason codes and NDJSON audit.
- `engine/session.mjs` + `engine/models/session.mjs` — guarded session state
  machine, timeline cap, `restartedFrom` recovery chain, `orderKeys` /
  `positionIds` evidence.
- `engine/models/botInstance.mjs` / `botProfile.mjs` — persisted shape only;
  transitions are explicitly owned by a supervisor that does not exist yet.
- `services/signalStore.mjs` + `engine/models/signal.mjs` — idempotent native
  signals keyed by `signalKey` (`ownerId`, `accountId`, attribution).
- `services/workspaceStore.mjs` + `engine/tradingDomainEvents.mjs` — durable
  outbox and canonical UI events (`order.*`, `fill.recorded`, `position.*`,
  `signal.received`).
- `services/heartbeat.mjs` — file heartbeat shared with `/health`.

The gap (from `system-integration-map.md` row 191): **no supervisor**, bot
instances are seed rows only, no command path, no lease/liveness, and native
signals never reach a bot instance.

## Steps

### E1 — Supervisor contract (pure)

`engine/botSupervisor.mjs` (mongoose-free): lifecycle vocabulary and allowed
edges, lease liveness, command validation (owner/account scope, terminal
guards, idempotent `commandId`), boot recovery decisions, heartbeat patch and
`DEGRADED` promotion rules. Roadmap §61.7 states map onto the persisted
`bot_instances` enum without churning it:

| §61.7 | persisted |
|---|---|
| `DRAFT` / `VALIDATING` / `READY` | `queued` |
| `STARTING` | `starting` |
| `RUNNING` | `running` (+ `health: 'ok'`) |
| `DEGRADED` | `running` + `health: 'degraded'` |
| `PAUSED` | `paused` |
| `STOPPING` | `stopping` |
| `STOPPED` / `COMPLETED` | `completed` |
| `FAILED` | `failed` |
| `RETIRED` / kill-switch | `halted` |

Tests: `tests/botSupervisor.test.ts` (offline).

### E2 — Durable command inbox + lease fields

- `engine/models/botCommand.mjs` (new collection `bot_commands`): per-owner
  unique `(ownerId, commandId)`, `instanceId`, `type`, `payload`, `status`
  (`pending` / `applied` / `rejected`), `reasonCode`, `requestedAt`,
  `appliedAt`, `supervisorId`.
- `engine/models/botInstance.mjs` additive fields: `lease` (supervisorId,
  expiresAt, beatAt), `engineVersion`, `subscriptions`, `lastSignalKey`,
  `healthReason`, `demo` marker.
- `services/botRuntimeStore.mjs`: claim/renew/release lease, enqueue command,
  list pending commands, apply/reject atomically, boot recovery scan.

Tests: `engine/test-db.mjs` section (unique command key, conditional lease
claim, terminal command rejection).

### E3 — Supervisor worker + CLI

`services/botWorker.mjs` (pure-ish loop) and `tools/bot-worker.mjs` CLI
(`run`, `status`, `stop`). One logical supervisor per owner (`ownerId` lease);
worker:

- claims instances of its `ownerId` with a live lease,
- applies pending commands before ticking (persist transition, then ack),
- creates/attaches one `live-paper` session per account,
- runs `runCycle` for the owner/account,
- beats both the file heartbeat (`paper`) and the Mongo lease,
- on boot, marks expired-lease `running`/`starting` instances `failed`
  (`lease_expired`) and supersedes their sessions (no duplicate orders),
- exits cleanly on `SIGINT`/`SIGTERM` (`stopping` → `completed`).

### E4 — Signal → bot instance → risk → paper order

`services/botSignalBridge.mjs`: for each running instance subscription,
read native `signals` newer than `lastSignalKey`, map each signal to one ENTRY
intent with deterministic `alertKey`
(`bot_<instanceId>_<signalKey>`), `source: 'bot'`, and `instanceId` /
`strategyVersionId` attribution. The existing paper cycle performs the Risk
Gate and the order/fill/position writes — no second execution path.

Tests: `tests/botSignalBridge.test.ts` (offline mapping/idempotency) and the
integration scenario in `engine/test-db.mjs`.

### E5 — Commands API and ownership re-check

`POST /api/v1/bots/instances/[id]/commands` (start/pause/resume/stop) enqueues
a durable command after a fresh ownership check; `GET` lists command history.
The worker re-checks ownership at execution time (stale/revoked owner cannot
write).

### E6 — Seed/demo separation

Seed rows get `demo: true` + `createdBy: 'seed'`; operational list endpoints
exclude them unless `?demo=1`; the Bots page shows `NOT RUNNING` when no lease
heartbeat exists instead of a seeded `RUNNING`. `scripts/seed-strategy-lab.mjs`
updated accordingly.

### E7 — Integration proof, docs and gates

`engine/test-db.mjs` scenario: signal → bot → risk → order → fill → position →
account metrics → session evidence, then restart the worker mid-session and
assert zero duplicate orders/fills (unique `clientOrderId` + `signalKey`).
Update `implementation-tracker.md`, roadmap Phase E line, and
`system-integration-map.md` row 191.

## Touch points

- `engine/botSupervisor.mjs`, `engine/models/botCommand.mjs`,
  `engine/models/botInstance.mjs`
- `services/botRuntimeStore.mjs`, `services/botWorker.mjs`,
  `services/botSignalBridge.mjs`
- `tools/bot-worker.mjs`
- `server/api/v1/bots/instances/[id]/commands.post.ts` (+ `index.get.ts`)
- `scripts/seed-strategy-lab.mjs`
- `engine/test-db.mjs`, `tests/botSupervisor.test.ts`,
  `tests/botSignalBridge.test.ts`
