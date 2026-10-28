// engine/aiProviders.mjs
// Phase G (local-first): the app owns its AI provider connections. TM Hub may
// publish provider *metadata* and an optional enable/disable overlay, but no key
// ever leaves this app and no inference request is proxied through the hub.
// That is the architecture decision recorded as D35 in the roadmap.
//
// This module is pure: catalog, validation, redaction, fallback policy, budget
// math. IO (Mongo, fetch, encryption at rest) lives in ai/providerStore.mjs.
import { createHash } from 'node:crypto'

export const AI_PROVIDER_SCHEMA_VERSION = 'ai-provider.v1'

/** Wire families the gateway actually implements (ai/gateway.mjs). */
export const AI_ADAPTER_TYPES = Object.freeze(['openai_compatible', 'anthropic', 'ollama', 'hub_relay'])

/** Capability keys an assignment or fallback may require. */
export const AI_CAPABILITY_KEYS = Object.freeze(['chat', 'tools', 'structured', 'streaming'])

const CAP = (chat, tools = false, structured = false, streaming = false) => ({ chat, tools, structured, streaming })

/**
 * Builtin catalog. `key` is the stable id; `baseUrl` is only a default — a
 * connection may override it (self-hosted gateways, regional endpoints).
 * `requiresBaseUrl` providers have no safe default and must be configured.
 */
