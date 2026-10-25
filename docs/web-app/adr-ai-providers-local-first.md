# ADR — AI providers are app-owned (local-first)

Status: accepted (2026-10-20) · Decision: **D35** · Related: Phase G, tm-hub R147

## Context

TM Hub R147 added `provider_definitions`, app-scoped `connections`, `ai_models`
and `connection_app_grants`, with AES-GCM secrets and discovery adapters. It did
not add a child-app resolver or inference proxy, and `/system/ai-keys` belongs to
tm-tools, not the hub app.

Three options were considered:

1. **Hub proxy** — child apps send inference through the hub; secrets never leave it.
2. **Hub resolver** — authenticated app server receives effective credentials.
3. **App-owned** — each app stores and uses its own credentials; hub is metadata.

## Decision

Use option 3 for AI/LLM connections. TM Hub remains the base registry:

- provider catalog metadata (no secrets);
- app registration, grants and an optional enable/disable overlay;
- audit for hub-owned connections only.

The app owns:

- encrypted connection secrets (`AI_CREDENTIAL_KEY`, AES-256-GCM at rest);
- model selection, capability requirements, budgets and fallback;
- health tests and request audit (`logs/ai.ndjson` + provider health rows).

Hub-owned connections stay hub-side where the credential is inherently central:
identity OAuth (Google/GitHub login), shared storage (Cloudinary bucket), push
(FCM/VAPID). Those are consumed through grants; keys are never copied to apps.

## Consequences

- Phase G can pass locally without hub availability or cross-repo changes.
- The hub cannot revoke an app-owned secret. A hub disable flag is an instruction,
  not enforcement; the app must apply it to its own resolver.
- No inference latency or availability dependency on the hub.
- Each app pays for and rate-limits its own usage; budgets are per connection.
- Cross-protocol fallback is forbidden: only same-adapter, capability-compatible
  targets are candidates. Re-shaping a request silently would change behavior.
- If a future requirement mandates central secret custody, add a hub proxy as a
  *new* source in the resolver; do not move existing secrets.

## Implementation map

- `engine/aiProviders.mjs` — catalog, validation, redaction, fallback and budget rules;
  also `parseConnectionImport`/`resolveProviderKey` for the import surface.
- `engine/aiProviderCrypto.mjs` — AES-256-GCM envelope, no plaintext fallback.
- `ai/providerStore.mjs` — owner-scoped CRUD, health tests, env fallback, usage,
  plus `exportConnections`/`importConnections` (skip/overwrite by provider+label).
- `engine/models/aiProviderConnection.mjs` — persisted config (envelope only).
- API `/api/v1/ai/providers/import|export` — dry-run preview by default; secrets
  only ever sent when the user opts into an export with keys.
- API `/api/v1/ai/providers*` — redacted responses; key is write-only.
- Settings UI — `app/pages/admin-system/ai-providers.vue`.

## Import/export

`AI_PROVIDER_CATALOG` accepts a FreeLLMAPI-adjacent long tail of providers;
unknown platforms without a base URL are reported per row, never silently
dropped as "configured". JSON import is dry-run by default and requires an
explicit `commit: true`, so the preview is a real safety gate. Plaintext keys
travel only inside an opt-in `includeSecrets=1` export, which is also recorded
to the provider audit.
