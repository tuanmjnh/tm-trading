import { createError } from 'h3'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listAiConnections, providerCatalog, resolveAiProvider } from './aiProviders'
import { getTradingSession } from './sessions'
import { getSignal } from './signals'
import { getNativeSignal } from './nativeSignals'
import { getMarketEventDetail, getNewsItem, getOutlook, getOutlookById } from './newsStore'
import {
  ASSISTANT_TOOL_EXECUTORS,
  ASSISTANT_TOOL_NAMES,
  assistantToolSpecs,
  executeAssistantTool,
  type ToolArgs,
} from './moduleAssistantTools'

// =============================================================================
//  Phase H (§61.12) — contextual in-module assistant, READ-ONLY.
//
//  The client sends a scope (module + record id) and a question; the server
//  re-fetches the referenced record with an OWNER-SCOPED read and builds a
//  compact context bundle. The model must cite the record ids it used. A foreign
//  record is a 404, so switching user/account can never carry a previous context
//  over.
//
//  H4: when the caller has an owner id, the model may also call the A0
//  owner-scoped read tools (engine/agentPolicy.mjs ASSISTANT_READ_TOOLS — see
//  moduleAssistantTools.ts). The owner is NEVER a model argument: the executor
//  injects the verified owner, so the model can only choose WHICH owned record,
//  never whose. A tool name outside the allowlist is BLOCKED, not executed.
//
//  Scopes: session, signal (alerts/engine), provider (redacted settings), news
//  item, market event and outlook. News/outlook records are global/rights-gated
//  by newsStore, not owner-scoped; they still come from a server re-read.
// =============================================================================

type AnyDoc = Record<string, any>
type ChatFn = (messages: AnyDoc[], tools?: AnyDoc[], opts?: AnyDoc) => Promise<AnyDoc>
type LoadSessionFn = (id: string, ownerId?: string | null) => Promise<AnyDoc | null>
type LoadSignalFn = (id: string, ownerId: string | null, source: 'alerts' | 'engine') => Promise<AnyDoc | null>
type LoadProviderFn = (ownerId: string | null, id: string | null) => Promise<{ connections: AnyDoc[], env: AnyDoc } | null>
type LoadNewsItemFn = (id: string) => Promise<AnyDoc | null>
type LoadMarketEventFn = (id: string) => Promise<AnyDoc | null>
type LoadOutlookFn = (scope: AssistantScope) => Promise<AnyDoc | null>
type ResolveProviderFn = (ownerId: string | null, opts?: { id?: string | null; required?: string[] }) => Promise<AnyDoc | null>

// Dynamic engine/AI imports (pathToFileURL + @vite-ignore) — see app-inheritance.md.
type Loose<T> = { [K in keyof T]: T[K] extends (...a: any[]) => infer R ? (...a: any[]) => R : T[K] }
function lazy<T>(file: string): () => Promise<T> {
  let cached: Promise<T> | null = null
  return () => {
    if (!cached) {
      const href = pathToFileURL(join(process.cwd(), file)).href
      cached = import(/* @vite-ignore */ href) as Promise<T>
    }
    return cached
  }
}
const gatewayModule = lazy<Loose<typeof import('../../ai/gateway.mjs')>>('ai/gateway.mjs')
// Pure autonomy policy (engine/agentPolicy.mjs) — the A0 assistant tool allowlist.
const policyModule = lazy<Loose<typeof import('../../engine/agentPolicy.mjs')>>('engine/agentPolicy.mjs')

export const ASSISTANT_SCHEMA = 'module-assistant.v1'
export const MAX_QUESTION_CHARS = 2000
/** H4 — tool-calling rounds per ask, mirroring ai/agent.mjs's bounded loop. */
export const MAX_TOOL_ROUNDS = 4

export type AssistantScopeType = 'session' | 'signal' | 'provider' | 'news' | 'market_event' | 'outlook'

export interface AssistantScope {
  type: AssistantScopeType
  id?: string | null
  /** Signal source selector (ownership still comes from the verified token). */
  source?: 'alerts' | 'engine' | null
  /** Outlook selectors; the snapshot itself is rebuilt server-side. */
  group?: string | null
  horizon?: string | null
}

