import { getRouterParam } from 'h3'
import { paperAccount } from '~~/server/utils/paperAccount'

/**
 * GET /api/v1/paper/accounts/:id — paper account detail (§30.5).
 *
 * Tenancy (docs/web-app/user-tenancy-plan.md): scoped to the caller. The literal
 * id 'default' means "my active account" — see server/utils/paperAccount.ts.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'account id required', data: null, meta: { mongo: 'down' } }

  const acc = await paperAccount({ ownerId: requireOwnerId(event), account: id })

  if (!acc) {
    return { success: false, error: 'account not found or mongo down', data: null, meta: { mongo: 'down' } }
  }

  return { success: true, data: acc, meta: { mongo: 'up' } }
})
