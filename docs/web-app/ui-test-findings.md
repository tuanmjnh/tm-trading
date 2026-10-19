# UI / UX Test Findings & Upgrade Plan

Manual end-to-end pass over the dashboard (desktop + mobile) driving the running
dev server (`npm run dev` → `http://localhost:4001`) against the tm-hub IAM app.
This file records what was verified, what was fixed, and what remains to be done.

## Environment

- App: tm-trading dashboard, dev server on `:4001` (`ssr: false`, SPA).
- Hub: auth + routes + notifications served by `NUXT_PUBLIC_HUB_URL`
  (`https://tm-hub-app.vercel.app`, app `tm-trading_8pmp33`).
- Session: `root@example.com`; the hub is the auth provider.
- Mongo local; Redis **not** running (see F5).

## Fixes applied

### F1 — Duplicate notification fetches → hub 429 (FIXED)
`useNotify()` (app/composables/useNotify.ts) was a per-caller factory: every one
of its ~48 consumers created its own `notify` state **and** registered its own
`onMounted(fetchNotify)` + `watch(auth.user) → refresh()`. Every page load
therefore hit `GET /api/v1/apps/tm-trading_8pmp33/notifications` 2–3× (measured:
111 calls / 348 network entries across a route sweep), which tripped the hub's
rate limiter (HTTP 429) and produced browser console error storms.

Change:
- The feed moved into `useNotifyFeed()` (`app/composables/useNotify.ts`) with
  shared `useState` (`notify:items`, `notify:loading`, `notify:loadingMore`,
  `notify:nextCursor`, `notify:hasMore`) so all consumers read one list;
  `useNotify()` now just spreads the feed and adds the toast helpers.
- Initial load + auth watcher moved out of the component tree entirely into
  `app/plugins/notify.client.ts` (see U3), so they run **once per app boot**
  regardless of which page mounts.
- Concurrent resets collapse into a single in-flight request (`notifyInFlight`).
- Removed the redundant `onMounted(fetchNotify)` in
  `app/components/dashboard/NotificationsSlideover.vue` (the plugin owns the
  initial load).

Verified live: a 5-route sweep now issues exactly **1** notifications request per
page load (was ~3); no 429s. Re-verified after the U3 plugin move: one
`GET …/notifications?limit=20 → 200` per load, bell slideover renders, no Vue
warnings. `npm run typecheck` → 4/4 project PASS.

Residual note: the lifecycle is registered by whichever component calls
`useNotify()` first (normally the always-mounted header `BellButton`). If that
first caller ever unmounts before auth resolves, the watcher is disposed and not
re-registered. A client plugin would make this bullet-proof — see U3.

### F7 — Paper API routes shadowed by a literal `/index` segment (FIXED)
Four paper endpoints were unreachable at their documented paths. Nitro maps a
dot in a filename to a **literal path segment**, so `accounts.index.get.ts`
served `/api/v1/paper/accounts/index`, not `/api/v1/paper/accounts` — and a
request to the real path fell through to the SPA shell (HTML). The clients
(`usePaperAccounts.ts`, `useForwardTests.ts`) call the documented paths, so the
paper pages silently got HTML instead of JSON.

Renamed the four files to the folder-index convention (matches
`server/api/v1/news/index.get.ts`); imports are all `~~/`-aliased so the moves
were content-preserving:

| was | now | route |
| --- | --- | --- |
| `paper/accounts.index.get.ts` | `paper/accounts/index.get.ts` | `GET /api/v1/paper/accounts` |
| `paper/orders.index.post.ts` | `paper/orders/index.post.ts` | `POST /api/v1/paper/orders` |
| `paper/accounts/[id]/orders.index.get.ts` | `paper/accounts/[id]/orders/index.get.ts` | `GET /api/v1/paper/accounts/:id/orders` |
| `paper/accounts/[id]/positions.index.get.ts` | `paper/accounts/[id]/positions/index.get.ts` | `GET /api/v1/paper/accounts/:id/positions` |

Verified live: all four now return JSON (was HTML), and `POST /api/v1/paper/orders`
reaches its validation branch. `npm run docs:check` 822/0 · `npm run typecheck` 4/4.

## Findings still open

