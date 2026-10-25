# Phase H — Contextual in-module assistant

Status: **done** · Spec: §61.12 · Roadmap: §61.17 · Depends on: Phase G (provider gateway)

## Goal

One reusable, read-only assistant that answers questions from the *current
authorized context*, instead of a separate chat per module. Every factual
statement is grounded in a **server-built context bundle** and cites the internal
record ids it used.

## Design rules

- **Server builds the bundle.** The client never submits "trusted facts"; it sends
  a scope (module + record id) and a question. The server re-fetches the
  referenced records with an **owner-scoped** read and rejects a foreign record
  with 404 (no cross-tenant read, no context carry-over between users).
- **Owner-scoped tools, not the agent's tools.** H1–H3 shipped with no tools
  because the existing `ai/agent.mjs` tools read shared files (`queryDB`) and are
  not owner-scoped. H4 added a SEPARATE A0 allowlist
  (`engine/agentPolicy.mjs ASSISTANT_READ_TOOLS`) with owner-scoped read tools:
  the server injects the verified owner into every execution, the model can only
  choose WHICH owned record, and a name outside the allowlist is BLOCKED. The
  `READ_TOOLS === ai/agent.mjs TOOL_NAMES` invariant (tests/aiAgents.test.ts) is
  untouched.
- **Read-only.** The assistant cannot place/modify/cancel orders and must say so.
- **Cite.** The bundle carries `refs` (record id + kind); the prompt requires the
  model to cite the ids it used and to label fact vs inference.
- **Fail closed on tenancy, fail soft on the provider.** Missing ownership → 404;
  missing AI key → 503 `ai_unconfigured`.

## Steps

| Step | Scope | Status |
| --- | --- | --- |
| H1 | Owner-scoped context-bundle builder + read-only ask endpoint (scope: `session`) | done |
| H2 | Reusable `ModuleAssistantPanel` UI (`app/components/base/ModuleAssistantPanel.vue`, `BaseResponsiveSlideover`) + wired into Session detail | done |
| H3 | More scopes: signal, provider/settings diagnosis, news/outlook (cited NewsItem/MarketEvent) | done |
| H4 | Owner-scoped read tools behind a separate A0 allowlist (replaces "no tools") | done |
| H5 | Conversation metadata + messages persisted under the user, with retention | done |

## H1 surface

- `server/utils/moduleAssistant.ts`
  - `buildSessionContext(session)` — pure; compact bundle + `refs`, no secrets.
  - `askModuleAssistant({ ownerId, sessionId, question }, deps?)` — owner-scoped
    read (`getTradingSession`), owner-resolved provider (`resolveAiProvider`, D35
    with env fallback), one `chat()` call with no tools.
- `POST /api/v1/assistant/ask` — body `{ sessionId, question }`; owner from the
  verified hub token.
- Tests: `tests/assistant.test.ts` (owner isolation, bundle shape, guardrails,
  provider failure mapping).

## Acceptance (H1)

A question about a session is answered from that session's bundle only; a
different owner asking for the same id gets 404; no bundle field carries another
owner's data; the model is told it is advisory and read-only.

## H3 surface

- `POST /api/v1/assistant/ask` accepts `{ scope, question }`; the legacy
  `{ sessionId, question }` shape maps to a `session` scope. Scope types:
  `session`, `signal`, `provider`, `news`, `market_event`, `outlook`.
- `server/utils/moduleAssistant.ts` — pure bundle builders per scope:
  - `buildSignalContext` (`signal`, alerts or native engine row, no `ownerId`);
  - `buildProviderContext` (allowlisted redacted rows: no key, ciphertext, mask,
    fingerprint; URL query secrets redacted);
  - `buildNewsItemContext` (rights-gated NewsItem projection, publication vs
    first-seen times preserved);
  - `buildMarketEventContext` (event + capped evidence items, every item id a ref);
  - `buildOutlookContext` (as-of/expiry/stale/invalidation, supporting and
    counter-evidence refs).
- Reads: `getSignal`/`getNativeSignal` are owner-scoped; provider rows come from
  `listAiConnections(ownerId)`; news/outlook use the existing rights-gated reads.
  A foreign signal/provider id is 404. Owner-scoped scopes fail closed (401)
  without a verified owner.
- UI: `ModuleAssistantPanel` takes a `scope` prop (sessionId still supported) and
  is wired into Session detail, Signals (per row), Outlook, Market Events (per
  event) and AI provider settings.
- Tests: `tests/assistant.test.ts` covers per-scope bundles, secret stripping,
  cross-tenant 404, fail-closed owner checks and selector validation.

## Acceptance (H3)

Signal/provider asks cannot read another owner's record; provider bundles never
contain secrets or masks; news/outlook answers can only cite ids present in the
server-built refs, and show as-of/stale/contrary-evidence fields when present.

## H4 surface (done)

- `engine/agentPolicy.mjs` — `ASSISTANT_READ_TOOLS` (listSessions, getSession,
  listSignals, listPositions, listOrders) + `checkAssistantTool(name)`; separate
  from `READ_TOOLS`, so the `ai/agent.mjs` tool invariant is untouched.
- `server/utils/moduleAssistantTools.ts` — OpenAI-style specs + owner-scoped
  executors; the owner is never a model argument (server injects it).
- `server/utils/moduleAssistant.ts` — bounded tool loop (`MAX_TOOL_ROUNDS = 4`):
  specs offered only when an owner is present and the resolved provider does not
  declare `tools: false`; each call re-checked against the allowlist (blocked
  names return an error result, never execute); results fed back as `role:'tool'`
  messages; the response carries `toolCalls` + `truncated`.
- Tests: `tests/assistant.test.ts` — executor set equals the allowlist, owner
  injection, tool result feedback, blocked non-allowlisted tool, foreign id stays
  owner-scoped, round cap truncation.

## H5 surface (done)

- `engine/models/aiAssistantConversation.mjs` — one doc per conversation
  (`ownerId` = hub user), capped messages (drop oldest, counted), sliding
  `expiresAt` purged by a Mongo TTL index.
- `server/utils/assistantConversations.ts` — pure helpers (turn shape, patch,
  retention `ASSISTANT_CONVERSATION_TTL_DAYS`, default 30 days, public
  projection that never leaks `ownerId`) + fail-soft IO (injectable Model).
- Endpoints: `GET /api/v1/assistant/conversations` (newest first),
  `GET|DELETE /api/v1/assistant/conversations/:id` (owner-scoped; a foreign id is
  404, never a silent read/delete). `POST /api/v1/assistant/ask` accepts
  `conversationId` and appends the verified turn (fail-soft — history never
  breaks the ask).
- UI: `ModuleAssistantPanel.vue` — message thread, history drawer (open/delete),
  new-conversation reset; i18n `assistant.history`/`newConversation`/
  `conversationsEmpty`/`deleteConversation` (en+vi).
- Tests: `tests/assistantConversations.test.ts` — turn/patch/capping/retention
  purity, owner-scoped IO (foreign id never hijacked/read/deleted), expired-row
  hiding, Mongo-down fail-soft.

## Acceptance (H4/H5)

Tool calls only ever read the signed-in user's records (a foreign id returns
"not found", never data); a tool name outside the allowlist is blocked; the
conversation list/get/delete are owner-scoped; retention is a config value and
expired rows are invisible before the TTL sweep.