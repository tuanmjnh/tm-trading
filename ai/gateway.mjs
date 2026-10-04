#!/usr/bin/env node
// =============================================================================
//  TM TRADING - AI GATEWAY (roadmap Phase 11).
//
//  One abstraction over three provider families, zero dependencies (raw fetch):
//   - openai    : POST {base}/chat/completions   (OpenAI or any compatible)
//   - ollama    : same as openai, auth optional   (local, AI_BASE_URL=.../v1)
//   - anthropic : POST {base}/v1/messages         (x-api-key + version header)
//
//  Every call:
//   - passes a sliding-window rate limit (AI_RPM per 60s)
//   - is appended to logs/ai.ndjson (prompt/response excerpts, usage, latency,
//     ok/error) — the audit trail required by the Phase 11 guardrails
//   - fails with a stable error code (AIGatewayError.code):
//     ai.no-key | ai.rate-limited | ai.timeout | ai.network | ai.http-error |
//     ai.api-error | ai.bad-shape
//
//  This module only TALKS to a model: no orders, no accounts, no execution.
//  Proposals only — the tool layer lives in ai/agent.mjs.
//
//  Run: node ai/gateway.mjs       (prints effective config, masked, no network)
//  Env: AI_PROVIDER, AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_MAX_TOKENS,
//       AI_TIMEOUT_MS, AI_RPM, AI_TEMPERATURE, AI_LANG, AI_LOG, AI_LOG_FILE
// =============================================================================
import { appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadEnv } from '../exec/env.mjs'

loadEnv() // read .env BEFORE freezing config (telegram.mjs pattern)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Gateway error with a stable machine-readable `code` for callers/tests. */
export class AIGatewayError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'AIGatewayError'
    this.code = code
    Object.assign(this, extra)
  }
}

/** Build config from env (pure — tests pass their own env object). */
export function aiConfig(env = process.env) {
  // Numeric env vars must be guarded. A single typo such as AI_TIMEOUT_MS=abc would otherwise
  // yield NaN, and setTimeout(fn, NaN) fires immediately, so EVERY call aborts as ai.timeout
  // while the message points at the network. Same failure class: maxTokens=abc sends
  // "max_tokens":null, and rpm=abc silently degrades the limiter to 1 call/60s.
  const num = (raw, fallback) => {
    const n = Number(raw)
    return raw === undefined || raw === '' || !Number.isFinite(n) ? fallback : n
  }
  return Object.freeze({
    provider: String(env.AI_PROVIDER || 'openai').toLowerCase(),
    apiKey: String(env.AI_API_KEY || '').trim(),
    baseUrl: String(env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: String(env.AI_MODEL || 'gpt-4o-mini').trim(),
    maxTokens: num(env.AI_MAX_TOKENS, 1024),
    timeoutMs: num(env.AI_TIMEOUT_MS, 60000),
    rpm: num(env.AI_RPM, 30),
    temperature: num(env.AI_TEMPERATURE, 0.3),
    lang: String(env.AI_LANG || 'vi'),
    log: env.AI_LOG !== '0',
    logFile: String(env.AI_LOG_FILE || join(ROOT, 'logs', 'ai.ndjson')),
  })
}

/** Config frozen at import time (reads .env via loadEnv above). */
export const AI_CFG = aiConfig()

/**
 * Sliding-window rate limiter (default: AI_RPM calls per 60s).
 * `attempt()` consumes one slot when allowed; rejected calls report how long
 * to wait. Tests drive it with an injected `now`.
 */
export class RateLimiter {
  constructor(limit = 30, windowMs = 60000) {
    this.limit = Math.max(1, Number(limit) || 1)
    this.windowMs = Math.max(1, Number(windowMs) || 60000)
    this.stamps = []
  }

  attempt(now = Date.now()) {
    const cut = now - this.windowMs
    this.stamps = this.stamps.filter((t) => t > cut)
    if (this.stamps.length >= this.limit) {
      const waitMs = Math.max(1, this.stamps[0] + this.windowMs - now)
      return { ok: false, retryAfterMs: waitMs, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) }
    }
    this.stamps.push(now)
    return { ok: true, retryAfterMs: 0, retryAfterSec: 0 }
  }
}

const defaultLimiter = new RateLimiter(AI_CFG.rpm)

const excerpt = (s, n = 1200) => {
  const t = String(s ?? '')
  return t.length > n ? `${t.slice(0, n)}…[+${t.length - n} chars]` : t
}

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)

