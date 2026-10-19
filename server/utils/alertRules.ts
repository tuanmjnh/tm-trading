import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createError } from 'h3'
import { Types } from 'mongoose'
import type { AlertRule } from '../../types/alertRules'
import { engineModel } from './engineModel'

// =============================================================================
//  Alert Rules store (roadmap §58.5 /alerts; §58.6 Notifications != Alert Rules).
//
//  The dashboard only WRITES rule definitions here — evaluation + delivery live in
//  engine/alertRules.mjs and services/alertRules.mjs. Validation/normalization is
//  the engine's (one source, D1): the pure module is loaded at runtime like
//  engine/keys.mjs, so the API route stays thin (validate -> normalize -> persist).
//
//  Mongo unreachable -> reads fail-soft (200 + mongo:'down'); writes 503 (never a
//  silent no-op, D12).
// =============================================================================

interface EngineAlertRulesModule {
  validateRule: (input: unknown) => { ok: boolean; error?: string }
  normalizeRule: (input: Record<string, unknown>) => Record<string, unknown>
  ruleKeyFor: (normalized: Record<string, unknown>) => string
}

let alertRulesPromise: Promise<EngineAlertRulesModule> | null = null

function engineAlertRules(): Promise<EngineAlertRulesModule> {
  if (!alertRulesPromise) {
    const file = pathToFileURL(join(process.cwd(), 'engine', 'alertRules.mjs')).href
    alertRulesPromise = import(/* @vite-ignore */ file) as Promise<EngineAlertRulesModule>
  }
  return alertRulesPromise
}

/** Alert-rule model via the shared engineModel() (memo + fail-soft, D1). */
export function alertRuleModel(): ReturnType<typeof engineModel> {
  return engineModel('alertRule.mjs', 'AlertRule')
}

function iso(d: unknown): string | null {
  if (!d) return null
  const t = new Date(d as string | number | Date)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function serializeRule(doc: any): AlertRule {
  return {
    _id: String(doc._id),
    ruleKey: doc.ruleKey ?? '',
    name: doc.name ?? '',
    enabled: doc.enabled !== false,
    kind: doc.kind ?? 'news',
    minLevel: doc.minLevel ?? 'med',
    dirs: Array.isArray(doc.dirs) ? doc.dirs : [],
    symbols: Array.isArray(doc.symbols) ? doc.symbols : [],
    sources: Array.isArray(doc.sources) ? doc.sources : [],
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    minScore: Number.isFinite(doc.minScore) ? doc.minScore : null,
    priority: doc.priority ?? 'normal',
    lookbackSec: Number.isFinite(doc.lookbackSec) ? doc.lookbackSec : 7 * 24 * 3600,
    stats: {
      matches: Number(doc.stats?.matches) || 0,
      notified: Number(doc.stats?.notified) || 0,
      lastMatchAt: iso(doc.stats?.lastMatchAt),
      lastRunAt: iso(doc.stats?.lastRunAt),
    },
    createdAt: iso(doc.createdAt) ?? '',
    updatedAt: iso(doc.updatedAt) ?? '',
  }
}

function assertId(id: string): string {
  if (!Types.ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidId', message: `invalid alert rule id: ${id}` })
  }
  return id
}

export interface ListAlertRulesQuery {
  limit: number
  /** Tenancy (roadmap §61.3): only the caller's own rules are ever returned. */
  ownerId: string
  enabled?: boolean
}

export interface ListAlertRulesResult {
  items: AlertRule[]
  total: number
  mongo: 'up' | 'down'
}

export async function listAlertRules(q: ListAlertRulesQuery): Promise<ListAlertRulesResult> {
  const AlertRule = await alertRuleModel()
  if (!AlertRule) return { items: [], total: 0, mongo: 'down' }

  const filter: Record<string, unknown> = { ownerId: q.ownerId }
  if (q.enabled !== undefined) filter.enabled = q.enabled

  try {
    const docs = await AlertRule.find(filter).sort({ enabled: -1, createdAt: -1 }).limit(q.limit).lean()
    const total = await AlertRule.countDocuments(filter)
    return { items: docs.map(serializeRule), total, mongo: 'up' }
  } catch {
    // Lost the connection mid-way -> fail-soft like signals/news (never a 500).
    return { items: [], total: 0, mongo: 'down' }
  }
}

export async function getAlertRuleById(id: string, ownerId: string): Promise<AlertRule | null> {
  const AlertRule = await alertRuleModel()
  if (!AlertRule) return null
  assertId(id)
  const doc = await AlertRule.findOne({ _id: id, ownerId }).lean()
  return doc ? serializeRule(doc) : null
}

/** validate + normalize + mint the stable definition key (engine-owned, D1). */
async function buildNormalized(body: unknown): Promise<Record<string, unknown>> {
  const { validateRule, normalizeRule, ruleKeyFor } = await engineAlertRules()
  const v = validateRule(body)
  if (!v.ok) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_rule', message: v.error })
  }
  const normalized = normalizeRule(body as Record<string, unknown>)
  return { ...normalized, ruleKey: ruleKeyFor(normalized) }
}

