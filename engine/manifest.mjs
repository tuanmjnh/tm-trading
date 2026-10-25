// engine/manifest.mjs
// ONE versioned identity document for a run or a session (roadmap Phase F).
//
// The point is to answer, from the persisted record alone, "which engine,
// strategy, risk configuration and data produced this?" — without guessing from
// whichever fields a producer happened to write. A manifest therefore declares
// FIVE sections, and the gaps it carries are part of the answer: an identity
// that cannot name its engine version is not silently complete.
//
// This module is pure (no IO, no clock): callers pass `createdAt`. Timestamps
// are UTC epoch ms everywhere (D2).
import { createHash } from 'node:crypto'
import { stableStringify } from './version.mjs'

export const MANIFEST_SCHEMA_VERSION = 'manifest.v1'

/** The five sections every manifest carries (some may be nullish). */
export const MANIFEST_SECTIONS = Object.freeze(['engine', 'strategy', 'risk', 'data', 'scope'])

/** How a record was produced — not a quality claim, only a provenance kind. */
export const MANIFEST_SOURCES = Object.freeze(['paper', 'bot', 'replay', 'backtest', 'dataset', 'manual'])

export const MANIFEST_KINDS = Object.freeze(['session', 'run'])

const str = (v) => {
  const s = v === null || v === undefined ? '' : String(v).trim()
  return s || null
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const list = (v) => {
  if (!Array.isArray(v)) return []
  return [...new Set(v.map(str).filter(Boolean))]
}

/**
 * Gaps that make a manifest unusable as identity (as opposed to merely
 * incomplete): without an engine version or a data source, a reader cannot even
 * bound what produced the record.
 */
export function essentialGaps(manifest) {
  const m = manifest ?? {}
  const missing = []
  if (!str(m?.engine?.version)) missing.push('engine.version')
  if (!str(m?.data?.source)) missing.push('data.source')
  return missing
}

/**
 * Build a normalized manifest. Unknown input is dropped rather than invented —
 * every field not supplied becomes an explicit gap, never a default that reads
 * like a measurement.
 *
 * @param {object} [input]
 * @returns {Readonly<object>}
 */
export function buildManifest(input = {}) {
  const i = input ?? {}
  const kind = MANIFEST_KINDS.includes(i.kind) ? i.kind : 'session'
  const source = MANIFEST_SOURCES.includes(i.source) ? i.source : null

  const manifest = {
    schema: MANIFEST_SCHEMA_VERSION,
    kind,
    source,
    engine: {
      version: str(i.engineVersion),
      methods: list(i.methods?.length ? i.methods : (i.method ? [i.method] : [])),
    },
    strategy: {
      versionId: str(i.strategyVersionId),
      paramsHash: str(i.paramsHash),
      method: str(i.method),
    },
    risk: {
      fingerprint: str(i.riskFingerprint),
      source: str(i.riskSource),
    },
    data: {
      source: str(i.dataSource),
      dataHash: str(i.dataHash),
      qualityState: str(i.qualityState),
      datasetIds: list(i.datasetIds),
      asOf: num(i.asOf),
      inputCutoff: num(i.inputCutoff),
    },
    scope: {
      purpose: str(i.purpose),
      account: str(i.account),
      instruments: list(i.instruments),
      timeframes: list(i.timeframes),
      botProfileId: str(i.botProfileId),
      instanceId: str(i.instanceId),
      experimentId: str(i.experimentId),
      baselineVersionId: str(i.baselineVersionId),
      evidenceSetId: str(i.evidenceSetId),
      symbol: str(i.symbol),
      tf: str(i.tf),
      market: str(i.market),
    },
    createdAt: num(i.createdAt),
  }

  const gaps = manifestGaps(manifest, { kind })
  return Object.freeze({ ...manifest, gaps, fingerprint: manifestFingerprint(manifest) })
}

/**
 * Every identity field this manifest could not declare, as dotted paths. The
 * PATH is the message: "strategy.versionId" tells a reader exactly what is
 * unknown, which a bare `manifest: null` never could.
 */
export function manifestGaps(manifest, { kind = manifest?.kind ?? 'session' } = {}) {
  const m = manifest ?? {}
  const gaps = []
  const need = (ok, path) => { if (!ok) gaps.push(path) }
  need(!!str(m?.engine?.version), 'engine.version')
  need(!!str(m?.data?.source), 'data.source')
  if (kind === 'run') {
    need(!!str(m?.strategy?.paramsHash), 'strategy.paramsHash')
  } else {
    need(!!str(m?.strategy?.versionId), 'strategy.versionId')
    need(!!str(m?.risk?.fingerprint), 'risk.fingerprint')
  }
  if (kind === 'run') {
    need(!!str(m?.strategy?.method), 'strategy.method')
  }
  return gaps
}

/** True when a value was produced by `buildManifest` (or is shaped like it). */
export function isManifest(value) {
  return !!value && typeof value === 'object' && value.schema === MANIFEST_SCHEMA_VERSION
}

/**
 * Content fingerprint of the identity document — stable across processes and
 * independent of `createdAt`, `gaps` and the fingerprint itself. Two sessions
 * started from the same engine/strategy/risk/data identity therefore share it,
 * which is what makes "these runs are comparable" checkable.
 */
export function manifestFingerprint(manifest) {
  const m = manifest ?? {}
  const canon = {
    schema: m.schema ?? MANIFEST_SCHEMA_VERSION,
    kind: m.kind ?? null,
    source: m.source ?? null,
    engine: m.engine ?? null,
    strategy: m.strategy ?? null,
    risk: m.risk ?? null,
    data: m.data ?? null,
    scope: {
      purpose: m?.scope?.purpose ?? null,
      account: m?.scope?.account ?? null,
      instruments: m?.scope?.instruments ?? [],
      timeframes: m?.scope?.timeframes ?? [],
      symbol: m?.scope?.symbol ?? null,
      tf: m?.scope?.tf ?? null,
      market: m?.scope?.market ?? null,
    },
  }
  return 'mf1_' + createHash('sha256').update(stableStringify(canon)).digest('hex').slice(0, 40)
}

/**
 * Manifest of a persisted session, or null when it predates manifest.v1. The
 * legacy shape (`{account, source}` written by early paper executors) is NOT
 * upgraded into a v1 document: inventing an engine version would turn an
 * unknown into a fact.
 */
export function manifestFromSession(session) {
  const m = session?.manifest
  return isManifest(m) ? m : null
}

/** Human-readable note for an evidence bundle whose source has no v1 manifest. */
export function legacyManifestNote(session) {
  if (manifestFromSession(session)) return null
  const raw = session?.manifest
  if (raw === null || raw === undefined) return null
  return 'source manifest predates manifest.v1 — engine/strategy/risk/data identity is only partially declared'
}

/**
 * Fingerprint of a risk configuration: the caps that shaped every order, with
 * owner/account removed because those are scope, not risk. Two desks running the
 * same numbers therefore share it, which is what a comparison needs.
 */
export function riskFingerprint(config) {
  const caps = { ...(config ?? {}) }
  // Scope, not risk: two desks with the same caps must compare equal.
  delete caps.ownerId
  delete caps.account
  return 'rf1_' + createHash('sha256').update(stableStringify(caps)).digest('hex').slice(0, 40)
}

/**
 * Split a session manifest into what a paper-validation launch must carry over.
 * Used by the server launcher so a validation session inherits the experiment
 * linkage without re-declaring identity the caller cannot know.
 */
export function validationScope(manifest) {
  const m = manifest ?? {}
  return {
    purpose: m?.scope?.purpose ?? 'paper-validation',
    experimentId: m?.scope?.experimentId ?? null,
    baselineVersionId: m?.scope?.baselineVersionId ?? null,
    evidenceSetId: m?.scope?.evidenceSetId ?? null,
    instruments: Array.isArray(m?.scope?.instruments) ? m.scope.instruments : [],
    timeframes: Array.isArray(m?.scope?.timeframes) ? m.scope.timeframes : [],
  }
}
