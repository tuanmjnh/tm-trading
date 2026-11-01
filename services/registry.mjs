// =============================================================================
//  TM TRADING — SERVICE REGISTRY (V4.2 §17.2 / §17.5)
//
//  One machine-readable definition per unit of continuous work. This file
//  DESCRIBES the services; it does not run them. `services/run.mjs` stays the
//  executor until the supervisor lands (S2), at which point the supervisor and
//  the Operations API read THIS registry instead of a hand-written list.
//
//  Why it exists: today "is the service healthy?" is derived from the age of a
//  JSON heartbeat, which cannot distinguish "never started" from "crashed at
//  boot" from "running but producing nothing" (see
//  docs/web-app/v4.2-operations-control-audit.md §5). A lifecycle needs a
//  definition with dependencies, readiness rules, ownership and capabilities.
//
//  Rules encoded here:
//    - `scope` says who owns the DATA; `processGroup` says which PROCESS hosts
//      the work. They are different axes (§17.5).
//    - `readiness` splits REQUIRED rules (gate for READY) from OPTIONAL rules
//      (a failure downgrades to DEGRADED, never blocks start).
//    - `planned: true` marks target entries that have no code yet, so the UI
//      can render them without pretending they exist.
//
//  Intervals mirror `DEFAULT_INTERVALS` in services/heartbeat.mjs. They are
//  literals on purpose: the registry is a definition, not a snapshot of the
//  current environment. When S2 moves `run.mjs` onto this registry the
//  duplication disappears.
// =============================================================================

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { READINESS_RULE_IDS } from './readiness.mjs'

/** @typedef {import('../shared/types/service').ManagedServiceDefinition} ManagedServiceDefinition */

export const REGISTRY_SCHEMA_VERSION = 'services.v1'

/** Allowed enum values, used by `validateRegistry`. */
const VALID_SCOPES = new Set(['system', 'owner', 'account', 'session'])
const VALID_CATEGORIES = new Set([
  'market-data',
  'intelligence',
  'signals',
  'alerts',
  'ai',
  'bots',
  'platform',
])
const VALID_EXECUTION_MODES = new Set(['continuous', 'periodic', 'event-driven', 'on-demand'])
const VALID_PROCESS_GROUPS = new Set(['web', 'market', 'intelligence', 'signals', 'ai', 'bots'])
const VALID_DEPENDENCY_POLICIES = new Set(['REQUIRE_READY', 'DEGRADED_ALLOWED', 'OPTIONAL'])

/** Canonical English name per readiness rule id. */
export const READINESS_RULE_LABELS = Object.freeze({
  'process-alive': 'Process is alive',
  'dependency-reachable': 'Dependencies reachable',
  'subscription-acked': 'Subscription acknowledged',
  'fresh-event': 'Recent market event received',
  'recent-success': 'A cycle completed within the allowed window',
  'output-produced': 'The last cycle produced output',
  'capability-verified': 'Provider capability verified',
  'validated-job': 'The last job passed validation',
  'outbox-consuming': 'Delivery outbox is being consumed',
  'sink-writable': 'Output sink is writable',
})

/** Build a required readiness rule. */
const req = (id) => ({ id, label: READINESS_RULE_LABELS[id], required: true })
/** Build an optional readiness rule. */
const opt = (id) => ({ id, label: READINESS_RULE_LABELS[id], required: false })

