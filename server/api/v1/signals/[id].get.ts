import { getRouterParam } from 'h3'
import { getSignal } from '../../../utils/signals'

// =============================================================================
//  GET /api/v1/signals/:id — one webhook signal (collection `alerts`, D4).
//
//  Read-only detail view. The lifecycle overlay is projected on top of the
//  immutable evidence (S8 chunk 4). Unknown id (or another owner's) -> 404,
//  store down -> 503. Token from tm-hub required (D10).
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  if (!id) throw Object.assign(new Error('signal id is required'), { statusCode: 400, statusMessage: 'error.invalidId' })

  try {
    const data = await getSignal(requireOwnerId(event), id)
    if (!data) throw Object.assign(new Error(`signal not found: ${id}`), { statusCode: 404, statusMessage: 'signal_not_found' })
    return { success: true, data }
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      statusCode: (err as any)?.statusCode ?? 500,
      statusMessage: (err as any)?.statusMessage ?? 'error.internal'
    })
  }
})