import { createError, getRouterParam } from 'h3'
import { deletePaperAccount, ACCOUNT_ERROR_STATUS } from '~~/server/utils/paperAccount'

/**
 * DELETE /api/v1/paper/accounts/:id — remove one of the caller's accounts
 * (roadmap §61.17 Phase B).
 *
 * Tenancy (docs/web-app/user-tenancy-plan.md): owner-scoped, and refused when
 * the account still owns book rows (positions/orders/fills/risk state) — such a
 * book must be archived instead so no history is orphaned.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const res = await deletePaperAccount({ ownerId: requireOwnerId(event), accountId: id })
  if (!res.ok) {
    throw createError({
      statusCode: ACCOUNT_ERROR_STATUS[res.code ?? ''] ?? 400,
      statusMessage: res.code,
      message: res.code
    })
  }
  return { success: true, data: { accountId: id } }
})
