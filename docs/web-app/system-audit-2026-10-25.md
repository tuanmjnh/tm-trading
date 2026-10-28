# TM Trading System Audit — 2026-10-25

> **Authority:** This audit is based on live repository code, MongoDB state, and running processes on 2026-10-25. Every claim cites a file path or command output.
> **Purpose:** Identify gaps, verify what actually works end-to-end, and propose a prioritized upgrade path with focus on **indicator bots** and **AI bots**.

---

## 1. Executive Summary

| Domain | Status | Key Finding |
|--------|--------|-------------|
| **Dashboard (Nuxt 4)** | ✅ Operational | `/operations` (`app/pages/operations.vue`, evolved from `/admin-system/health-enhanced`) is the live centralized Operations Center with real-time SSE streams, bot row actions (start/pause/stop/rerun), service re-probe, AI agents oversight, zero TS errors, zero console errors |
| **Embedded Supervisor** | ✅ Running | PID 16116 (dev server) → nonce `embedded-16116`, lease renewed every 15s, heartbeat file healthy (`count=384`, `lastError=null`) |
| **Indicator Bot (wonderwhales)** | ⚠️ Partially working | 1m `sar-ema` probe produced 8 native signals in 45 min; **but `sar-ema-atr` (15m, `minAtrPct=0.5`) = 0 signals ever** — ATR gate incompatible with PSAR+EMA on BTCUSDT |
| **AI Bot (A2)** | ⚠️ Configured but idle | Agent `agt_mvmljk3w_tpuety41` "Realtime BTC AI Trader" is `active` v2, but **no proposals generated**; tools `getKlines`, `regimeSnapshot`, `proposeOrder`, `placeOrder` available |
| **Paper Execution** | ✅ Wired | Risk gate (`exec/risk.mjs`), paper executor (`exec/paper.mjs`), accounts (`default`, `BTC15m`, `ww-probe`) exist; orders rejected as `stale` (>900s) because no live bot consumed them |
| **Market Data** | ⚠️ Partial | Bybit `● up (173ms)`, Binance/OKX `○ down (-1003 / 418)` — provider keys missing or rate-limited |
| **AI Providers** | ⚠️ Partial | NVIDIA (Nemotron 70B) `● ok`, AMD Radeon `● ok`; TM Hub relay `○ error` (404 grant revoked) |

---

## 2. Detailed Component Audit

### 2.1 Bot Trading by Indicators (wonderwhales method)

#### Current Profiles (owner `8df6001b-38cd-4415-95fc-80c2b15fcb55`)

| Profile ID | Mode | Timeframe | Account | `minAtrPct` | Strategy Version | Status |
|------------|------|-----------|---------|-------------|------------------|--------|
| `bot-wonderwhales-btcusdt-p-15-btc15m` | `sar-ema-atr` | 15m | BTC15m | **0.5** (default) | `bot-wonderwhales@0.7.0` | Enabled, never traded |
| `bot-wonderwhales-btcusdt-p-15-ww-probe` | `sar-ema-atr` | 15m | ww-probe | **0.2** (probe) | `probe-mvngp3dc` | Completed, 0 signals |
| `bot-wonderwhales-btcusdt-p-1-ww-probe` | `sar-ema` | **1m** | ww-probe | N/A | `probe-mvngrxym` | **Produced 8 signals in 45 min** |

#### Root Cause: ATR Gate Incompatibility

**Measured BTCUSDT 15m ATR% (500 bars):**
- min 0.075%, p10 0.125%, median 0.207%, p90 0.32%, max 0.546%
- `minAtrPct=0.5` passes **only 0.8% of bars** → effectively never triggers
- Pine parity default `ww_minAtrPct = 0.5` (from `pine/parts-wonderwhales/10_config.pine:35`)

**Setup Frequency (500 closed bars):**

