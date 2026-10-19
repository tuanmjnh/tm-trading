# AI Agent & Session Audit — V3.4 §59.17 Required First Deliverable

> Status: **audit only — no behavior implemented here.** Required before any
> Slice B–F work. Authority: `docs/web-app/tm-trading-roadmap-v3.5.md` §59
> (V3.5 keeps §59 authoritative for AI agents, bots, sessions and autonomy;
> its §60 adds the news/events/macro intelligence domain on top).
> All claims verified against code on 2026-10-16; file paths are the evidence.

## 1. Existing files / models / APIs

### AI stack (`ai/`)

| File | Role | Persistent runtime? |
|---|---|---|
| `ai/gateway.mjs` | Provider translation (OpenAI/Anthropic messages+tools) + `chat()` + file-appended AI log (`appendAiLog`) | No — stateless call wrapper |
| `ai/agent.mjs` | One-shot analysis: `TOOLS = { queryDB }` over whitelisted collections (`runs`, `trades`, `signals`, `intel`), read-only | **No — no loop, no timers, no state, no Mongo writes** |
| `ai/proposal.mjs` | Structured proposal builder (§27.3) | Produces `Proposal` docs (persisted via research API) |
| `ai/research.mjs`, `ai/dataset.mjs` | Evidence-set helpers | Read-only |
| `ai/daily-brief.mjs` | Scheduled brief generator | Output artifact (brief), not a runtime |
| `ai/review.mjs` | Review workflow | Analysis only |

**Answer to §59.17 Q3**: the existing AI agent code is an **analysis tool-caller**, not a persistent autonomous runtime. Nothing in `ai/` loops, holds sessions, or places orders. An `/ai-agents` UI therefore has no agent-runtime records to show today — only gateway config status, tool allowlist (static, from `TOOLS`), and persisted AI *outputs* (proposals, experiments, briefs).

### Execution & risk (`exec/`)

| File | Role |
|---|---|
| `exec/paper.mjs` | Paper executor loop (`--watch`): alerts → gate → orders → fills → positions. CLI-driven, no supervisor record of its own runs |
| `exec/risk.mjs` | Risk gate (`checkOrder`, `recordOpen`/`recordClose`, kill-switch) + ISIN-level audit file |
| `engine/journal.mjs` | Central executed-trade journal (Mongo `journal` + NDJSON mirror) |

### Session-representing fields (Q2 — what exists today)

| Entity (model) | Session-like fields | Missing for §59 sessions |
|---|---|---|
| Bot Instance (`engine/models/botInstance.mjs`) | `instanceId`, `botProfileId`, `strategyVersionId`, mode, state machine (`queued…completed/failed/halted`), `startedAt/stoppedAt`, counts, `paperPnl` | event timeline, restart recovery, order/fill linkage |
| Paper Order (`engine/models/order.mjs`) | `clientOrderId`, `alertKey`, status machine, cancel audit | **no session link** |
| Position (`engine/models/position.mjs`) | `signalKey`, `strategyVersionId`, `leverage` (§17.1b) | **no session link** |
| Journal (`engine/journal.mjs`) | `key/account/source/signalKey`, D3/D4 identity | **no session link** |
| Replay session (`server/utils/replaySessions.ts`) | in-memory id/cursor/mode/speed | **not durable** (dies with the process) |
| Paper Account (`engine/models/account.mjs`) | equity/margin/drawdown per account+day | session-agnostic aggregates |
| Experiment (`engine/models/experiment*.mjs`) | proposal → arms → decision lifecycle | experiment workflow, not live sessions |

**Conclusion (Q2)**: no session entity exists. The minimal new schema (Slice C) is a `trading_sessions` collection: `{ sessionId, kind: 'live-paper'|'replay', strategyVersionId, botProfileId?, accountId, status (running/paused/completed/failed/halted), startedAt/stoppedAt, lastEventAt, eventTimeline[] (capped), orderKeys[], positionIds[], journalKeys[], manifest (engine/params/dataset), restartedFrom? }` — linked FROM orders/fills/positions by `sessionId` (additive nullable field, legacy docs unaffected), never rewritten.

### Hub route/auth integration

