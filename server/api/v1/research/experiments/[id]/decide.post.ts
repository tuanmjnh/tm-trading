import { createError, getRouterParam, readBody } from 'h3'
import { decideExperiment, researchHttpError } from '../../../../../utils/research'
import type { DecideExperimentOptions } from '../../../../../utils/research'

// =============================================================================
//  POST /api/v1/research/experiments/:id/decide — accept/reject (§28.1/§28.3).
//  Body: { accept: boolean, opts?: { minTrades?, maxDegenerate?, ddSlackPct? } }.
//
//  Accept re-runs the §28.3 gate over the persisted arms on the server, so a
//  candidate can never be accepted from a cached/optimistic client state. A
//  failing gate is 409 acceptance_gate_failed; GET the detail endpoint to read
//  the same gates and show WHY.
//
//  Fail-soft: bad body -> 400; unknown experiment -> 404; Mongo down -> 503.
// =============================================================================

interface DecideBody {
  accept?: unknown
  opts?: unknown
}

function asOpts(v: unknown): DecideExperimentOptions {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const o = v as Record<string, unknown>
  const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : undefined)
  return { minTrades: num(o.minTrades), maxDegenerate: num(o.maxDegenerate), ddSlackPct: num(o.ddSlackPct) }
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_id', message: 'experiment id is required' })
  }

  const body = (await readBody(event).catch(() => null)) as DecideBody | null
  if (!body || typeof body.accept !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'invalid_decision', message: 'accept must be a boolean' })
  }

  try {
    const data = await decideExperiment(id, body.accept, asOpts(body.opts), {}, requireOwnerId(event))
    return { success: true, data }
  } catch (err) {
    throw researchHttpError(err)
  }
})
