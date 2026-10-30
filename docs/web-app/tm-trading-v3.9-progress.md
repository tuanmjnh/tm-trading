# TM Trading V3.9 — Multi-Exchange Demo Adapters: Progress & Evidence

Status: implementation complete for the offline-verifiable scope; live demo-account
verification is BLOCKED pending user-provided demo API credentials and a running
worker/DB environment. Version date 2026-10-28. Authority: roadmap Section 64
(see `docs/web-app/tm-trading-roadmap-v3.9.md`) and the task prompt
`docs/web-app/tm-trading-v3.9-multi-exchange-update-prompt.md`.

This document records what was built, the endpoint/capability evidence per venue,
the gate results actually observed, what is fully implemented versus partial or
blocked, and the explicit proof that execution remains demo-only.

## 1. Scope and safety boundary

Execution in this application is limited to crypto exchange DEMO APIs (Bybit,
OKX, Binance). Production/mainnet order placement is impossible by construction:

- Every REST and WS endpoint is validated server-side against an exact demo
  allowlist before any network I/O (`exec/exchange/profiles.mjs`). Production
  hosts are rejected with a stable error code and are covered by tests.
- OKX serves live and demo on the same host, so the `x-simulated-trading: 1`
  header is mandatory and enforced fail-closed; a missing header is refused as a
  potential production request.
- Order capability fails closed until a live probe VERIFIES the required
  capabilities; a connected public market stream is never treated as proof that
  authenticated demo execution works.
- The browser can never choose a host, mode, or credential. Venue, account and
  connection are resolved server-side from persisted, owner-scoped records.

Non-crypto broker (MT5) execution code, tests and IPC docs were already removed
from this app in the prior V3.8 work; no executable non-crypto broker path
remains. Read-only historical provenance (the `source` enum value and journal /
position labels) is intentionally retained so existing records stay valid and
viewable; it is not an execution path. Cross-market news/macro remains read-only
context.

## 2. Changed and created paths

Created — exchange DEMO framework (plain Node, dependency-free, offline-testable):

- `exec/exchange/profiles.mjs` — venue/profile registry, demo-only allowlist, capability matrix
- `exec/exchange/errors.mjs` — per-venue error namespacing, sanitization, correlation ids
- `exec/exchange/throttle.mjs` — isolated per-venue request-weight budget, backoff, clock skew
- `exec/exchange/http.mjs` — signed demo REST client (reuses the V3.8 signer), reconcile-before-resend
- `exec/exchange/normalize.mjs` — venue to canonical mappers (account/position/order/execution/fee/funding/instrument)
- `exec/exchange/stream.mjs` — WS connection manager (reconnect, heartbeat, sequence gaps, resync)
- `exec/exchange/health.mjs` — isolated per-venue health + declared-vs-verified capability gating
- `exec/exchange/reconcile.mjs` — idempotent fill dedupe, order/position reconciliation
- `exec/exchange/failover.mjs` — market-data vs execution-venue failover policy engine
- `exec/exchange/adapter.mjs` — the ExchangeDemoAdapter contract implementation
- `exec/exchange/index.mjs` — runtime factory + public surface
- `exec/exchange/venuePreferenceStore.mjs` — VenuePreference persistence (fail-closed)
- `exec/exchange/eventStore.mjs` — idempotent evidence ledger + order-mapping persistence
- `exec/exchange/executeIntent.mjs` — Risk Gate to adapter order-intent pipeline
- `exec/exchange/botBridge.mjs` — bot/AI to EXCHANGE_DEMO integration seam
- `exec/exchange/exchange.test.mjs` — offline suite (mock fetch + fake socket)

Created — models, server API:

- `engine/models/venuePreference.mjs`
- `engine/models/exchangeEvent.mjs`
- `engine/models/exchangeOrderMapping.mjs`
- `server/utils/exchangeVenues.ts`
- `server/api/v1/exchange-demo/venues/index.get.ts`
- `server/api/v1/exchange-demo/venue-preference/index.get.ts`
- `server/api/v1/exchange-demo/venue-preference/index.put.ts`
- `server/api/v1/exchange-demo/venue-preference/switch.post.ts`
- the per-connection capabilities route under the exchange-demo connections folder

Modified:

- `exec/exchangeDemo.mjs` — fixed a latent URL-construction bug that doubled the path for OKX and Binance signing (Bybit was unaffected); origin and signature are unchanged
- `exec/exchangeDemo.test.mjs` — made the credential-tamper test deterministic (it was flaky ~1 run in 6)
- `engine/session.mjs` — added `EXECUTION_MODES` and additive, nullable execution binding to `createSession`
- `engine/models/session.mjs` — added additive, nullable venue-binding fields
- `app/pages/admin-system/data-sources.vue` — venue preference, health/capability cards, MARKET DATA vs EXECUTION labels, switch-for-next-session flow
- `i18n/locales/en.json` and `i18n/locales/vi.json` — `marketSources.venuePrefs.*` keys
- `package.json` — added the `test:exchange` script
- `tools/test-summary.mjs` — registered the `exchange` suite in the aggregate gate
- `docs/web-app/pine-inventory.md` — regenerated (pre-existing stale doc, unrelated to V3.9)

## 3. Venue profiles and endpoint evidence

Hosts verified against official documentation on 2026-10-28.