export const AI_PROVIDER_CATALOG = Object.freeze([
  { key: 'openai', name: 'OpenAI', adapter: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'openrouter', name: 'OpenRouter', adapter: 'openai_compatible', baseUrl: 'https://openrouter.ai/api/v1', requiresBaseUrl: false, keyless: false, privacy: 'aggregator', capabilities: CAP(true, true, true, true) },
  { key: 'anthropic', name: 'Anthropic', adapter: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, false, true) },
  { key: 'google_ai', name: 'Google AI (Gemini)', adapter: 'openai_compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'groq', name: 'Groq', adapter: 'openai_compatible', baseUrl: 'https://api.groq.com/openai/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'deepseek', name: 'DeepSeek', adapter: 'openai_compatible', baseUrl: 'https://api.deepseek.com/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, false, true, true) },
  { key: 'mistral', name: 'Mistral', adapter: 'openai_compatible', baseUrl: 'https://api.mistral.ai/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'together', name: 'Together AI', adapter: 'openai_compatible', baseUrl: 'https://api.together.xyz/v1', requiresBaseUrl: false, keyless: false, privacy: 'aggregator', capabilities: CAP(true, true, true, true) },
  { key: 'cerebras', name: 'Cerebras', adapter: 'openai_compatible', baseUrl: 'https://api.cerebras.ai/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'amd_radeon', name: 'AMD Radeon AI', adapter: 'openai_compatible', baseUrl: 'https://developer.amd.com.cn/radeon/api/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'cohere', name: 'Cohere (compatibility API)', adapter: 'openai_compatible', baseUrl: 'https://api.cohere.ai/compatibility/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'github_models', name: 'GitHub Models', adapter: 'openai_compatible', baseUrl: 'https://models.inference.ai.azure.com', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'huggingface', name: 'Hugging Face Router', adapter: 'openai_compatible', baseUrl: 'https://router.huggingface.co/v1', requiresBaseUrl: false, keyless: false, privacy: 'aggregator', capabilities: CAP(true, true, true, true) },
  { key: 'nvidia', name: 'NVIDIA NIM', adapter: 'openai_compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'zhipu', name: 'Zhipu AI', adapter: 'openai_compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', requiresBaseUrl: false, keyless: false, privacy: 'vendor', capabilities: CAP(true, true, true, true) },
  { key: 'ollama', name: 'Ollama (local)', adapter: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', requiresBaseUrl: false, keyless: true, privacy: 'local', capabilities: CAP(true, false, false, true) },
  { key: 'freellmapi', name: 'FreeLLMAPI deployment', adapter: 'openai_compatible', baseUrl: 'http://127.0.0.1:31415/v1', requiresBaseUrl: false, keyless: true, privacy: 'deployment', capabilities: CAP(true, true, true, true) },
  { key: 'opencode', name: 'OpenCode server (OpenAI-compatible)', adapter: 'openai_compatible', baseUrl: null, requiresBaseUrl: true, keyless: false, privacy: 'deployment', capabilities: CAP(true, true, true, true) },
  { key: 'custom_openai', name: 'Custom OpenAI-compatible endpoint', adapter: 'openai_compatible', baseUrl: null, requiresBaseUrl: true, keyless: false, privacy: 'deployment', capabilities: CAP(true, true, true, true) },
  // TM Hub relay (managed by hub sync, never created by hand): this app holds no
  // key at all — every inference call is proxied through tm-hub, which owns the
  // credential. Needs NUXT_PUBLIC_HUB_URL / NUXT_PUBLIC_HUB_APP_ID /
  // NUXT_HUB_APP_SECRET on this app. Plain chat only until the relay forwards
  // tool schemas.
  { key: 'hub', name: 'TM Hub (shared AI)', adapter: 'hub_relay', baseUrl: null, requiresBaseUrl: false, keyless: true, noBaseUrl: true, privacy: 'hub', capabilities: CAP(true, false, false, false) },
])

export const PROVIDER_KEYS = Object.freeze(AI_PROVIDER_CATALOG.map((p) => p.key))

const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export function providerDefinition(key) {
  const k = String(key ?? '').trim().toLowerCase()
  return AI_PROVIDER_CATALOG.find((p) => p.key === k) ?? null
}

const PROVIDER_ALIASES = Object.freeze({
  'google': 'google_ai',
  'google ai': 'google_ai',
  'google ai studio': 'google_ai',
  'gemini': 'google_ai',
  'github': 'github_models',
  'github models': 'github_models',
  'hf': 'huggingface',
  'hugging face': 'huggingface',
  'nvidia nim': 'nvidia',
  'z.ai': 'zhipu',
  'bigmodel': 'zhipu',
  'custom': 'custom_openai',
  'openai-compatible': 'custom_openai',
  'openai compatible': 'custom_openai',
})

export function resolveProviderKey(input, baseUrl) {
  const raw = String(input ?? '').trim().toLowerCase()
  const mapped = PROVIDER_ALIASES[raw] ?? raw
  if (providerDefinition(mapped)) return mapped
  if (str(baseUrl)) return 'custom_openai'
  return null
}

function importEntries(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.connections)) return payload.connections
  if (Array.isArray(payload?.keys)) return payload.keys
  return []
}

function importName(entry, fallback) {
  const raw = String(entry?.name ?? entry?.label ?? fallback ?? 'default').trim()
  const slug = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return slug || 'default'
}

/**
 * Parse a tm-trading export or a FreeLLMAPI `{ keys: [...] }` payload. Secrets
 * stay in memory here and are handed straight to the store during commit.
 */
export function parseConnectionImport(payload, { defaultModel = '' } = {}) {
  const entries = importEntries(payload)
  if (entries.length === 0) {
    return { ok: false, rows: [], errors: [{ index: null, label: null, message: 'no connections or keys array found' }] }
  }
  const rows = []
  const errors = []
  const usedNames = new Set()

  entries.forEach((entry, index) => {
    const label = String(entry?.label ?? entry?.name ?? entry?.platform ?? '').slice(0, 80) || null
    const baseUrl = str(entry?.baseUrl ?? entry?.base_url ?? entry?.apiBase ?? entry?.api_base)
    const provider = resolveProviderKey(entry?.provider ?? entry?.platform, baseUrl)
    if (!provider) {
      errors.push({ index, label, message: 'unsupported provider and no baseUrl to use as a custom endpoint' })
      return
    }
    const def = providerDefinition(provider)
    const model = str(entry?.model ?? entry?.modelId ?? entry?.defaultModel) ?? str(defaultModel)
    if (!model) {
      errors.push({ index, label, message: 'model is required (enter a default model for rows without one)' })
      return
    }
    const apiKey = String(entry?.apiKey ?? entry?.key ?? entry?.token ?? entry?.secret ?? '').trim()
    const isKeyless = def?.keyless || isLocalEndpoint(baseUrl)
    if (!isKeyless && !apiKey) {
      errors.push({ index, label, message: 'apiKey is missing' })
      return
    }
    let name = importName(entry, label ?? provider)
    if (usedNames.has(`${provider}:${name}`)) {
      let n = 2
      while (usedNames.has(`${provider}:${name}-${n}`)) n += 1
      name = `${name}-${n}`
    }
    usedNames.add(`${provider}:${name}`)
    const normalized = normalizeConnection({
      provider,
      name,
      model,
      baseUrl,
      apiKey,
      enabled: entry?.enabled !== false && entry?.disabled !== true,
    }, { requireKey: false })
    if (!normalized.ok) {
      errors.push({ index, label, message: normalized.errors.join('; ') })
      return
    }
    rows.push({ ...normalized.connection, sourceIndex: index })
  })

  return { ok: rows.length > 0, rows, errors }
}

export function isLocalEndpoint(url) {
  if (!url) return false
  const s = String(url).trim()
  if (!s) return false
  try {
    const raw = s.includes('://') ? s : `http://${s}`
    const u = new URL(raw)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')
      || /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(h)
  } catch {
    return /localhost|127\.0\.0\.1|::1|0\.0\.0\.0|\.local/i.test(s)
  }
}

export function capabilitiesFor(key) {
  const def = providerDefinition(key)
  return def ? { ...def.capabilities } : null
}

/** True when the provider declares every capability the caller requires. */
export function supports(providerKey, required = ['chat']) {
  const caps = capabilitiesFor(providerKey)
  if (!caps) return false
  return (Array.isArray(required) ? required : [required]).every((c) => caps[c] === true)
}

const URL_RE = /^https?:\/\/[^\s]+$/i

/**
 * Validate one provider connection. Never echoes the secret: the returned
 * object carries `apiKey` only for the caller that will encrypt it immediately.
 * @returns {{ok:boolean, errors:string[], connection?:object}}
 */
export function normalizeConnection(input = {}, { requireKey = true } = {}) {
  const errors = []
  const key = String(input.provider ?? input.key ?? '').trim().toLowerCase()
  const def = providerDefinition(key)
  if (!def) {
    errors.push(`unknown provider: ${String(input.provider ?? '') || '(empty)'}`)
    return { ok: false, errors }
  }
  const explicitBase = str(input.baseUrl)
  const baseUrl = explicitBase ?? def.baseUrl
  const isKeyless = Boolean(def.keyless) || isLocalEndpoint(baseUrl) || /freellm|local/i.test(key)
  const apiKey = String(input.apiKey ?? '').trim()
  if (requireKey && !isKeyless && !apiKey) errors.push('apiKey is required')
  // `noBaseUrl` providers (tm-hub relay) never talk to a base URL directly, so
  // no endpoint is required or validated.
  if (!baseUrl && def.noBaseUrl !== true) errors.push('baseUrl is required for this provider')
  else if (baseUrl && !URL_RE.test(baseUrl)) errors.push('baseUrl must be an http(s) URL')
  else if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.username || parsed.password) errors.push('baseUrl must not embed credentials')
      if (/[?&](?:key|api_key|token|access_token)=/i.test(parsed.search)) errors.push('baseUrl must not embed an API key')
    } catch {
      errors.push('baseUrl is not a valid URL')
    }
  }
  if (def.requiresBaseUrl && !explicitBase) errors.push('baseUrl must be configured explicitly for this provider')
  const model = str(input.model)
  if (!model) errors.push('model is required')
  const enabled = input.enabled !== false
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    errors: [],
    connection: {
      id: str(input.id) ?? `${key}:${str(input.name) ?? 'default'}`,
      name: str(input.name) ?? 'default',
      provider: def.key,
      adapter: str(input.adapter) ?? def.adapter,
      baseUrl: (baseUrl ?? '').replace(/\/+$/, ''),
      model,
      apiKey: (isKeyless && !apiKey) ? '' : apiKey,
      enabled,
      capabilities: { ...def.capabilities },
      privacy: def.privacy,
    },
  }
}

