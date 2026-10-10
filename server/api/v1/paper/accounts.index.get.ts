import { getQuery } from 'h3'
import { paperAccount } from '~~/server/utils/paperAccount'

/**
 * GET /api/v1/paper/accounts — list paper accounts (§30.5).
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const account = q.account ? String(q.account) : undefined

  // For now, just return the default account. The paperAccount function
  // computes the full projection from positions.
  const acc = await paperAccount({ account })

  if (!acc) {
    return { success: true, data: [], meta: { count: 0, mongo: 'down' } }
  }

  // Return as a list (single account for now)
  return {
    success: true,
    data: [{
      accountId: acc.accountId,
      currency: acc.currency,
      mode: acc.mode,
      initialBalance: acc.initialBalance,
      createdAt: acc.createdAt,
      updatedAt: String(acc.updatedAt),
    }],
    meta: { count: 1, mongo: 'up' }
  }
})