import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EvidenceError, evidenceHttpError } from './evidenceSets'
import { getSessionEvidenceGraph } from './evidenceGraph'
import { resolveAiProvider } from './aiProviders'

// =============================================================================
//  AI analysis of a COMPLETED persisted session (roadmap Phase F).
//
//  The acceptance rule is narrow on purpose: the analysis must cite record ids
//  that exist in the evidence graph, and it may only produce a DRAFT proposal.
//  It never writes an experiment, never touches a strategy version and never
//  reads anything outside the digest it was given — the digest is built from
//  frozen evidence, so what the model saw is exactly what a reviewer can replay.
// =============================================================================

type AnyDoc = Record<string, any>
type ChatFn = (messages: AnyDoc[], tools?: AnyDoc[], opts?: AnyDoc) => Promise<AnyDoc>
type ParseFn = (text: string) => { proposals: AnyDoc[]; errors: string[] }
type PersistFn = (proposal: AnyDoc, opts: { generation: AnyDoc; ownerId: string | null }) => Promise<AnyDoc>
// See evidenceSets.ts: dynamic engine/AI imports widen optional params to
// `null`/`never`, which would reject plain data at the call sites.
type Loose<T> = { [K in keyof T]: T[K] extends (...a: any[]) => infer R ? (...a: any[]) => R : T[K] }

function lazy<T>(file: string): () => Promise<T> {
  let cached: Promise<T> | null = null
  return () => {
    if (!cached) {
      const href = pathToFileURL(join(process.cwd(), file)).href
      // @vite-ignore — ai/ and engine/ live outside server/ (docs/app-inheritance.md).
      cached = import(/* @vite-ignore */ href) as Promise<T>
    }
    return cached
  }
}

const gatewayModule = lazy<Loose<typeof import('../../ai/gateway.mjs')>>('ai/gateway.mjs')
const proposalModule = lazy<Loose<typeof import('../../ai/proposal.mjs')>>('ai/proposal.mjs')
const serviceModule = lazy<Loose<typeof import('../../engine/experimentService.mjs')>>('engine/experimentService.mjs')
const versionModule = lazy<Loose<typeof import('../../engine/version.mjs')>>('engine/version.mjs')

export const SESSION_ANALYSIS_SCHEMA = 'session-analysis.v1'

const SYSTEM_PROMPT = [
  'You are a trading research analyst working on paper-trading evidence.',
  'Analyze ONLY the evidence digest in the user message. Do not use outside knowledge of markets.',
  'Return exactly ONE JSON object (no markdown, no prose) with this shape:',
  '{"proposalId":string,"hypothesis":string,"changes":[{"parameter":string,"from":any,"to":any}],',
  '"evidence":[{"metric":string,"value":number,"sampleSize":number}],"risks":[string],',
  '"recommendedTest":{"symbols":[string],"timeframes":[string]},',
  '"citations":[{"kind":"session|evidence-set|order|fill|position|trade|journal|news|experiment|dataset|related-set","id":string}]}',
  'Rules: every evidence row must come from the digest; every citation id MUST be copied exactly from the digest;',
  'never invent an id; sampleSize must not exceed the rows the digest reports;',
  'propose a TEST, never a change to the active strategy; when the evidence is insufficient, say so in hypothesis and keep changes empty.',
].join(' ')

export interface SessionAnalysisDeps {
  graph?: typeof getSessionEvidenceGraph
  chat?: ChatFn
  resolveProvider?: (ownerId: string | null, opts?: { id?: string | null; required?: string[] }) => Promise<AnyDoc | null>
  parse?: ParseFn
  persist?: PersistFn
  hash?: (value: unknown) => string
  now?: () => number
  proposalId?: (seed: string) => string
}

export interface AnalyzeInput {
  focus?: string | null
  /** false = dry run: validate and return the draft without writing a row. */
  persist?: boolean
  createdBy?: string | null
}

export function sessionAnalysisHttpError(err: unknown) {
  return evidenceHttpError(err)
}

const asIds = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [])

/** Largest sample the graph can actually support (session + related sets). */
function maxSampleSize(graph: AnyDoc): number {
  const own = Number(graph?.bundle?.metrics?.trades ?? 0) || 0
  const related = (Array.isArray(graph?.relatedSets) ? graph.relatedSets : [])
    .map((r: AnyDoc) => Number(r?.metrics?.trades ?? 0) || 0)
  return Math.max(own, ...related, 0)
}

/**
 * Analyze one completed session and (optionally) persist the draft proposal.
 * @throws EvidenceError with 400/404/409/422/502/503 — never a bare Error.
 */