### F2 — Auth refresh has no 429/backoff handling (low — FIXED)
`useAuth.refresh()` deduped within a page load, but a rapid burst of **full**
reloads still issued one `POST /auth/refresh` each and could hit the hub 429
limit (largely a test artifact — real users do not hard-navigate 30× in 40 s).
Fix (U1): a shared Hub 429 budget in `app/utils/hub.ts` — `parseRetryAfterMs()`
(delay-seconds *or* HTTP-date), `noteHubRateLimit()` (records the window in
`sessionStorage`, so it **survives the very reload that caused the burst**),
`hubRateLimitRemainingMs()` and `clearHubRateLimit()`. `refresh()` now skips the
call while a window is open, records `Retry-After` on a 429, and clears it on
success; the proactive refresh timer retries once the window closes instead of
dropping the session. `useHub().hubFetch` records a 429 and does a single bounded
retry (in-request wait capped at 3 s so a long `Retry-After` never hangs the UI).
Honored windows are capped at 5 min and fall back to 30 s. Covered by
`tests/hubRateLimit.test.ts`.

### F3 — No SSR → "INITIALIZING..." splash on deep links (medium — FIXED)
With `ssr: false`, every hard navigation boots the SPA and showed the
`TM Trading Signal Engine & Backtest INITIALIZING . . .` full-screen splash
before content. Fix: replaced the splash with a **dashboard skeleton shell**
(`app/spa-loading-template.html`) — sidebar (brand, search, nav, user), header
(breadcrumb, actions), KPI tiles, and card/table row placeholders with a shimmer,
dark-mode and `prefers-reduced-motion` aware, responsive (sidebar hidden < 1024px,
KPI 2-col < 640px). The skeleton is placed outside `#__nuxt`
(`spaLoadingTemplateLocation` defaults to `body`), so it disappears the moment the
app mounts. Verified by blocking the app JS (skeleton stays) and unblocking
(`#__nuxt` mounts, skeleton removed). The dead root-level duplicate
`spa-loading-template.html` was removed (`spaLoadingTemplate` resolves against
`srcDir` = `app/`). See U2.

### F4 — Hub URL mismatch with AGENTS.md (config — DOCUMENTED)
`.env` sets `NUXT_PUBLIC_HUB_URL=https://tm-hub-app.vercel.app`, but AGENTS.md
documents `http://localhost:4000`. The locally-started hub rejects the app's
login shape (`400 error.missingLoginFields`) and is seeded with a different appId
(`tm-trading_wdr7mh` vs the active `tm-trading_8pmp33`), so the deployed hub is
the intentional active target.

Resolved (docs only, no logic change): the `.env` comment block above
`NUXT_PUBLIC_HUB_URL` now states the deployed hub **is** the active URL and why —
the previous block claimed the opposite ("never the active URL") while setting it
anyway — and records the deliberate deviation from AGENTS.md's localhost
default. AGENTS.md gained a matching note under "Satellite Connection". The URL
value itself is unchanged.

### F5 — Redis not running in dev (env)
`redis://localhost:6379` is down, so import + mail queues are disabled and log
`[ImportQueue]/[MailQueue] Redis unavailable`. Expected locally; document it.

### F6 — Stale `<title>` on fast checks (verify)
In the automated sweep `/news` and `/outlook` briefly reported the previous
page's title. Believed to be a measurement artifact (title read before
navigation settled); re-check interactively before acting.

### F9 — No mid-session access-token refresh → 401 storms (medium/high)
The access token is a cookie with `maxAge = expiresIn` (short TTL; observed
expiry ≈ 7–15 min into a session) plus in-memory `useState`. `refresh()` is
called **only** from `fetchUser()`, which runs at boot — there is no periodic
refresh timer and no 401 interceptor/retry. So when the cookie expires
mid-session:
- the local `/api/v1/*` proxy (which reads the `accessToken` cookie) starts
  returning `401 error.tokenMissing` for **every** call — reads *and* writes;
