# Operations Guide

This chapter is for whoever keeps TM Trading running: how to see whether the
background work is alive, how to run it, how to read the heartbeat, and what the
current control plane can and cannot do.

> **Read this first:** the **production** control plane is still the manual one.
> Most continuous work runs inside the Nuxt/Nitro process or is started by hand
> with `npm run services`, so the honest statement for daily operations remains:
> *the web app and the background work have independent lifecycles that nobody
> owns.*
>
> A real supervisor now exists (V4.2 **S1.3**, see section 9) and is driven from
> the terminal, but it is **not yet wired into the dashboard or the web
> process**. The `/operations` page and `npm run services` still read the
> heartbeat file described below. When S2 lands, this chapter is rewritten around
> the control plane.

---

## 1. The two ways background work runs

| Mode | Command | Lifetime | Used for |
| --- | --- | --- | --- |
| Manual orchestrator | `npm run services` | Until you stop the terminal | The 14 periodic services |
| Embedded in Nitro | `npm run dev` / `npm run preview` | As long as the web process lives | Bot supervisor, AI agent, AI review |

They are independent. Nothing prevents both from running. The only overlap
protection is the bot lease.

### 1.0 One owner per service (V4.2 S3)

There are two runtimes that can execute the periodic work: the **legacy
orchestrator** (`npm run services`, timers inside one process) and the
**supervisor** (`npm run services:supervised`, one child process per service).
Running both for the same service means duplicate Telegram alerts and duplicate
writes, so as of V4.2 S3 the legacy orchestrator **checks the supervisor's leases**
and skips any service a live supervisor owns:

```
[guard] SKIP news: supervisor lease held by host:1234 (expires 2026-10-31T12:45:00.000Z)
```

It re-checks every cycle (a supervisor may take a service over after the
orchestrator started) and `npm run services:once` exits non-zero when it ran
nothing. `SERVICES_ALLOW_OVERLAP=1` forces the overlap for a deliberate one-off —
you will get duplicate work.

Migration is per service and one-way: watch the Service control plane table, then
take the service off the legacy orchestrator. Never flip both back on.

### 1.1 The 14 periodic services

`npm run services` runs these on their own intervals:

| Service | Default interval | Produces |
| --- | --- | --- |
| `scanner` | 15 min | movers, volatility |
| `funding` | 15 min | funding rate, open interest |
| `news` | 10 min | news items, source health |
| `regime` | 60 min | market regime |
| `liquidation` | 15 min | liquidation estimates + WS events |
| `confluence` | 24 h | method confluence |
| `brief` | 60 min (window-gated) | AI daily brief / outlook |
| `retention` | 6 h | prunes expired data |
| `reconcile` | 6 h | dataset quality flags |
| `crossScan` | 4 h | cross-venue spread/funding/OI |
| `alertRules` | 5 min | evaluates alert rules |
| `macro` | 6 h | FRED macro series |
| `newsExtract` | 24 h | LLM extraction of news |
| `signals` | 1 min | native futures signals |

Intervals are overridable per service with the matching `*_INTERVAL` environment
variable. The orchestrator records the interval it actually used in the heartbeat,
so the UI never guesses.

### 1.2 The embedded loops

| Loop | Interval | Disable with |
| --- | --- | --- |
| Bot supervisor | 15 s | `BOT_EMBEDDED=off` |
| AI agent | 30 s | `AI_AGENT_EMBEDDED=off` |
| AI review | 300 s | `AI_REVIEW_EMBEDDED=off` |

**Consequence:** restarting the web app stops these three. Restarting the
orchestrator terminal does not.

If you want the AI or bot loops to survive a web restart today, set the kill
switch to `off` and run the corresponding worker in its own terminal
(`npm run bot:worker` for bots; the AI workers have no standalone CLI yet).

---

## 2. Checking status

### 2.1 From the terminal

```bash
npm run services:status
```

Prints one row per service:

```
OK   scanner  cu    3m / ky   15m | ok=2026-10-31T09:12:00Z err=- lan=42
DEAD funding  cu   41m / ky   15m | ok=2026-10-31T08:34:00Z err=HTTP 451 lan=40 | loi: HTTP 451
```

