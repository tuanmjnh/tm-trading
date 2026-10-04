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
npm run build          # assemble pine/parts* -> pine/dist (4 targets) + lint
npm test               # smoke + engine + journal + preset-drift + risk + paper
                       # + drift + mt5 + db + services + ai + ai-review (12 suites)
npm run verify         # build + test  <- the gate; must stay green
npm run typecheck      # tools/typecheck.mjs

npm run dev            # Nuxt dashboard  -> http://localhost:4001/
npm run services       # run periodic services (watch mode)
npm run services:once  # run all services once
npm run services:status# service + heartbeat status

npm run engine:run     # backtest CLI (--symbols --tfs --market --preset)
npm run engine:league  # method league table -> docs/method-league.md
npm run notify         # TradingView webhook receiver

npm run ai:gateway     # smoke the AI provider gateway
npm run ai:agent       # run the AI agent
npm run ai:brief       # force a daily brief

npm run backup         # backup

# Central Seeding via tm-hub:
# cd ../tm-hub && pnpm seed --app=trading        # sync routes, roles, & configs
# cd ../tm-hub && pnpm seed:reset --app=trading  # reset and recreate trading data
```

Individual suites: `test:pines`, `test:engine`, `test:journal`, `test:preset-drift`,
`test:risk`, `test:paper`, `test:drift`, `test:db`, `test:services`, `test:ai`,
`test:ai-review`, `test:app`.

## Layout

```
engine/           ta, version, keys, db, data, backtest, report, store, run, league,
                  journal (central executed-trade journal),
                  preset-drift (live preset vs frozen backtest preset)
engine/methods/   method plugins: vsa (method 0), priceAction, trend, orderflow (+ index, all)
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
pine/             parts/ parts-vsa/ shared/ dist/   (build inputs; dist is generated)
tools/            build, smoke, errors, copy, pine-ref, typecheck, backup
docs/             roadmap, architecture, data-model, time-rules, alert-schema, mt5-ipc,
                  method-league, vsa-wyckoff-method, vsa-optimization, app-inheritance
tests/            run-tests.mjs (app-level suite)
```

## Architecture rules that must not be broken

### 1. Pine ↔ engine parity is risk #1
`docs/vsa-wyckoff-method.md` is the **spec**; golden fixtures in `engine/test.mjs` guarantee the
engine matches Pine. Any change to `pine/parts-vsa/` (or `engine/methods/vsa.mjs`) requires
re-running the fixtures. `tools/build.mjs` lints Pine against `tools/pine-ref.json`, which is
**generated** (`npm run ref`) — never hardcode Pine knowledge from memory.

### 2. Every stored result carries a version stamp (D1)
`engine/version.mjs` — `engineVersion`, `paramsHash`, `params`, `dataHash`, `universeSnapshot`,
`gitRev`. Bump `ENGINE_VERSION` whenever behaviour changes. **Never mix runs from different
`paramsHash`/`engineVersion`** in a report or preset table.

### 3. No order without the risk gate (D7)
`exec/risk.mjs` is the single choke point for every order (manual, scanner, AI, MT5). AI output is
**proposals only** — see the guardrail comments in `ai/agent.mjs` and `ai/daily-brief.mjs`.

### 4. Idempotency has two layers (D3/D4)
`engine/keys.mjs`: `alertKey` (alert dedupe; unique index on `alerts.alertKey`) and
`clientOrderId` (order-layer idempotency). Never rely on in-memory dedupe for anything that can
place an order.

### 5. Time is UTC everywhere (D2)
See `docs/time-rules.md`. Business days are `YYYY-MM-DD` strings, never local time.

### 6. Measurement honesty (D12)
Phase 5 (preset optimizer) was **deliberately skipped**: the random-entry baseline showed VSA is
not distinguishable from random entries, so tuning parameters would only produce confident
overfitting. Read `docs/vsa-optimization.md` before proposing any parameter optimisation.

## Platform Integration — Satellite of TM Hub

`tm-hub` (Port 4000) is the central IAM, route catalog, configuration store, and notification hub:

- **Satellite Connection**:
  - Connects to TM Hub via `useHub()` (wrapping `tm-hub-client`) with `X-App-Id: tm-trading_8pmp33`.
  - Login/auth requests go directly to Hub (`POST /api/v1/auth/login`).
  - Configure via `.env`: `NUXT_PUBLIC_HUB_URL=http://localhost:4000`, `NUXT_PUBLIC_HUB_APP_ID=tm-trading_8pmp33`.
- **Dynamic Menu Catalog**:
  - Navigation menu is fetched from TM Hub via `GET /api/v1/apps/:appId/routes` (`system_routes` table) filtered by `isVisible !== false`.
  - Route labels map to i18n keys (`nav.*`).
- **Satellite Administration & Resources Modules**:
  - `/administration/*` (Users, Roles, Permissions, Routes, Configs, Logs, Apps) and `/resources/*` (Media, Inbox, Notifications, Connections, Import, Queues) interface with TM Hub API while displaying locally in the dashboard.
- **Push Notifications & Firebase FCM**:
  - Device subscriptions use `useWebPush.ts` and `public/push-sw.js`.
  - Supports both **Firebase Cloud Messaging (FCM)** and standard **VAPID Web Push** dispatched via TM Hub.

## UI & Coding Conventions

- **BasePage Mandatory**:
  - Every page MUST wrap its layout in `<BasePage :title="..." :description="...">`.
  - Auxiliary header buttons belong in `template #right`.
  - Primary actions use `color="primary" variant="soft"`.
- **GridList & Batch Deletion**:
  - Prefer `LazyGridList` over `BaseTable`. Always provide a `#mobile-content` slot for responsive cards.
  - Delete operations support batch removal using `LazyBaseConfirmModal`.
- **i18n Mandatory**:
  - All user-facing strings MUST be defined in both `i18n/locales/en.json` and `i18n/locales/vi.json`.
  - Never hardcode raw English or Vietnamese in template markup.
- **Language Policy**:
  - All NEW code, comments, log/error strings, CLI output and docs MUST be in English.
  - User-facing Vietnamese belongs strictly in `i18n/locales/vi.json` via `t()`.

## Testing & Verification

Verification is manual:
```bash
npm run verify        # build Pine + run all unit/smoke suites
npm run typecheck     # Nuxt vue-tsc typecheck
npm run lint          # ESLint check
```