/** @type {ReadonlyArray<ManagedServiceDefinition>} */
export const SERVICES = Object.freeze([
  // ---------------------------------------------------------------------------
  // Market data plane — event-driven, stateful in memory.
  // ---------------------------------------------------------------------------
  {
    id: 'market-plane',
    label: 'Market data plane',
    category: 'market-data',
    scope: 'system',
    executionMode: 'event-driven',
    processGroup: 'market',
    entry: 'market/index.mjs',
    intervalSec: null,
    startupGraceMs: 60_000,
    dependencies: [],
    readiness: [
      req('process-alive'),
      req('dependency-reachable'),
      req('subscription-acked'),
      req('fresh-event'),
      opt('output-produced'),
    ],
    // Runs lazily inside the Nitro process today (server/utils/market-plane.ts).
    // The supervisor must not start a second copy, so only probe is allowed.
    supervised: false,
    supports: ['probe'],
  },

  // ---------------------------------------------------------------------------
  // Periodic intelligence ingestion.
  // ---------------------------------------------------------------------------
  {
    id: 'funding',
    label: 'Funding and open interest',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/funding.mjs',
    runExport: 'runFunding',
    outputCountKeys: ['checked'],
    intervalSec: 900,
    intervalEnv: 'FUNDING_INTERVAL',
    startupGraceMs: 300_000,
    dependencies: [],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'scanner',
    label: 'Volatility and movers scanner',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/scanner.mjs',
    runExport: 'runScanner',
    outputCountKeys: ['scanned'],
    intervalSec: 900,
    intervalEnv: 'SCANNER_INTERVAL',
    startupGraceMs: 300_000,
    dependencies: [],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'news',
    label: 'News ingestion',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/news.mjs',
    runExport: 'runNews',
    outputCountKeys: ['fresh'],
    intervalSec: 600,
    intervalEnv: 'NEWS_INTERVAL',
    startupGraceMs: 240_000,
    dependencies: [],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'regime',
    label: 'Market regime',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/regime.mjs',
    runExport: 'runRegime',
    outputCountKeys: ['sweep'],
    intervalSec: 3600,
    intervalEnv: 'REGIME_INTERVAL',
    startupGraceMs: 600_000,
    dependencies: [
      { serviceId: 'scanner', policy: 'DEGRADED_ALLOWED' },
      { serviceId: 'funding', policy: 'DEGRADED_ALLOWED' },
    ],
    readiness: [req('process-alive'), req('dependency-reachable'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'liquidation',
    label: 'Liquidation intelligence',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/liquidation.mjs',
    runExport: 'runLiquidation',
    outputCountKeys: ['events'],
    intervalSec: 900,
    intervalEnv: 'LIQ_INTERVAL',
    startupGraceMs: 300_000,
    dependencies: [],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'confluence',
    label: 'Method confluence',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/confluence.mjs',
    runExport: 'runConfluence',
    outputCountKeys: ['n'],
    intervalSec: 86_400,
    intervalEnv: 'CONFLUENCE_INTERVAL',
    startupGraceMs: 1_800_000,
    dependencies: [
      { serviceId: 'regime', policy: 'REQUIRE_READY' },
      { serviceId: 'funding', policy: 'REQUIRE_READY' },
      { serviceId: 'liquidation', policy: 'DEGRADED_ALLOWED' },
    ],
    readiness: [req('process-alive'), req('dependency-reachable'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'crossScan',
    label: 'Cross-venue scan',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/crossScan.mjs',
    runExport: 'runCrossScan',
    intervalSec: 14_400,
    intervalEnv: 'CROSS_SCAN_INTERVAL',
    startupGraceMs: 900_000,
    dependencies: [{ serviceId: 'market-plane', policy: 'OPTIONAL' }],
    readiness: [req('process-alive'), req('dependency-reachable'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'macro',
    label: 'Macro calendar and series',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/macro.mjs',
    runExport: 'runMacro',
    outputCountKeys: ['observations'],
    intervalSec: 21_600,
    intervalEnv: 'MACRO_INTERVAL',
    startupGraceMs: 900_000,
    dependencies: [],
    readiness: [req('process-alive'), req('dependency-reachable'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'newsExtract',
    label: 'News extraction',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/newsExtract.mjs',
    runExport: 'runNewsExtract',
    outputCountKeys: ['extracted'],
    intervalSec: 86_400,
    intervalEnv: 'NEWS_EXTRACT_INTERVAL',
    startupGraceMs: 1_800_000,
    dependencies: [{ serviceId: 'news', policy: 'REQUIRE_READY' }],
    readiness: [req('process-alive'), req('capability-verified'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'retention',
    label: 'Data retention',
    category: 'platform',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'exec/retention.mjs',
    runExport: 'runRetentionService',
    outputCountKeys: ['purged'],
    intervalSec: 21_600,
    intervalEnv: 'RETENTION_INTERVAL',
    startupGraceMs: 900_000,
    dependencies: [],
    readiness: [req('process-alive'), req('sink-writable'), opt('recent-success')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'reconcile',
    label: 'Dataset reconciliation',
    category: 'platform',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry: 'services/reconcile.mjs',
    runExport: 'runReconcileService',
    outputCountKeys: ['checked'],
    intervalSec: 21_600,
    intervalEnv: 'RECONCILE_INTERVAL',
    startupGraceMs: 900_000,
    dependencies: [{ serviceId: 'market-plane', policy: 'OPTIONAL' }],
    readiness: [req('process-alive'), req('sink-writable'), opt('recent-success')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },

  // ---------------------------------------------------------------------------
  // Signals and alerts — must survive an AI or market crash; owns delivery.
  // ---------------------------------------------------------------------------
  {
    id: 'signals',
    label: 'Futures signal producer',
    category: 'signals',
    scope: 'system',
    ownerScopedData: true,
    executionMode: 'periodic',
    processGroup: 'signals',
    entry: 'services/signalProducer.mjs',
    runExport: 'runSignalProducer',
    outputCountKeys: ['emitted'],
    intervalSec: 60,
    intervalEnv: 'SIGNAL_PRODUCER_INTERVAL',
    startupGraceMs: 180_000,
    dependencies: [{ serviceId: 'market-plane', policy: 'DEGRADED_ALLOWED' }],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'alertRules',
    label: 'Alert rule evaluator',
    category: 'alerts',
    scope: 'system',
    ownerScopedData: true,
    executionMode: 'periodic',
    processGroup: 'signals',
    entry: 'services/alertRules.mjs',
    runExport: 'runAlertRules',
    outputCountKeys: ['matched'],
    intervalSec: 300,
    intervalEnv: 'ALERT_RULES_INTERVAL',
    startupGraceMs: 180_000,
    dependencies: [
      { serviceId: 'scanner', policy: 'DEGRADED_ALLOWED' },
      { serviceId: 'funding', policy: 'DEGRADED_ALLOWED' },
    ],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), opt('outbox-consuming')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },

  // ---------------------------------------------------------------------------
  // Delivery outbox drain (§7.3).
  //
  //  The dedicated consumer for the durable notification outbox. It is what
  //  makes `alertRules`' optional `outbox-consuming` rule honest: before this
  //  service existed, the only drain happened as a side effect of rule
  //  evaluation, so a rules outage also meant no delivery retries. This tick
  //  runs on its own cadence and reports `outboxLastConsumedAt` whether or not
  //  anything was due — a dead consumer stops reporting, which is exactly the
  //  signal the readiness rule is meant to catch.
  // ---------------------------------------------------------------------------
  {
    id: 'outbox-drain',
    label: 'Notification outbox drain',
    category: 'alerts',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'signals',
    entry: 'services/outboxDrain.mjs',
    runExport: 'runOutboxDrain',
    outputCountKeys: ['accepted'],
    intervalSec: 60,
    intervalEnv: 'OUTBOX_DRAIN_INTERVAL',
    startupGraceMs: 120_000,
    dependencies: [{ serviceId: 'alertRules', policy: 'DEGRADED_ALLOWED' }],
    readiness: [req('process-alive'), req('dependency-reachable'), req('recent-success'), req('outbox-consuming')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },

  // ---------------------------------------------------------------------------
  // AI plane — external provider calls, budget-capped, crash-isolated.
  // ---------------------------------------------------------------------------
  {
    id: 'brief',
    label: 'Daily brief and outlook',
    category: 'ai',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'ai',
    entry: 'ai/daily-brief.mjs',
    runExport: 'runBrief',
    outputCountKeys: ['chars'],
    intervalSec: 3600,
    intervalEnv: 'AI_BRIEF_INTERVAL',
    startupGraceMs: 600_000,
    dependencies: [
      { serviceId: 'news', policy: 'DEGRADED_ALLOWED' },
      { serviceId: 'regime', policy: 'DEGRADED_ALLOWED' },
    ],
    readiness: [req('process-alive'), req('capability-verified'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
  },
  {
    id: 'ai-agent',
    label: 'AI agent runtime',
    category: 'ai',
    scope: 'owner',
    ownerScopedData: true,
    executionMode: 'continuous',
    processGroup: 'ai',
    entry: 'services/aiAgentWorker.mjs',
    intervalSec: 30,
    killSwitch: 'AI_AGENT_EMBEDDED',
    startupGraceMs: 120_000,
    dependencies: [],
    readiness: [req('process-alive'), req('capability-verified'), opt('recent-success'), opt('validated-job')],
    // Hosted by server/plugins/ai-agent-runtime.ts today; starting a second
    // copy would duplicate agent ticks (duplicate proposals).
    supervised: false,
    supports: ['probe'],
  },
  {
    id: 'ai-review',
    label: 'AI review runtime',
    category: 'ai',
    scope: 'system',
    executionMode: 'continuous',
    processGroup: 'ai',
    entry: 'services/aiReviewWorker.mjs',
    intervalSec: 300,
    killSwitch: 'AI_REVIEW_EMBEDDED',
    startupGraceMs: 600_000,
    dependencies: [{ serviceId: 'ai-agent', policy: 'OPTIONAL' }],
    readiness: [req('process-alive'), req('capability-verified'), opt('recent-success'), opt('validated-job')],
    // Hosted by server/plugins/ai-review-runtime.ts today.
    supervised: false,
    supports: ['probe'],
  },

  // ---------------------------------------------------------------------------
  // Bots and owner-scoped execution — lease-based, never in the web process.
  // ---------------------------------------------------------------------------
  {
    id: 'bot-supervisor',
    label: 'Bot supervisor',
    category: 'bots',
    scope: 'owner',
    ownerScopedData: true,
    executionMode: 'continuous',
    processGroup: 'bots',
    entry: 'services/botWorker.mjs',
    intervalSec: 15,
    killSwitch: 'BOT_EMBEDDED',
    startupGraceMs: 60_000,
    dependencies: [{ serviceId: 'market-plane', policy: 'DEGRADED_ALLOWED' }],
    readiness: [req('process-alive'), req('dependency-reachable'), opt('recent-success')],
    // Hosted by server/plugins/bot-runtime.ts today; a second supervisor would
    // double-apply owner commands.
    supervised: false,
    supports: ['probe'],
  },

  // ---------------------------------------------------------------------------
  // Planned target services (no code yet). Kept here so the UI and the
  // dependency graph can be designed before implementation (§17.2).
  // ---------------------------------------------------------------------------
  {
    id: 'market-feeds',
    label: 'Market feed workers',
    category: 'market-data',
    scope: 'system',
    executionMode: 'event-driven',
    processGroup: 'market',
    intervalSec: null,
    startupGraceMs: 60_000,
    dependencies: [],
    readiness: [
      req('process-alive'),
      req('dependency-reachable'),
      req('subscription-acked'),
      req('fresh-event'),
      opt('output-produced'),
    ],
    supports: ['start', 'stop', 'restart', 'probe'],
    planned: true,
  },
  {
    id: 'outlook',
    label: 'Evidence and outlook producer',
    category: 'intelligence',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    intervalSec: 3600,
    startupGraceMs: 600_000,
    dependencies: [{ serviceId: 'brief', policy: 'OPTIONAL' }],
    readiness: [req('process-alive'), req('capability-verified'), opt('recent-success'), opt('output-produced')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
    planned: true,
  },
  {
    id: 'demo-runner',
    label: 'Exchange demo runner',
    category: 'bots',
    scope: 'owner',
    ownerScopedData: true,
    executionMode: 'on-demand',
    processGroup: 'bots',
    intervalSec: null,
    startupGraceMs: 60_000,
    dependencies: [{ serviceId: 'market-plane', policy: 'REQUIRE_READY' }],
    readiness: [req('process-alive'), req('dependency-reachable'), opt('sink-writable')],
    supports: ['start', 'stop', 'restart', 'run-once', 'probe'],
    planned: true,
  },
])

/** Fast lookup by id. */
export const SERVICE_BY_ID = new Map(SERVICES.map(definition => [definition.id, definition]))

/** One definition, or `undefined` when the id is unknown. */
export function getServiceDefinition(id) {
  return SERVICE_BY_ID.get(id)
}

/**
 * Load the registry the supervisor and worker host should use.
 *
 * Production uses the built-in `SERVICES`. A drill (or a future plugin bundle)
 * may point `TM_SUPERVISOR_REGISTRY` at a module exporting `SERVICES`; the same
 * `validateRegistry()` rules run, so a custom registry cannot smuggle in an
 * unknown readiness rule or a service that advertises control it cannot honour.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<{ registry: ReadonlyArray<ManagedServiceDefinition>, source: string }>}
 */
export async function loadRegistry(env = process.env) {
  const requested = String(env.TM_SUPERVISOR_REGISTRY ?? '').trim()
  if (!requested) return { registry: SERVICES, source: 'builtin' }

  const file = pathToFileURL(resolve(requested)).href
  const module = await import(file)
  const registry = module.SERVICES ?? module.default
  if (!Array.isArray(registry) || registry.length === 0) {
    throw new Error(`loadRegistry: ${requested} does not export a non-empty SERVICES array`)
  }
  const validation = validateRegistry(registry)
  if (!validation.ok) {
    const detail = validation.errors.map(error => `${error.code}: ${error.detail}`).join('; ')
    throw new Error(`loadRegistry: ${requested} is invalid — ${detail}`)
  }
  return { registry, source: requested }
}

/**
 * Validate a registry.
 *
 * @param {ReadonlyArray<ManagedServiceDefinition>} [registry]
 * @returns {{ ok: boolean, errors: Array<{ code: string, serviceId: string | null, detail: string }> }}
 */
export function validateRegistry(registry = SERVICES) {
  const errors = []
  const seen = new Set()
  const byId = new Map()

  for (const definition of registry) {
    if (seen.has(definition.id)) {
      errors.push({ code: 'duplicate-id', serviceId: definition.id, detail: `duplicate service id ${definition.id}` })
    }
    seen.add(definition.id)
    byId.set(definition.id, definition)

    if (!VALID_SCOPES.has(definition.scope)) {
      errors.push({ code: 'invalid-scope', serviceId: definition.id, detail: `unknown scope ${definition.scope}` })
    }
    if (!VALID_CATEGORIES.has(definition.category)) {
      errors.push({ code: 'invalid-category', serviceId: definition.id, detail: `unknown category ${definition.category}` })
    }
    if (!VALID_EXECUTION_MODES.has(definition.executionMode)) {
      errors.push({
        code: 'invalid-execution-mode',
        serviceId: definition.id,
        detail: `unknown execution mode ${definition.executionMode}`,
      })
    }
    if (!VALID_PROCESS_GROUPS.has(definition.processGroup)) {
      errors.push({
        code: 'invalid-process-group',
        serviceId: definition.id,
        detail: `unknown process group ${definition.processGroup}`,
      })
    }
    if (!definition.supports?.length) {
      errors.push({ code: 'empty-supports', serviceId: definition.id, detail: 'no control action is declared' })
    }
    // A service that is still hosted inside another process must not expose a
    // control action the supervisor cannot honour without duplicating it.
    if (definition.supervised === false) {
      const forbidden = definition.supports.filter(action => action !== 'probe')
      if (forbidden.length > 0) {
        errors.push({
          code: 'unsupervised-control',
          serviceId: definition.id,
          detail: `unsupervised service cannot declare ${forbidden.join(', ')}`,
        })
      }
    }
    // The supervisor runs one exported function. A startable service without
    // one would spawn a process that has nothing to do.
    if (!definition.planned && definition.supervised !== false && definition.supports?.includes('start')) {
      if (!definition.entry) {
        errors.push({ code: 'missing-entry', serviceId: definition.id, detail: 'startable service needs an entry module' })
      }
      if (!definition.runExport) {
        errors.push({ code: 'missing-run-export', serviceId: definition.id, detail: 'startable service needs a runExport' })
      }
    }
    if (!Number.isFinite(definition.startupGraceMs) || definition.startupGraceMs <= 0) {
      errors.push({ code: 'invalid-startup-grace', serviceId: definition.id, detail: 'startupGraceMs must be > 0' })
    }
    const needsInterval = definition.executionMode === 'periodic' || definition.executionMode === 'continuous'
    if (needsInterval && !(Number.isFinite(definition.intervalSec) && definition.intervalSec > 0)) {
      errors.push({ code: 'invalid-interval', serviceId: definition.id, detail: 'periodic/continuous service needs intervalSec > 0' })
    }
    if (!needsInterval && definition.intervalSec !== null) {
      errors.push({ code: 'invalid-interval', serviceId: definition.id, detail: 'event-driven/on-demand service must use intervalSec: null' })
    }
    for (const rule of definition.readiness ?? []) {
      if (!READINESS_RULE_IDS.includes(rule.id)) {
        errors.push({ code: 'unknown-readiness-rule', serviceId: definition.id, detail: `unknown readiness rule ${rule.id}` })
      }
    }
    for (const dependency of definition.dependencies ?? []) {
      if (dependency.serviceId === definition.id) {
        errors.push({ code: 'self-dependency', serviceId: definition.id, detail: 'a service cannot depend on itself' })
      }
      if (!VALID_DEPENDENCY_POLICIES.has(dependency.policy)) {
        errors.push({
          code: 'invalid-dependency-policy',
          serviceId: definition.id,
          detail: `unknown dependency policy ${dependency.policy}`,
        })
      }
    }
  }

  for (const definition of registry) {
    for (const dependency of definition.dependencies ?? []) {
      if (!byId.has(dependency.serviceId)) {
        errors.push({
          code: 'unknown-dependency',
          serviceId: definition.id,
          detail: `unknown dependency ${dependency.serviceId}`,
        })
      }
    }
  }

  const { errors: orderErrors } = resolveStartOrder(registry, registry.map(definition => definition.id))
  errors.push(...orderErrors)

  return { ok: errors.length === 0, errors }
}

/**
 * Topological start order for a subset of services.
 *
 * Deterministic: ties keep the order in which ids were supplied. Unknown ids
 * and cycles are reported, never silently dropped.
 *
 * @param {ReadonlyArray<ManagedServiceDefinition>} [registry]
 * @param {ReadonlyArray<string>} [ids]
 * @returns {{ order: string[], errors: Array<{ code: string, serviceId: string | null, detail: string }> }}
 */
export function resolveStartOrder(registry = SERVICES, ids = registry.map(definition => definition.id)) {
  const byId = new Map(registry.map(definition => [definition.id, definition]))
  const errors = []
  const wanted = new Set()

  for (const id of ids) {
    if (!byId.has(id)) {
      errors.push({ code: 'unknown-service', serviceId: id, detail: `no definition for ${id}` })
      continue
    }
    wanted.add(id)
  }

  const indegree = new Map()
  const dependents = new Map()
  for (const id of wanted) {
    indegree.set(id, 0)
    dependents.set(id, [])
  }
  for (const id of wanted) {
    const definition = byId.get(id)
    for (const dependency of definition?.dependencies ?? []) {
      if (!wanted.has(dependency.serviceId)) continue
      indegree.set(id, (indegree.get(id) ?? 0) + 1)
      dependents.get(dependency.serviceId)?.push(id)
    }
  }

  const queue = [...wanted].filter(id => indegree.get(id) === 0)
  const order = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    order.push(id)
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }

  if (order.length !== wanted.size) {
    const stuck = [...wanted].filter(id => !order.includes(id)).sort()
    errors.push({
      code: 'dependency-cycle',
      serviceId: stuck[0] ?? null,
      detail: `cycle among ${stuck.join(', ')}`,
    })
  }

  return { order, errors }
}

/**
 * Direct (or transitive) dependency ids of one service, cycle-safe.
 *
 * @param {ReadonlyArray<ManagedServiceDefinition>} registry
 * @param {string} id
 * @param {{ transitive?: boolean }} [options]
 * @returns {string[]}
 */
export function dependenciesOf(registry, id, options = {}) {
  const byId = new Map(registry.map(definition => [definition.id, definition]))
  // Seeding the origin keeps a cyclic graph from reporting the service as its
  // own transitive dependency.
  const seen = new Set([id])
  const out = []

  const walk = (serviceId) => {
    const definition = byId.get(serviceId)
    for (const dependency of definition?.dependencies ?? []) {
      if (seen.has(dependency.serviceId)) continue
      seen.add(dependency.serviceId)
      out.push(dependency.serviceId)
      if (options.transitive) walk(dependency.serviceId)
    }
  }

  walk(id)
  return out
}
