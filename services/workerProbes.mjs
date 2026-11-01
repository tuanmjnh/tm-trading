// =============================================================================
//  TM TRADING — WORKER PROBES (V4.2 §17.4)
//
//  The supervisor never invents readiness. It asks the worker, and the worker
//  answers from evidence it can actually observe:
//
//    dependenciesReachable  a configured dependency answered (Mongo ping), or
//                           the service has no external dependency to reach;
//    sinkWritable           the configured sink accepts writes (Mongo when it
//                           is the store, otherwise the data directory);
//    capabilityVerified     the AI provider answered a FREE capability probe
//                           (`GET /models`, `GET /api/tags`) — no tokens spent;
//    lastOutputCount        rows the last completed cycle reported.
//
//  Honesty rules (D12):
//
//    - `null` means NOT OBSERVED and is never treated as a pass by the
//      readiness evaluator;
//    - a provider probe that cannot be attempted (no key, no endpoint) is
//      `null`, not `false` — an unconfigured provider is not a broken one;
//    - a probe that fails at the network level IS `false` — the provider is
//      configured and unreachable, which is a real fault.
//
//  Everything here is pure over its inputs (fetch, fs and clock are injected),
//  so the supervisor's readiness story is testable without a network or a DB.
// =============================================================================

import fs from 'node:fs'

export const WORKER_PROBE_SCHEMA_VERSION = 'worker-probes.v1'

/** Fallback summary fields that report "how many rows did this cycle produce". */
export const DEFAULT_OUTPUT_COUNT_KEYS = Object.freeze(['count', 'rows', 'n', 'produced'])

/**
 * Evidence fields a worker is allowed to report.
 *
 * One canonical list shared by the worker host (which builds the report), the
 * supervisor (which refuses anything outside it) and the drill harness. Keeping
 * it in a single place matters: before this list existed, a service could only
 * report dependency/sink/capability evidence, so a declared `subscription-acked`,
 * `validated-job`, `fresh-event` or `outbox-consuming` rule could never pass for
 * a real service. A new readiness rule now has exactly one field list to extend.
 */
export const EVIDENCE_FIELDS = Object.freeze([
  'dependenciesReachable',
  'subscriptionAcked',
  'lastEventAt',
  'lastSuccessAt',
  'lastOutputCount',
  'capabilityVerified',
  'lastJobValidated',
  'outboxLastConsumedAt',
  'sinkWritable',
])

/**
 * Keep only the evidence fields a worker is allowed to report.
 *
 * `undefined` is dropped (a missing field is not evidence either way); an
 * explicit `null` is preserved because NOT OBSERVED is a real answer, not a
 * comfortable pass (D12).
 *
 * @param {unknown} evidence
 * @returns {Record<string, unknown>}
 */
export function pickEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return {}
  const picked = {}
  for (const field of EVIDENCE_FIELDS) {
    if (evidence[field] !== undefined) picked[field] = evidence[field]
  }
  return picked
}

/**
 * How many rows one cycle produced, or `null` when the summary does not say.
 *
 * A cycle that returns an array (the cross-venue scan) reports its length. A
 * zero is a real answer and stays zero — only an absent field is `null`.
 *
 * @param {unknown} summary
 * @param {ReadonlyArray<string>} [keys]
 * @returns {number | null}
 */
export function outputCountOf(summary, keys = DEFAULT_OUTPUT_COUNT_KEYS) {
  if (Array.isArray(summary)) return summary.length
  if (Number.isFinite(summary)) return Math.max(0, Number(summary))
  if (!summary || typeof summary !== 'object') return null

  const fields = Array.isArray(keys) && keys.length > 0 ? keys : DEFAULT_OUTPUT_COUNT_KEYS
  for (const field of fields) {
    const value = summary[field]
    if (Number.isFinite(value) && value >= 0) return Number(value)
  }
  return null
}

/**
 * Did the cycle succeed?
 *
 * A service that reports `{ ok: false }` or `{ error }` failed even though it
 * did not throw. Everything else — including a deliberate skip — completed.
 *
 * @param {unknown} summary
 * @returns {boolean}
 */
export function cycleSucceeded(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return true
  if (summary.ok === false) return false
  if (typeof summary.error === 'string' && summary.error.trim().length > 0) return false
  return true
}

/**
 * Why the cycle did nothing, when the service says so.
 *
 * A skip is not a failure and not a success: it must not refresh
 * `lastSuccessAt`, because "the brief was outside its window" is not evidence
 * that the brief works.
 *
 * @param {unknown} summary
 * @returns {string | null}
 */
export function cycleSkipReason(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const skipped = summary.skipped
  if (typeof skipped === 'string' && skipped.length > 0) return skipped
  if (skipped === true) return 'skipped'
  if (Number.isFinite(skipped) && skipped > 0) return `skipped:${skipped}`
  return null
}

