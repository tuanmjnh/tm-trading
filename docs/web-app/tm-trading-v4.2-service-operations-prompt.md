# AI Coding Agent Prompt — TM Trading V4.2 Background Services & Operations Reliability

Read the complete `tm-trading-roadmap-v4.2.md`. Preserve V4.1 product direction and treat **Section 17 as mandatory and authoritative** for all background services, their lifecycle, readiness/health, Operations controls and UI loading behavior.

## Mission

Make TM Trading's background services genuinely reliable and controllable. Authorized users must be able to start, stop, restart, reset and probe services from `/operations`; the UI must remain in a truthful loading/progress state until the backend verifies the requested lifecycle outcome. A database flag, PID, process spawn event or button click is not proof of a healthy service.

Keep TM Trading as a Crypto Market Intelligence + AI Research + Alerting app. Preserve TM Hub/shared core, V4.0 compact data-first UI, AI provider gateway, market/news/on-chain/funding/alert services and the small Pine exchange-demo test harness. Do not reintroduce MT5/Exness/Forex/EA scope or build a full trading terminal.

## Non-negotiable rules

1. Audit every current service/process/scheduler/plugin/queue consumer before changes. Do not invent service IDs or claim services are implemented based only on menu rows or seed records.
2. Separate `desiredState`, `observedState`, `health` and `functionalProgress`.
3. A service is `READY` only after its own readiness policy passes. A PID or heartbeat alone is insufficient.
4. A connected market socket with no fresh valid subscribed events is `DEGRADED`/`STALE`, not healthy. A scanner heartbeat without a successful scan is not healthy. An AI worker marked active without successful jobs is not healthy.
5. Start/stop/restart/reset are asynchronous, durable and idempotent. Every request receives an `operationId`; concurrent conflicting operations are serialized/rejected.
6. UI must show loading/progress until `SUCCEEDED`, `FAILED`, `TIMED_OUT` or other terminal outcome. Never optimistically update the service badge from the initial HTTP response.
7. Start success means verified READY. Stop success means worker terminated and lease released. Restart success means stop plus a new instance passing readiness. Reset success means documented reinitialization plus verification.
8. Reset must not delete historical market data, signals, news, AI evidence, datasets, trades, credentials or user configuration. Destructive cleanup is a separate elevated, previewed, backed-up and audited maintenance action.
9. Use TM Hub identity/RBAC and existing core services. Derive owner/scope from server authentication; never trust user-supplied owner IDs.
10. Keep secrets out of status payloads and logs. AI/MCP tools must call the same control API and cannot bypass permissions or service policy.
11. Keep Node.js/TypeScript and current ESM engine. Do not add Redis/BullMQ or a new orchestration platform without an evidence-based ADR.
12. Preserve all existing app behavior; do not commit unless requested.

## Required Phase O0 — Repository and runtime audit

Create `docs/web-app/v4.2-service-inventory.md` and `docs/web-app/v4.2-operations-control-audit.md`.

For each service, record:
- stable service ID, category and scope (`system`/`tenant`/`account`/`session`);
- code entrypoint and actual process/runtime owner;
- embedded Nuxt plugin vs external process vs scheduled job;
- dependencies and consumers;
- current API/control path and UI subscriber;
- heartbeat, lease and readiness implementation;
- last successful useful work and persisted output evidence;
- restart/reset behavior and data-loss risk;
- actual runtime status and whether it is real, partial, seed-only, dev-only or broken.

Inventory market adapters, instrument catalog, scanners, volatility/funding/OI/liquidation collectors, news ingestion, on-chain/sentiment services, evidence/outlook jobs, AI agents, signal engine, Telegram outbox, recorder/dataset workers and Pine demo test runner.

## Required Phase O1 — Lifecycle and service contracts

Implement or consolidate:
- a typed service registry;
- desired vs observed state;
- liveness, readiness and functional-health policies;
- operation records and audit events;
- stable instance identity, lease and heartbeat sequence;
- dependency policy and cycle validation.

Support observed states `STOPPED`, `STARTING`, `INITIALIZING`, `READY`, `DEGRADED`, `STOPPING`, `FAILED`, `UNKNOWN`; health states `HEALTHY`, `WARNING`, `CRITICAL`, `UNKNOWN`. One-shot jobs may use `COMPLETED`.

