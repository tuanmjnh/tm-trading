import { getRouterParam, readBody } from 'h3'
import { botInstanceModel, botProfileModel, botRuntimeStore } from '~~/server/utils/engineModel'

// POST /api/v1/bots/instances/:id/rerun — re-run a TERMINAL instance with two actions:
//   1. 'reset' (default): Clone parameters from the profile/instance, reset capital to
//      default ($10,000 or custom), create a fresh bot instance with 0 trades/PnL.
//   2. 'continue': Continue running with existing trade history, cumulative PnL,
//      and current equity balance.
const TERMINAL = new Set(['completed', 'failed', 'halted'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'instance id is required' })
  const ownerId = requireOwnerId(event)
  const now = Date.now()
  const body = (await readBody(event).catch(() => ({}))) || {}
  const rerunMode = body.mode === 'continue' ? 'continue' : 'reset'

  const BotProfile = await botProfileModel()
  const BotInstance = await botInstanceModel()
  if (!BotProfile || !BotInstance) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const instance = await BotInstance.findOne({ _id: id, ownerId }).lean()
  if (!instance) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'instance not found' })
  if (!TERMINAL.has(String(instance.state))) {
    throw createError({ statusCode: 409, statusMessage: 'error.bot_not_terminal', message: 'Only finished bots can be re-run' })
  }
  const profileId = String(instance.botProfileId ?? '')
  if (!profileId) throw createError({ statusCode: 404, statusMessage: 'error.bot_profile_missing', message: 'instance has no bot profile' })

  const profile = await BotProfile.findOne({ profileId, ownerId }).lean()
  if (!profile) throw createError({ statusCode: 404, statusMessage: 'error.bot_profile_missing', message: 'bot profile no longer exists' })

  const runtime = await botRuntimeStore() as unknown as {
    createInstanceFromProfile(input: Record<string, unknown>): Promise<{ ok?: boolean, instanceId?: string, created?: boolean, state?: string, code?: string }>
    enqueueCommand(input: Record<string, unknown>): Promise<{ ok?: boolean, duplicate?: boolean }>
  }

  if (rerunMode === 'continue') {
    // Action 2: Continue running with history and current equity/PnL
    await BotInstance.updateOne(
      { _id: id, ownerId },
      {
        $set: {
          state: 'queued',
          health: 'ok',
          healthReason: null,
          lastError: null,
          stoppedAt: null,
          startedAt: now,
          updatedAt: now
        }
      }
    )

    const cmd = await runtime.enqueueCommand({
      ownerId,
      instanceId: id,
      type: 'start',
      commandId: `cmd_continue_${id}_${now.toString(36)}`,
      botProfileId: profileId,
      accountId: instance.accountId ?? id
    })

    return {
      success: true,
      data: {
        instanceId: id,
        mode: 'continue',
        state: 'queued',
        commandEnqueued: cmd?.ok === true,
        retainedEquity: instance.paperEquity ?? instance.initialCapital ?? 10000,
        retainedPnl: instance.paperPnl ?? 0
      }
    }
  }

  // Action 1: Clone parameters, reset capital to default, create a fresh instance
  const initialCapital = Number(body.initialCapital) || Number(instance.initialCapital) || 10000
  const inst = await runtime.createInstanceFromProfile({
    ownerId,
    profileId,
    initialCapital,
    createdBy: 'ui-rerun-reset',
    now
  })
  if (!inst?.ok || !inst.instanceId) {
    throw createError({ statusCode: 500, statusMessage: 'error.bot_instance', message: String(inst?.code ?? 'instance create failed') })
  }
  const cmd = await runtime.enqueueCommand({
    ownerId,
    instanceId: inst.instanceId,
    type: 'start',
    commandId: `cmd_rerun_${inst.instanceId}_${now.toString(36)}`,
    botProfileId: profileId,
    accountId: inst.instanceId
  })

  return {
    success: true,
    data: {
      instanceId: inst.instanceId,
      mode: 'reset',
      created: inst.created === true,
      state: inst.state ?? 'queued',
      commandEnqueued: cmd?.ok === true,
      initialCapital
    }
  }
})
