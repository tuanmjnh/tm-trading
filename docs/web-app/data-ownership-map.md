# Data Ownership Map

> **Authority:** roadmap `docs/web-app/tm-trading-roadmap-v3.6.md` §61.3 (canonical
> identity, ownership and account scope) and §61.17 Phase B. Phase A deliverable.
> **Companion to:** `docs/web-app/system-integration-map.md` (wiring) and
> `docs/web-app/user-tenancy-plan.md` (the executing plan).
> **Method:** static repo audit + a read-only coverage report produced by
> `node scripts/backfill-owner.mjs --report` on 2026-10-19 against local Mongo
> (`mongodb://localhost:27017/tm-trading`). No claim of runtime execution is made from
> a seed row.

## 1. Ownership axes

| Axis | Meaning | Source |
|---|---|---|
| `ownerId` | hub user id (JWT `sub`) — the **tenant** | `server/utils/owner.ts` |
| `accountId` / `account` | a sub-book (paper/broker account) inside one owner | `engine/models/account.mjs` |

`ownerId` is **not** the same as `accountId`. A record may be account-bound
(`accountId`) *and* owner-bound (`ownerId`); an account-bound mutation must prove the
account belongs to the caller's `ownerId` (§61.3).

## 2. Collection classification

### 2.1 Per-user (MUST be owner-scoped)

**Phase B complete (2026-10-19):** every collection below declares
`ownerId` (`{ type: String, default: null, index: true }`) and is included in the
backfill list. Where a single-field `unique` index existed it was replaced by a
compound `{ ownerId, naturalKey }` unique (no key values were re-derived).

| Collection | Model | Compound unique index |
|---|---|---|
| `alerts` | `alert.mjs` | `ownerId+alertKey` |
| `positions` | `position.mjs` | `ownerId+account+source+externalId` |
| `paper_orders` | `order.mjs` | `ownerId+orderId`, `ownerId+clientOrderId` |
| `paper_fills` | `fill.mjs` | `ownerId+fillId` |
| `paper_accounts` | `account.mjs` | `ownerId+accountId` |
| `risk_state` | `riskState.mjs` | `ownerId+account+utcDay` |
| `trading_sessions` | `session.mjs` | — (`sessionId` unique) |
| `journal` | `journal.mjs` | `ownerId+key` |
| `signals` | `signal.mjs` | — |
| `strategy_profiles` | `strategyProfile.mjs` | — |
| `strategy_versions` | `strategyVersion.mjs` | — (`_id`-keyed, see limitations) |
| `bot_profiles` | `botProfile.mjs` | — |
| `bot_instances` | `botInstance.mjs` | — |
| `alert_rules` | `alertRule.mjs` | `ownerId+ruleKey` |
| `ai_agents` | `aiAgent.mjs` | — (`_id`-keyed, see limitations) |
| `ai_agent_versions` | `aiAgentVersion.mjs` | — |
| `ai_agent_actions` | `aiAgentAction.mjs` | `ownerId+agentId+idempotencyKey` |
| `ai_proposals` | `aiProposal.mjs` | — (`_id`-keyed, see limitations) |
| `research_evidence_sets` | `evidenceSet.mjs` | — (`_id`-keyed, see limitations) |
| `experiments` | `experiment.mjs` | — (`_id`-keyed, see limitations) |
| `experiment_runs` | `experimentRun.mjs` | — (`_id`-keyed, see limitations) |
| `indicator_runs` | `indicatorRun.mjs` | — |
| `notification_logs` | `notificationLog.mjs` | — (`_id`-keyed, see limitations) |
| `trade_context` | `tradeContext.mjs` | — (`_id`-keyed, see limitations) |
| `runs` | `run.mjs` | — |
| `market_snapshots` | `snapshot.mjs` | — |
| `news_evaluations` | `newsEvaluation.mjs` | — |
| `news_evidence_sets` | `newsEvidenceSet.mjs` | — |
| `equity` | `equity.mjs` | — (read-only projection, no production writer) |

### 2.2 Global / shared reference (do NOT scope)

`candles`, `datasets`, `market_feed`, `intel`, `trades` (market trades),
`news_items`, `news_item_revisions`, `news_sources`, `news_market_events`,
`news_market_outlooks`, `news_domain_events`, `news_dead_letters`,
`news_assessments`, `news_macro_*`, `macro_*`.

*(`news_evidence_sets`, `news_evaluations`, `market_snapshots` and `equity` moved
to §2.1: their models declare `ownerId`.)*

## 3. Owner-coverage report

Command: `node scripts/backfill-owner.mjs --report --owner 62da4efe-34b4-4a6b-b4ae-967942ecaf53`

**Before (dry-run, 2026-10-19):** total 676 · owned 39 · foreign 0 · **unassigned 637**
(dominated by `signals` 606, `notification_logs` 16, `strategy_versions` 5,
`bot_instances` 3, `strategy_profiles`/`bot_profiles`/`market_snapshots` 2 each,
`trade_context` 1).

**After (`--owner 62da4efe-…`, applied 2026-10-19):** total 676 · **owned 676** ·
foreign 0 · **unassigned 0**. Every unassigned row was assigned to the single
legacy desk owner; zero foreign-owned rows were seen → no cross-tenant conflict.
Real Mongo backup taken first:
`backups/2026-10-19T00-33-05Z-owner` (`npm run backup:owner`).

## 4. Migration state & rollback

- **Migration:** `scripts/backfill-owner.mjs` (idempotent, parameterized by `--owner`,
  supports `--dry-run`, `--only`, and now `--report`). It matches `{ ownerId: null }`
  (Mongo equality matches both `null` and missing) and `$set`s `ownerId` — it never
  touches an already-owned row, so re-runs are safe.
- **Applied so far:** the eight collections in `COLLECTIONS` → 39 rows.
- **Rollback:** no automated revert yet. A reversible path requires a pre-migration
  backup (`npm run backup`) and then `updateMany({ ownerId: <owner> }, { $unset: { ownerId: 1 } })`
  scoped to rows whose `createdAt` predates the migration window. Because the migration
  is additive and non-destructive, restore-from-backup is the safe rollback.
- **Strict-filter safety (§61.3.5):** do **not** enable strict per-owner filters that
  hide legacy rows until the remaining 637 rows are backfilled and the test data is
  recoverable.

## 5. Gaps to close in Phase B

1. Add `ownerId` (+ index) to every per-user model in §2.1 that lacks it.
2. Extend `COLLECTIONS` in `scripts/backfill-owner.mjs` to the full per-user set and
   re-run the parameterized migration after backup.
3. Add `ownerId` acceptance to the unscoped utils: `journal`, `strategy*`, `bot*`,
   `aiAgents`, `alertRules`, `research`, `evidenceSets`, `indicator-runs`, `runs`,
   `notification_logs`, `trade_context`.
4. Add compound `{ ownerId, accountId }` indexes and owner-prefixed deterministic `_id`s
   (§61.3 migration requirement, previously tracked as P2 in `user-tenancy-plan.md`).
5. Confirm `market_snapshots` classification (global vs per-user).
6. Two-user isolation tests over list/get/create/edit/cancel/close/aggregate/export
   (§61.3.6) — tracked in `implementation-tracker.md`.