- `OK` means the last successful run is within **2 × interval**.
- `DEAD` means it is not. The exit code is non-zero, so a cron or systemd timer
  can surface it.
- `cu` = age of the last success; `ky` = the interval in minutes.
- `lan` = how many successful cycles have been recorded.

For a machine-readable form:

```bash
node services/heartbeat.mjs status --json
```

### 2.2 From the UI

Open **Operations**. The service section is driven by the same heartbeat file, so
the UI and the CLI cannot disagree.

### 2.3 Where the heartbeat actually lives

```
node_modules/.cache/tm-trading/services.json
```

It is deliberately outside the project tree so the dev watcher does not reload on
every beat.

> **Trap:** an older file exists at `logs/services.json`. It is **stale** and is
> not read by the current code. If you are debugging by opening a JSON file, make
> sure it is the one under `node_modules/.cache/`.

Heartbeat shape:

```json
{
  "updatedAt": "2026-10-31T09:15:00.000Z",
  "services": {
    "scanner": {
      "intervalSec": 900,
      "lastRunAt": "2026-10-31T09:12:00.000Z",
      "lastOkAt": "2026-10-31T09:12:00.000Z",
      "lastErrorAt": null,
      "lastError": null,
      "count": 42,
      "lastSummary": "{\"movers\":12}",
      "lastAlertAt": null
    }
  }
}
```

### 2.4 What the heartbeat does **not** tell you

This is the single most important operational caveat:

| Question | Answer today |
| --- | --- |
| Is the process still alive? | **Unknown.** There is no pid, host or boot id in the file. |
| Is it connected to Mongo? | **Unknown.** Only "the last run threw or not". |
| Is it receiving data? | **Unknown.** `lastOkAt` means the function returned, not that rows were produced. |
| Is it stuck mid-run? | **Unknown.** `lastRunAt` is written *before* the work, so a hung run looks recent. |
| Is it restarting in a loop? | **Unknown.** There is no restart counter. |

So `OK` means "returned within 2 cycles". It does **not** mean "healthy". Treat a
green table as a necessary condition, not a sufficient one.

---

## 3. Running work on demand

### 3.1 Run everything once

```bash
npm run services:once
```

Runs all 14 services serially, then disconnects Mongo and exits. Use this after a
cold start, or to populate empty tables before a demo.