export async function analyzeSession(
  sessionId: string,
  input: AnalyzeInput = {},
  deps: SessionAnalysisDeps = {},
  ownerId?: string | null
): Promise<AnyDoc> {
  const id = String(sessionId ?? '').trim()
  if (!id) throw new EvidenceError('sessionId is required', 400, 'invalid_session')

  const graph = await (deps.graph ?? getSessionEvidenceGraph)(id, {}, ownerId)
  if (graph.bundle?.sealed !== true) {
    throw new EvidenceError('the session has not reached a terminal state — analysis needs a sealed session', 409, 'session_not_sealed')
  }
  if (graph.bundle?.frozen !== true) {
    throw new EvidenceError('the session evidence is not frozen yet — freeze it before asking for analysis', 409, 'evidence_not_frozen')
  }
  if (Number(graph.bundle?.metrics?.trades ?? 0) <= 0) {
    throw new EvidenceError('the session closed no trades — there is no outcome to analyze', 409, 'no_trades')
  }

  const digest = String(graph.digest ?? '')
  const focus = typeof input.focus === 'string' && input.focus.trim() ? input.focus.trim().slice(0, 1000) : null
  const userPrompt = focus ? `${digest}\n\nfocus: ${focus}` : digest

  const chat = deps.chat ?? (await gatewayModule()).chat
  const gateway = deps.chat ? null : await gatewayModule()
  let provider: AnyDoc | null = null
  if (!deps.chat) {
    // Stored, owner-scoped provider wins. Fail soft to env/`AI_CFG` when Mongo
    // is unavailable so analysis still works on a fresh install.
    try {
      provider = await (deps.resolveProvider ?? resolveAiProvider)(ownerId ?? null, { required: ['chat'] })
    } catch {
      provider = null
    }
  }
  const cfg = provider && gateway
    ? {
        ...gateway.AI_CFG,
        provider: provider.provider,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model: provider.model,
      }
    : undefined
  let reply: AnyDoc
  try {
    reply = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      [],
      { tag: '[session-analysis]', temperature: 0.2, maxTokens: 1200, ...(cfg ? { cfg } : {}) }
    )
  } catch (err) {
    const code = String((err as AnyDoc)?.code ?? '')
    if (code === 'ai.no-key') {
      throw new EvidenceError((err as Error)?.message || 'AI is not configured', 503, 'ai_unconfigured')
    }
    throw new EvidenceError(`AI analysis failed: ${(err as Error)?.message || err}`, 502, 'ai_failed')
  }

  const parse = deps.parse ?? (await proposalModule()).parseProposalsText
  const parsed = parse(String(reply?.text ?? ''))
  if (!parsed.proposals.length) {
    const why = parsed.errors.slice(0, 3).join('; ') || 'empty response'
    throw new EvidenceError(`the AI response was not a valid proposal: ${why}`, 502, 'ai_invalid_output')
  }
  const raw = parsed.proposals[0] as AnyDoc | undefined
  if (!raw) {
    throw new EvidenceError('the AI response was not a valid proposal: empty response', 502, 'ai_invalid_output')
  }

  // Citations are the acceptance criterion: an analysis that cannot name the
  // rows it read is refused, and an invented id is a hard error (not trimmed).
  const allowed = new Set(asIds(graph.ids))
  const citations = (Array.isArray(raw.citations) ? raw.citations : [])
    .map((c: AnyDoc) => ({ kind: String(c?.kind ?? 'record'), id: String(c?.id ?? '').trim() }))
    .filter((c: AnyDoc) => c.id)
  if (citations.length === 0) {
    throw new EvidenceError('the AI analysis cited no records — a draft must cite the evidence it used', 422, 'no_citations')
  }
  const unknown = citations.filter((c: AnyDoc) => !allowed.has(c.id))
  if (unknown.length) {
    throw new EvidenceError(`the AI analysis cited records that are not in the evidence: ${unknown.map((c: AnyDoc) => c.id).slice(0, 5).join(', ')}`, 422, 'invalid_citation')
  }

  const maxSample = maxSampleSize(graph as AnyDoc)
  const fabricated = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .filter((e: AnyDoc) => Number(e?.sampleSize) > maxSample)
  if (fabricated.length) {
    throw new EvidenceError(`the AI analysis claimed a sample size larger than the evidence supports (max ${maxSample})`, 422, 'fabricated_sample')
  }

  const now = deps.now ?? Date.now
  const hash = deps.hash ?? (await versionModule()).hashOf
  const newId = deps.proposalId ?? ((seed: string) => `draft_${seed.slice(0, 24)}_${Math.floor(now()).toString(36)}`)
  const at = now()
  const digestHash = String(hash(digest))

  const draft: AnyDoc = {
    ...raw,
    proposalId: String(raw.proposalId ?? '').trim() || newId(id),
    strategyVersionId: raw.strategyVersionId ?? graph.bundle.strategyVersionId ?? null,
    evidenceSetId: graph.bundle.setId ?? null,
    citations,
  }
  const generation = {
    kind: SESSION_ANALYSIS_SCHEMA,
    provider: reply?.provider ?? null,
    model: reply?.model ?? null,
    at,
    digestHash,
    sessionId: String(graph.session?.sessionId ?? id),
    evidenceSetId: graph.bundle.setId ?? null,
    analysis: 'session',
    createdBy: input.createdBy ?? null,
  }

  let persisted: AnyDoc | null = null
  if (input.persist !== false) {
    const persist = deps.persist ?? (await serviceModule()).persistAiProposal
    const res = await persist(draft, { generation, ownerId: ownerId ?? null })
    if (!res?.ok) {
      throw new EvidenceError(`the draft could not be recorded: ${res?.code ?? 'unknown'}`, 503, 'proposal_write_failed')
    }
    persisted = res.doc ?? null
  }

  return {
    draft,
    generation,
    citations,
    digestHash,
    persisted: persisted !== null,
    links: graph.links,
    limitations: graph.limitations,
  }
}