TM Hub owns auth/session/RBAC/route registry (`X-App-Id: tm-trading_8pmp33`); the app reads `system_routes` via `GET /api/v1/auth/routes`. Local dev currently runs its own hub (:4000) while `.env` points at production — see open question in §5 below.

## 2. Route / API ownership map (Q4)

| Route (proposed/existing) | Owner | Evidence today |
|---|---|---|
| `/ai-agents` (NEW) | AI gateway + outputs | `ai/gateway.mjs` (config/tools), `engine/models/aiProposal.mjs`, experiments; **no runtime records exist** — list/detail must be built on outputs + static tool allowlist, labeled as such |
| `/bots`, `/bots/instances` | Strategy Lab (existing) | `app/pages/strategy-lab/bots/*`, `/api/v1/bots/*` — Bot Profile ≠ Bot Instance contract enforced |
| `/sessions` (NEW) | **nothing yet** — needs Slice C schema above | closest existing: bot instances (bot-scoped) + replay summaries (ephemeral) |
| `/forward-tests` | Test Center (existing) | `app/pages/test-center/forward.vue`, paper-account API — live-paper monitor, no session abstraction |
| `/research`, `/research/experiments` | AI Research (existing) | proposals → approval → experiment → backtest/holdout → live-paper; D31 guardrail (never silent) |
| `/replay` | Test Center (existing) | `server/utils/replaySessions.ts` — deterministic, in-memory only |

## 3. Is the agent analysis or runtime? (Q3)

Analysis. `ai/agent.mjs` runs one queryDB-assisted pass per invocation and returns text; there is no autonomy loop, no heartbeat, no action schema, no tool beyond read-only queries, and no persistence of its own runs (only the file log via `appendAiLog`). Slice D must therefore BUILD the runtime (versioned config/prompts, tool allowlist, autonomy levels A0–A4, action schema with idempotency keys) — it cannot "expose" one.

## 4. Milestone plan (Q5 — read-only first, per §59.15)

1. **Slice B (read-only)**: `/ai-agents` from gateway status + `TOOLS` allowlist + proposals/experiments/briefs; `/sessions` read-model over bot instances + replay summaries + journal (explicitly labeled as pre-session evidence, every gap labeled, nothing fabricated).
2. **Slice C (durable sessions)**: `trading_sessions` schema + lifecycle transitions + restart recovery; paper runtime creates/updates/closes sessions; orders/fills/positions carry `sessionId`.
3. **Slice D (governance)**: agent config versions, tool allowlist enforcement, A0/A1 → A2-live-paper gating, A3/A4 hard-disabled.
4. **Slice E (evidence loop)**: session evidence bundle → Research Evidence Set → experiment → base-vs-candidate → new live-paper validation session.
5. **Slice F (hardening)**: D33 connection states, stale-feed blocking policy, kill-switch integration, simulated-failure tests per §59.16.

## 5. Open questions / risks

1. **Hub backend**: `.env` `NUXT_PUBLIC_HUB_URL` points at production while AGENTS.md mandates local. Auth/routes behavior (including the `/auth/routes` 500 that blanked the shell) differs per backend — lock one before Slice B e2e tests.
2. **Fapi REST bans on this network** (HTTP 418/−1003): universe/seed endpoints must stay fail-soft; WS-first design already assumes this.
3. **API budget 60 req/min**: session timeline polling must join the visibility-pause + backoff discipline (`useVisibleInterval`, 429 backoff), not add naive pollers.
4. **No silent promotion (D31)** and **no browser-authoritative positions (D32)** constrain every Slice C–E design: sessions record, the executor + gate decide.

## 6. Implementation status of §59.15 (updated 2026-10-16)

Each row names the artifact that proves it — a page existing is never the evidence
(§59.16). All slices A–F are now implemented; the gaps of each are stated below.