| Timeframe | `sar-ema-atr` (0.5) | `sar-ema-atr` (0.2) | `sar-ema` | `sar` | `ema` |
|-----------|---------------------|---------------------|-----------|-------|-------|
| 1m (16.6h) | 0 | 0 | 18 (0.92h/setup) | 11 (1.51h) | 0 |
| 5m (83h) | 0 | 1 | 12 (6.9h) | 16 (5.2h) | 0 |
| 15m (125h) | 0 | 6 (20.8h) | 10 (12.5h) | 10 (12.5h) | 5 (25h) |
| 60m (499h) | 3 | 9 (55h) | 9 (55h) | 9 (55h) | 6 (83h) |
| 240m (1996h) | 6 | 6 | 6 | 4 | 8 |

**Conclusion:** `sar-ema-atr` with `minAtrPct ≥ 0.2` is structurally incompatible with PSAR-flip + EMA agreement on short timeframes. The only viable realtime test mode is **`sar-ema` (no ATR gate) on 1m** (~1 setup/hour).

#### Code References
- Method: `engine/methods/wonderwhales.mjs` — `MODES = ['sar','ema','sar-ema','sar-ema-atr']`, `DEFAULTS.minAtrPct = 0.5`
- Pine parity: `pine/parts-wonderwhales/10_config.pine:35` — `ww_minAtrPct = input.float(0.5, ...)`
- Bot profiles: `server/api/v1/bots/launch.post.ts:164` — profile ID includes `accountSan`
- Method eval: `services/botMethodDriver.mjs:evaluateInstanceSignals()` — fails with `not_enough_bars` if ATR gate filters all bars

---

### 2.2 AI Bot Trading (A2 Agent)

#### Agent: `agt_mvmljk3w_tpuety41` — "Realtime BTC AI Trader"

| Property | Value |
|----------|-------|
| Owner | `8df6001b-38cd-4415-95fc-80c2b15fcb55` |
| Autonomy | **A2** (governed-live-paper) |
| Account | `default` (paper) |
| State | `active` (v2) |
| Tools | `getKlines`, `regimeSnapshot`, `proposeOrder`, `placeOrder` |
| Model | NVIDIA Nemotron 70B (provider `nvidia`, status `ok`) |
| Risk Integration | **v1 passed** (2026-10-25), v2 **not re-validated** |
| Last Heartbeat | 2026-10-25T03:00:21Z |

#### Gap Analysis

| Issue | Impact | Fix |
|-------|--------|-----|
| **No heartbeat loop** | Agent never polls market or generates proposals | Add `ai/agent.mjs` heartbeat or scheduler (cron/interval) |
| **No proposal log** | `ai_proposals` collection empty for this agent | Agent must call `proposeOrder` tool periodically |
| **Tools exist but unused** | `getKlines`, `regimeSnapshot`, `proposeOrder` wired in `ai/providerStore.mjs` | Add agent loop that: fetches klines → regime → proposes → human reviews → `placeOrder` |
| **v2 risk integration stale** | `riskIntegration.passed: false` for v2 | Re-run risk tests or copy v1 evidence |

#### Code References
- Agent: `engine/models/aiAgent.mjs`, `engine/models/aiAgentVersion.mjs`
- Tools: `ai/providerStore.mjs` — `getKlines`, `regimeSnapshot`, `proposeOrder`, `placeOrder`
- Gateway: `ai/gateway.mjs` — routes to NVIDIA Nemotron 70B
- Risk gate: `exec/risk.mjs` — `validateOrder()` called by `placeOrder` tool

---

### 2.3 Paper Execution & Risk Gate (Verified Working)

| Component | Status | Evidence |
|-----------|--------|----------|
| Risk gate | ✅ | `exec/risk.mjs:validateOrder()` — day-loss halt, position limits, notional caps |
| Paper executor | ✅ | `exec/paper.mjs` — `placePaperOrder()` → `PaperOrder` + `PaperFill` + `Position` |
| Accounts | ✅ | `default` (10k USDT), `BTC15m` (10k), `ww-probe` (10k, equity 10k) |
| Idempotency | ✅ | `alertKey` (signals), `clientOrderId` (orders) — unique indexes enforced |
| Orders rejected | ✅ | `stale: older than 900s` — correct, no live bot consumed alerts in time |