/** Canonical message -> OpenAI chat.completions message. */
export function toOpenAIMessages(messages) {
  const out = []
  for (const m of messages || []) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: String(m.toolCallId || ''), content: String(m.content ?? '') })
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      out.push({
        role: 'assistant',
        content: m.content ? String(m.content) : null,
        tool_calls: m.toolCalls.map((c) => ({
          id: String(c.id || ''),
          type: 'function',
          function: { name: String(c.name || ''), arguments: JSON.stringify(c.args ?? {}) },
        })),
      })
    } else {
      out.push({ role: String(m.role), content: String(m.content ?? '') })
    }
  }
  return out
}

/**
 * Canonical messages -> Anthropic messages (+ extracted system text).
 * Anthropic has no `tool` role: results ride in user messages as tool_result
 * blocks, consecutive results merged into ONE user turn (API alternation rule).
 */
export function toAnthropicMessages(messages) {
  const out = []
  let system = ''
  for (const m of messages || []) {
    if (m.role === 'system') {
      system += `${system ? '\n' : ''}${String(m.content ?? '')}`
      continue
    }
    if (m.role === 'assistant') {
      const blocks = []
      if (m.content) blocks.push({ type: 'text', text: String(m.content) })
      for (const c of m.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: String(c.id || ''), name: String(c.name || ''), input: c.args && typeof c.args === 'object' ? c.args : {} })
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '(empty)' }] })
      continue
    }
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: String(m.toolCallId || ''), content: String(m.content ?? '') }
      const prev = out[out.length - 1]
      if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content.every((b) => b.type === 'tool_result')) {
        prev.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    out.push({ role: String(m.role), content: String(m.content ?? '') })
  }
  return { system, messages: out }
}

export function toOpenAITools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export function toAnthropicTools(tools) {
  return (tools || []).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

/** Canonical messages/tools -> {url, headers, body} for the provider. */
export function buildRequest({ cfg = AI_CFG, messages = [], tools = [], temperature, maxTokens } = {}) {
  const provider = cfg.provider
  const temp = Number.isFinite(temperature) ? temperature : cfg.temperature
  const maxTok = Number.isFinite(maxTokens) ? maxTokens : cfg.maxTokens
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')

  if (provider === 'anthropic') {
    const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
    const { system, messages: ms } = toAnthropicMessages(messages)
    const body = { model: cfg.model, max_tokens: maxTok, temperature: temp, messages: ms }
    if (system) body.system = system
    if (tools.length) body.tools = toAnthropicTools(tools)
    return {
      url,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    }
  }

  // openai | ollama | any OpenAI-compatible endpoint
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const body = { model: cfg.model, messages: toOpenAIMessages(messages), temperature: temp, max_tokens: maxTok }
  if (tools.length) body.tools = toOpenAITools(tools)
  return { url: `${base}/chat/completions`, headers, body }
}

/** Provider response -> {text, toolCalls[], usage} (throws ai.api-error/bad-shape). */
export function parseResponse(provider, data) {
  if (data && typeof data === 'object' && data.error !== undefined) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message || JSON.stringify(data.error)
    throw new AIGatewayError('ai.api-error', msg, { provider })
  }

  if (provider === 'anthropic') {
    if (!Array.isArray(data?.content)) {
      throw new AIGatewayError('ai.bad-shape', 'anthropic response missing content[]', { provider })
    }
    let text = ''
    const toolCalls = []
    for (const b of data.content) {
      if (b?.type === 'text') text += String(b.text ?? '')
      else if (b?.type === 'tool_use') {
        toolCalls.push({
          id: String(b.id || ''),
          name: String(b.name || ''),
          args: b.input && typeof b.input === 'object' ? b.input : {},
        })
      }
    }
    return {
      text,
      toolCalls,
      usage: { prompt: num(data.usage?.input_tokens), completion: num(data.usage?.output_tokens) },
    }
  }

  const msg = data?.choices?.[0]?.message
  if (!msg || typeof msg !== 'object') {
    throw new AIGatewayError('ai.bad-shape', 'openai response missing choices[0].message', { provider })
  }
  const toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c, i) => {
    let args = {}
    const raw = c?.function?.arguments
    if (raw) {
      try {
        args = JSON.parse(raw)
      } catch {
        args = { __raw: String(raw) }
      }
    }
    return { id: String(c?.id || `call_${i}`), name: String(c?.function?.name || ''), args }
  })
  const text = typeof msg.content === 'string' ? msg.content : msg.content == null ? '' : JSON.stringify(msg.content)
  return {
    text,
    toolCalls,
    usage: { prompt: num(data?.usage?.prompt_tokens), completion: num(data?.usage?.completion_tokens) },
  }
}