export async function createAlertRule(body: unknown, ownerId: string): Promise<AlertRule> {
  const AlertRule = await alertRuleModel()
  if (!AlertRule) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — rule not saved' })
  }
  const doc = { ...(await buildNormalized(body)), ownerId }
  try {
    const created = await AlertRule.create(doc)
    return serializeRule(created.toObject())
  } catch (e: unknown) {
    if ((e as { code?: number } | null)?.code === 11000) {
      throw createError({ statusCode: 409, statusMessage: 'duplicate', message: 'A rule with the same definition already exists' })
    }
    throw createError({ statusCode: 500, statusMessage: 'insert_failed', message: `Rule not stored: ${String((e as Error)?.message ?? e)}` })
  }
}

export async function updateAlertRule(id: string, body: unknown, ownerId: string): Promise<AlertRule> {
  const AlertRule = await alertRuleModel()
  if (!AlertRule) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — rule not saved' })
  }
  assertId(id)

  const current = await AlertRule.findOne({ _id: id, ownerId }).lean()
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'not_found', message: `alert rule not found: ${id}` })
  }
  const patch = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  if (!patch) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_rule', message: 'payload must be an object' })
  }

  const merged = {
    name: current.name,
    enabled: current.enabled,
    kind: current.kind,
    minLevel: current.minLevel,
    dirs: current.dirs,
    symbols: current.symbols,
    sources: current.sources,
    tags: current.tags,
    minScore: current.minScore,
    priority: current.priority,
    lookbackSec: current.lookbackSec,
    ...patch
  }
  const doc = await buildNormalized(merged)

  try {
    const updated = await AlertRule.findOneAndUpdate({ _id: id, ownerId }, { $set: doc }, { new: true }).lean()
    if (!updated) {
      throw createError({ statusCode: 404, statusMessage: 'not_found', message: `alert rule not found: ${id}` })
    }
    return serializeRule(updated)
  } catch (e: unknown) {
    if ((e as { statusCode?: number } | null)?.statusCode) throw e
    if ((e as { code?: number } | null)?.code === 11000) {
      throw createError({ statusCode: 409, statusMessage: 'duplicate', message: 'A rule with the same definition already exists' })
    }
    throw createError({ statusCode: 500, statusMessage: 'update_failed', message: `Rule not saved: ${String((e as Error)?.message ?? e)}` })
  }
}

export async function deleteAlertRule(id: string, ownerId: string): Promise<{ id: string }> {
  const AlertRule = await alertRuleModel()
  if (!AlertRule) {
    throw createError({ statusCode: 503, statusMessage: 'mongo_down', message: 'MongoDB unavailable — rule not deleted' })
  }
  assertId(id)
  const deleted = await AlertRule.findOneAndDelete({ _id: id, ownerId }).lean()
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'not_found', message: `alert rule not found: ${id}` })
  }
  return { id }
}
