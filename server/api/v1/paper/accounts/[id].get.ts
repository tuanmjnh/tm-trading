import { getRouterParam } from 'h3'
import { paperAccount } from '~~/server/utils/paperAccount'

/**
 * GET /api/v1/paper/accounts/:id — paper account detail (§30.5).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'account id required', data: null, meta: { mongo: 'down' } }

  const acc = await paperAccount({ account: id })

  if (!acc) {
    return { success: false, error: 'account not found or mongo down', data: null, meta: { mongo: 'down' } }
  }

  return { success: true, data: acc, meta: { mongo: 'up' } }
})