/** Append one audit line to logs/ai.ndjson (fail-soft: never throws). */
export function appendAiLog(entry, file) {
  try {
    const target = file || AI_CFG.logFile
    mkdirSync(dirname(target), { recursive: true })
    appendFileSync(target, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
    return true
  } catch {
    return false
  }
}

const promptExcerpt = (messages) => {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'user') || (messages || [])[0]
  return excerpt(last?.content, 1200)
}

/**
 * One model call: rate-limit -> HTTP -> parse -> audit log.
 *
 * @param {Array<{role:string, content:string, toolCalls?:Array, toolCallId?:string}>} messages
 * @param {Array<{name:string, description:string, parameters:object}>} tools
 * @param {object} [opts] {cfg, fetchImpl, limiter, now, tag, logFile, temperature, maxTokens}
 * @returns {Promise<{text:string, toolCalls:Array, usage:object, provider:string, model:string, ms:number}>}
 */
export async function chat(messages, tools = [], opts = {}) {
  const cfg = opts.cfg || AI_CFG
  // The audit path is read from opts.logFile, but aiConfig() also exposes cfg.logFile.
  // Without this normalization, AI_LOG_FILE / aiConfig().logFile is silently ignored and audit
  // rows are appended to the shared logs/ai.ndjson instead of the requested per-run file.
  opts = { ...opts, logFile: opts.logFile || cfg.logFile }
  const tag = opts.tag || '[ai]'
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  const limiter = opts.limiter || defaultLimiter
  const now = opts.now || Date.now
  const provider = cfg.provider

  if (provider !== 'ollama' && !cfg.apiKey) {
    throw new AIGatewayError('ai.no-key', `AI_API_KEY missing for provider "${provider}" (set it in .env or use AI_PROVIDER=ollama)`)
  }

  const baseLog = {
    tag,
    provider,
    model: cfg.model,
    messages: (messages || []).length,
    tools: (tools || []).length,
    prompt: promptExcerpt(messages),
  }

  const gate = limiter.attempt(now())
  if (!gate.ok) {
    if (cfg.log) appendAiLog({ ...baseLog, ok: false, error: 'rate-limited', retryAfterSec: gate.retryAfterSec }, opts.logFile)
    throw new AIGatewayError('ai.rate-limited', `AI_RPM exceeded, retry in ${gate.retryAfterSec}s`, { retryAfterSec: gate.retryAfterSec })
  }

  const req = buildRequest({ cfg, messages, tools, temperature: opts.temperature, maxTokens: opts.maxTokens })
  const t0 = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs)

  let res
  let raw
  try {
    res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: ac.signal })
    try {
      raw = typeof res?.json === 'function' ? await res.json() : {}
    } catch {
      raw = { error: 'response body is not JSON' }
    }
  } catch (e) {
    clearTimeout(timer)
    const timedOut = e?.name === 'AbortError'
    const error = timedOut ? `timeout after ${cfg.timeoutMs}ms` : String(e?.message || e)
    if (cfg.log) appendAiLog({ ...baseLog, ms: Date.now() - t0, ok: false, error }, opts.logFile)
    throw new AIGatewayError(timedOut ? 'ai.timeout' : 'ai.network', error, { provider })
  }
  clearTimeout(timer)
  const ms = Date.now() - t0

  if (!res?.ok) {
    const msg = raw?.error?.message || raw?.message || `HTTP ${res?.status ?? '?'}`
    if (cfg.log) appendAiLog({ ...baseLog, ms, ok: false, status: res?.status, error: msg }, opts.logFile)
    throw new AIGatewayError('ai.http-error', `HTTP ${res?.status}: ${msg}`, { provider, status: res?.status })
  }

  try {
    const parsed = parseResponse(provider, raw)
    if (cfg.log) {
      appendAiLog({
        ...baseLog,
        ms,
        ok: true,
        status: res?.status,
        usage: parsed.usage,
        toolCalls: parsed.toolCalls.map((c) => c.name),
        response: excerpt(parsed.text),
      }, opts.logFile)
    }
    return { ...parsed, provider, model: cfg.model, ms }
  } catch (e) {
    if (cfg.log) appendAiLog({ ...baseLog, ms, ok: false, status: res?.status, error: e.message }, opts.logFile)
    throw e
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  const { apiKey, ...rest } = AI_CFG
  console.log(JSON.stringify({ ...rest, apiKey: apiKey ? `${apiKey.slice(0, 6)}***` : '(empty)' }, null, 2))
}