const SYSTEM_PROMPT = [
  'You are a read-only in-app assistant for TM Trading, a paper/demo trading research desk.',
  'Answer from the CONTEXT bundle in the user message and, when offered, from the read tools.',
  'Never use outside market knowledge; never invent numbers, ids or events.',
  'If neither the bundle nor a tool result contains the answer, say so plainly.',
  'Label each statement as "fact" (copied from the bundle or a tool result) or "inference" (your own reasoning).',
  'When you reference a stored record, cite its id exactly as it appears in the bundle refs or tool results.',
  'For news and outlook bundles, separate publication time from as-of time and surface contrary evidence or uncertainty when present.',
  'The tools only ever read the signed-in user\'s own records; you cannot read another user\'s data and must not try.',
  'You are advisory and read-only: you cannot place, modify or cancel orders, and you must not claim to.',
  'Reply in the same language as the user question.',
].join(' ')

export class ModuleAssistantError extends Error {
  statusCode: number
  statusMessage: string
  constructor(message: string, statusCode = 400, statusMessage = 'assistant_error') {
    super(message)
    this.statusCode = statusCode
    this.statusMessage = statusMessage
  }
}

export function moduleAssistantHttpError(err: unknown) {
  if (err instanceof ModuleAssistantError) {
    return createError({ statusCode: err.statusCode, statusMessage: err.statusMessage, message: err.message })
  }
  const e = err as { statusCode?: number; statusMessage?: string; message?: string } | null
  if (e && typeof e.statusCode === 'number') {
    return createError({ statusCode: e.statusCode, statusMessage: e.statusMessage ?? 'error', message: e.message ?? 'error' })
  }
  return createError({ statusCode: 500, statusMessage: 'assistant_failed', message: e?.message || 'assistant failed' })
}

const asArray = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '')).filter(Boolean) : [])

const redactText = (v: unknown): string | null => {
  if (!v) return null
  return String(v)
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|afp1_[a-f0-9]+)\b/g, '[redacted]')
    .slice(0, 300)
}

const redactUrl = (v: unknown): string | null => {
  if (!v) return null
  return String(v).replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, '$1[redacted]')
}

/**
 * Compact, browser-safe context for one session. Pure: no IO, no secrets.
 * `refs` are the record ids the model may cite.
 */
export function buildSessionContext(session: AnyDoc, generatedAt: number = Date.now()) {
  if (!session || typeof session !== 'object') {
    throw new ModuleAssistantError('session not found', 404, 'session_not_found')
  }
  const id = String(session.sessionId ?? session._id ?? '')
  const timeline = Array.isArray(session.timeline) ? session.timeline.slice(-10) : []
  return {
    scope: 'session',
    generatedAt: new Date(generatedAt).toISOString(),
    session: {
      id,
      kind: session.kind ?? null,
      state: session.state ?? null,
      accountId: session.accountId ?? null,
      instruments: asArray(session.instruments),
      timeframes: asArray(session.timeframes),
      strategyVersionId: session.strategyVersionId ?? null,
      botProfileId: session.botProfileId ?? null,
      startedAt: session.startedAt ?? null,
      stoppedAt: session.stoppedAt ?? null,
      lastEventAt: session.lastEventAt ?? null,
      counts: session.counts ?? { orders: 0, fills: 0, positions: 0 },
      recentTimeline: timeline,
    },
    refs: [{ kind: 'session', id }],
  }
}

/** Compact context for one stored signal. Pure: no IO, no owner data. */
export function buildSignalContext(signal: AnyDoc, source: 'alerts' | 'engine' = 'alerts', generatedAt: number = Date.now()) {
  if (!signal || typeof signal !== 'object') {
    throw new ModuleAssistantError('signal not found', 404, 'signal_not_found')
  }
  const id = String(signal.id ?? signal._id ?? '')
  const body = source === 'engine'
    ? {
        id,
        ts: signal.ts ?? null,
        symbol: signal.symbol ?? null,
        tf: signal.tf ?? null,
        type: signal.type ?? null,
        price: signal.price ?? null,
        method: signal.method ?? null,
        signalKey: signal.signalKey ?? null,
        schemaVersion: signal.schemaVersion ?? null,
        accountId: signal.accountId ?? null,
        attribution: signal.attribution ?? null,
        meta: signal.meta ?? null,
      }
    : {
        id,
        ts: signal.ts ?? null,
        source: signal.source ?? null,
        symbol: signal.symbol ?? null,
        tf: signal.tf ?? null,
        mode: signal.mode ?? null,
        action: signal.action ?? null,
        side: signal.side ?? null,
        level: signal.level ?? null,
        price: signal.price ?? null,
        sl: signal.sl ?? null,
        tps: Array.isArray(signal.tps) ? signal.tps : [],
        atr: signal.atr ?? null,
        conf: signal.conf ?? null,
        status: signal.status ?? null,
        rejectReason: signal.rejectReason ?? null,
      }
  return {
    scope: 'signal',
    source,
    generatedAt: new Date(generatedAt).toISOString(),
    signal: body,
    refs: [{ kind: 'signal', id }],
  }
}

