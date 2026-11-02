import { getRouterParam } from 'h3'
import { getNativeSignal } from '../../../../utils/nativeSignals'

// =============================================================================
//  GET /api/v1/signals/native/:id — one attributed native signal (collection
//  `signals`, §61.17 Phase D).
//
//  Read-only detail view with the full attribution + lifecycle overlay
//  (S8 chunk 4). Unknown id (or another owner's), or a legacy row without a
//  durable `signalKey` -> 404. Store down -> 503. Token from tm-hub required.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw Object.assign(new Error('signal id is required'), { statusCode: 400, statusMessage: 'error.invalidId' })

  try {
    const data = await getNativeSignal(requireOwnerId(event), id)
    if (!data) throw Object.assign(new Error(`signal not found: ${id}`), { statusCode: 404, statusMessage: 'signal_not_found' })
    return { success: true, data }
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      statusCode: (err as any)?.statusCode ?? 500,
      statusMessage: (err as any)?.statusMessage ?? 'error.internal'
    })
  }
})