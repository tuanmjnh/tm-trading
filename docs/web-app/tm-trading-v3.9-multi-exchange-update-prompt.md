# TM Trading V3.9 — Multi-Exchange Demo Adapter Update Prompt

Read `tm-trading-roadmap-v3.9.md` completely, especially Section 64, before coding.

## Goals

1. Keep Bybit demo support and add independently working Binance Demo Trading API and OKX Demo Trading API adapters.
2. Support a user-configured preferred venue and backup order (Bybit/Binance/OKX), health checks, and explicit venue switching for new sessions.
3. Keep this application focused on crypto exchange demo execution. Remove non-crypto broker-terminal execution code, config, routes, tests and documentation from this app. Cross-market news/macro analysis may remain read-only context.
4. Preserve the existing Node.js engine, Nuxt 4, indicator/method logic, AI Agent, Risk Gate, Research and Operations components where valid. Do not rewrite functioning layers without repository evidence.
5. Make production/mainnet order execution impossible within this scope. Validate endpoint hosts server-side against exact demo allowlists. Never trust frontend mode or host selections.

## Mandatory failover rules

- Market-data fallback is a distinct policy and must be labelled with its actual source. It may be enabled only for explicitly allowed analysis/reference data. Never use another venue's prices as the execution venue's mark price or account/order/fill truth.
- Never automatically switch execution venue for an active session. If a venue fails, mark `DEGRADED`, block new entries, reconcile uncertain orders and preserve open positions under their original venue/account. Switching execution venue is an audited manual action that starts a new session after safety checks.
- Never merge balances, PnL, fills, fees or funding across venue accounts.

## Implementation steps

A. Audit existing adapters, environment configuration, endpoints, private streams, connection manager, rate-limit handling, persistence, account/PnL code, Operations UI, bot runtime, AI runtime and tests. Separate verified current behavior from assumptions.

B. Define or reuse one `ExchangeDemoAdapter` contract with capabilities, independent health, market streams, private streams, account/order/fill/position APIs, fee/funding reads, order submission and reconciliation.

C. Fix error isolation, stale-data status, timeout/idempotency, reconnect and snapshot reconciliation before enabling new adapters.

D. Complete Bybit verification, then implement OKX Demo (including `x-simulated-trading: 1` and region-specific official domains), then Binance Demo (separate Spot and USDⓈ-M Futures profiles as supported). Verify every endpoint against current official docs before use.

E. Add a venue selector and backup settings with health/capability cards, clear `MARKET DATA SOURCE` vs `EXECUTION VENUE` labels, and a confirmed “Switch for next session” action.

F. Connect indicator bots and AI bots to the shared Risk Gate + configured demo adapter. AI outputs proposals only; it cannot choose arbitrary hosts, bypass risk or silently switch venue.

G. Persist every external order ID, client order ID, fill ID, fee, funding observation/settlement, account snapshot, reconciliation result, session event and strategy/agent version for history and research.

H. Remove obsolete non-crypto broker execution references/code/tests/config from this app; do not leave dead paths hidden behind UI flags. Do not delete unrelated news/macro analysis features.

## Acceptance criteria

- Each venue separately passes demo endpoint allowlist, authentication, capability probe, read-only snapshot, one controlled demo order, private event/REST reconciliation, idempotent fill persistence, PnL/fee/funding mapping and restart/reconnect tests.
- A failed venue cannot mark another venue unhealthy or cross-contaminate credentials, state or error messages.
- Venue switching is visible, audited and new-session-only for execution. Market-data fallback is independently labelled and policy-gated.
- No production order endpoint or credential can be reached by the bot/AI runtime.
- Run current project gates in the required order, including `test:app`, `docs:check`, `typecheck`, risk/paper tests and adapter-specific demo tests. Never claim a gate passed unless its output was observed.

## Required report (Vietnamese)

List actual changed paths, endpoint/capability evidence per venue, what is fully implemented vs partial/unsupported, test outputs, any migration/rollback plan, and explicit proof that execution remains demo-only. Do not commit unless asked.
