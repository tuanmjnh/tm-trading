# CLAUDE.md — tm-trading

The single source of truth for AI coding agents is **[`AGENTS.md`](./AGENTS.md)**.

## Quick Summary
- **App**: TM Trading Automated Trade Desk & Nuxt 4 Dashboard (Port 4001)
- **Tech Stack**: Node.js ESM (engine/exec/services/ai), Nuxt 4 + Nuxt UI v4 (Tailwind CSS v4)
- **Control Plane**: Satellite of TM Hub (`http://localhost:4000`) with `X-App-Id: tm-trading_8pmp33`
- **Core Modules**: Runs (`/runs`), Signals (`/signals`), Resources (`/resources/*`), Utilities (`/utilities/*`), Administration (`/administration/*`), System (`/system/*`)
- **Push Engine**: Firebase FCM + VAPID Web Push via `useWebPush` and `public/push-sw.js`
- **Commands**:
  - `npm run verify` (Pine build + full test suite)
  - `npm run dev` (Dashboard on `http://localhost:4001/`)
  - `npm run typecheck`
  - `npm run lint`

Please refer to [`AGENTS.md`](./AGENTS.md) for full architecture rules, guardrails, and conventions.
