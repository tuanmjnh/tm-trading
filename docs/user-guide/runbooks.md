# Service Runbooks

Recovery procedures for the background services and the V4.2 supervisor. Each
runbook follows the same shape: **symptom → confirm → fix → prevent**. They are
written for the terminal first; where the dashboard can do the same thing, that is
noted.

Related reading:

- [operations.md](operations.md) — how the two runtimes work and how to read state.
- [troubleshooting.md](troubleshooting.md) — the shorter "what is broken now" list.
- [../web-app/v4.2-service-inventory.md](../web-app/v4.2-service-inventory.md) — which service lives where.

> **The one rule that governs all of these:** the supervisor is the single writer
> of service state. Never edit `node_modules/.cache/tm-trading/supervisor.json` or a
> file in the commands inbox by hand. Use `node services/supervisor.mjs …` or the
> Service control plane. A hand-edited state file is the fastest way to make two
> owners for one service, which means duplicate alerts and duplicate writes.

---

## 0. Ground truth before you start

```bash
# who is running what, according to the supervisor
node services/supervisor.mjs status

# the legacy orchestrator's own view (may be stale if the supervisor owns services)
npm run services:status
```

If the two disagree, the **supervisor wins** — that is the whole point of S3. A
service the supervisor holds is deliberately skipped by the legacy orchestrator
(it logs `[guard] SKIP <service>`).

---

## 1. A worker crashed / exited non-zero

**Symptom.** A service shows `FAILED` or flips `READY → STARTING` with a rising
`restartCount`; the SLO badge turns amber/red on **Restart stability**.

**Confirm.**

```bash
node services/supervisor.mjs status          # observed state + restartCount
```

Look at the operation timeline in the service drawer: the supervisor records a
`crash-restart` audit row with the exit code.

**Fix.** A crash is usually caused by a transient dependency (an unreachable feed,
a bad payload). Do nothing and watch the backoff: the supervisor restarts with
exponential backoff. If it keeps crashing:

1. open the service drawer and read the last error and the audit rows;
2. fix the cause (see the sections below), then

```bash
node services/supervisor.mjs restart <service>
```

**Prevent.** If it crashes four or more times in an hour the SLO is `breached` by
design — that is the signal to stop restarting and look at the cause.

---

## 2. Heartbeat gap and lease expiry

**Symptom.** The heartbeat age climbs past the interval while the process looks
alive; or `status` shows a lease that has expired.

**Confirm.** This is the trickiest one, because **a live heartbeat is not proof of
health**. Check all three:

```bash
node services/supervisor.mjs status      # observed state, lastHeartbeatAt
npm run services:status                  # the legacy heartbeat file
```

**Fix.**

- **Heartbeat older than the interval, process alive:** the service is wedged (its
  event loop is blocked). Restart it: `node services/supervisor.mjs restart <service>`.
  A `readiness` rule (`process-alive`, `heartbeat-fresh`) will already have moved it
  to `DEGRADED` — that is the system telling you before a user does.
- **Expired lease:** a crashed supervisor releases nothing, so an expired lease is
  evidence that nobody owns the service. The legacy orchestrator treats an expired
  lease as free and may pick the service up; the supervisor will re-claim it on its
  next tick. If you want a single owner, stop the legacy orchestrator
  ([operations.md](operations.md) §1.0).

**Prevent.** Never set a long lease and a short interval; the lease must outlive a
slow cycle.

---

## 3. A drop in refresh does not kill a worker

**Symptom.** You closed the browser (or it reconnected) during a start/restart.

**Confirm.** Nothing to confirm — this is a **non-event by design**. Workers are
dedicated processes owned by the supervisor, not by the page, so closing the tab
changes nothing.

**Fix.** Reopen the Service control plane. The table re-reads the current state and
the SSE stream reconnects with bounded backoff (1 s → 30 s), so in-flight progress
reappears. If the stream shows **Offline**, the page falls back to a 15 s poll and
you have lost nothing but latency.

**Prevent.** Do not start long work from a laptop you are about to close on the
assumption that it runs locally. It does not.

---

## 4. A duplicate or late command

**Symptom.** You pressed a button twice; or a command was accepted while the
supervisor was down and it fired much later.

**Confirm.**

```bash
node services/supervisor.mjs status
```

The operation timeline shows one operation per `idempotencyKey`, not two.

**Fix.** None required: this is handled.

- The API mints the `operationId` and the supervisor's `request()` is idempotent on
  it, so consuming a command twice resolves to the same operation (at-least-once
  delivery is safe).
- A command has a **deadline**. If the supervisor was down past it, the command is
  **expired** and dropped with a `command-expired` audit row — it will not fire late.
- Two *different* commands for one service cannot both run: the supervisor allows
  one active operation per service and answers the second with `OPERATION_IN_PROGRESS`.

