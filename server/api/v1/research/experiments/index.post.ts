import { createError, readBody } from 'h3'
import { createExperiment, researchHttpError } from '../../../../utils/research'

/**
 * POST /api/v1/research/experiments — create a `proposed` experiment from a
 * validated AI proposal (roadmap §28.1 / §30.7).
 *
 * Body: a §27.3 proposal { proposalId, hypothesis, changes, evidence, risks,
 * recommendedTest }. Proposals are DATA (D7) — this writes an `experiments` doc
 * ($setOnInsert, D4), it never touches a preset, profile or the risk gate.
 *
 * Fail-soft: invalid proposal -> 400 invalid_proposal; Mongo down -> 503.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_proposal', message: 'body must be a proposal object' })
  }
  try {
    const data = await createExperiment(body)
    return { success: true, data }
  } catch (err) {
    throw researchHttpError(err)
  }
})
