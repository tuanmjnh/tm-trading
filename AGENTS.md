# AGENTS.md — tm-trading

Guidance for AI coding agents working in this repository.

> **This file describes `tm-trading` only.** For tm-hub read `../tm-hub/AGENTS.md`, and for tm-tools read `../tm-tools/AGENTS.md`.

## What this project is

An **automated trade desk** and quantitative signal execution platform with an integrated Nuxt 4 administration dashboard:

- **`engine/`** — Node ESM signal engine + backtester (the backbone)
- **`exec/`** — risk gate, drift detection, paper execution
- **`services/`** — periodic jobs: intel, regime, scanner, funding, liquidation, confluence
- **`ai/`** — AI copilot: provider gateway, tool-calling agent, daily brief
- **`app/`** — Nuxt 4 dashboard (Nuxt UI v4 + Tailwind v4) running on Port 4001 (`APP_PORT=4001`)
- **`pine/`** — TradingView indicators, a **supporting tool** (signal source + manual cross-check), not the product
- **`server/`** — the TradingView webhook receiver (zero-dependency Node HTTP)

**Engine core is dependency-free.** `tools/build.mjs`, `engine/ta.mjs`, `engine/methods/*`,
`engine/version.mjs` and their tests run with plain Node — no `npm install` needed. Nuxt and
Mongoose are only required for the dashboard and the store layer.

## Commands

**Package manager is `npm`** (not pnpm). See `.npmrc` and "Environment gotchas" below.

```bash
npm run pine:build          # assemble pine/parts* -> pine/dist (13 targets) + lint
npm test               # smoke + engine + market + journal + preset-drift + stamp + risk
                       # + paper + drift + exchange-demo + db + services + ai + ai-review (14 suites)
npm run verify         # pine:build + test  <- the gate; must stay green
npm run typecheck      # tools/typecheck.mjs

npm run dev            # Nuxt dashboard  -> http://localhost:4001/
npm run services       # run periodic services (watch mode)
npm run services:once  # run all services once
npm run services:status# service + heartbeat status

npm run engine:run     # backtest CLI (--symbols --tfs --market --preset)
npm run engine:league  # method league table -> docs/engine/method-league.md
npm run notify         # TradingView webhook receiver

npm run ai:gateway     # smoke the AI provider gateway
npm run ai:agent       # run the AI agent
npm run ai:brief       # force a daily brief

npm run backup         # backup

# Central Seeding via tm-hub:
# cd ../tm-hub && pnpm seed --app=trading        # sync routes, roles, & configs
# cd ../tm-hub && pnpm seed:reset --app=trading  # reset and recreate trading data
```

Individual suites: `test:pines`, `test:engine`, `test:market`, `test:journal`,
`test:preset-drift`, `test:risk`, `test:paper`, `test:drift`, `test:db`, `test:services`, `test:ai`, `test:ai-review`, `test:app`.

## Layout

```
engine/           ta, version, keys, db, data, backtest, report, store, run, league,
                  journal (central executed-trade journal),
                  preset-drift (live preset vs frozen backtest preset)
engine/methods/   method plugins: vsa (method 0), priceAction, trend, orderflow (+ index, all)
market/           realtime market plane: canonical events, trading clock, candle builder,
                  1m->4m/10m aggregation, quote/orderbook stores, bus, Binance provider
exec/             risk, drift, paper, env
services/         binance, news, funding, scanner, regime, liquidation, confluence,
                  telegram, heartbeat, store, run
ai/               gateway, agent, daily-brief, review
app/              Nuxt dashboard:
  ├── components/ BasePage, LazyGridList, LazyBaseConfirmModal, JsonEditor, form inputs
  ├── composables/ useAuth, useHub (tm-hub-client wrapper), useNavMenu, useWebPush
  ├── layouts/    default.vue (dashboard layout with sidebar)
  ├── pages/
  │   ├── index.vue, runs.vue, signals.vue
  │   ├── administration/ (users, roles, permissions, routes, configs, logs, apps)
  │   ├── resources/      (media, inbox, notifications, connections, import, queues)
  │   ├── utilities/      (text, icons, encode, random, editor)
  │   └── system/         (profile, docs, settings)
server/           webhook.mjs (TradingView receiver)
pine/             parts/ parts-vsa/ parts-longkaco-vsa/ parts-sweep/ parts-xau/ parts-xau2/ shared/ dist/   (build inputs; dist is generated)
tools/            build, smoke, errors, copy, pine-ref, typecheck, backup
docs/             roadmap, architecture, data-model, time-rules, alert-schema,
                  method-league, vsa-wyckoff-method, vsa-optimization, app-inheritance
tests/            run-tests.mjs (app-level suite)
```

