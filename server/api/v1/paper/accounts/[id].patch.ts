import { createError, getRouterParam, readBody } from 'h3'
import { updatePaperAccount, ACCOUNT_ERROR_STATUS } from '~~/server/utils/paperAccount'

/**
 * PATCH /api/v1/paper/accounts/:id — rename, archive/un-archive or adjust the
 * seed of one of the caller's accounts (roadmap §61.17 Phase B).
 *
 * Tenancy (docs/web-app/user-tenancy-plan.md): owner-scoped — a foreign id
 * simply resolves to `errNotFound`. Body: { accountId?, archived?, currency?,
 * initialBalance? }. A rename is refused once the account owns book rows.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody(event).catch(() => ({}))
  const res = await updatePaperAccount({
    ownerId: requireOwnerId(event),
    accountId: id,
    patch: {
      accountId: body?.accountId,
      archived: body?.archived,
      currency: body?.currency,
      initialBalance: body?.initialBalance
    }
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
