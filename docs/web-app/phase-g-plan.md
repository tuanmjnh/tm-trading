# Phase G — AI provider gateway (local-first)

Status: **in progress** · Decision: **D35** · Roadmap: §61.18

## Goal

One adapter contract for every provider the app uses, with encrypted credentials,
capability checks, health visibility, budgets and audit — without making TM Hub a
runtime dependency.

## Steps

| Step | Scope | Status |
| --- | --- | --- |
| G1 | Provider catalog + validation + redaction (`engine/aiProviders.mjs`) | done |
| G1 | AES-256-GCM credential envelope (`engine/aiProviderCrypto.mjs`) | done |
| G1 | Owner-scoped store, health test, env fallback (`ai/providerStore.mjs`) | done |
| G1 | Request resolution (same-protocol fallback, capability filter) | done |
| G1 | Redacted API + settings UI | done |
| G1 | Budget counters + provider audit | done |
| G2 | Wire per-user callers to the resolver instead of `AI_CFG` | done — `sessionAnalysis` resolves via `resolveAiProvider(ownerId)`; system/CLI services (newsExtract/daily-brief/review/agent) intentionally keep the global env config (no per-owner context) and accept an injected `cfg` for future per-user use; cfg-forwarding is test-locked |
| G2 | Exercise a real OpenRouter / FreeLLMAPI / OpenCode deployment | pending (needs credentials); Google AI (Gemini) verified live (chat + agent tool loop) |
| G2 | Capability tests beyond reachability (tools/structured) | tools done — verified end-to-end with Gemini 3.x (agent loop, real `getKlines` call); structured output still pending |
| G2 | JSON import/export (FreeLLMAPI + tm-trading) with preview/commit | done |
| G2 | Model discovery for unsaved credentials + settings picker | done |
| G3 | Optional hub overlay: read catalog/enable flag, never secrets | pending (hub Phase 6) |

## What exists

- Catalog: OpenAI, OpenRouter, Anthropic, Google AI, Groq, DeepSeek, Mistral,
  Together, Cerebras, Cohere, GitHub Models, Hugging Face Router, NVIDIA NIM,
  Zhipu AI, Ollama, FreeLLMAPI deployment, OpenCode server,
  custom OpenAI-compatible endpoint.
- Import/export: `POST /api/v1/ai/providers/import` (auto-detects a tm-trading
  export or a FreeLLMAPI `{ keys }` payload; dry-run by default, `commit: true`
  to write) and `GET /api/v1/ai/providers/export` (secrets omitted unless
  `includeSecrets=1`). Unknown FreeLLMAPI platforms fall back to a custom
  endpoint when a base URL is present, otherwise they are reported per row.
- Model discovery: `POST /api/v1/ai/providers/connections/discover` tests
  unsaved credentials (`persist: false`, nothing written) and returns the
  advertised model ids; the settings form shows a picker fed by that list.
- Tool calling: the agent loop works end-to-end on Gemini 3.x. Google requires the
  `thought_signature` from each model `tool_call` to be echoed back verbatim on the
  follow-up turn; the gateway preserves `extra_content` through `parseResponse` and
  `toOpenAIMessages` (dropping it returns HTTP 400 `INVALID_ARGUMENT`).
- Connection row: provider, adapter, base URL, model, envelope, mask, fingerprint,
  enabled, status (`untested|ok|error|disabled`), last error/latency, budgets.
- Health test: `GET {baseUrl}/models` with adapter-specific auth; 401/403 →
  `ai.invalid-key`, 429 → `ai.rate-limited`, 5xx → `ai.provider-unavailable`,
  throw → `ai.network`, abort → `ai.timeout`. The configured model is checked
  against the advertised list and a warning is stored when missing.
- Owner isolation: every read/write filters `ownerId`; another owner gets 404.
- Env fallback keeps fresh installs/CI working without a stored row.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Outages and invalid keys visible | row `status`/`lastError` + UI badge; `test:db` §16 |
| Capabilities tested | declared capabilities filtered per request; reachability tested (tools/structured pending G2) |
| No secret in browser | `redactConnection`; API tests assert absence of key/envelope |
| No plaintext at rest/logs | AES-GCM row; audit/test results contain no key |
| Fallback controlled | `fallbackCompatible` requires same adapter + capabilities |
| OpenRouter / FreeLLMAPI / OpenCode | catalog + OpenAI-compatible adapter; real deployment verification pending |

## Deliberate limits

- A health test proves endpoint + credential + model advertisement, not tool or
  structured-output support. Capability claims remain declared until exercised.
- The hub cannot disable an app-owned connection; it can only publish a flag the
  app may honor.
- Budgets are counters, not a billing system; no automatic provider-side quota.