- no `POST /auth/refresh` is attempted;
- mutations fail with no recovery UI (the trade ticket's `Send order` simply
  did not POST, and the retry 401'd).

Observed live: at ~7 min a burst `GET /orders|/fills|/positions` → 401, then
`POST /api/v1/orders` → 401; a manual page reload fired
`POST /auth/refresh → 200` and restored the session (refreshToken cookie still
valid), confirming the gap is the missing mid-session refresh, not the hub.

Fix options (needs a decision — touches auth plumbing): a 401 interceptor on the
local `$fetch` that calls `refresh()` once and retries, and/or a timer that
refreshes shortly before `expiresIn`. See U5.

### F10 — Trade ticket: empty TP slots blocked submit + misleading error (FIXED)
`app/components/TradeTicket.vue` defaults to **two** TP slots
(`tps = ref(['', ''])`, line 39). `submit()` sent `tps: tps.value.map(Number)`,
so an untouched slot became `0`. Both the client mirror (`clientError()`) and the
server (`server/utils/orders.ts:74-78`, `tp must be > 0`) reject a `0`, so the
ticket **could not submit** until every TP slot was filled or removed — and the
only feedback was the generic, misleading `trade.ticketInvalid` ("Check price —
SL/TP must sit on the correct side of the entry"), which points at SL/TP sides
rather than the empty slot.

Verified live: BUY @ ~81466 with SL 80000 / TP1 83000 and an empty TP2 → no POST,
`ticketInvalid` shown (preview R/R was a valid 1.05). Removing the empty TP2 row
(leaving `tps: [83000]`) allowed the POST.

Fix:
- Added a `ladder` computed that normalises each slot
  (`String(x ?? '').trim()`) and **drops blank slots**, so an untouched slot is
  no longer a level. `<UInput type="number">` emits numbers, not strings, so the
  normalise step is required (a naive `x.trim()` throws `x.trim is not a
  function`).
- `clientError()` now validates the filled ladder, requires **at least one** TP
  (new key `trade.ticketNoTp`, added to both `en.json` and `vi.json`) and also
  requires a positive `SL` (empty SL previously coerced to `0` and slipped past
  the old finite check).
- `submit()` sends `tps: ladder.value` instead of `tps.value.map(Number)`.
- The preview R/R now reads `ladder[0]`, matching what is sent.

Verified live: with TP2 left **empty**, `Send order` now issues
`POST /api/v1/orders → 200` with body `tps:[84000]` (blank slot dropped); no
console error. `npm run typecheck` 4/4 · `npm run test:app` 1103/0.

### F11 — `error.invalidId` missing from i18n → raw key shown to users (FIXED)
Opening a `[id]` detail route with an unknown id (e.g.
`/test-center/runs/does-not-exist-12345`) makes the API return
`400 error.invalidId`. That status message is thrown from six call sites
(`server/utils/alertRules.ts:75`, `server/utils/newsStore.ts:330,369,489`,
`server/api/v1/runs/[id].get.ts:14`, `server/api/v1/runs/[id]/lineage.get.ts:28`)
but the key was **not defined** in the `error.*` block of
`i18n/locales/{en,vi}.json`, so `getErrorMessage()` fell back to the raw key and
intlify logged `[intlify] Not found 'error.invalidId' key in 'en' locale
messages`. The page itself degrades gracefully — it renders an empty detail
shell (e.g. "No trades yet"), no error boundary.

Fix: added `error.invalidId` to both locales (en `Invalid ID`, vi
`ID không hợp lệ`).

Resolved with U7 (below): the API already returns `400 invalidId` only for a
**malformed** id and `404 notFound` for a well-formed-but-missing one; the UI
now renders a dedicated not-found state instead of an empty shell.

### F12 — Bot instance detail heading duplicates the id (cosmetic, low — FIXED)
`/strategy-lab/bots/instances/<id>` rendered the id as both the page title and the
subtitle (`bot-core-live-20261014 bot-core-live-20261014`): both `title` and
`description` computeds fell back to the raw id.

Resolved: `description` in `app/pages/strategy-lab/bots/instances/[id].vue` is now
`<stateLabel> · <botProfileId>` when the record loads (e.g. `Running · bot-core-live`),
falling back to a new static blurb `strategyLab.bots.instanceDetail.description`
(en+vi) while loading or when the record is gone. The id remains the title and the
breadcrumb leaf. Verified live.

### F13 — Nuxt dev server dies with a JS heap OOM after a heavy route sweep (env)
While sweeping the authenticated routes with full page loads, the `npm run dev`
process on :4001 crashed:
`FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of
memory`, at a Mark-Compact of ~4.0 GB (default `--max-old-space-size`). It had
been up ~44 min; Vite compiles each route's client chunk on demand (`ssr: false`)
and a 20+ route sweep compiles the whole app into one long-lived dev process.
This is what caused the batch sweep's `net::ERR_ABORTED` (the server died
mid-loop), not an app error — the store and the app itself were fine.

Mitigation (env, not code): restart the dev server before a long sweep, or raise
the heap (`NODE_OPTIONS=--max-old-space-size=6144`). Not caused by the U3 notify
plugin (verified: exactly one notifications request per page load, no growth loop).

After the crash the dev process was left **degraded**: `.nuxt/` was missing
generated artifacts (`nuxt.config.mjs`, `routes.mjs`, `nuxt-fonts-global.css`), so
every page load 404s `/_nuxt/@fs/…/.nuxt/nuxt-fonts-global.css?direct` (cosmetic —
fonts fall back; not an app bug), and `history.pushState` + `popstate`
client-side navigation rendered stale pages. Memory also climbed steadily
(2.3 GB → 3.4 GB in ~25 min) after a cold start, so a second crash was imminent.
A clean dev-server restart is required for reliable local testing.

## API surface (token via deployed hub)

Read endpoints all return `200`; requests without a token return `401` (auth
middleware works). Confirmed non-bugs:

- `GET /api/v1/methods/events` → `400` is expected input validation; with valid
  params it still `400`s because the Binance fapi REST upstream is banned in this
  environment (WS-first fail-soft design) — env limitation, not a route bug.
- `GET /api/v1/instruments/universe` → `200` (≈5 s cold, ≈2 s warm); fail-soft.
- Health reports `degraded` (Redis down, F5). `market-sources/health` recovered to
  binance `up` (~500 ms) during the pass.

## Routes verified clean (desktop, no error boundary, no console errors)

- `/`, `/markets`, `/markets/calendar`, `/markets/explorer`, `/markets/scanner`
- `/trading`, `/trading/positions`, `/trading/orders`, `/trading/accounts`
- `/strategy-lab`, `/strategy-lab/methods`, `/strategy-lab/indicators`,
  `/strategy-lab/bots`, `/strategy-lab/bots/instances`
- `/test-center`, `/test-center/runs`, `/test-center/forward`, `/test-center/replay`
- `/data-research/data`, `/data-research/journal`, `/data-research/research`,
  `/data-research/research/experiments`, `/data-research/research/evidence`,
  `/data-research/research/news-impact`
- `/ai-agents`
- `/alerts`, `/alerts/history`, `/alerts/inbox`

**Retracted after a real browser pass:** `/news`, `/news/sources`, `/news/events`,
`/outlook` and `/data-research/research/news-impact` were NOT reachable (they
redirected to `/`) — see F8, **now fixed**.

**Detail (`[id]`) routes verified clean** (real data, no error boundary, no
console errors): `/strategy-lab/tm-vsa-core`, `/strategy-lab/bots/bot-core-live`,
`/strategy-lab/bots/instances/bot-core-live-20261014`,
`/strategy-lab/indicators/atr`.

**Detail routes with an unknown id** (their collections are empty in this dev
DB) — no crash, no error boundary; F11 warning gone after the fix:
`/test-center/runs/<unknown>` → **now** a dedicated "Run not found" state (U7,
fixed); `/sessions/<unknown>` → **now** a dedicated "Session not found" state
(U7, fixed) — previously an empty "No trades yet"/"No sessions yet" shell;
`/data-research/research/evidence/<unknown>` → proper "Evidence set not found"
state (404 `evidence_not_found`); `/data-research/research/experiments/<unknown>`
→ renders the shell (no fetch error). The runs API returns `400 invalidId` only
for a **malformed** id and `404 notFound` for a well-formed-but-missing one (the
earlier "runs 400s an unknown id" reading was wrong — the id used was malformed).

Pending a browser pass: `/shared-resources/{index,connections,import,queues}`,
`/admin-system/*`, `/tools/*`.

## Remaining test plan

1. **Mobile viewport** — responsive nav (`ActionsSheet`), `GridList`
   `#mobile-content` cards, tables, forms, slideovers at ≤ 480 px and ~ 768 px.
2. **Processing actions** — news desk (source enable/disable via
   `PATCH /news/sources/:id`, retry ingestion), trading (paper order, position,
   signal), strategy/test-center run create, CRUD modals, delete flows.
3. **Detail routes** — DONE for strategy, bots, bot instance, indicators (real
   data). Runs/experiments/evidence/sessions have no rows in this dev DB, so only
   the unknown-id (graceful) path was exercised (F11).
4. **CRUD** — DONE create + delete for an alert rule via `/alerts` (New rule →
   name → Save → `POST /api/v1/alert-rules → 200`; Delete → Confirm →
   `DELETE /api/v1/alert-rules/:id → 200`; verified gone from `alert_rules`).

### F8 — News desk, Outlook and news-impact were unreachable (HIGH — FIXED)
With a real browser, `/news`, `/news/sources`, `/news/events`, `/outlook` and
`/data-research/research/news-impact` all redirect to `/`. Cause: the global
client guard `app/middleware/auth.global.ts` fetches the hub route catalog
(`GET /api/v1/auth/routes`) and, for any authenticated path not present as a
visible route, `navigateTo('/')`. The live catalog (54 visible routes) contains
**no** `/news*`, `/outlook` or news-impact entry, and the source of truth —
`createTradingRoutes` in `../tm-hub/scripts/seed/data.ts` — never defines them
either (no `group_news`, no news leaves). The page files and APIs exist and are
green (`app/pages/news/{index,sources,events}.vue`, `app/pages/outlook.vue`,
`server/api/v1/news/*`), and `tests/nav-contracts.test.ts` still lists them as
expected visible leaves — so the seed and the app's nav contract have drifted.

Fix (hub-side, cross-repo): add a News group + `/news`, `/news/sources`,
`/news/events`, `/outlook` and `/data-research/research/news-impact` to
`createTradingRoutes` (with matching `allowed_routes` ids for the roles), then
re-seed the hub (`cd ../tm-hub && pnpm seed --app=trading`). Mirrors the
"routes without a working page are seeded hidden" note in that file, except here
the pages DO exist and the routes are simply absent.

This also revises F6: the earlier "clean" desktop sweep for these routes was a
measurement artifact — the SPA had already redirected to `/` before the title
was read. Trust live navigation over the batch sweep for guarded routes.

Resolved: added a News set to `createTradingRoutes` in
`../tm-hub/scripts/seed/data.ts` (`intel_news` → `/news`, `news_events` →
`/news/events`, `news_sources` → `/news/sources`, `news_outlook` → `/outlook`
under `group_markets`; `research_news_impact` →
`/data-research/research/news-impact` under `group_data_research`) and the ids
to the trading `admin` role's `allowed_routes`. Re-seeded with
`cd ../tm-hub && pnpm seed --app=trading`: the live catalog went 54 → 59 visible
routes and all five pages load (verified in a real browser).

## Processing actions exercised (live)

- **News source enable/disable (PASS).** `/news/sources` → toggled the
  `vnexpress` row off and back on. `PATCH /api/v1/news/sources/vnexpress → 200`
  both times, response `enabled` flipped, the Enabled stat tile went 13 → 12 → 13
  and the switch state followed. Reverted; nothing left changed.
- **Paper order via the terminal ticket (PASS, end-to-end).** `/trading` →
  Execution desk → Ticket → Buy / Market / qty 0.001 / leverage 5x / SL 80000 /
  TP 84000, then `Send order` → `POST /api/v1/orders → 200`
  (`alertKey a1_3154…`, status `received`). Running one paper cycle
  (`node exec/paper.mjs`) opened the position: `OPEN BTCUSDT BUY market
  qty=0.001 @ 81513.03`; it renders in the Positions tab and is in the store
  (`positions`: qty 0.001, entry 81513.03, sl 80000, tps [84000], lev 5).
  Gate exercised too: an earlier ticket with R/R 1.05 was correctly rejected
  with `MIN_RR` (min 1.5, `exec/risk.mjs:65`).
- **Trade ticket form (PASS)** renders correctly at desktop width; the
  empty-TP-slot defect found here (F10) is now fixed and re-verified live.

## Browser pass (round 2) — Shared Resources, Admin System, Tools (all PASS)

Every route in the three groups was loaded with a real hard navigation
(`goto`, not client-side) and checked for: correct final path (no unexpected
redirect), rendered `<h1>`, and a clean console.

- `/shared-resources`, `/shared-resources/connections`, `/shared-resources/import`,
  `/shared-resources/queues` — PASS.
- `/admin-system`, `/admin-system/configs`, `/admin-system/data-sources`,
  `/admin-system/docs`, `/admin-system/health`, `/admin-system/logs`,
  `/admin-system/permissions`, `/admin-system/roles`, `/admin-system/routes`,
  `/admin-system/settings`, `/admin-system/settings/system`,
  `/admin-system/profile`, `/admin-system/profile/push`,
  `/admin-system/profile/security`, `/admin-system/profile/sessions` — PASS.
- `/tools`, `/tools/editor`, `/tools/encode`, `/tools/icons`, `/tools/random` —
  PASS. Note `app/pages/tools.vue` + `app/pages/tools/index.vue` is **not** a
  duplicate route: `app/pages/tools.vue` is the nested-pages parent (owns the
  header, tab strip and `<NuxtPage/>`) and `app/pages/tools/index.vue` its default
  child — the intended pattern.

Mobile (390×844): representative pages from each group
(`/admin-system/roles`, `/admin-system/logs`, `/admin-system/settings/system`,
`/shared-resources/connections`, `/shared-resources/queues`, `/tools/encode`)
report `scrollWidth === clientWidth` — no horizontal overflow.

Console: only benign dev logs (`✅ Service Worker registered`,
`<Suspense> is an experimental feature`); zero JS exceptions and zero Vue
warnings. `npm run typecheck` → 4/4. (The occasional mid-sweep `net::ERR_ABORTED`
/ spurious redirect was the dev server dying — see F13 — not app behaviour; each
route was re-confirmed with a fresh navigation.)

## Terminal desk upgrade pass (round 3) — symbol provenance, wider universe, payload

Three requested upgrades were implemented and verified live on `/trading`
(1280×800, dev server `:4001`).

### Symbol provenance in the picker and the watchlist (DONE)

- `app/utils/venueMeta.ts` — single source of truth mapping a universe `source`
  to `{ label, short, icon }`. Aliases fold the sub-venues onto their brand
  (`binance-spot` → `binance`, `gate-spot` → `gate`, `bitget-spot` → `bitget`,
  `mexc-spot` → `mexc`, `bingx-spot` → `bingx`, `coin-gecko` → `coingecko`).
  Only `binance`, `okx`, `kucoin` and `coinbase` have a brand mark in
  `@iconify-json/simple-icons`; every other venue degrades to its short text
  label instead of a fake icon.
- `app/components/VenueChip.vue` — reusable chip (brand mark when available,
  otherwise the short label, `+N` for the extra venues, `title` lists them all,
  `data-testid="venue-chip"` + `data-venue`). `dense` mode (watchlist) keeps only
  the mark and drops the label and `+N`, so a narrow rail is not eaten by it.
- `app/components/SymbolSearchModal.vue` — `SymbolRow` gained `source` and
  `venues`; both the universe and the catalog-match branch render the chip.
- `app/pages/trading/index.vue` — `pickerAllRows` forwards `source`/`venues`, and
  `PICKER_MAX_ROWS` was raised to `12_000` (the previous `slice(0, 2000)` would
  have silently hidden symbols now that the universe grew). `watchVenues`
  computes symbol → venues and is passed to the watchlist as `venue-index`.
- `app/components/Watchlist.vue` — renders the dense chip next to the spread.

Verified live: picker rows read `MXBTC MX/BTC MEXC`, `MXUSDT MX/USDT BITGET +1`,
`BEAMXUSDC BEAMX/USDC ▣ BINANCE +1`; watchlist rows carry the Binance mark with
the tooltip `Binance · Bybit · OKX · BingX · Gate · Bitget · MEXC`.

### Add-to-watchlist from the picker (DONE)

Every selectable result row also carries a watchlist button (`star-plus` → filled
`star`, disabled once tracked), so a symbol can be tracked without switching the
desk away from the current instrument. The click never selects the row and never
bumps `recent`; the button is disabled when the list already holds the symbol or
the 60-symbol cap (`MAX_WATCHLIST`) is reached, and its label/tooltip explains
which (`trade.pickerAddWatchlist` / `pickerInWatchlist` / `pickerWatchlistFull`).
The row had to become a `div role="option"` wrapping a select button plus the
watchlist button — a `<button>` inside a `<button>` is invalid HTML. Index rows
(unselectable) get no watchlist button, since the feed cannot serve them.
Verified live: `ADA` → click → `tm-term:v1.watchlist` gained `ADAUSDT`, the
button flipped to `Already in the watchlist`, the active instrument stayed
unchanged, and the row appeared in the rail.

### Universe widened from 6 to 12 vendor endpoints (DONE)

`server/utils/marketUniverse.ts` now sweeps Binance spot, Bybit, OKX, BingX perp
and BingX spot, Gate perp and spot, Bitget perp and spot, MEXC perp and spot and
CoinGecko concurrently (`Promise.all`, per-source fail-soft, deterministic
assembly). New `source` values: `binance-spot`, `bingx-spot`, `gate`, `gate-spot`,
`bitget`, `bitget-spot`, `mexc`, `mexc-spot`.

Filtering is per vendor reality, not a guess: Gate futures need
`status === 'trading' && type === 'direct' && in_delisting !== true` **and an empty
`contract_type`** (a non-empty value marks stocks/indices/commodities/forex, which
are not tradeable perps); Gate spot needs `trade_status === 'tradable'`; Bitget
futures need `symbolStatus === 'normal' && symbolType === 'perpetual'`; Bitget
spot needs `status === 'online'`; MEXC futures need `state === 0`; MEXC spot is
Binance-shaped (`status === '1'`, `isSpotTradingAllowed !== false`); BingX spot
needs `status === 1` (0 = offline). A malformed or offline row is dropped, never
routed.

Live result: **8190 rows**, `degraded: false`, all 12 sources present (perp 2048,
spot 6138, index 4). Payload **1,930,464 bytes** uncompressed; the cold sweep takes
~11.8 s (12 hosts, browser includes DNS/TLS) with per-vendor latency under 1.8 s.

### `/api/*` gzip (`server/middleware/api-compress.ts`, DONE)

Nitro's node-server does not compress dynamic responses, so the universe payload
crossed the wire uncompressed. A middleware now gzips `GET`/`HEAD` `/api/*`
bodies ≥ 1 KB and appends `Vary: Accept-Encoding` (it only fires when the body is
a single string/Buffer, the status is 200, no `Content-Encoding` is set yet and
the headers are not flushed; any failure falls through uncompressed). Verified on
the universe request: `content-encoding: gzip`, `content-length: 69284` — about
**28× smaller** — and the client parses it unchanged.

### F14 — the watchlist rail was too narrow for its own row (layout, FIXED)

Found while verifying the chip: at 1280 the dock put the watchlist on
`lg:col-span-2` (~135 px of row). The row has to fit symbol + `24h` change + the
remove button beside the price, and the `1fr` column collapsed to **0 px** — the
symbols were invisible and the chip overflowed the price. Fixes: the rail is now
`lg:col-span-3` with the chart on `lg:col-span-6` (right rail unchanged at 3), the
remove button became a hover/keyboard overlay (`absolute`, hidden on desktop,
always visible below `lg`) so it costs no layout width, and the dense chip is
mark-only. This is a deliberate deviation from the mockup's `2 / 7 / 3` dock at
`lg`+ — the mockup rail cannot host the requested provenance chip at 1280; the
`1fr` column now measures 91–98 px and every cell renders.

### Dev-server trap: `npm run typecheck` kills a running dev server (tooling)

`npm run typecheck` runs `nuxt prepare`, which deletes `.nuxt/dist`; a dev server
that is up flips to the "`.nuxt/dist` directory has been removed. Restarting
Nuxt…" 503 page and can hang there for minutes. Kill the tree
(`taskkill /PID <pid> /T /F`) and restart before doing browser verification. Run
`typecheck` independently of a live UI session.

**A second, easier-to-hit cause of the same 503 loop: two dev servers on the same
project.** Two live `tools/nuxt-dev.mjs` trees both serving `:4001` fight over
`.nuxt/dist` — one rebuilds it while the other keeps noticing its removal, so
every route answers 503 with "Restarting Nuxt…" in the log and the app looks
broken. Restarting the desk is only safe once the port is free; killing just the
`nuxt` child is not enough, because the `pwsh → npm run dev → node
tools/nuxt-dev.mjs` chain can leave a surviving wrapper. Kill and verify with:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'tools/nuxt-dev' -or $_.CommandLine -match 'nuxt\.mjs dev --port 4001' } |
  ForEach-Object { taskkill /PID $_.ProcessId /T /F }
