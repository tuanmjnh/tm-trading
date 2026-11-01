import { requireOwnerId } from '~~/server/utils/owner'
import { loadServiceOperation } from '~~/server/utils/operations'

/**
 * GET /api/v1/operations/operations/:operationId — poll one operation.
 *
 * The async contract (§17.7): a control request returned `202` with an
 * `operationId`, and the screen polls here until the operation is terminal
 * (`SUCCEEDED` / `FAILED` / `UNCONFIRMED`). `UNCONFIRMED` means the deadline
 * passed without proof — the UI must present it as "check by hand", never as
 * success.
 */
export default defineEventHandler(async (event) => {
  requireOwnerId(event)

  const operationId = getRouterParam(event, 'operationId') || ''
  const found = await loadServiceOperation(operationId)

  if (!found) {
    throw createError({
      statusCode: 404,
      statusMessage: 'error.unknownOperation',
      message: `no operation ${operationId}`,
    })
  }

  return {
    success: true,
    data: {
      ...found.operation,
      pending: found.pending,
      terminal: ['SUCCEEDED', 'FAILED', 'UNCONFIRMED'].includes(found.operation.state),
    },
  }
})
