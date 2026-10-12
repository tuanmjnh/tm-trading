// =============================================================================
//  Alert Rules projection (roadmap §58.5 /alerts) — PURE functions only.
//
//  Formats a rule's condition facets for display and validates/collects the
//  editor form. No fetching, no re-evaluation (D1): the engine
//  (engine/alertRules.mjs) is the single source of the matching semantics; this
//  file only mirrors the input shape the API accepts.
// =============================================================================
import type {
  AlertRule,
  AlertRuleDir,
  AlertRuleInput,
  AlertRuleKind,
  AlertRuleLevel,
  AlertRulePriority
} from '~~/types/alertRules'

export const RULE_KINDS: AlertRuleKind[] = ['news', 'alert']
export const RULE_LEVELS: AlertRuleLevel[] = ['high', 'med', 'low']
export const RULE_DIRS: AlertRuleDir[] = ['pos', 'neg', 'flat']
export const RULE_PRIORITIES: AlertRulePriority[] = ['critical', 'important', 'normal', 'info']

/** Editor form state — list facets are comma-separated strings for plain inputs. */
export interface AlertRuleForm {
  name: string
  kind: AlertRuleKind
  minLevel: AlertRuleLevel
  dirs: AlertRuleDir[]
  symbols: string
  sources: string
  tags: string
  minScore: string
  priority: AlertRulePriority
  lookbackSec: number
  enabled: boolean
}

export function emptyRuleForm(): AlertRuleForm {
  return {
    name: '',
    kind: 'news',
    minLevel: 'med',
    dirs: [],
    symbols: '',
    sources: '',
    tags: '',
    minScore: '',
    priority: 'normal',
    lookbackSec: 7 * 24 * 3600,
    enabled: true
  }
}

export function ruleToForm(rule: AlertRule): AlertRuleForm {
  return {
    name: rule.name,
    kind: rule.kind,
    minLevel: rule.minLevel,
    dirs: [...rule.dirs],
    symbols: rule.symbols.join(', '),
    sources: rule.sources.join(', '),
    tags: rule.tags.join(', '),
    minScore: rule.minScore === null ? '' : String(rule.minScore),
    priority: rule.priority,
    lookbackSec: rule.lookbackSec,
    enabled: rule.enabled
  }
}

/** Split a comma/space separated input into a de-duplicated list. */
export function parseList(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of value.split(/[\s,]+/)) {
    const token = part.trim()
    if (!token) continue
    const key = token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(token)
  }
  return out
}

export interface RuleFormValidation {
  ok: boolean
  /** i18n key suffix under `alertRules.error.` on failure. */
  error?: string
}

/** Client-side mirror of the server rules (server stays the authority). */
export function validateRuleForm(form: AlertRuleForm): RuleFormValidation {
  const name = form.name.trim()
  if (!name) return { ok: false, error: 'nameRequired' }
  if (name.length > 80) return { ok: false, error: 'nameTooLong' }
  const score = String(form.minScore ?? '').trim()
  if (score && !Number.isFinite(Number(score))) return { ok: false, error: 'scoreInvalid' }
  if (!Number.isFinite(form.lookbackSec) || form.lookbackSec < 0) return { ok: false, error: 'lookbackInvalid' }
  return { ok: true }
}

/** Collect a validated form into the API payload. */
export function formToInput(form: AlertRuleForm): AlertRuleInput {
  const score = String(form.minScore ?? '').trim()
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    kind: form.kind,
    minLevel: form.minLevel,
    dirs: [...form.dirs],
    symbols: parseList(form.symbols),
    sources: parseList(form.sources),
    tags: parseList(form.tags),
    minScore: score ? Number(score) : null,
    priority: form.priority,
    lookbackSec: form.lookbackSec
  }
}

export interface RuleFacet {
  facet: 'kind' | 'level' | 'dir' | 'symbol' | 'source' | 'tag' | 'score' | 'priority'
  value: string
}

/** Condition facets of a rule, in a stable display order. Pure. */
export function ruleFacets(rule: AlertRule): RuleFacet[] {
  const out: RuleFacet[] = [{ facet: 'kind', value: rule.kind }]
  if (rule.minLevel) out.push({ facet: 'level', value: rule.minLevel })
  if (rule.dirs.length) out.push({ facet: 'dir', value: rule.dirs.join(', ') })
  if (rule.symbols.length) out.push({ facet: 'symbol', value: rule.symbols.join(', ') })
  if (rule.sources.length) out.push({ facet: 'source', value: rule.sources.join(', ') })
  if (rule.tags.length) out.push({ facet: 'tag', value: rule.tags.join(', ') })
  if (rule.minScore !== null) out.push({ facet: 'score', value: `>= ${rule.minScore}` })
  out.push({ facet: 'priority', value: rule.priority })
  return out
}
