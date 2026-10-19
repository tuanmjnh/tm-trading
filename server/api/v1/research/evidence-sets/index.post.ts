import { readBody } from 'h3'
import { createEvidenceSet, evidenceHttpError } from '../../../../utils/evidenceSets'

// =============================================================================
//  POST /api/v1/research/evidence-sets — FREEZE the evidence of a source.
//
//  Body: { kind?, sourceId, notes?, createdBy? } — `sourceId` is a sessionId for
//  the session kinds. Freezing is idempotent by identity (D3): a repeat freeze
//  returns the set that already exists (flagged `alreadyFrozen`, and
//  `sourceChanged` when the source has moved on since), because two sets for one
//  run would let two reports disagree about the same facts. A 409 is reserved for
//  the genuine race where two freezes of the same source collide on insert.
//
//  The response carries the bundle's limitations and sufficiency verdict — a set
//  below the trade floor is returned as such, never as a quiet result.
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw evidenceHttpError(new Error('body must be an object'))
  }

  try {
    const data = await createEvidenceSet({
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      sourceId: typeof body.sourceId === 'string' ? body.sourceId : '',
      notes: Array.isArray(body.notes) ? body.notes.map(String) : undefined,
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : null,
      ownerId: requireOwnerId(event)
    })
    return { success: true, data }
  } catch (err) {
    throw evidenceHttpError(err)
  }
})
