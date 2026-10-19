import { createError, readBody } from 'h3'
import { createPaperAccount, ACCOUNT_ERROR_STATUS } from '~~/server/utils/paperAccount'

/**
 * POST /api/v1/paper/accounts — create a new paper account (roadmap §61.17
 * Phase B "account CRUD/switching safely").
 *
 * Tenancy (docs/web-app/user-tenancy-plan.md): the row is stamped with the
 * caller's hub user id, so the account can never be created inside another
 * owner's book. Body: { accountId, currency?, initialBalance? }.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const res = await createPaperAccount({
    ownerId: requireOwnerId(event),
    accountId: body?.accountId,
    currency: body?.currency,
    initialBalance: body?.initialBalance
  })
  if (!res.ok) {
    throw createError({
      statusCode: ACCOUNT_ERROR_STATUS[res.code ?? ''] ?? 400,
      statusMessage: res.code,
      message: res.code
    })
  }
  return { success: true, data: res.account }
})
