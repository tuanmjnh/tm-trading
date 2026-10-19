import { listPaperAccounts } from '~~/server/utils/paperAccount'

/**
 * GET /api/v1/paper/accounts — list the caller's paper accounts (§30.5).
 *
 * Tenancy (docs/web-app/user-tenancy-plan.md): only the accounts owned by the
 * authenticated hub user are listed. When the owner has no book yet the list is
 * empty — never a fabricated 'default' account.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  const data = await listPaperAccounts(ownerId)
  return {
    success: true,
    data,
    meta: { count: data.length, mongo: 'up' }
  }
})