| Venue / profile | Demo REST host | Private WS | Public market feed | Auth | Notes |
|---|---|---|---|---|---|
| Bybit (`bybit`) | `api-demo.bybit.com` | `stream-demo.bybit.com` | mainnet public stream (read-only) | HMAC (X-BAPI) | No WS Trade; REST orders + private-stream reconciliation; 7-day order retention |
| OKX (`okx`) | `www.okx.com` | `wspap.okx.com` | `wspap.okx.com` | HMAC (OK-ACCESS) + `x-simulated-trading: 1` | Header is the demo discriminator on a shared host |
| OKX US (`okx-us`) | `us.okx.com` | `wspap.okx.com` | `wspap.okx.com` | as OKX | Region profile inherits OKX |
| OKX EEA (`okx-eea`) | `eea.okx.com` | `wspap.okx.com` | `wspap.okx.com` | as OKX | Region profile inherits OKX |
| Binance USDⓈ-M Futures (`binance-usdm`) | `demo-fapi.binance.com` | `demo-fstream.binance.com` | `demo-fstream.binance.com` | HMAC (X-MBX) | Capabilities UNKNOWN pending rate-limit/error-isolation re-test |
| Binance Spot (`binance`) | `demo-api.binance.com` | `demo-stream.binance.com` | `demo-stream.binance.com` | HMAC (X-MBX) | Spot demo host not confirmable from docs on the verification date; capabilities UNKNOWN, fail closed |

Declared capabilities are docs-derived. Execution capabilities (account, order,
cancel, openOrders, executions, positions) start UNVERIFIED and are only enabled
after a live probe confirms them, so an unverified venue can never submit an order.

## 4. Fully implemented vs partial vs blocked

Fully implemented and verified offline (mock fetch + fake socket, no live venue):

- One `ExchangeDemoAdapter` contract shared by all three venues
- Demo-only allowlist for REST and WS; production hosts rejected before I/O
- OKX simulated-header fail-closed enforcement
- Per-venue isolated throttle, backoff, clock skew, health and error namespace
- Declared-vs-verified capability gating (fail closed)
- Market-data failover (labelled, policy-gated, durable `market.source-switched`)
- Execution-venue failover (never auto-switch; immutable venue; DEGRADED; flat-required manual new-session switch)
- Idempotent fill/order/event persistence with venue+account-scoped keys (no cross-venue collision)
- Risk Gate to adapter order-intent pipeline with reconcile-before-resend on uncertain acks
- Bot/AI bridge that routes only EXCHANGE_DEMO sessions and never lets AI pick a venue/host
- Venue preference model/store, API routes, and the venue selector / health / switch UI
- Session execution binding (mode, immutable venue, connection, market-data venue)

Partial / requires a live demo connection to complete end-to-end:

- Live capability probe, one controlled demo order, private-event and REST
  reconciliation against the real venue, and PnL/fee/funding mapping from real
  demo fills. The adapter methods and persistence exist and are unit-tested with
  fixtures, but a real demo round-trip needs credentials.
- Read-only projection routes for account/positions/orders/executions/costs are
  served by the adapter methods; wiring them as authenticated endpoints is a thin
  step deferred until a live demo connection is available to verify them.

Blocked (cannot be honestly completed in this environment):

- Any acceptance item that requires placing a real demo order or reading a real
  demo account. This needs user-provided demo API keys and network access to the
  venue. No live result is fabricated.
- Enabling EXCHANGE_DEMO inside the running `services/aiAgentWorker.mjs` and
  `services/botWorker.mjs` processes end-to-end. The integration seam
  (`exec/exchange/botBridge.mjs`) is delivered and tested; flipping a live worker
  to EXCHANGE_DEMO additionally requires demo credentials, a running DB and a
  supervised worker to verify boot/restart/reconnect against the venue.

## 5. Gate results (observed)

- `npm run verify` (pine:build + docs:check + npm test): PASS — 2508 pass, 0 fail across 18 suites
- `npm test`: PASS — includes `exchange` 38/0, `exchange-demo` 5/0, `risk` 135/0, `paper` 65/0, `db` 181/0
- `npm run test:app`: PASS — 1395 pass, 0 fail
- `npm run typecheck`: PASS — 4/4 projects (server, app, shared, node)
- `npm run docs:check`: PASS — 1399 pass, 0 fail
- `npm run test:exchange`: PASS — 38/0

A pre-existing, unrelated failure in the pine inventory report (a stale doc from
prior work) was resolved with its own documented remedy, `npm run pine:inventory`.

## 6. Migration and rollback

- Migration: additive. New collections (`venue_preferences`, `exchange_events`,
  `exchange_order_mappings`) are created on first write. Session venue-binding
  fields are nullable and default to `INTERNAL_PAPER` with no venue, so existing
  sessions and the internal-paper path behave exactly as before.
- Rollback: remove the `exec/exchange` folder, the three new models, the new
  server routes and util, and revert the additive session fields, the UI section,
  the i18n keys, the `test:exchange` script and the `tools/test-summary.mjs`
  suite entry. The `exec/exchangeDemo.mjs` signing fix should be KEPT (it is a
  correctness fix), but reverting it only affects OKX/Binance URL construction.

## 7. Demo-only proof

- The registry lists only demo/sandbox hosts; `PRODUCTION_HOSTS` exists solely so
  tests can assert they are rejected.
- Allowlist tests assert production hosts throw `exchange.demo-host-required` /
  `exchange.demo-ws-host-required` before any network I/O.
- The order-intent pipeline refuses non-EXCHANGE_DEMO sessions, refuses a venue
  that differs from the session's immutable venue, and fails closed when
  capabilities are unverified — all covered by tests with zero network calls.
- VenuePreference persistence forces `executionEnvironment = DEMO` and
  `executionSwitchPolicy = MANUAL_NEW_SESSION_ONLY`; the browser cannot override either.