Provide service-specific readiness checks. Examples:
- exchange feed: connected + subscription acknowledged + fresh valid events;
- scanner: completed recent cycle + input freshness + output evidence;
- news/on-chain/funding workers: recent successful fetch/parse/normalize cycle;
- AI worker: provider capability check + successfully completed validated task;
- Telegram: authenticated bot + valid destination + outbox/last delivery health;
- recorder: storage writable + recent persisted recording evidence.

## Required Phase O2 — Real supervisor and command durability

- Use one authoritative supervisor/control plane. Nuxt must not be the only owner of continuous production work.
- Persist a control command before returning acknowledgement.
- Use `operationId` and idempotency key.
- Implement graceful drain, checkpoint, socket close, lease release and stop verification.
- Restart via controlled stop/start and verify new instance readiness.
- Reset follows a documented service-specific policy; preserve durable history by default.
- Reconcile desired/observed mismatch after crash or supervisor restart.
- Avoid duplicate workers, stale leases and replay of non-idempotent side effects.

Use existing persistence/queue first. Add Redis/BullMQ only if audit proves the existing mechanism cannot meet the required durability/throughput/retry semantics; document the decision.

## Required Phase O3 — APIs and Operations UI

Audit existing routes before adding new ones. Reuse/extend current `/operations` and SSE stream where possible.

Required capabilities:
- list/filter services;
- inspect one service and its readiness/dependencies;
- start, stop, restart, reset, probe and run-once where supported;
- fetch operation history/status;
- receive progress/state updates through authenticated SSE/WebSocket;
- restore in-flight operations through REST after browser refresh/reconnect.

UI requirements:
- service rows show name, scope, desired state, observed state, health, heartbeat age, last successful work, data freshness, backlog/latency and available actions;
- each control shows a spinner and phase text;
- conflicting controls stay disabled during an unresolved operation;
- loading continues through all restart/reset phases;
- state badges update only from server-observed state;
- timeout is displayed as unconfirmed/unknown/degraded, not success;
- detail drawer contains Overview, Activity, Logs, Jobs, Data, sanitized Configuration and Audit;
- destructive reset/cascade actions require confirmation and show impact;
- no service appears HEALTHY solely because a heartbeat or PID exists.

## Required Phase O4 — Roll out incrementally

Start with a low-risk scanner or news worker. Then Telegram outbox, funding/OI, on-chain and market feeds; then AI analysis and signals; finally Pine demo runner. Do not migrate all services at once. Avoid simultaneous old/new consumers that duplicate work.

## Required Phase O5 — Failure drills and verification

Test:
- start from stopped and readiness success;
- spawned process that never becomes ready;
- provider socket connected but no data;
- scanner heartbeat but no output;
- stop while work is active;
- restart/reset with checkpoint and history preservation;
- duplicated/concurrent commands;
- expired lease, worker crash and supervisor restart;
- provider rate limit/auth failure;
- storage outage and queue backlog;
- browser refresh during operation;
- SSE disconnect and REST reconciliation;
- unauthorized cross-tenant/system control;
- Nuxt restart while external worker continues.

For every test capture operation IDs, observed state transitions, timestamps and persisted evidence. Add unit/integration/e2e tests; don't rely only on a screenshot.

## Definition of Done

- Each visible service is backed by a real registered worker/service or explicitly labelled unavailable.
- Start/stop/restart/reset invoke real authorized supervisor operations.
- The UI waits until verified target state or terminal failure/timeout.
- Functional readiness proves fresh inputs and useful persisted outputs.
- Operations survives page refresh and API/supervisor recovery.
- No duplicate worker or duplicate side effects occur.
- Safe restart/reset preserves historical data/configuration.
- TM Hub/core, auth, RBAC, route registry and V4.1 product scope remain intact.
- Documentation describes inventory, dependencies, readiness, reset policy and runbooks.
- Run the repository's established tests, `npm run test:app`, `npm run docs:check`, and `npm run typecheck` in the required order (or report the actual equivalent commands). Include exact output and remaining gaps.

Return a Vietnamese implementation report with modified paths, verified runtime evidence, test results, failed/partial services and follow-up risks. Do not mark a service complete just because a route or database row exists.
