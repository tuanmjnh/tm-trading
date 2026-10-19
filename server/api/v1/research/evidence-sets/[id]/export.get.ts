import { getRouterParam, setResponseHeader } from 'h3'
import { evidenceHttpError, getEvidenceSet } from '../../../../../utils/evidenceSets'
import { buildEvidenceExport, evidenceExportFilename } from '../../../../../utils/evidenceExport'

// =============================================================================
//  GET /api/v1/research/evidence-sets/:id/export — download one frozen set.
//
//  G8.3 / §59.11: the dashboard could cite a frozen set but never ship it, so
//  "reproducible evidence" stopped at the browser. The body is the bundle
//  itself (not the usual { success, data } envelope): it is a file a second
//  party re-verifies offline, and `Content-Disposition: attachment` names it.
//
//  Read-only and immutable: exporting never writes, and the exported doc is a
//  copy — re-verification happens against the same hash the store holds.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw evidenceHttpError(new Error('evidence set id is required'))

  try {
    const set = await getEvidenceSet(id, {}, requireOwnerId(event))
    if (!set) {
      throw Object.assign(new Error(`evidence set not found: ${id}`), {
        statusCode: 404,
        statusMessage: 'evidence_not_found'
      })
    }
    const config = useRuntimeConfig()
    const bundle = buildEvidenceExport(set, {
      appId: (config.public.hubAppId as string) || null
    })
    setResponseHeader(event, 'Content-Type', 'application/json; charset=utf-8')
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="${evidenceExportFilename(set)}"`)
    // A frozen set never changes, but the VERDICT is recomputed per request —
    // so a cached copy could keep claiming "verified" after tampering.
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return bundle
  } catch (err) {
    throw evidenceHttpError(err)
  }
})