**Prevent.** Send an `idempotencyKey` from automation; a retry then cannot become a
second operation.

---

## 5. Stop during active work

**Symptom.** You stop a service while it is mid-cycle.

**Confirm.** The drawer shows the operation phase as `draining` before `STOPPED`.

**Fix.** None — stopping is graceful.

- New work is blocked immediately.
- Active work is allowed to finish inside the grace period.
- Only after that is the worker force-killed, and the escalation is recorded.

If a stop appears stuck, it is waiting on the grace period, not wedged. Watch the
phase; if it passes the deadline the operation becomes `UNCONFIRMED`, which means
*check by hand*, never *assume success*.

---

## 6. A dependency is unavailable or degraded

**Symptom.** A dependent service will not reach `READY`, or it degrades when its
dependency does.

**Confirm.**

```bash
node services/supervisor.mjs status     # compare the dependency's observed state
```

**Fix.** Fix or start the dependency first. A service waiting on a dependency sits
in `awaiting-dependency` and re-evaluates each tick rather than failing hard — so
it recovers on its own once the dependency is back. This is deliberate: "not ready
because a dependency is down" must not look like "crashed".

**Prevent.** Keep the dependency list in the registry honest; the supervisor trusts
it.

---

## 7. Provider rate limit or authentication failure

**Symptom.** A scanner or funding service errors repeatedly with HTTP 429 or 401.

**Confirm.** The last error in the service drawer names the provider and the status.

**Fix.**

- **429:** leave it. Retries use exponential backoff with jitter; hammering makes it
  worse. If it persists, lower the interval in `.env`.
- **401/403:** the credential is wrong or expired. Fix `engine/.env` and restart the
  service. Do not retry a non-idempotent call blindly.

**Prevent.** Watch the SLO **Cycle freshness**: a provider that is throttling shows
up as late cycles before it shows up as errors.

---

## 8. Socket open but no data arriving

**Symptom.** The market feed connection reads *connected* but the table is stale.

**Confirm.** Compare the heartbeat age against the source's expected publication
interval. An open socket is not a healthy source.

**Fix.** Restart the feed service. Its readiness includes a freshness rule, so an
open-but-silent socket should already be `DEGRADED`/`STALE` rather than green.

**Prevent.** Never encode a single global "realtime" SLA: different providers
publish on different intervals, so the expected interval is per service.

---

## 9. Queue backlog growth

**Symptom.** Commands stop being accepted; the API answers `429` with
`error.inboxFull`.

**Confirm.**

```bash
# count what is actually waiting
node -e "import('./services/commandInbox.mjs').then(m => console.log(m.pendingCount()))"
```

**Fix.** Start the supervisor so it drains the inbox:
`node services/supervisor.mjs run`. The inbox is **bounded** (default 200 pending);
a full inbox is a refusal, not a silent drop, so no accepted command is lost.

**Prevent.** Run the supervisor under a process wrapper (nssm / Task Scheduler on
Windows, systemd on Linux) so it is always there to drain the queue.

---

## 9a. A command was accepted but nothing happened

**Symptom.** You pressed Start, got `202 Accepted`, and the service never changed.

**Confirm.** A command can only end in three ways: performed, deferred (busy
service, retried next tick), or **dropped**. A dropped command is never deleted —
it is moved to the **quarantine** (dead-letter) box with the reason attached:

```bash
node services/supervisor.mjs quarantine
```

You will see one line per dropped command: when, which service/action, and why
(`rejected: UNKNOWN_SERVICE`, `expired: the supervisor did not pick it up before
its deadline`, `invalid: ...`).

**Fix.**

- **`expired`:** the supervisor was not running when the command was queued, or it
  was busy past the deadline (default 5 min). Re-issue the action now that the
  supervisor is up; a late command is deliberately **not** replayed, because it was
  meant for a moment that has passed.
- **`rejected`:** the target is wrong — an unknown, planned or unsupervised service,
  or an unsupported action. Check the service in the registry.
- **`invalid`:** a corrupt file on disk. The raw bytes are preserved in the
  quarantine entry; delete it and re-issue the command.

The quarantine keeps the newest 100 entries; older ones are pruned automatically, so
it cannot grow without bound.

**Prevent.** Keep the supervisor running (see §9) and do not hand-edit files in
`node_modules/.cache/tm-trading/commands/`; use the dashboard or the CLI.

---

## 10. Storage unavailable or a write failure

**Symptom.** State file writes fail; the supervisor reports a write error.

**Confirm.** State is written **atomically** (write to a temp file, then rename), so
a crash *during* a write cannot leave a half-written state file — either the old
state or the new one is on disk, never a mixture.

**Fix.** Free disk space or fix permissions on `node_modules/.cache/tm-trading/`,
then restart the supervisor. A failed write is thrown, not swallowed, so it will not
be mistaken for a successful tick.

