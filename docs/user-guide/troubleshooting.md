# Troubleshooting

Work through the section that matches the symptom. Each entry states the cause,
how to confirm it, and the fix.

---

## 1. Cannot log in

### 1.1 Redirect loop or "unauthorized" after submitting credentials

**Cause:** the app posts credentials to TM Hub, then verifies the returned JWT
locally with `AUTH_JWT_SECRET`. If the secret differs, every request is rejected
even though the password was correct.

**Confirm:**

```bash
# both values must match the hub's .env
grep AUTH_JWT_SECRET .env
grep AUTH_JWT_SECRET ../tm-hub/.env
```

**Fix:** copy the Hub's value into `tm-trading/.env` and restart the dev server.
Do not invent a new secret in one app only.

### 1.2 Login request never leaves the browser

**Cause:** `NUXT_PUBLIC_HUB_URL` is unreachable, or points at a local hub that does
not know this app id.

**Confirm:** open the browser network tab and look at `POST /api/v1/auth/login` on
the hub host. A CORS or DNS error means the URL is wrong.

**Fix:** set `NUXT_PUBLIC_HUB_URL` to a hub that has the `tm-trading_ghfseu` app
registered. The committed default is the deployed hub.

### 1.3 Login succeeds but the sidebar is empty

**Cause:** the account is valid but has no route grants for this app. Menu rows are
filtered by both permission and "does the page exist".

**Confirm:** open `/admin-system/routes` directly. If it 403s, you have no admin
grant; ask a Hub admin to assign your role.

**Fix:** in TM Hub, assign the user a role whose `allowed_routes` includes this
app's routes. `root` has `['*']`; `admin` and `viewer` have explicit lists.

### 1.4 `400 error.missingLoginFields`

**Cause:** the app is pointed at a local hub that was seeded with a different app
id, so the login payload is rejected before it reaches the auth handler.