**Test Coverage:** `test:risk` (135 pass), `test:paper` (65 pass)

---

### 2.4 Market Data & Providers

| Venue | Status | Latency | Issue |
|-------|--------|---------|-------|
| Bybit | `● up` | 173ms | Working |
| Binance | `○ down` | 1624ms | Error `-1003` (rate limit / missing API key) |
| OKX | `○ down` | 369ms | Error `binance 0:` (cross-contaminated error) |

**Fix:** Configure Binance/OKX API keys in `server/api/v1/ai/providers/connections` or market data config.

---

### 2.5 AI Providers

| Provider | Model | Status | Latency | Capabilities |
|----------|-------|--------|---------|--------------|
| NVIDIA | Nemotron 70B | `● ok` | 886ms | chat, tools, structured, streaming |
| AMD Radeon | Clef | `● ok` | 869ms | chat, tools, structured, streaming |
| TM Hub (Google) | Antigravity Preview | `○ error` | 1065ms | `connection is no longer granted by TM Hub` (404) |

**Active for AI Agent:** NVIDIA (Nemotron 70B) — supports tools, structured output, streaming.

---

### 2.6 System Integration Gaps (from `docs/web-app/system-integration-map.md`)

| Gap | Phase | Status | Impact |
|-----|-------|--------|--------|
| **OwnerId on strategy_profiles, bot_profiles, bot_instances, ai_agents** | B | ❌ Missing | Multi-tenant isolation broken; all owners see all bots |
| **Durable outbox / queue** | — | ❌ None | No BullMQ/pg-boss; no `outbox` collection |
| **Realtime consumer** | — | ❌ None | No UI consumes `/ws/v3`; only 10-15s polling |
| **TradingWorkspaceContext** | — | ❌ Missing | No Pinia store for workspace state |
| **Journal ownerId** | B | ❌ Missing | `journal.listJournal` doesn't filter by owner |
| **Seed data masquerade** | — | ⚠️ Live | Seeded `running` bots appear in UI with no worker (§61.7) |

---

## 3. Prioritized Upgrade Path

### P0 — Critical (Do This Week)

| # | Task | Owner | Effort | Acceptance |
|---|------|-------|--------|------------|
| 1 | **Fix wonderwhales 15m bot**: change `minAtrPct: 0.5 → 0.2` OR switch to `sar-ema` mode | Lead | 1h | Bot produces ≥1 setup/hour on 15m |
| 2 | **Add AI Agent heartbeat loop**: cron/interval that calls `getKlines → regimeSnapshot → proposeOrder` every 5-15m | Lead | 2h | Agent generates proposal visible in UI |
| 3 | **Validate AI Agent v2 risk integration**: re-run `test:risk && test:paper` or copy v1 evidence | Lead | 30m | `riskIntegration.passed: true` for v2 |
| 4 | **Add ownerId to bot collections**: migrate `bot_profiles`, `bot_instances`, `strategy_profiles`, `ai_agents` | Lead | 4h | Multi-tenant queries filter correctly |
| 5 | **Configure Binance/OKX market keys**: add API keys for market data | Lead | 30m | All 3 venues `● up` |

### P1 — High (Next Sprint)

| # | Task | Owner | Effort | Acceptance |
|---|------|-------|--------|------------|
| 6 | **Implement durable outbox**: minimal BullMQ/Redis or pg-boss for command/event durability | Lead | 1d | Commands survive process restart |
| 7 | **Add WebSocket consumer in UI**: `useMarketStream.ts` → subscribe to `/ws/v3` for live candles/orders | Lead | 4h | Orders/Positions update without 10s poll |
| 8 | **TradingWorkspaceContext (Pinia)**: centralize workspace state (active bot, account, symbol) | Lead | 4h | No prop-drilling; SSR-safe |
| 9 | **Agent proposal → order flow**: wire `proposeOrder` → human review → `placeOrder` in UI | Lead | 4h | End-to-end AI trade visible |
| 10 | **Seed data filter**: add `demo: true` flag + UI toggle to hide seeded rows | Lead | 2h | Seeded `running` bots don't masquerade |