/**
 * Evidence a cycle summary proves, without asking the database again.
 *
 * A summary may carry an explicit `evidence` object for facts the supervisor
 * cannot derive (a subscription ack, a validated job, an outbox timestamp, the
 * last market event). Only whitelisted fields survive, and an explicit
 * observation wins over the `mongo` heuristics below.
 *
 * @param {unknown} summary
 * @param {{ outputCountKeys?: ReadonlyArray<string> }} [definition]
 * @returns {{ lastOutputCount: number | null, dependenciesReachable?: boolean }}
 */
export function evidenceFromSummary(summary, definition = {}) {
  /** @type {{ lastOutputCount: number | null, dependenciesReachable?: boolean }} */
  const evidence = { lastOutputCount: outputCountOf(summary, definition.outputCountKeys) }
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return evidence

  const mongo = String(summary.mongo ?? '').toLowerCase()
  if (mongo === 'up') evidence.dependenciesReachable = true
  if (mongo === 'down') evidence.dependenciesReachable = false
  if (summary.mongoDown === true) evidence.dependenciesReachable = false
  if (summary.skipped === 'mongo-down') evidence.dependenciesReachable = false

  // Explicit evidence is the service's own observation; it is more specific
  // than anything derived from a summary field.
  Object.assign(evidence, pickEvidence(summary.evidence))
  return evidence
}

/**
 * Turn a Mongo status into dependency evidence.
 *
 * No URI configured means there is no dependency to reach: the services fall
 * back to NDJSON files by design, so reporting `null` would keep a perfectly
 * healthy file-only deployment permanently un-ready.
 *
 * @param {{ configured?: boolean, connected?: boolean } | null | undefined} status
 * @returns {boolean | null}
 */
export function mongoEvidence(status) {
  if (!status || typeof status !== 'object') return null
  if (status.configured === false) return true
  if (status.connected === true) return true
  if (status.connected === false) return false
  return null
}

/**
 * Is the service's output sink writable right now?
 *
 * When Mongo is the configured store, a disconnected Mongo IS a non-writable
 * sink. Otherwise the check is a real `access(W_OK)` on the data directory.
 *
 * @param {{
 *   mongoConfigured?: boolean,
 *   mongoConnected?: boolean,
 *   dir?: string | null,
 *   fsImpl?: typeof fs,
 * }} [input]
 * @returns {boolean | null}
 */
export function probeSink(input = {}) {
  const { mongoConfigured = false, mongoConnected = false, dir = null, fsImpl = fs } = input
  if (mongoConfigured) return mongoConnected === true
  if (!dir) return null
  try {
    const mode = fsImpl.constants?.W_OK ?? 2
    fsImpl.accessSync(dir, mode)
    return true
  } catch {
    return false
  }
}

/**
 * Build the free capability request for the configured provider.
 *
 * Returns `null` when no honest probe exists, so the caller reports
 * "not observed" instead of guessing.
 *
 * @param {{ provider?: string, apiKey?: string, baseUrl?: string } | null | undefined} cfg
 * @returns {{ url: string, headers: Record<string, string> } | null}
 */
export function providerProbeTarget(cfg) {
  if (!cfg || typeof cfg !== 'object') return null
  const baseUrl = String(cfg.baseUrl ?? '').replace(/\/+$/, '')
  if (!baseUrl) return null
  const provider = String(cfg.provider ?? '').toLowerCase()
  const apiKey = String(cfg.apiKey ?? '').trim()

  // Local runtime: listing installed models proves the daemon answers.
  if (provider === 'ollama') return { url: `${baseUrl}/api/tags`, headers: {} }
  // The hub gateway exposes no capability endpoint of its own.
  if (provider === 'hub') return null
  if (!apiKey) return null
  if (provider === 'anthropic') {
    return { url: `${baseUrl}/models`, headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } }
  }
  // OpenAI-compatible providers all expose a models list.
  return { url: `${baseUrl}/models`, headers: { authorization: `Bearer ${apiKey}` } }
}

/**
 * Probe provider capability without spending tokens.
 *
 * @param {{
 *   cfg?: { provider?: string, apiKey?: string, baseUrl?: string } | null,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} [input]
 * @returns {Promise<{ passed: boolean | null, detail: string }>}
 */
export async function probeProviderCapability(input = {}) {
  const { cfg = null, fetchImpl = fetch, timeoutMs = 5_000 } = input
  const target = providerProbeTarget(cfg)
  if (!target) {
    const hasKey = Boolean(String(cfg?.apiKey ?? '').trim())
    return {
      passed: null,
      detail: hasKey ? 'the provider has no capability probe' : 'no provider configured',
    }
  }

  try {
    const response = await fetchImpl(target.url, {
      method: 'GET',
      headers: target.headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response?.ok) return { passed: true, detail: `provider answered ${response.status}` }
    const status = Number(response?.status)
    if (status === 401 || status === 403) {
      return { passed: false, detail: `provider rejected the credentials (${status})` }
    }
    // 404 / 405 / 5xx: the endpoint may not exist or the provider is degraded.
    // Neither proves the service cannot work, so this is "not observed".
    return { passed: null, detail: `provider probe inconclusive (${Number.isFinite(status) ? status : 'no status'})` }
  } catch (error) {
    return { passed: false, detail: `provider probe failed: ${String(error?.message || error).slice(0, 200)}` }
  }
}