**Fix:** use the deployed hub URL, or re-seed the local hub for this app id
(carefully — see [operations.md](operations.md#6-seeding-and-the-route-registry)).

---

## 2. A menu item leads to a 404

**Cause:** the route exists in the Hub registry but no page file resolves it. The
menu hides most of these at runtime, but deep links and stale tabs can still reach
them.

**Known cases today:**

| Path | Why |
| --- | --- |
| `/admin-system/health-enhanced` | Seeded visible, no page file |
| `/strategy-lab/bots/instances` | Only the `[id]` detail page exists |

**Confirm:** check whether a page file exists under `app/pages/` for the path.

**Fix:** either create the page or set `is_visible: false` in
`createTradingRoutes` and re-seed. Do not leave a visible route pointing at
nothing.

---

## 3. A page loads but every table is empty

This is the most common report. Work through the layers in order.

### 3.1 Is Mongo running?

```bash
mongosh "mongodb://localhost:27017/tm-trading" --eval "db.runCommand({ping:1})"
```

If this fails, every table is empty. The app fails soft by design: it renders an
empty section instead of a stack trace.

### 3.2 Has a producer run?

```bash
npm run services:status
```

If no service has ever run, the collections do not exist. Run:

```bash
npm run services:once
```

### 3.3 Is the producer failing?

Read the `lastError` column from `npm run services:status`. A geo-block (`HTTP
451`), an expired key or an empty universe all produce an empty table with a
healthy-looking process.

### 3.4 Is the page reading a different collection than you expect?

Some pages read **snapshots** (replaced each cycle) and some read **history**
(append-only). An empty snapshot means the last cycle found nothing; an empty
history means nothing was ever recorded. `lastSummary` in the heartbeat is the
quickest way to tell which happened.

### 3.5 Is it a Placeholder page?

Several pages are intentionally unbound: News Impact, Strategy profiles, and parts
of Strategy Lab. See [workspaces.md](workspaces.md). A placeholder renders a shell
with no data and that is expected.

---

## 4. Data is stale but the service says OK

**Cause:** `lastOkAt` records that the function returned, not that it produced
rows. A service can return successfully with zero new events.

**Confirm:** open the heartbeat and read `lastSummary`. It is the truncated JSON
the service returned.

**Fix:** usually none — an idle market is not a fault. If the summary shows zero
for many cycles while you expect activity, check the provider and the filters
(`SCANNER_MIN_QUOTE_VOL`, `SCANNER_TOP_N`, symbol lists).

---

## 5. Operations shows everything as DEAD

**Cause:** the heartbeat file is missing, or every service is genuinely overdue.

**Confirm:**

```bash
npm run services:status
```

If the file does not exist, no orchestrator has run since the last cache clear.

**Fix:** start `npm run services`. If the file exists but all rows are old, the
orchestrator died. Restart it and watch the first output line.

> **File trap:** the live heartbeat is
> `node_modules/.cache/tm-trading/services.json`. A stale copy at
> `logs/services.json` is not read by the current code. Opening the wrong file
> produces confusing conclusions.

---

## 6. "Run all services once" queued operations but nothing changed

**Cause (V4.2 S2 onward):** the button enqueues a real `run-once` operation per
service and returns `202 Accepted`. Nothing performs those operations until the
**supervisor** is running, so with no supervisor they wait in the queue and then
expire.

**Confirm:**

```bash
node services/supervisor.mjs status
```

If the services still read `UNKNOWN` / `never started`, the supervisor is not
consuming the queue.

**Fix:** start it — `node services/supervisor.mjs run` — and watch the Service
control plane table. To run the legacy orchestrator in the foreground instead:

```bash
npm run services:once
```

Full analysis: [../web-app/v4.2-operations-control-audit.md](../web-app/v4.2-operations-control-audit.md).

---

## 7. Telegram alerts never arrive

Check in this order:

1. **Is a token configured?**
   ```bash
   grep TELEGRAM_TOKEN .env
   grep TELEGRAM_CHAT_ID .env
   ```
   Without both, `sendTelegram` returns `false` immediately.

2. **Does the token work?** Send a message manually:
   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_TOKEN/getMe"
   ```
   A `401` means the token is wrong; `403` usually means the bot was removed from
   the chat.

3. **Is the chat id correct?** A private chat id is a positive number; a group id
   is negative. Using the wrong sign silently fails.

4. **Did the rule fire?** Check `/alerts/history`. A failed attempt is recorded as
   failed — it is never shown as delivered.

5. **Was it deduplicated?** The router suppresses repeats inside the dedupe
   window. The same alert twice in quick succession is expected to send once.

> There is **no retry**. If Telegram was unreachable at send time, the message is
> lost. This is a known gap.

---

## 8. The bot will not start or keeps stopping

| Symptom | Cause | Fix |
| --- | --- | --- |
| Start does nothing | No web process running, so no embedded supervisor | Start `npm run dev` |
| `lease_held` | Another supervisor owns the instance | Expected; stop the other supervisor or wait for the lease to expire |
| Starts then stops | The worker threw during its first cycle | Check the bot instance detail and the server console |
| Works in dev, not in prod | `BOT_EMBEDDED=off` in production | Run `npm run bot:worker` as its own process |
| Duplicate cycles | Both the embedded loop and `bot:worker` are running | Set `BOT_EMBEDDED=off` when using the external worker |

---

## 9. Port 4001 is already in use

**Cause:** a previous dev server or preview process did not exit.

**Confirm (Windows):**

```powershell
Get-NetTCPConnection -LocalPort 4001 | Select-Object OwningProcess
```

**Fix:** stop that pid, or run the app on another port with
`npm run dev:raw -- --port 4002`. Note that some absolute URLs in local
bookmarks will then be wrong.

---

## 10. `npm run verify` fails

`verify` = Pine build + docs consistency + full test suite. Failures fall into
three classes:

| Failure | Meaning | Fix |
| --- | --- | --- |
| `docs:check` fails on a path | A backticked file path in `docs/` does not exist | Create the file or stop claiming it exists. Planned paths must not be backticked. |
| `docs:check` fails on a script | A doc cites an npm script that is not in `package.json` | Fix the doc or add the script |
| A test suite fails | Real regression | Read `logs/test-summary.json`; it names the suite and the first failing assertion |

Run the failing suite alone for a faster loop:

```bash
npm run test:app
npm run test:services
npm run test:engine
```

### 10.1 Pine reports are "stale"

`tests/pineInventory.test.ts` and `tests/pineParity.test.ts` compare the committed
reports against `pine/dist`. If a script was added or edited, regenerate first:

```bash
npm run pine:build
npm run pine:inventory
npm run pine:parity
```

`pine/dist/` is generated and not committed, so on a fresh clone build it before
running `npm run test:app`. The inventory hash deliberately ignores the build
timestamp that `tools/build.mjs` stamps into every file, so a plain rebuild no
longer churns the report — only a real source change does.

---

## 11. Typecheck fails after pulling

**Cause:** stale generated Nuxt types.

**Fix:**

```bash
npm install
npm run typecheck
```

If it still fails on a missing `.nuxt` type, delete `.nuxt/` and run
`npm install` again.

---

## 12. Charts or quotes freeze while the rest of the page works

**Cause:** the market plane is lazy and in-memory. A dropped WebSocket or a
restarted server loses quotes, and the page keeps rendering the last value.

**Confirm:** check the market source health on `/admin-system/data-sources` or
`/operations`.

**Fix:** reload the page to re-subscribe. If it recurs, the provider connection is
unstable; check the server console for socket errors. `process-guard` deliberately
keeps the server alive on socket teardown, so the absence of a crash is not
evidence that the feed is healthy.

---

## 13. A run comparison looks wrong

**Cause:** runs with different `engineVersion` or `paramsHash` were mixed.

**Fix:** filter to one stamp before comparing. The report is designed to refuse
cross-stamp aggregation; if you bypassed it, the result is meaningless. This is the
measurement-honesty rule, not a UI bug.

---

## 14. Where to look next

| Need | Read |
| --- | --- |
| What each page does | [workspaces.md](workspaces.md) |
| How to run and monitor services | [operations.md](operations.md) |
| Why the control plane behaves this way | [../web-app/v4.2-operations-control-audit.md](../web-app/v4.2-operations-control-audit.md) |
| Which features are real | [../web-app/v4-product-scope-audit.md](../web-app/v4-product-scope-audit.md) |
| Menu and route constraints | [../web-app/v4-route-migration-map.md](../web-app/v4-route-migration-map.md) |

If none of this explains the symptom, capture:

1. the exact page and action;
2. the browser console error;
3. the server console output around the same timestamp;
4. `npm run services:status`;
5. whether Mongo was reachable.

That set is enough to distinguish a UI bug from a producer bug from an
environment bug.