| Slice | Status | Evidence |
|---|---|---|
| A — Domain audit / menu | done | this document; `docs/web-app/navigation-audit.md`; agents + sessions in the target navigation |
| B — Read-only observability | done | `server/utils/aiAgents.ts` (status), `server/api/v1/ai/agents.get.ts`, `app/pages/ai-agents/index.vue` (gateway + tool allowlist), `/sessions` list + timeline |
| C — Durable session lifecycle | done | `engine/session.mjs` (pure guards), `engine/models/session.mjs`, `server/utils/sessions.ts` + `server/api/v1/sessions/*`, `exec/paper.mjs` session context with restart recovery (stale sessions superseded, `restartedFrom` chain), `sessionId` on `orders`/`fills`/`positions`, `tests/session.test.ts` |
| D — AI agent governance | done | `engine/agentPolicy.mjs` (autonomy ladder, immutable version hash, tool allowlist, action schema, `authorizeAction`), collections `ai_agents` / `ai_agent_versions` / `ai_agent_actions`, `server/utils/aiAgents.ts` + `server/api/v1/ai-agents/*` (register, versions, validate, start/pause/resume/disable, risk-integration, heartbeat, actions, activity), governance UI on `/ai-agents`, `tests/aiAgents.test.ts` |
| E — Evidence & research feedback | done | `engine/evidence.mjs` + `server/utils/evidenceSets.ts` (deterministic set id, content hash, sample-size floor, `requireProposalEvidence`, auto-freeze on terminal session, `createPaperValidationSession`), `server/api/v1/research/evidence-sets/*` (freeze idempotent by identity, D3), `server/api/v1/research/experiments/[id]/paper-session.post.ts` (409 if active profile already points at candidate — D31), evidence link enforced at `createExperiment` (`server/utils/research.ts`, baseline frozen as `baselineVersionId`), auto-freeze wired in `server/api/v1/sessions/[id]/move.post.ts`, periodic backfill `server/plugins/evidence-backfill.ts`, UI `/data-research/research/evidence` + freeze/link on `/sessions/[id]`, tests `tests/evidence.test.ts` (52) + `tests/research-api.test.ts` baseline cases |
| F — Operational hardening | done | `exec/feedHealth.mjs` (pure D33 states ok/degraded/stale/disconnected/unknown + candle-gap detector, `tests/failureModes.test.ts`), `exec/paper.mjs` §35 gate now fed MEASURED facts (stream state from fetch history, quote age from the bar's data timestamp, real gap check, `PAPER_QUOTE_STALE_MS`/`PAPER_FEED_FAIL_THRESHOLD` policies — the old hardcoded `streamState:'ok'`/`candleGapUnresolved:false` are gone, source-guarded) + watch loop beats the shared heartbeat (`services/heartbeat.mjs` → `/health` + orchestrator overdue alert; Mongo-down cycle = FAILED beat, one-shot stays silent), acceptance suite `tests/failureModes.test.ts` — the six §59.15 simulated failures (disconnection, stale feed, restart, duplicate command, Risk Gate denial, kill-switch) pass offline with injected clocks/fake models |

What Slice D did **not** build, stated plainly: there is still no autonomous model
loop. An agent is a governed configuration plus an audited action trail; asking a
model for an action remains the caller's job, and every order-capable action is
refused unless it carries a session, an idempotency key and a real `exec/risk.mjs`
decision. A3/A4 stay policy-disabled (`LEVEL_DISABLED`), so no code path reaches a
demo connector or real execution.

What Slice E did **not** build: no automatic promotion. The evidence loop ends at
a *proposed* candidate — approval, the §28 comparison decision and activation stay
human actions (`strategy:promote` / the research approve flow), and a paper
validation session is refused outright while the active profile already points at
the candidate version.

What Slice F did **not** build, stated plainly: (1) no session-evidence-bundle
EXPORT endpoint — the UI links to frozen sets but there is no download/export
route yet; (2) kill-switch tripping freezes new orders via the Risk Gate but does
NOT auto-transition the running session to `halted` (the halt and the session are
still two separate records an operator must reconcile); (3) the market-plane WS
`monitor.status()` is still not a feedHealth input — paper prices off REST klines,
so feedHealth tracks the REST fetch path, and the WS latency/sequence stream
(`market/monitor.mjs`, Phase 7R) remains measured-but-unplugged into the gate;
(4) heartbeat alerting for `paper` relies on the services orchestrator's existing
60s overdue check running — a standalone alerter does not exist. All §59.15
slices A–F are implemented; these four are the known open edges.