**Prevent.** Do not replace the store's write with a plain `writeFile`; the atomic
rename is what makes the state durable across a crash.

---

## 11. Nuxt restart while external workers run

**Symptom.** You restarted the dashboard (or deployed it).

**Confirm.** `node services/supervisor.mjs status` before and after.

**Fix.** None — this is the design contract. Workers are **dedicated external
processes**: a dashboard restart must not kill or duplicate them. Verify it once on
your own box: note the worker pids (`node services/supervisor.mjs status`), restart
Nuxt, and confirm the pids are unchanged.

**Prevent.** Do not drain workers from a web process' shutdown path. The embedded
driver (`server/plugins/service-supervisor.ts`, dev/self-host only) follows this: its
`close` hook stops the tick timer and nothing else, so a Nitro restart is exactly the
drill's *control-plane restart* — the next boot adopts the same pids
(`[... adopted=13 recovered=0 ...]`).

**If a web process dies without a close hook** (kill -9, OOM): the workers notice the
closed IPC channel, log `lost its control-plane channel`, and keep serving for
`WORKER_CHANNEL_GRACE_MS` (default 5 min) so the next supervisor can adopt the pid by
its state-file record. If nothing adopts them they exit 0 by themselves — an
unsupervised producer must not keep writing. Clear the window by starting the driver
(`npm run services:supervised`, or just open the dashboard).

**Escalation.** For anything beyond a single box, run the supervisor as an OS service
and disable the embedded one (`SERVICE_SUPERVISOR_EMBEDDED=off`), so a dashboard
outage cannot affect service supervision at all.

---

## 12. Supervisor restart with work in flight

**Symptom.** The supervisor process restarted (crash, deploy, reboot).

**Confirm.** After it is back:

```bash
node services/supervisor.mjs status
```

**Fix.** None required:

- Queued commands are still on disk (the inbox is durable) and are picked up on the
  first tick — unless they expired, in which case they are dropped with an audit row.
- A lease held by the dead supervisor expires and is reclaimed; nothing runs twice.
- A worker that outlived the supervisor is adopted or reconciled on the next tick.

**Prevent.** Use the OS wrapper so a supervisor crash is restarted automatically;
do not rely on a person noticing.

### 12a. Operator intent survives the restart

`desired` is not derived state — it is what the operator asked for. A supervisor
shutdown drains the workers but leaves `desired` untouched, and the next
supervisor process reads it at boot and restarts those services through the normal
`start` path (actor `supervisor-recovery`, so the audit row is distinguishable
from a person pressing Start).

So after a restart you should see:

| Field | Value | Meaning |
| --- | --- | --- |
| `desired` | `RUNNING` | the service you started is still expected to run |
| `observed` | `STARTING` → `READY` | recovery is in progress, then healthy |
| `restartCount` | unchanged | recovery is not a crash |
| `lastError` | unchanged / `null` | the restart did not invent an error |

If a service you had started stays `STOPPED` after a supervisor restart, that is a
bug, not an operator action — check that `desired` is still `RUNNING` and report it.

### 12b. A graceful drain is not a crash

When you stop the supervisor (or deploy over it), it asks every worker to shut
down and records `observed: STOPPED`. It must **not** record `restartCount + 1`,
a `worker-exited` audit row, or a scheduled restart: the exit was requested.

**Confirm.**

```bash
node services/supervisor.mjs status
```

After a clean shutdown every drained service should show `pid: null`,
`observed: STOPPED`, `restartCount` unchanged and `nextRestartAt: null`.

**If it is wrong.** A rising `restartCount` after every deploy makes the
**Restart stability** SLO meaningless and triggers restarts nobody asked for. This
is covered by drills 5–7 of the drill harness:

```bash
npm run drills
```

See [../web-app/v4.2-drills.md](../web-app/v4.2-drills.md) for what each drill
proves and how to read a failure.

---

## 13. Reset semantics

**Symptom.** You want to clear a service's state.

**Fix.** `node services/supervisor.mjs reset <service>` (or **Reset** in the
drawer, root-only). Reset:

- stops the service if running, then
- clears the supervisor's runtime record (generation, restart count, last error),
- **preserves durable history and configuration** (audit rows, the operation log).

Reset is destructive and root-only; it is the last thing to try, not the first.

---

## 14. Escalation checklist

If none of the above applies, collect this before asking for help — it is what the
maintainer will ask for first:

```bash
node services/supervisor.mjs status          # desired/observed/readiness per service
npm run services:status                      # legacy heartbeat view
npm run services:supervisor:status           # same as the first, package-script form
npm run drills                               # proves the lifecycle mechanism, not the service
```

Then, for the failing service, the **operation timeline** and **audit rows** from
its drawer. Include the `operationId` of the failed action: every mutation is
identifiable by it.

If the drills fail too, the bug is in the supervisor or the worker host, not in
the service — say that explicitly in the escalation.
