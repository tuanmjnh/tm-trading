// =============================================================================
//  Evidence-set EXPORT (G8.3 / §59.11) — PURE.
//
//  A frozen evidence set is only useful if it can LEAVE the dashboard: a second
//  party must be able to re-derive the hash offline, years later, without this
//  app, this Mongo, or this process. So the export is the frozen facts plus the
//  verdicts and the exact hash contract — never a tidied-up summary.
//
//  No imports on purpose: the endpoint test can load this file without Nitro,
//  Mongo or an engine module.
// =============================================================================

export const EVIDENCE_EXPORT_SCHEMA = 'evidenceExport.v1'

export type AnyDoc = Record<string, any>

/** Filesystem-safe, stable filename for one set. */
export function evidenceExportFilename(set: AnyDoc): string {
  const id = String(set?.setId ?? set?._id ?? 'evidence').replace(/[^a-zA-Z0-9._-]+/g, '_')
  return `evidence-${id}.json`
}

/**
 * Build the downloadable bundle.
 *
 * @param set   a set as returned by getEvidenceSet() (frozen doc + integrity + sufficiency)
 * @param opts  exportedAt (ms) and the app that produced it (audit, outside the hash)
 */
export function buildEvidenceExport(
  set: AnyDoc,
  { exportedAt = Date.now(), appId = null }: { exportedAt?: number, appId?: string | null } = {}
): AnyDoc {
  if (!set || typeof set !== 'object') {
    throw Object.assign(new Error('evidence set required'), { statusCode: 400, statusMessage: 'invalid_evidence' })
  }
  const frozen: AnyDoc = { ...set }
  // Mongo's `_id` is a storage key, `integrity`/`sufficiency` are per-request
  // verdicts — none of the three is part of the hash, and keeping them would
  // make two exports of the same evidence differ byte-for-byte.
  delete frozen._id
  delete frozen.integrity
  delete frozen.sufficiency

  return {
    schemaVersion: EVIDENCE_EXPORT_SCHEMA,
    exportedAt: new Date(Number(exportedAt)).toISOString(),
    appId,
    setId: String(set.setId ?? set._id ?? ''),
    kind: set.kind ?? null,
    sourceId: set.sourceId ?? null,
    hash: set.hash ?? null,
    // Verdicts first: a reader must see "tampered" before reading conclusions.
    integrity: set.integrity ?? null,
    sufficiency: set.sufficiency ?? null,
    verification: {
      algorithm: 'sha256(stableStringify(canonicalFields)) -> evh1_<40 hex>',
      implementation: 'engine/evidence.mjs#evidenceHash',
      compareWith: 'hash',
      note: 'The hash covers the frozen facts (incl. limitations); editing any of them invalidates the set.'
    },
    frozen
  }
}