## Architecture rules that must not be broken

### 1. Pine ↔ engine parity is risk #1
`docs/indicator/vsa-wyckoff/vsa-wyckoff-method.md` is the **spec**; golden fixtures in `engine/test.mjs` guarantee the
engine matches Pine. Any change to `pine/parts-vsa/` (or `engine/methods/vsa.mjs`) requires
re-running the fixtures. `tools/build.mjs` lints Pine against `tools/pine-ref.json`, which is
**generated** (`npm run pine:ref`) — never hardcode Pine knowledge from memory.

### 2. Every stored result carries a version stamp (D1)
`engine/version.mjs` — `engineVersion`, `paramsHash`, `params`, `dataHash`, `universeSnapshot`,
`gitRev`. Bump `ENGINE_VERSION` whenever behaviour changes. **Never mix runs from different
`paramsHash`/`engineVersion`** in a report or preset table.

### 3. No order without the risk gate (D7)
`exec/risk.mjs` is the single choke point for every order (manual, scanner, AI, exchange demo). AI output is
**proposals only** — see the guardrail comments in `ai/agent.mjs` and `ai/daily-brief.mjs`.

### 4. Idempotency has two layers (D3/D4)
`engine/keys.mjs`: `alertKey` (alert dedupe; unique index on `alerts.alertKey`) and
`clientOrderId` (order-layer idempotency). Never rely on in-memory dedupe for anything that can
place an order.

### 5. Time is UTC everywhere (D2)
See `docs/engine/time-rules.md`. Business days are `YYYY-MM-DD` strings, never local time.

### 6. Measurement honesty (D12)
Phase 5 (preset optimizer) was **deliberately skipped**: the random-entry baseline showed VSA is
not distinguishable from random entries, so tuning parameters would only produce confident
overfitting. Read `docs/indicator/vsa-wyckoff/vsa-optimization.md` before proposing any parameter optimisation.

## Platform Integration — Satellite of TM Hub

`tm-hub` (Port 4000) is the central IAM, route catalog, configuration store, and notification hub:

- **Satellite Connection**:
  - Connects to TM Hub via `useHub()` (wrapping `tm-hub-client`) with `X-App-Id: tm-trading_ghfseu`.
  - Login/auth requests go directly to Hub (`POST /api/v1/auth/login`).
  - Configure via `.env`: `NUXT_PUBLIC_HUB_URL=http://localhost:4000`, `NUXT_PUBLIC_HUB_APP_ID=tm-trading_ghfseu`.
    - **Note**: the committed `.env` currently points `NUXT_PUBLIC_HUB_URL` at the **deployed** hub (`https://tm-hub-app.vercel.app`) because the local hub is seeded with a different appId and rejects this app's login payload (`400 error.missingLoginFields`). See `docs/web-app/ui-test-findings.md` (F4/U4).
- **Dynamic Menu Catalog**:
  - Navigation menu is fetched from TM Hub via `GET /api/v1/apps/:appId/routes` (`system_routes` table) filtered by `isVisible !== false`.
  - Route labels map to i18n keys (`nav.*`).
- **Satellite Administration & Resources Modules**:
  - `/administration/*` (Users, Roles, Permissions, Routes, Configs, Logs, Apps) and `/resources/*` (Media, Inbox, Notifications, Connections, Import, Queues) interface with TM Hub API while displaying locally in the dashboard.
- **Push Notifications & Firebase FCM**:
  - Device subscriptions use `useWebPush.ts` and `public/push-sw.js`.
  - Supports both **Firebase Cloud Messaging (FCM)** and standard **VAPID Web Push** dispatched via TM Hub.

## UI & Coding Conventions

- **Open Source First**: Đối với những chức năng chưa quen thuộc, đừng viết từ con số 0, hãy tìm kiếm các dự án mã nguồn mở trên GitHub để so sánh ý tưởng trước khi bắt tay vào làm.
- **BasePage Mandatory**:
  - Every page MUST wrap its layout in `<BasePage :title="..." :description="...">`.