The same action exists in the UI as **Run all services once**. As of V4.2 S2 the
button no longer spawns a process: it **enqueues one `run-once` operation per
service** for the supervisor and reports what it queued ("Queued N run-once
operations"). It does **not** claim the work happened — watch the Service control
plane table for the outcome. With no supervisor running the operations wait in the
queue and expire, so if nothing changes, start the supervisor (section 9).

`npm run services:once` from the terminal is still the legacy orchestrator and
runs the services in the foreground, so you can watch the output.

### 3.2 Run one service

There is no per-service CLI flag. The supported options are:

- run everything once (`npm run services:once`);
- run the whole watch loop and let intervals do the work (`npm run services`);
- call the service function from a Node one-liner for debugging, e.g.
  `node -e "import('./services/scanner.mjs').then(m => m.runScanner())"`.

A per-service `run-once` is part of the V4.2 control plane, not available now.

### 3.3 Re-probe from the UI

**Operations → Re-probe** calls `POST /api/v1/admin/health/services/reprobe`.

Despite the name, it **re-reads the heartbeat file**. It does not contact any
service, provider or database. It is a refresh, not a probe. Use it to confirm the
file changed, not to test connectivity.

Both **Re-probe** and **Run all services once** now require a **root** account.
Any other role gets `403`. This is deliberate: spawning a background process, even
to refresh status, is a privileged action.

---

## 4. Restarting things safely

### 4.1 Restart the web app

```bash
# stop the current dev process (Ctrl+C in its terminal), then
npm run dev
```

Effects:

- the three embedded loops stop and restart with the new process;
- in-flight HTTP requests are dropped;
- the market plane's in-memory quotes, order book and candles are lost and rebuild
  on demand;
- bot instances keep their leases (the supervisor nonce is stable per pid), but a
  *new* pid adopts them rather than resuming mid-cycle.

### 4.2 Restart the services orchestrator

Stop the `npm run services` terminal and start it again. Effects:

- all 14 timers restart, staggered by 3 s;
- the heartbeat file is preserved, so the UI does not flash "never ran";
- a service that was mid-run when you stopped it leaves `lastRunAt` newer than
  `lastOkAt` — the next cycle fixes it.

### 4.3 Restart order after a machine reboot

1. MongoDB;
2. `npm run dev` (web + embedded loops);
3. `npm run services` (periodic work).

The web app works without step 3; the tables simply stop updating.

---

## 5. Reading failures

### 5.1 A service shows `DEAD`

1. Check the terminal running `npm run services`. A thrown error is logged as
   `FAIL <ms> <message>` and the loop continues.
2. Check `lastError` in the heartbeat for the short message.
3. Common causes:

| Symptom | Cause | Fix |
| --- | --- | --- |
| `HTTP 451` / `403` from a venue | Geo-block or key restriction | Use an allowed region or a different provider |
| Mongo timeout | `MONGODB_URI` wrong or Mongo not running | Start Mongo, verify the URI |
| `skips cleanly` in the log | Missing key (FRED, AI, Telegram) | Expected; the service is a no-op without its key |
| Service never appears in the table | The orchestrator never ran, or it crashed at import | Run `npm run services:once` and read the first error |

### 5.2 Everything is `DEAD` at once

Almost always Mongo. Every service touches it. Verify with:

```bash
mongosh "mongodb://localhost:27017/tm-trading" --eval "db.runCommand({ping:1})"
```

### 5.3 A service says `OK` but the table is empty

`OK` only means the function returned. The producer may have had nothing to
write: no new events, an empty universe, a provider returning an empty page, or a
filter that excluded everything. Check the `lastSummary` field — it is the
truncated JSON the service returned.

### 5.4 Alerts are evaluated but nothing arrives on Telegram

Expected when `TELEGRAM_TOKEN` or `TELEGRAM_CHAT_ID` is unset. `sendTelegram`
returns `false` and records a failed attempt. There is no retry: the message is
lost. Verify the token with a manual send before blaming the rule.

### 5.5 A bot will not start

The bot supervisor runs inside the web process. Check:

1. Is the web app running? (No web process → no embedded supervisor.)
2. Is `BOT_EMBEDDED=off`? Then you need `npm run bot:worker` in its own terminal.
3. Is another supervisor holding the lease? A `lease_held` result is not an error;
   it means another process owns that instance.

---

## 6. Seeding and the route registry

The menu is not generated from the filesystem. It is read from TM Hub's
`system_routes` table for app `tm-trading_ghfseu`.

### 6.1 What a seed run does

From `../tm-hub`:

```bash
pnpm seed --app=trading
```

It will:

1. resolve app ids from the `apps` table;
2. **rewrite** `../tm-trading/.env` (`NUXT_PUBLIC_HUB_APP_ID`, `AUTH_JWT_SECRET`);
3. upsert the 72 routes from `createTradingRoutes`;
4. **delete** every route for this app that is not in that list.

### 6.2 Why this is dangerous here

The local hub and the deployed hub (`https://tm-hub-app.vercel.app`) share the
same Supabase project. There is no sandbox. A seed run is a production change: it
can change app identity, rotate the JWT secret, and delete routes the deployed app
is serving.

**Before seeding:**

- diff the route list against the live table;
- back up `system_routes` for `tm-trading_ghfseu`;
- confirm nobody is mid-session;
- run only `--app=trading`, never `--app=all`.

**After seeding:** restart the web app so it reloads routes, and re-check the
sidebar against `tests/nav-contracts.test.ts`.

### 6.3 Never add routes through the UI

A route created on `/admin-system/routes` is deleted by the next seed. The seed is
the source of truth. Change `createTradingRoutes`, the page, the nav contract test
and the `nav.*` i18n keys together.

---

## 7. Backups and retention

| Command | What it does |
| --- | --- |
| `npm run backup` | Backup per the tool's configuration |
| `npm run backup:owner` | Backup owner-scoped collections |
| `npm run backfill:owner` | Backfill `ownerId` on legacy rows |

The `retention` service prunes expired data every 6 h according to the dataset
manifest. It does not delete market recordings outside the manifest.

---

## 8. Known operational gaps (V4.2 scope)

Documented so you do not spend time looking for features that are not there.
"Built" means the capability exists in code and is reachable from the terminal,
but is **not yet** exposed in the dashboard.

| Gap | Impact | Stage | Status |
| --- | --- | --- | --- |
| No supervisor wired into the app | Restarting the web app kills bot/AI loops | S2 | Supervisor built (S1.3); wiring is S2 |
| No desired/observed state in the UI | You cannot ask "should this be running?" from the screen | S1.2 | Built (registry + readiness); UI is S2 |
| No per-service start/stop/restart/reset in the UI | Only "run all once" | S2 | Available from the CLI (S1.3); UI is S2 |
| No operation records in the UI | A control action leaves no trace on screen | S2 | Durable operation records built (S1.3) |
| No capability check on `run-once` / `reprobe` | Any logged-in user could spawn a process | S1 fix | **Fixed** — root-only guard (403 for others) |
| Telegram has no outbox/retry | Failed deliveries are lost | S3 | Not started |
| No per-process telemetry in the UI | Cannot prove the web process is saturated | S1.2 | Sampler built; UI is S2 |
| Heartbeat has no pid/generation | Cannot distinguish restart from never-ran | S1.2 | Superseded by the supervisor state (S1.3) |

Full analysis: [../web-app/v4.2-operations-control-audit.md](../web-app/v4.2-operations-control-audit.md).

---

## 9. The supervisor (V4.2 S1.3, terminal only)

A dedicated supervisor owns service lifecycle without relying on the web process.
It is a plain Node program, so it survives a dashboard restart and can still stop
a wedged service when MongoDB is down.

> **Scope today:** the supervisor has its own registry of services but does not
> yet start the services the dashboard relies on. It is safe to inspect and to
> exercise on a pilot service; do not point it at a service that `npm run
> services` is already running, or you will have two copies of the same work.

### 9.1 What it adds over the heartbeat

| Question | Heartbeat (section 2) | Supervisor |
| --- | --- | --- |
| Is the process alive? | Unknown | pid + host + generation, reconciled each tick |
| Should it be running? | Not tracked | `desired` (your intent) vs `observed` (proof) |
| Is it ready, not just alive? | Not tracked | READY requires dependencies reachable **and** initialisation complete |
| Did a command take effect? | No record | A durable operation with a terminal state |
| Is it restarting in a loop? | Unknown | restart counter + bounded backoff |

Readiness is deliberately strict: a service reporting *skipped* (for example the
AI brief outside its window) is **not** counted as a success, and evidence the
worker could not observe is never treated as a pass.

### 9.2 Commands

```bash
node services/supervisor.mjs status
node services/supervisor.mjs tick
node services/supervisor.mjs run
node services/supervisor.mjs start news --actor=ops --reason="pilot"
```

- `status` adopts any process that survived a restart, runs one reconciliation
  pass and prints the table.
- `tick` runs a single pass and prints a one-line JSON summary (useful in a
  timer).
- `run` is the loop; set `SUPERVISOR_TICK_MS` to change the cadence. `Ctrl+C`
  drains every worker before exiting.
- `start | stop | restart | reset | probe | run-once <serviceId>` requests one
  operation and waits for its terminal state.

Flags: `--scope=system` (ownership scope), `--actor=<name>` (audit), `--key=<id>`
(idempotency — repeat it to make a retried command safe), `--reason=<text>`.

### 9.3 Operation states

A command is not a result. `start` returns as soon as the request is **persisted**,
then moves through phases:

| Terminal state | Meaning |
| --- | --- |
| `SUCCEEDED` | The intent was proven (e.g. the service reported READY). |
| `FAILED` | Proven failure (`DEPENDENCY_NOT_READY`, `READINESS_TIMEOUT`, `WORKER_EXITED`, `LEASE_HELD`, …). |
| `UNCONFIRMED` | The deadline passed without proof. Treat as "check by hand", not as success. |

`reset` restarts a service and asks it to clear ephemeral state; it never deletes
history. `run-once` runs exactly one cycle — either in the running worker, or in a
one-shot process — and records the outcome.

### 9.4 Where its state lives

The supervisor keeps state in a JSON file outside the project tree (next to the
heartbeat) and writes it atomically before acknowledging a command. This is
intentional: it needs no database connection at boot. MongoDB-backed state is
planned for S2, when the HTTP API and the supervisor become separate writers.

### 9.5 Safety rules

- It refuses to start a service another process still hosts, or a service that is
  only planned. Only `probe` is allowed for those.
- It claims an exclusive lease per service+scope, so two supervisors cannot both
  run the same service. An expired lease (a crashed supervisor) is reclaimable.
- It drains a worker with a graceful message first and only force-kills after the
  grace period, recording the escalation.

### 9.6 Driving it from the dashboard

As of V4.2 S2 the **Service control plane** tab on `/operations` is the primary
surface. It is a read-only table until you open a service, and every action there
does exactly what the CLI does — it enqueues an operation for this supervisor:

1. the button returns immediately with `202 Accepted` and an operation id;
2. the button then polls that operation and shows its **phase** (starting,
   awaiting-readiness, draining …);
3. the outcome is only reported once the operation is terminal. `UNCONFIRMED`
   means the deadline passed without proof — check by hand, do not assume success.

For the dashboard to have any effect, the supervisor must be running:

```bash
node services/supervisor.mjs run
```

With no supervisor running, a command is still accepted and queued (it is a real
record), but nothing performs it and it expires after its deadline. A command that
is rejected, expires or cannot be read is never deleted silently — it is moved to
the **quarantine** with the reason attached, and
`node services/supervisor.mjs quarantine` lists what was dropped and why. When the
box is non-empty the Services header shows a **Dead-letter** badge with the count, so
a silently emptied queue cannot look healthy. `restart`,
`reset`, `run-once` and `probe` are root-only actions; other roles see the table
but get `403` when they press a button.

The table is updated by a server-sent event stream, so a service changing state
appears without a manual refresh. The badge shows **Live** when the stream is
connected and **Polling** when it has dropped and the page is falling back to a
15 s refresh.

### 9.7 Service objectives (SLOs)

Each row carries an **SLO** badge, and opening a service lists its three
objectives. They are computed from the evidence the supervisor already stores, so
the badge can always be explained by the fields beside it:

| Objective | What it means | Turns amber / red when |
| --- | --- | --- |
| **Cycle freshness** | the service finished a cycle inside its budget (`3 × interval`, floor 5 min) | it is late by more than one budget / two budgets |
| **Restart stability** | it is not crash-looping | 2 / 4 unhealthy exits in the last hour |
| **Process saturation** | its event loop is not overwhelmed | telemetry says elevated / saturated |

Two things the badge means that are easy to misread:

- **Grey "Not measured"** is not a pass. A service you never started has no duty,
  so every objective is `unknown` — it is deliberately **not** shown green.
- The badge is the **worst** objective, so one amber objective turns the whole
  service amber even if the other two are fine.

The header roll-up shows only the breached and at-risk counts, and it never adds
"not measured" to either. If you want the raw numbers behind an objective, open
the service: the drawer prints the observed value and the budget in words (for
example "last success 240s ago, budget 2700s"). Availability percentage and error
rate are **not** shown because this system records no request/uptime time series;
reporting them would be a guess.

### 9.8 Control-plane latency

Opening a service also shows a **Control plane** block: how long its last finished
command took. It is computed from the operation timeline, so every number is
explainable by the rows above it:

| Number | Meaning |
| --- | --- |
| **Queue wait** | how long the command sat in the inbox before the supervisor picked it up |
| **Execution** | how long the supervisor then spent doing it |
| **Total** | requested → finished, the time a person actually waited |

Only a **finished** operation is timed — an operation still running has no
duration yet, so the block reports "No completed control action yet" rather than a
misleading zero. The action and its terminal state are shown beside the timings, so
a slow restart and a failed restart cannot be confused. Missing halves (a command
the supervisor never started) show `—`, never `0`.
