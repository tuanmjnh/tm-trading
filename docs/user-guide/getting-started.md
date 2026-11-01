# Getting Started

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 18 or newer | `package.json` declares `engines.node >= 18`. Nuxt 4 works best on a current LTS. |
| npm | This repo uses **npm**, not pnpm. See `.npmrc`. |
| MongoDB | Local by default: `mongodb://localhost:27017/tm-trading`. Most data (intel, news, signals, runs) lives here. The app fails soft without it, but shows empty tables. |
| A TM Hub account | Identity is delegated. You cannot create a TM Trading account inside this app. |
| Network access to the Hub | The committed `.env` points at the deployed hub, `https://tm-hub-app.vercel.app`. |

Optional, per feature:

| Feature | Requires |
| --- | --- |
| Telegram alerts | `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID` |
| AI summaries and extraction | `AI_API_KEY` (and provider settings) |
| Macro calendar | `FRED_API_KEY` |
| Exchange demo testing | Demo credentials, plus `EXCHANGE_DEMO_CREDENTIAL_KEY` |

## 2. Install

```bash
cd D:/Applications/tm-trading
npm install
```

`postinstall` runs `nuxt prepare`, which generates the Nuxt types. If typecheck
complains about missing `.nuxt` types, run `npm install` again.

## 3. Configure the environment

Copy the example file and fill in the values you need:

```bash
cp .env.example .env
```

The four values that must be correct before the app is usable:

| Variable | Purpose | Typical value |
| --- | --- | --- |
| `NUXT_PUBLIC_HUB_URL` | Which TM Hub issues your session | `https://tm-hub-app.vercel.app` |
| `NUXT_PUBLIC_HUB_APP_ID` | This app's identity in the Hub | `tm-trading_ghfseu` |
| `AUTH_JWT_SECRET` | Verifies Hub-issued JWTs offline (HS256) | must match the Hub's value |
| `MONGODB_URI` | Primary data store | `mongodb://localhost:27017/tm-trading` |

> **Important:** `NUXT_PUBLIC_HUB_APP_ID` and `AUTH_JWT_SECRET` are **rewritten**
> whenever someone runs `pnpm seed --app=trading` in `../tm-hub`. The local hub
> and the deployed hub share one Supabase project, so seeding is a production
> change. See [operations.md](operations.md#6-seeding-and-the-route-registry).

Everything else has a safe default and degrades gracefully:

- no `TELEGRAM_TOKEN` → sends return `false`, nothing is queued or retried;
- no `AI_API_KEY` → AI services skip cleanly;
- no `FRED_API_KEY` → the macro service skips cleanly.

## 4. Start the app

```bash
npm run dev
```

Open `http://localhost:4001`. The dev wrapper (`tools/nuxt-dev.mjs`) starts Nuxt
with `--no-fork` so a browser disconnect does not restart the server.

Other useful entry points:

| Command | What it does |
| --- | --- |
| `npm run dev` | Dashboard on port 4001 |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build on port 4001 |
| `npm run services` | Start the periodic services in watch mode (legacy orchestrator) |
| `npm run services:once` | Run every periodic service one time |
| `npm run services:status` | Print the service heartbeat table |
| `npm run services:supervised` | Start the V4.2 supervisor (one process per service) |
| `npm run services:supervisor:status` | Print the supervisor's desired/observed table |

## 5. Log in

1. Open `http://localhost:4001`.
2. You are redirected to the login page, which posts credentials **directly to
   TM Hub** (`POST /api/v1/auth/login` on the configured hub URL).
3. After login, the app stores the Hub-issued token and verifies its signature
   locally with `AUTH_JWT_SECRET`.

If login fails, the cause is almost always one of:

- the Hub URL is unreachable from your machine;
- `AUTH_JWT_SECRET` does not match the Hub's secret;
- your account does not have the `tm-trading` app assigned in the Hub;
- your role does not grant any route in this app, so the menu renders empty.

See [troubleshooting.md](troubleshooting.md#1-cannot-log-in).

## 6. First run checklist

Do these in order. Each step tells you what "good" looks like.

| Step | Action | Good result |
| --- | --- | --- |
| 1 | Log in | Sidebar renders the workspaces your role allows |
| 2 | Open **Operations** | The page loads; the service table may be empty on a fresh install |
| 3 | Run `npm run services:once` in a terminal | The command finishes and prints `OK` lines per service |
| 4 | Reload **Operations** | Services show a recent `lastRunAt`, not "never" |
| 5 | Open **Markets** | The intel table has rows (needs Mongo + network to Binance) |
| 6 | Open **News** | Items appear if the news service ran and sources are enabled |
| 7 | Open **Alerts** | You can create a rule; delivery needs Telegram configured |

If step 5 or 6 is empty, the app is working but the **producer** has not run or
has no data source. That is a data problem, not a UI problem — read
[troubleshooting.md](troubleshooting.md#4-tables-are-empty).

## 7. Where the data comes from

Understanding this prevents most "the page is broken" reports.

```
Binance REST + WebSocket ─┐
FRED (macro)             ─┼─> services/*.mjs ─> MongoDB ─> Nitro API ─> Nuxt pages
News feeds + AI extract  ─┤
AI providers             ─┘
```

- **No service running → no new data.** Pages still render, but tables age.
- **Mongo down → empty tables**, not an error page.
- **Provider key missing → that one service skips**, the others continue.
- **Telegram missing → alerts are evaluated and logged, but not delivered.**

## 8. Verifying your checkout

Before reporting a bug, run the repository gate:

```bash
npm run verify
```

This runs the Pine build, the docs consistency check, and the full test suite. A
green run means the code you have is internally consistent; it does not mean your
Mongo has data.

For UI-only changes, also run:

```bash
npm run typecheck
npm run test:app
```
