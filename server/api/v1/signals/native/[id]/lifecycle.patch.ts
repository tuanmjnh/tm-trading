import { getRouterParam, readBody } from 'h3'
import { applySignalLifecycle } from '../../../../../utils/signalLifecycle'

// =============================================================================
//  PATCH /api/v1/signals/native/:id/lifecycle — advance one native engine signal
//  through the lifecycle (S8 chunk 4).
//
//  Body: { status: 'expired' | 'invalidated' | 'superseded', at?, note? }.
//  The transition must be legal from the current state (400 otherwise). The
//  evidence + attribution is never touched — only the overlay.
//
//  Owner-only: a foreign id or a legacy row without a `signalKey` -> 404.
//  Store down -> 503.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw Object.assign(new Error('signal id is required'), { statusCode: 400, statusMessage: 'error.invalidId' })

  const body = await readBody(event).catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('body must be an object'), { statusCode: 400, statusMessage: 'error.invalidBody' })
  }

  try {
    const result = await applySignalLifecycle('signal', requireOwnerId(event), id, body)
    if (!result) throw Object.assign(new Error(`signal not found: ${id}`), { statusCode: 404, statusMessage: 'signal_not_found' })
    return { success: true, data: result }
  } catch (err) {
    const e = err as any
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      statusCode: e?.statusCode ?? 500,
      statusMessage: e?.statusMessage ?? 'error.internal'
    })
  }
})