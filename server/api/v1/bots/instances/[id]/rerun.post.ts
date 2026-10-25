import { getRouterParam } from 'h3'
import { botInstanceModel, botProfileModel, botRuntimeStore } from '~~/server/utils/engineModel'

// POST /api/v1/bots/instances/:id/rerun — re-run a TERMINAL instance: resolve
// its bot profile (operational config) and arm a fresh instance for today,
// then enqueue the durable `start` command. Same chain as the UI launcher,
// minus the strategy version (the profile still points at its immutable one).
const TERMINAL = new Set(['completed', 'failed', 'halted'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'instance id is required' })
  const ownerId = requireOwnerId(event)
  const now = Date.now()

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
  const inst = await runtime.createInstanceFromProfile({ ownerId, profileId, createdBy: 'ui-rerun', now })
  if (!inst?.ok || !inst.instanceId) {
    throw createError({ statusCode: 500, statusMessage: 'error.bot_instance', message: String(inst?.code ?? 'instance create failed') })
  }
  const cmd = await runtime.enqueueCommand({
    ownerId,
    instanceId: inst.instanceId,
    type: 'start',
    commandId: `cmd_rerun_${inst.instanceId}_${now.toString(36)}`,
    botProfileId: profileId,
    accountId: profile.simulatedAccountId ?? null
  })

  return {
    success: true,
    data: {
      instanceId: inst.instanceId,
      created: inst.created === true,
      state: inst.state ?? 'queued',
      commandEnqueued: cmd?.ok === true
    }
  }
})