/**
 * Redacted provider/settings diagnostic bundle. Only allowlisted connection
 * fields leave this function: no ciphertext, key mask or fingerprint.
 */
export function buildProviderContext(connections: AnyDoc[], env: AnyDoc, generatedAt: number = Date.now()) {
  const rows = (Array.isArray(connections) ? connections : []).slice(0, 20).map((c) => ({
    id: String(c.id ?? c._id ?? ''),
    name: c.name ?? null,
    provider: c.provider ?? null,
    adapter: c.adapter ?? null,
    baseUrl: redactUrl(c.baseUrl),
    model: c.model ?? null,
    enabled: c.enabled !== false,
    keyless: Boolean(c.keyless),
    hasSecret: Boolean(c.hasSecret),
    status: c.status ?? 'untested',
    lastTestedAt: c.lastTestedAt ?? null,
    lastError: redactText(c.lastError),
    testLatencyMs: typeof c.testLatencyMs === 'number' ? c.testLatencyMs : null,
    capabilities: c.capabilities ?? null,
  }))
  return {
    scope: 'provider',
    generatedAt: new Date(generatedAt).toISOString(),
    provider: {
      env: {
        configured: Boolean(env?.configured),
        provider: env?.provider ?? null,
        model: env?.model ?? null,
        baseUrl: redactUrl(env?.baseUrl),
        source: env?.source ?? 'env',
      },
      connections: rows,
    },
    refs: rows.filter((r) => r.id).map((r) => ({ kind: 'provider', id: r.id })),
  }
}

/** Compact context for one allowlisted NewsItem projection. */
export function buildNewsItemContext(item: AnyDoc, generatedAt: number = Date.now()) {
  if (!item || typeof item !== 'object' || !item.id) {
    throw new ModuleAssistantError('news item not found', 404, 'news_not_found')
  }
  return {
    scope: 'news',
    generatedAt: new Date(generatedAt).toISOString(),
    newsItem: {
      id: String(item.id),
      sourceId: item.sourceId ?? null,
      url: redactUrl(item.url),
      title: item.title ?? '',
      excerpt: item.excerpt ?? '',
      language: item.language ?? null,
      publishedAt: item.publishedAt ?? null,
      firstSeenAt: item.firstSeenAt ?? null,
      marketGroup: item.marketGroup ?? null,
      eventType: item.eventType ?? null,
      tags: asArray(item.tags),
      level: item.level ?? null,
      dir: item.dir ?? null,
      score: typeof item.score === 'number' ? item.score : null,
    },
    refs: [{ kind: 'news_item', id: String(item.id) }],
  }
}

/** Event plus its capped evidence items; every cited item id is a ref. */
export function buildMarketEventContext(detail: AnyDoc, generatedAt: number = Date.now()) {
  const event = detail?.event ?? detail
  if (!event || typeof event !== 'object' || !event.id) {
    throw new ModuleAssistantError('market event not found', 404, 'event_not_found')
  }
  const items = (Array.isArray(detail?.items) ? detail.items : []).slice(0, 20)
  return {
    scope: 'market_event',
    generatedAt: new Date(generatedAt).toISOString(),
    marketEvent: event,
    evidenceItems: items,
    refs: [
      { kind: 'market_event', id: String(event.id) },
      ...items.filter((i: AnyDoc) => i?.id).map((i: AnyDoc) => ({ kind: 'news_item', id: String(i.id) })),
    ],
  }
}

