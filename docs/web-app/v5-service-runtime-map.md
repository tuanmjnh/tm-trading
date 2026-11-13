# TM Trading V5.0 — Service Runtime Map

> Implementation date: 2026-11-13 · Branch: `refactor/central-intelligence-dashboard-v5`
> This describes what the code does today. Nothing here was rebuilt in this pass:
> V4.2 already delivered the supervisor, leases, readiness probes and command inbox,
> and V5.0 §6 forbids a second one.

## 1. Ownership model (one supervisor, one process per group)

```text
Browser
  └── Nuxt SPA (/)
        └── Nitro read/control API
              ├── TM Hub (identity, routes, RBAC, shared config)
              ├── MongoDB (market snapshots, signals, news, operations state)
              └── durable command inbox (data/… commands dir)
                        │  (consumed by the supervisor, never by the API)
                        ▼
              services/supervisor.mjs   ← the ONLY process owner
                        ├── market       (market-plane, market-feeds)
                        ├── intelligence (scanner, news, newsExtract, regime, funding, liquidation, confluence, crossScan, macro, retention, reconcile, outlook)
                        ├── signals      (signals, alertRules, outbox-drain, brief)
                        ├── ai           (ai-agent, ai-review)
                        └── bots         (bot-supervisor, demo-runner — outside V5.0 scope)
```

| File | Responsibility |
|---|---|
| `services/registry.mjs` | Declarative definitions: id, label, category, process group, interval, dependencies, required/optional readiness rules, supported actions, `planned`/`supervised` flags |
| `services/supervisor.mjs` | Adopt running workers, reconcile desired state, tick the operation loop, consume the command inbox, keep the instance lease alive, restart with backoff |
| `services/supervisorStore.mjs` | Durable desired/observed state + operation timeline + audit |
| `services/workerHost.mjs` | Worker entry point (`node services/workerHost.mjs <serviceId>`) with graceful shutdown |
| `services/readiness.mjs` | Functional readiness rules (`process-alive`, `dependency-reachable`, `fresh-event`, `recent-success`, `output-produced`, `capability-verified`, `validated-job`, `outbox-consuming`, `sink-writable`) |
| `services/workerProbes.mjs` | Bounded probes that produce the evidence readiness rules read |
| `services/operationsView.mjs` | The read model behind `GET /api/v1/operations/services` |
| `services/commandInbox.mjs` | Durable command files, idempotency keys, quarantine/dead-letter |
| `server/plugins/service-supervisor.ts` | Embedded driver for single-process self-hosting: consumes commands, ticks operations, keeps leases |

## 2. Desired / observed / readiness are three different things

`OperationsServiceRow` (in `shared/types/operations.ts`) carries each separately:

- **Desired**: `RUNNING | STOPPED` — operator intent, durable.
- **Observed**: `STARTING | RUNNING | STOPPING | STOPPED | FAILED | UNKNOWN` — the process.
- **Health / readiness**: `READY | DEGRADED | UNHEALTHY | UNKNOWN` — the functional verdict.

`READY` requires the service's REQUIRED readiness rules to hold. A live PID with no
recent successful cycle is `DEGRADED`, not `READY`. The Dashboard (`SystemHealthStrip`)
and the Control Center both render this verdict — neither derives it from `pid`.

## 3. Embedded vs external (cutover state)

| Surface | Embedded today | Kill switch | Consequence |
|---|---|---|---|
| Service supervisor driver | yes (single-process self-hosting) | `SERVICE_SUPERVISOR_EMBEDDED=off` | With the driver off, nothing consumes control commands; the UI must be pointed at an external `pnpm run services:supervised` |
| First-boot autostart | yes | `SERVICE_SUPERVISOR_AUTOSTART=off` | Autostart only queues `start` for a service the state file has never seen |
| AI agent worker | yes | `AI_AGENT_EMBEDDED=off` | |
| AI review worker | yes | `AI_REVIEW_EMBEDDED=off` | |
| Bot runtime | yes, skipped when `VERCEL` is set | `BOT_EMBEDDED=off` | Outside V5.0 product scope |
| News registry bootstrap, evidence backfill, process guard | yes | n/a | Bootstrap/migration hooks; kept |

Workers run as **separate Node processes** (`workerHost.mjs`). The Nitro `close` hook
deliberately does **not** drain them — a control-plane restart must not restart
collection (that is the `control-plane-restart` drill). `supervisor.adopt()` re-attaches
to surviving PIDs on boot, and a lease prevents a second supervisor from running the
same service.

**Honest limitation:** in the current single-host deployment the supervisor loop is
driven by the Nitro process. That loop is a *driver*, not the worker lifecycle: workers
survive a Nuxt restart, and the loop can be disabled in favour of
`pnpm run services:supervised`. A multi-host deployment (API host + worker host) is
supported by the same supervisor but was **not verified in this pass** — no second host
was provisioned.

## 4. Control path (why the UI cannot fake a state)

1. UI action → `POST /api/v1/operations/services/:serviceId/:action`.
2. The route validates identity, capability and payload, writes an audit-able command
   with an idempotency key and returns `202 { operationId }`.
3. The supervisor consumes the command, performs the action, and records the operation
   state (`QUEUED → RUNNING → SUCCEEDED|FAILED|CANCELLED|UNCONFIRMED`).
4. The UI polls `GET /api/v1/operations/operations/:operationId` until terminal
   (`app/utils/serviceOperation.ts`), then re-reads the view.

There is no fixed sleep and no optimistic badge flip. A timeout ends as `UNCONFIRMED`,
which is surfaced as a warning, not a success.

## 5. Data freshness contract on the Dashboard

| Section | Source | Stale after | UI behaviour |
|---|---|---|---|
| Market overview / pulse | `intel` snapshot (`services/*` written) | 15 min | Tile + panel badge switch to "Stale"; values stay visible but are never labelled current |
| Signal Center (indicator) | `signals` collection (engine / signalProducer) | 24 h (event horizon) | Row freshness badge |
| News & events | `news_items` + market events | 6 h | Panel badge |
| Market briefing | `outlook` store | 24 h | "Stale" badge |
| System health | supervisor view | live read | Overall / per-worker badges |

Thresholds live in `FRESH_MS` (`app/composables/useDashboardFeed.ts`). `missing` means
"no observation timestamp" and is displayed as such, never as fresh.

## 6. Deployment reality

- Web: Nuxt SPA (`ssr: false`) — a static host can serve the shell, but the API and
  WebSocket routes need a Node runtime.
- API/control: Node (`node .output/server/index.mjs`), verified via `nuxt build`.
- Workers: a long-running Node process on a host that does not sleep. Serverless
  platforms (Vercel/Pages Functions) cannot host permanent workers, Mongoose
  connections or persistent WebSockets — the bot runtime already skips itself when
  `VERCEL` is set for that reason.
- Mongo: required for snapshots, signals, news, operations state.

## 7. What still needs operator evidence

Not verified in this pass (no deployment target was touched):

- Worker restart isolation on a real second host.
- Lease fencing under a deliberately duplicated supervisor (the `failure-drills` suite
  exercises the logic, not a live duplicate).
- Freshness behaviour with a genuinely stale provider (requires a provider outage or a
  clock shift).
- Push/Telegram delivery (needs live credentials).