Get-NetTCPConnection -LocalPort 4001 -State Listen   # must be empty before starting
```

Then start exactly one instance and confirm `logs/dev-4001*.log` shows no further
"Restarting Nuxt" lines.

## Card-list page collapse + dock wrap (round 4, FIXED)

### F15 — card-list pages collapsed to zero height (layout, FIXED)

`/news/events`, `/news/index`, `/news/sources`, `/outlook` declared their root as
`flex flex-col w-full h-full min-h-0`. The constraint chain is root → `BasePage`
body (`flex-1 min-h-0 flex flex-col`, definite height) → `UDashboardPanel` body
(`flex-1 overflow-y-auto`). `h-full` + `min-h-0` pinned the root to exactly the
viewport (570 px at 1280), so every `flex-shrink:1` child collapsed to **0 px**
and `scrollHeight` never grew — only hairline borders remained. Fix: drop
`h-full`/`min-h-0` and let the root size to its content (`flex flex-col w-full
pb-24 lg:pb-6 gap-3`); an overflowing non-clipping child then extends the
ancestor scroll container. `min-h-full` does **not** fix it (measured again: root
still 570, cards still 0).

Only pages *without* an internal scroll region break; the list pages that already
work have a dedicated scroll child (`LazyGridList` with `flex-1 min-h-0
overflow-auto`). No test asserts these classes.

Related: a `UAlert` placed *inside* an element with `min-h-0` loses its height —
the alert must be a sibling of the content block, outside the `min-h-0` wrapper
(`class="shrink-0 mb-3"`).

### F16 — dock pushed the chart below the rail (layout, FIXED)

With the watchlist on and the right rail off, `chartCol` was `lg:col-span-10` →
3 + 10 = 13 > 12, so the grid wrapped and the chart fell below the watchlist.
Changed to `lg:col-span-9`. Column rule: watchlist 3; chart 6 (both rails) / 9
(watchlist or right rail only) / 12 (no rails); spans **must** sum to 12.

## Upgrade proposals

- **U1** — Client-side request budget: coalesce/throttle hub calls and honor
  `Retry-After` on 429 (extends F1/F2). **Done** — see F2.
- **U2** — Loading UX: skeleton shell instead of the full-screen INITIALIZING
  splash on hard navigation (extends F3). **Done** — see F3.
- **U3** — Move the notification lifecycle into a client plugin so it does not
  depend on a component's mount (hardens F1). **Done** — the feed lives in
  `useNotifyFeed()` (`app/composables/useNotify.ts`) and its lifecycle (boot
  load + `watch(auth.user)` → refetch/clear) now runs from
  `app/plugins/notify.client.ts`, so it no longer waits for the first of ~48
  consumer components to mount. `useNotify()` keeps its public API identical
  (spread of the feed + toast helpers), and the toast helpers stay out of the
  plugin because `useToast()` uses `inject()`. Verified live: single
  notifications request on boot, feed renders in the bell slideover.
- **U4** — Align `.env` hub URL and AGENTS.md, or document the deployed-hub
  decision (extends F4). **Done** — documented the deployed-hub decision in both
  the `.env` comment block and AGENTS.md; the URL value is intentionally
  unchanged (see F4).
- **U5** — Auth resilience: add a single-flight 401 → `refresh()` → retry
  interceptor for local `/api/v1` calls and/or a pre-expiry refresh timer
  (fixes F9).
- **U6** — Ticket ergonomics: ignore empty trailing TP slots and surface a
  specific "fill or remove the empty TP" error — **done in F10** (empty slots are
  now dropped; `trade.ticketNoTp` covers the no-TP case).
- **U7** — Detail-route semantics: render a dedicated not-found state instead of
  an empty detail shell (extends F11). **Done** — `app/pages/test-center/runs/[id].vue`
  and `app/pages/sessions/[id].vue` now show "Run not found"/"Session not found"
  (`runs.detail.notFound(+Hint)`, `sessions.notFound(+Hint)`, added to both
  locales) with a back link, verified live against unknown ids. The API already
  separates malformed (`400 invalidId`) from missing (`404 notFound`) — no server
  change needed.
