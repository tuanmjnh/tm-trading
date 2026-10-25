// =============================================================================
//  Alert Rules read/write model (roadmap §58.5 /alerts; §58.6).
//
//  An Alert Rule is a trading-domain CONDITION over the intel event stream
//  (`news`/`alert`). The engine owns evaluation (engine/alertRules.mjs) and the
//  alertRules service owns delivery via the shared notify/ router — the dashboard
//  only reads the list and writes rule definitions (create/edit/toggle/delete).
// =============================================================================

export type AlertRuleKind = 'news' | 'alert'
export type AlertRuleLevel = 'high' | 'med' | 'low'
export type AlertRuleDir = 'pos' | 'neg' | 'flat'
export type AlertRulePriority = 'critical' | 'important' | 'normal' | 'info'

/** Per-rule evaluation counters — a read model maintained by the service. */
export interface AlertRuleStats {
  matches: number
  notified: number
  /** ISO time of the last match the rule produced; null when never matched. */
  lastMatchAt: string | null
  /** ISO time of the last service cycle that saw this rule enabled. */
  lastRunAt: string | null
}

export interface AlertRule {
  _id: string
  ruleKey: string
  name: string
  enabled: boolean
  kind: AlertRuleKind
  minLevel: AlertRuleLevel
  /** Empty array = any direction. */
  dirs: AlertRuleDir[]
  /** Empty array = any symbol. */
  symbols: string[]
  /** Empty array = any source. */
  sources: string[]
  /** Empty array = any tag (match if the event carries at least one). */
  tags: string[]
  /** Minimum intel score; null = no score floor. */
  minScore: number | null
  priority: AlertRulePriority
  /** How far back the service scans the event stream (seconds). */
  lookbackSec: number
  stats: AlertRuleStats
  createdAt: string
  updatedAt: string
}

/** Payload accepted by POST/PATCH — every facet except `name` is optional. */
export interface AlertRuleInput {
  name: string
  enabled?: boolean
  kind?: AlertRuleKind
  minLevel?: AlertRuleLevel
  dirs?: AlertRuleDir[]
  symbols?: string[]
  sources?: string[]
  tags?: string[]
  minScore?: number | null
  priority?: AlertRulePriority
  lookbackSec?: number
}

export interface AlertRuleListMeta {
  /** Rows returned in this page (after `limit`). */
  count: number
  /** Total rules stored (before `limit`). */
  total: number
  /** 'up' = Mongo reachable; 'down' = fail-soft empty page. */
  mongo: 'up' | 'down'
}

export interface AlertRuleListResponse {
  success: boolean
  data: AlertRule[]
  meta: AlertRuleListMeta
}

export interface AlertRuleResponse {
  success: boolean
  data: AlertRule
}