/** `sk-...abcd` -> `sk-…abcd`; short values are fully masked. Never reveal the middle. */
export function maskSecret(secret) {
  const s = String(secret ?? '')
  if (!s) return ''
  if (s.length < 10) return '••••'
  const head = s.slice(0, 3)
  const tail = s.slice(-4)
  return `${head}…${tail}`
}

/** Stable, non-reversible credential fingerprint (safe to store and display). */
export function secretFingerprint(secret) {
  const s = String(secret ?? '')
  if (!s) return null
  return 'afp1_' + createHash('sha256').update(s).digest('hex').slice(0, 16)
}

/**
 * Browser-safe projection. The secret never crosses this boundary, and the
 * encrypted blob is not included either.
 */
export function redactConnection(conn = {}) {
  return {
    id: conn.id ?? (conn._id != null ? String(conn._id) : null),
    name: conn.name ?? 'default',
    provider: conn.provider ?? null,
    adapter: conn.adapter ?? null,
    baseUrl: conn.baseUrl ?? null,
    model: conn.model ?? null,
    enabled: conn.enabled !== false,
    hasSecret: Boolean(conn.secretEnc || conn.apiKey),
    secretMask: str(conn.secretMask) ?? '',
    secretFingerprint: conn.secretFingerprint ?? null,
    capabilities: conn.capabilities ?? capabilitiesFor(conn.provider),
    status: conn.status ?? 'untested',
    lastTestedAt: Number(conn.lastTestedAt ?? 0) || null,
    lastError: conn.lastError ? String(conn.lastError) : null,
    lastErrorCode: conn.lastErrorCode ? String(conn.lastErrorCode) : null,
    source: conn.source ?? 'store',
    // TM Hub relay fields (null for every locally-credentialed connection).
    hubConnectionId: str(conn.hubConnectionId),
    hubProvider: str(conn.hubProvider),
    hubSyncedAt: Number(conn.hubSyncedAt ?? 0) || null,
    schemaVersion: AI_PROVIDER_SCHEMA_VERSION,
  }
}