const evidenceKind = (kind: unknown): string => {
  const k = String(kind ?? '')
  if (k === 'item' || k === 'news' || k === 'news_item') return 'news_item'
  if (k === 'event' || k === 'market_event') return 'market_event'
  if (k === 'outlook') return 'outlook'
  return k || 'evidence'
}

/** Stored/synthesized outlook snapshot plus the evidence ids it cites. */
export function buildOutlookContext(snapshot: AnyDoc, generatedAt: number = Date.now()) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new ModuleAssistantError('outlook not found', 404, 'outlook_not_found')
  }
  const evidence = [
    ...(Array.isArray(snapshot.supporting) ? snapshot.supporting : []),
    ...(Array.isArray(snapshot.counterEvidence) ? snapshot.counterEvidence : []),
  ]
  const refs: Array<{ kind: string, id: string }> = []
  const seen = new Set<string>()
  for (const e of evidence) {
    if (!e?.id) continue
    const kind = evidenceKind(e.kind)
    const key = `${kind}:${e.id}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ kind, id: String(e.id) })
  }
  return {
    scope: 'outlook',
    generatedAt: new Date(generatedAt).toISOString(),
    outlook: {
      id: snapshot._id ? String(snapshot._id) : null,
      marketGroup: snapshot.marketGroup ?? null,
      horizon: snapshot.horizon ?? null,
      horizonDays: snapshot.horizonDays ?? null,
      state: snapshot.state ?? null,
      asOf: snapshot.generatedAt ?? null,
      expiresAt: snapshot.expiresAt ?? null,
      stale: Boolean(snapshot.stale),
      invalidatedAt: snapshot.invalidatedAt ?? null,
      staleReason: snapshot.staleReason ?? null,
      evidenceHash: snapshot.evidenceHash ?? null,
      supporting: Array.isArray(snapshot.supporting) ? snapshot.supporting : [],
      counterEvidence: Array.isArray(snapshot.counterEvidence) ? snapshot.counterEvidence : [],
      contradictionCount: snapshot.contradictionCount ?? 0,
      multiSourceCount: snapshot.multiSourceCount ?? 0,
      singleSourceCount: snapshot.singleSourceCount ?? 0,
      limitations: asArray(snapshot.limitations),
      invalidation: snapshot.invalidation ?? null,
    },
    refs: snapshot._id ? [{ kind: 'outlook', id: String(snapshot._id) }, ...refs] : refs,
  }
}

export interface AskAssistantInput {
  ownerId?: string | null
  question?: string | null
  scope?: AssistantScope | null
  /** Legacy H1 shape; treated as `{ type: 'session', id: sessionId }`. */
  sessionId?: string | null
}

export interface ModuleAssistantDeps {
  loadSession?: LoadSessionFn
  loadSignal?: LoadSignalFn
  loadProvider?: LoadProviderFn
  loadNewsItem?: LoadNewsItemFn
  loadMarketEvent?: LoadMarketEventFn
  loadOutlook?: LoadOutlookFn
  resolveProvider?: ResolveProviderFn
  chat?: ChatFn
  now?: () => number
  /** Owner-scoped tool executors; defaults to the real IMPLS (tests inject fakes). */
  tools?: Record<string, (args: ToolArgs, ctx: { ownerId: string }) => Promise<unknown>>
}

/**
 * One read-only assistant turn over an owner-scoped or rights-gated bundle. The
 * model is called with NO tools. Throws ModuleAssistantError on bad scope /
 * ownership / provider failure.
 */
export async function askModuleAssistant(input: AskAssistantInput = {}, deps: ModuleAssistantDeps = {}) {
  const ownerId = input.ownerId ?? null
  const question = String(input.question ?? '').trim()
  if (!question) throw new ModuleAssistantError('question is required', 400, 'invalid_question')
  if (question.length > MAX_QUESTION_CHARS) {
    throw new ModuleAssistantError(`question must be <= ${MAX_QUESTION_CHARS} chars`, 400, 'invalid_question')
  }

  const scope = normalizeScope(input)
  const needsOwner = scope.type === 'session' || scope.type === 'signal' || scope.type === 'provider'
  if (needsOwner && !ownerId) {
    throw new ModuleAssistantError('owner is required for this scope', 401, 'owner_required')
  }

  const now = deps.now ?? Date.now
  let bundle: AnyDoc
  let responseScope: AnyDoc

  if (scope.type === 'session') {
    const sessionId = String(scope.id ?? '')
    if (!sessionId) throw new ModuleAssistantError('sessionId is required', 400, 'invalid_scope')
    const load = deps.loadSession ?? ((id: string, oid?: string | null) => getTradingSession(id, oid ?? undefined))
    const session = await load(sessionId, ownerId)
    if (!session) throw new ModuleAssistantError('session not found', 404, 'session_not_found')
    bundle = buildSessionContext(session, now())
    responseScope = { type: 'session', sessionId }
  } else if (scope.type === 'signal') {
    const source = scope.source === 'engine' ? 'engine' : 'alerts'
    const signalId = String(scope.id ?? '')
    if (!signalId) throw new ModuleAssistantError('signalId is required', 400, 'invalid_scope')
    const load = deps.loadSignal ?? ((id: string, oid: string | null, src: 'alerts' | 'engine') =>
      src === 'engine' ? getNativeSignal(oid ?? '', id) : getSignal(oid ?? '', id))
    const signal = await load(signalId, ownerId, source)
    if (!signal) throw new ModuleAssistantError('signal not found', 404, 'signal_not_found')
    bundle = buildSignalContext(signal, source, now())
    responseScope = { type: 'signal', id: signalId, source }
  } else if (scope.type === 'provider') {
    const providerId = scope.id ? String(scope.id) : null
    const load = deps.loadProvider ?? (async (oid: string | null, id: string | null) => {
      const [connections, catalog] = await Promise.all([listAiConnections(oid ?? ''), providerCatalog()])
      const rows = id ? connections.filter((c: AnyDoc) => String(c.id) === id) : connections
      if (id && !rows.length) return null
      return { connections: rows, env: catalog.env }
    })
    const data = await load(ownerId, providerId)
    if (!data) throw new ModuleAssistantError('provider connection not found', 404, 'provider_not_found')
    bundle = buildProviderContext(data.connections, data.env, now())
    responseScope = { type: 'provider', ...(providerId ? { id: providerId } : {}) }
  } else if (scope.type === 'news') {
    const newsId = String(scope.id ?? '')
    if (!newsId) throw new ModuleAssistantError('newsId is required', 400, 'invalid_scope')
    const load = deps.loadNewsItem ?? ((id: string) => getNewsItem(id))
    const item = await load(newsId)
    if (!item) throw new ModuleAssistantError('news item not found', 404, 'news_not_found')
    bundle = buildNewsItemContext(item, now())
    responseScope = { type: 'news', id: newsId }
  } else if (scope.type === 'market_event') {
    const eventId = String(scope.id ?? '')
    if (!eventId) throw new ModuleAssistantError('eventId is required', 400, 'invalid_scope')
    const load = deps.loadMarketEvent ?? ((id: string) => getMarketEventDetail(id))
    const detail = await load(eventId)
    if (!detail) throw new ModuleAssistantError('market event not found', 404, 'event_not_found')
    bundle = buildMarketEventContext(detail, now())
    responseScope = { type: 'market_event', id: eventId }
  } else {
    const outlookId = scope.id ? String(scope.id) : null
    const group = scope.group ? String(scope.group) : ''
    const horizon = scope.horizon ? String(scope.horizon) : ''
    if (!outlookId && (!group || !horizon)) {
      throw new ModuleAssistantError('outlook id or group+horizon is required', 400, 'invalid_scope')
    }
    const load = deps.loadOutlook ?? ((s: AssistantScope) =>
      s.id ? getOutlookById(String(s.id)) : getOutlook(String(s.group), String(s.horizon)))
    const snapshot = await load({ ...scope, id: outlookId, group, horizon })
    if (!snapshot) throw new ModuleAssistantError('outlook not found', 404, 'outlook_not_found')
    bundle = buildOutlookContext(snapshot, now())
    responseScope = { type: 'outlook', ...(outlookId ? { id: outlookId } : {}), group, horizon }
  }

  const userPrompt = `CONTEXT:\n${JSON.stringify(bundle)}\n\nquestion: ${question}`

  const gateway = deps.chat ? null : await gatewayModule()
  const chat = deps.chat ?? (gateway ? gateway.chat : null)
  if (!chat) throw new ModuleAssistantError('AI gateway unavailable', 503, 'ai_unavailable')

  let provider: AnyDoc | null = null
  if (!deps.chat) {
    try {
      provider = await (deps.resolveProvider ?? resolveAiProvider)(ownerId, { required: ['chat'] })
    } catch {
      provider = null
    }
  }
  const cfg = provider && gateway
    ? { ...gateway.AI_CFG, provider: provider.provider, apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.model }
    : undefined

  // H4 — owner-scoped read tools. Offered only when the caller has an owner id
  // and the provider does not explicitly declare tools:false. A provider without
  // capability info (or an injected test chat) keeps the tools: unknown is not
  // "incapable", only an explicit false is.
  const toolsSupported = provider ? provider.capabilities?.tools !== false : true
  const executors = (deps.tools ?? ASSISTANT_TOOL_EXECUTORS) as Record<string, (args: ToolArgs, ctx: { ownerId: string }) => Promise<unknown>>
  const allowedNames: readonly string[] = (await policyModule()).ASSISTANT_READ_TOOLS
  const toolNames = ownerId && toolsSupported
    ? allowedNames.filter(name => typeof executors[name] === 'function')
    : []
  const specs = toolNames.length ? assistantToolSpecs(toolNames) : []

  const messages: AnyDoc[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
  const usedTools: string[] = []
  let reply: AnyDoc | null = null
  let truncated = false

  try {
    for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await chat(
        messages,
        specs,
        { tag: '[assistant]', temperature: 0.2, maxTokens: 900, ...(cfg ? { cfg } : {}) }
      )
      const calls: AnyDoc[] = Array.isArray(res?.toolCalls) ? res.toolCalls : []
      if (!calls.length) {
        reply = res
        break
      }
      messages.push({ role: 'assistant', content: String(res?.text ?? ''), toolCalls: calls })
      const policy = await policyModule()
      for (const call of calls) {
        const name = String(call?.name ?? '')
        usedTools.push(name)
        // The allowlist is authoritative at execution time: a name outside
        // ASSISTANT_READ_TOOLS is BLOCKED (an error result), never executed.
        const verdict = policy.checkAssistantTool(name) as { ok: boolean, message?: string }
        let out: unknown
        if (!verdict.ok) {
          out = { error: verdict.message ?? 'tool not allowed' }
        } else {
          out = await executeAssistantTool(name, (call?.args ?? {}) as ToolArgs, { ownerId: String(ownerId) }, executors)
        }
        messages.push({ role: 'tool', toolCallId: String(call?.id ?? ''), content: JSON.stringify(out ?? null) })
      }
      reply = res
      if (round === MAX_TOOL_ROUNDS) truncated = true
    }
    if (!reply) throw new ModuleAssistantError('AI request failed: no reply', 502, 'ai_failed')
  } catch (err) {
    if (err instanceof ModuleAssistantError) throw err
    const code = String((err as AnyDoc)?.code ?? '')
    if (code === 'ai.no-key') throw new ModuleAssistantError('AI is not configured', 503, 'ai_unconfigured')
    throw new ModuleAssistantError(`AI request failed: ${(err as Error)?.message || err}`, 502, 'ai_failed')
  }

  return {
    schemaVersion: ASSISTANT_SCHEMA,
    answer: String(reply?.text ?? ''),
    model: reply?.model ?? null,
    provider: provider?.provider ?? reply?.provider ?? null,
    scope: responseScope,
    refs: bundle.refs,
    toolCalls: usedTools,
    truncated,
    generatedAt: bundle.generatedAt,
  }
}

function normalizeScope(input: AskAssistantInput): AssistantScope {
  if (input.scope && typeof input.scope === 'object') {
    const type = String(input.scope.type ?? '') as AssistantScopeType
    if (!ASSISTANT_SCOPE_TYPES.includes(type)) {
      throw new ModuleAssistantError('invalid scope type', 400, 'invalid_scope')
    }
    return { ...input.scope, type }
  }
  const sessionId = String(input.sessionId ?? '').trim()
  if (sessionId) return { type: 'session', id: sessionId }
  throw new ModuleAssistantError('scope is required', 400, 'invalid_scope')
}

const ASSISTANT_SCOPE_TYPES: AssistantScopeType[] = ['session', 'signal', 'provider', 'news', 'market_event', 'outlook']