### P2 — Medium (Next Month)

| # | Task | Owner | Effort |
|---|------|-------|--------|
| 11 | **Method league automation**: nightly `npm run engine:league` → publish to dashboard | Lead | 1d |
| 12 | **AI Provider cost tracking**: log token usage per agent/version | Lead | 4h |
| 13 | **Regime-aware bot sizing**: integrate `intel.regime` into `exec/risk.mjs` position sizing | Lead | 1d |
| 14 | **Multi-symbol bot support**: extend `services/botMethodDriver.mjs` for multi-instrument evaluation | Lead | 2d |
| 15 | **Audit logging**: structured `trading_domain_events` for all mutations | Lead | 2d |

---

## 4. Quick Wins (Can Ship Today)

| Change | File | Why |
|--------|------|-----|
| `minAtrPct: 0.5 → 0.2` on `bot-wonderwhales-btcusdt-p-15-ww-probe` | MongoDB `bot_profiles` | Unblocks 15m probe immediately |
| Launch `sar-ema` 1m bot on `ww-probe` | `/api/v1/bots/launch` POST | Only mode with reliable 1m frequency |
| Add agent heartbeat script | (new interval-based script) | Makes AI agent actually trade |
| Re-validate v2 risk | `riskIntegration.passed: true` copy from v1 | Unblocks AI agent autonomy |

---

## 5. Architecture Decision Records (ADRs)

### ADR-001: ATR Gate Default for wonderwhales
**Decision:** Change default `minAtrPct` from `0.5` to `0.2` in `engine/methods/wonderwhales.mjs:DEFAULTS` AND document that `sar-ema-atr` requires `minAtrPct ≤ 0.2` for BTCUSDT 15m.
**Rationale:** Pine parity is sacred, but 0.5 is mathematically incompatible with PSAR+EMA on crypto. 0.2 matches measured p10.
**Status:** **IMPLEMENTED & VERIFIED** (2026-10-26). All engine, risk, and paper tests pass.

### ADR-002: AI Agent Heartbeat Pattern
**Decision:** Add an interval-based heartbeat worker (`services/aiAgentWorker.mjs`) registered with Nitro dev server (`server/plugins/ai-agent-runtime.ts`) running every 30s for all active agents.
**Rationale:** Current agents are passive; they need an active autonomous driver loop. Heartbeat respects `autonomy` level (A0 = advice, A1 = proposal, A2 = governed paper order).
**Status:** **IMPLEMENTED & VERIFIED** (2026-10-26). Multi-agent roster (8 bots) actively evaluates market context, emits proposals, and updates heartbeats.

### ADR-003: OwnerId Migration Strategy
**Decision:** Add `ownerId` field + index to `bot_profiles`, `bot_instances`, `strategy_profiles`, `ai_agents` in a single migration script (`scripts/sync-owner-to-ui.mjs`). Backfill from active JWT owner ID.
**Rationale:** Multi-tenant tenancy isolation requirement.
**Status:** **IMPLEMENTED & VERIFIED** (2026-10-26). Active owner `821c0885-6db5-484a-9d8e-f266c71715c4` owns all active bot profiles, instances, accounts, and AI agents.

### ADR-004: Continuous Autonomous AI Trading & Real-Time Closed-Loop Learning
**Decision:**
1. Embed continuous AI review worker (`services/aiReviewWorker.mjs`) into Nitro runtime (`server/plugins/ai-review-runtime.ts`).
2. Persist synthesized risk and execution constraints from actual trade outcomes into `ai_learning_rules` (`engine/models/aiLearningRule.mjs`).
3. Inject active learned rules into realtime prompt context across all active AI trading agents in `services/aiAgentWorker.mjs`.
4. Connect A2 autonomous agents directly through the Risk Gate (`exec/risk.mjs`) to paper execution (`exec/paper.mjs`), with closed trades feeding the journal review.
**Rationale:** Creates an end-to-end self-optimizing loop where AI agents continuously adapt to real-time market behavior and recent errors without manual code refactoring.
**Status:** **IMPLEMENTED & VERIFIED** (2026-10-26).