/**
 * Fallback policy (Phase G bullet 3). A fallback is allowed only when the wire
 * protocol is identical and the target declares the required capabilities. A
 * different protocol is not "compatible"; silently re-shaping a request is how
 * a fallback turns into a behavior change.
 */
export function fallbackCompatible(from, to, required = ['chat']) {
  if (!from || !to) return false
  if (to.enabled === false) return false
  if (String(from.adapter ?? providerDefinition(from.provider)?.adapter) !== String(to.adapter ?? providerDefinition(to.provider)?.adapter)) return false
  return supports(to.provider, required)
}

/** Ordered candidates: requested first, then compatible fallbacks, never duplicates. */
export function rankCandidates(primary, fallbacks = [], required = ['chat']) {
  const out = []
  const seen = new Set()
  const push = (c) => {
    if (!c) return
    const id = String(c.id ?? `${c.provider}:${c.model}`)
    if (seen.has(id)) return
    seen.add(id)
    out.push(c)
  }
  push(primary)
  for (const f of Array.isArray(fallbacks) ? fallbacks : []) {
    if (fallbackCompatible(primary, f, required)) push(f)
  }
  return out
}

/** Budget snapshot used by the request path and the settings UI. */
export function budgetStatus(limits = {}, used = {}) {
  const lim = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
  const limitUsd = lim(limits.limitUsd)
  const limitTokens = lim(limits.limitTokens)
  const usedUsd = Math.max(0, Number(used.usedUsd) || 0)
  const usedTokens = Math.max(0, Number(used.usedTokens) || 0)
  const usdPct = limitUsd ? usedUsd / limitUsd : null
  const tokenPct = limitTokens ? usedTokens / limitTokens : null
  const pct = Math.max(usdPct ?? 0, tokenPct ?? 0)
  return {
    limitUsd,
    limitTokens,
    usedUsd,
    usedTokens,
    pct,
    state: !limitUsd && !limitTokens ? 'unbounded' : pct >= 1 ? 'exhausted' : pct >= 0.8 ? 'near' : 'ok',
  }
}

/** True when a request may proceed under the budget. */
export function budgetAllows(status) {
  return !status || status.state === 'unbounded' || status.state === 'ok' || status.state === 'near'
}

/** Effective status of a connection for the UI: configured but never tested is not "ok". */
export function connectionHealth(conn = {}) {
  if (conn.enabled === false) return 'disabled'
  if (!conn.hasSecret && conn.keyless !== true) return 'unconfigured'
  if (conn.lastError) return 'error'
  if (conn.lastTestedAt) return 'ok'
  return 'untested'
}

/**
 * Bootstrap config from env. A locally-stored connection always wins; env is the
 * fallback for a fresh install and for CI, and it is never written to Mongo.
 */
export function envConnection(env = process.env) {
  const key = String(env.AI_PROVIDER ?? 'openai').trim().toLowerCase()
  const def = providerDefinition(key)
  const provider = def ? def.key : 'custom_openai'
  const adapter = def?.adapter ?? 'openai_compatible'
  const baseUrl = String(env.AI_BASE_URL ?? def?.baseUrl ?? '').trim().replace(/\/+$/, '')
  const model = String(env.AI_MODEL ?? 'gpt-4o-mini').trim()
  const apiKey = String(env.AI_API_KEY ?? '').trim()
  if (!baseUrl || !model) return null
  if (!def?.keyless && !apiKey) return null
  return {
    id: 'env',
    name: 'environment',
    provider,
    adapter,
    baseUrl,
    model,
    apiKey,
    enabled: true,
    capabilities: capabilitiesFor(provider) ?? capabilitiesFor('custom_openai'),
    source: 'env',
  }
}