- **Button Variants**:
  - Primary action buttons (save, create, run, confirm, launch, export, …) use `color="primary" variant="soft"` — exactly one per surface.
  - Dismissal / secondary buttons (cancel, back, close, skip, dismiss, …) use `variant="ghost"` (usually `color="neutral"`) — they must never compete visually with the primary action.
  - Destructive confirmations use `color="error"`; their cancel counterpart stays `variant="ghost"`.
- **Form Controls & Inputs**:
  - Always add class `w-full` for inputs (`UInput`, `USelect`, `USelectMenu`, `UTextarea`, etc.) to ensure consistent responsive layout across all forms.
- **Page Actions (unified bar — apply to every page going forward)**:
  - Register page actions ONCE via `useMobileBar().registerActions()` (from the page or its component — never declare them twice). Mark exactly one action `primary: true` (usually "Add").
  - **Desktop**: all actions render in `BasePage`'s `UDashboardNavbar` (`#right`). The primary action is a labeled pill; every secondary action collapses into the `⋯` dropdown, never displayed as standalone buttons. When a page has no `#right` slot this happens automatically via `BasePageActions`; legacy pages may keep a hand-written `#right` (use `BaseHeaderActions` for the overflow logic).
  - **Mobile**: ALL page actions MUST be reachable from the bottom bar — `BottomNav` shows the primary icon + info + `⋯` + record count, `NavActionsSheet` owns the overflow actions and global actions (bell/settings/profile/scan). Non-primary registered actions are overflow-only and must NOT also render outside.
  - Call `mobileBar.registerInfo()` so the bottom bar can show the record count / loading state.
  - In-page action rows are deprecated — do not add new ones.
- **GridList & Batch Deletion**:
  - Prefer `LazyGridList` over `BaseTable`. Always provide a `#mobile-content` slot for responsive cards.
  - Delete operations support batch removal using `LazyBaseConfirmModal`.
- **Lazy components (code splitting)**:
  - Any component that mounts on demand — modals, slidesovers, drawers, heavy panels, tab content — MUST be referenced with the Nuxt `Lazy` prefix (e.g. `<LazyBaseResponsiveModal>`, `<LazyBaseConfirmModal>`, `<LazyTradingSymbolSearchModal>`). The Lazy prefix puts the component in its own chunk and defers loading until it is actually rendered.
  - Direct (non-lazy) references are reserved for always-visible, above-the-fold chrome (BasePage, nav, grid list).
- **Type placement (Nuxt 4 standard)**:
  - Types used by BOTH the Vue app and the Nitro server live in `shared/types/` (import via the built-in `#shared/types/<file>` alias).
  - App-only types live in `app/types/`; server-only types live in `server/types/`. There is NO root-level `types/` folder.
  - One canonical definition per type name across the auto-imported surfaces (`app/types`, `server/types`, `shared/types`) — duplicated interface names across those folders trip the unimport "Duplicated imports" warnings.
  - Values (type guards, status consts) belong in `shared/utils/` or `app/utils/`, not in types folders.
- **Tailwind CSS Conventions**:
  - Explicit pixel values using arbitrary brackets (e.g. max-h-[200px], w-[320px]) are acceptable for clarity. Shorthand scale enforcement (	ailwindcss/enforces-shorthand) and canonical class warnings are disabled.
- **i18n Mandatory**:
  - All user-facing strings MUST be defined in both `i18n/locales/en.json` and `i18n/locales/vi.json`.
  - **No Inline i18n Fallbacks**: NEVER pass fallback text as a second string argument to `t()` (e.g. `t('key', 'Fallback text')` is strictly forbidden). Always define keys directly in both `i18n/locales/en.json` and `i18n/locales/vi.json`, and invoke `t('key')` without inline fallback string arguments.
  - Never hardcode raw English or Vietnamese in template markup.
- **Language Policy**:
  - All NEW code, comments, log/error strings, CLI output and docs MUST be in English.
  - User-facing Vietnamese belongs strictly in `i18n/locales/vi.json` via `t()`.

## Testing & Verification

Verification is manual:
```bash
npm run verify        # build + docs:check + full test suites (writes logs/test-summary.json)
npm run docs:check      # docs ↔ repo consistency (scripts + file paths in docs must exist)
npm run typecheck     # Nuxt vue-tsc typecheck
```
