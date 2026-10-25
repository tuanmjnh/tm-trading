import { getRouterParam, readBody } from 'h3'
import { botInstanceModel, botRuntimeStore, botSupervisorRules } from '~~/server/utils/engineModel'

/**
 * POST /api/v1/bots/instances/:id/commands — enqueue a supervisor command.
 * Body: { type: 'start'|'pause'|'resume'|'stop', commandId?: string, payload?: object }
 *
 * The HTTP layer NEVER mutates instance state: it writes a durable, idempotent
 * command row (`bot_commands`) that the owner's supervisor applies within one
 * tick. Ownership is re-checked against the persisted row, and the command is
 * pre-validated against the current state so the caller gets an immediate
 * answer instead of a silent no-op.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) return { success: false, error: 'instance id required', code: 'missing_instance' }

  const body = await readBody(event).catch(() => ({}))
  const type = typeof body?.type === 'string' ? body.type.trim().toLowerCase() : ''
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {}

  const rules = await botSupervisorRules()
  if (!rules.SUPERVISOR_COMMANDS.includes(type)) {
    return { success: false, error: 'type must be start|pause|resume|stop', code: 'unknown_command' }
  }

  const ownerId = requireOwnerId(event)
  const BotInstance = await botInstanceModel()
  if (!BotInstance) return { success: false, error: 'mongo down', code: 'mongo_down', meta: { mongo: 'down' } }

  let instance
  try {
    instance = await BotInstance.findOne({ _id: id, ownerId }).lean()
  } catch {
    return { success: false, error: 'mongo error', code: 'store_error', meta: { mongo: 'down' } }
  }
  if (!instance) return { success: false, error: 'instance not found', code: 'not_found' }

  const commandId =
    typeof body?.commandId === 'string' && body.commandId.trim() !== ''
      ? body.commandId.trim()
      : `cmd_${type}_${id}_${Date.now().toString(36)}`

  const check = rules.validateCommand({
    instance,
    command: type,
    commandId,
    ownerId,
    accountId: instance.accountId ?? null,
  })
  if (!check.ok) {
    return { success: false, error: check.code, code: check.code, data: { commandId, type } }
  }
  if (check.noop) {
    return { success: true, data: { commandId, type, status: 'noop', from: instance.state }, code: 'noop' }
  }

  const store = await botRuntimeStore()
  const queued = await store.enqueueCommand({
    ownerId,
    instanceId: String(instance.instanceId ?? instance._id ?? id),
    botProfileId: instance.botProfileId ?? null,
    accountId: instance.accountId ?? null,
    type,
    commandId,
    payload,
  })
  if (!queued.ok) {
    return { success: false, error: queued.message || queued.code, code: queued.code }
  }

  return {
    success: true,
    data: {
      commandId,
      type,
      status: 'pending',
      duplicate: queued.duplicate === true,
      expectedState: check.to,
      instanceId: String(instance.instanceId ?? instance._id ?? id),
    },
  }
})
