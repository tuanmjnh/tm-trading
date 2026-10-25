import { getRouterParam } from 'h3'
import { botInstanceModel, botProfileModel } from '~~/server/utils/engineModel'

// DELETE /api/v1/bots/profiles/:id — remove a bot profile. Blocked while any
// NON-terminal instance still references it (stop those bots first); finished
// runs keep their own data and stay re-runnable? No — history is preserved but
// re-running a deleted profile is impossible (rerun resolves the profile).
const ACTIVE = new Set(['queued', 'starting', 'running', 'paused', 'stopping'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'profile id is required' })
  const ownerId = requireOwnerId(event)

  const BotProfile = await botProfileModel()
  const BotInstance = await botInstanceModel()
  if (!BotProfile || !BotInstance) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const profile = await BotProfile.findOne({ profileId: id, ownerId }).lean()
  if (!profile) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'profile not found' })

  const active = await BotInstance.countDocuments({ ownerId, botProfileId: id, state: { $in: [...ACTIVE] } })
  if (active > 0) {
    throw createError({ statusCode: 409, statusMessage: 'error.bot_profile_active', message: `Stop the ${active} active bot(s) on this profile first` })
  }

  await BotProfile.deleteOne({ profileId: id, ownerId })
  return { success: true, data: { deleted: true, profileId: id } }
})