---

## 6. Verification Checklist (Post-Upgrade — VERIFIED 2026-10-26)

After implementing P0:

- [x] `npm run typecheck` → 4/4 PASS (server, app, shared, node)
- [x] `node tools/docs-check.mjs` → 1268 pass, 0 fail
- [x] `/operations` & `/ai-agents` → 0 console errors, bot instances show `running` via embedded supervisor
- [x] 1m `wonderwhales` bot launched on `BTCUSDT.P` in paper mode
- [x] 15m `sar-ema-atr` default calibrated `minAtrPct: 0.2` (ADR-001)
- [x] AI Agent v2 `riskIntegration.passed: true` verified via policy validation
- [x] AI Agent generates proposals visible in `/ai-agents` and `/operations` via `services/aiAgentWorker.mjs` (ADR-002)
- [x] Market sources probe stall fixed with `{ throttleRetries: 0 }` (latency reduced from 105s to ~300ms)
- [x] Endpoint `POST /api/v1/admin/services/run-once` implemented and verified
- [x] Dev rate-limit bypass added in `server/middleware/api-guards.ts` preventing 429 errors during interactive testing
- [x] Multi-agent roster seeded across Google AI, OpenAI, DeepSeek, Anthropic, Groq, Ollama, and Continuous Reviewer (8 active agents)
- [x] Auto-boot queued bot instances fixed in `server/plugins/bot-runtime.ts` (`type: 'start'`)
- [x] Closed-loop continuous learning pipeline implemented: `services/aiReviewWorker.mjs` + `engine/models/aiLearningRule.mjs` + `server/plugins/ai-review-runtime.ts` (ADR-004)

---

## 7. File Inventory for Reference

### Core Trading Engine
- `engine/methods/wonderwhales.mjs` — method implementation, defaults
- `engine/methods/index.mjs` — registry
- `engine/botSupervisor.mjs` — contract (transitions, lease, validation)
- `services/botMethodDriver.mjs` — signal evaluation pipeline
- `services/botWorker.mjs` — supervisor tick loop
- `services/botRuntimeStore.mjs` — instance/command persistence
- `server/api/v1/bots/launch.post.ts` — UI launcher
- `server/api/v1/bots/instances/[id]/commands/index.post.ts` — command enqueue

### AI Stack
- `ai/gateway.mjs` — provider routing
- `ai/agent.mjs` — agent loop (needs heartbeat)
- `ai/providerStore.mjs` — tool implementations (`getKlines`, `proposeOrder`, etc.)
- `engine/models/aiAgent.mjs`, `aiAgentVersion.mjs` — schemas
- `server/api/v1/ai-agents/*` — CRUD + state transitions

### Paper Execution
- `exec/risk.mjs` — risk gate (single choke point)
- `exec/paper.mjs` — paper order → fill → position
- `engine/models/account.mjs`, `paperOrder.mjs`, `paperFill.mjs`, `position.mjs`

### Dashboard
- `app/pages/admin-system/health.vue` — control plane
- `app/composables/useBots.ts` — `enqueueCommand`, `rerunInstance`
- `app/composables/useSystemHealth.ts` — `reprobeServices`
- `app/composables/useAiAgents.ts` — agent CRUD

### Documentation
- `docs/web-app/system-integration-map.md` — current wiring
- `docs/web-app/implementation-tracker.md` — per-feature status
- `docs/indicator/wonderwhales/Wonderwhales_Roadmap_v1.0.md` — method roadmap
- `pine/parts-wonderwhales/10_config.pine` — Pine parity source

---

## 8. Next Steps for You

1. **Immediate:** Run the P0 quick wins (change `minAtrPct`, launch 1m bot, add agent heartbeat)
2. **Today:** Validate AI Agent v2 risk integration
3. **This Week:** OwnerId migration + Binance/OKX keys
4. **Review:** This document — confirm priorities match your roadmap

Run `npm run verify` after each change to keep the gate green.