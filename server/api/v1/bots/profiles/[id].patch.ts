import { getRouterParam, readBody } from 'h3'
import { botProfileModel } from '~~/server/utils/engineModel'

// PATCH /api/v1/bots/profiles/:id — operational edits ONLY (name / enabled /
// status). Parameter or strategy changes must go through a NEW immutable
// strategy version (D1/D3) — the launch flow handles that.
const STATUSES = new Set(['draft', 'enabled', 'disabled', 'archived'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'profile id is required' })
  const ownerId = requireOwnerId(event)
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'JSON body is required' })
  }

  const BotProfile = await botProfileModel()
  if (!BotProfile) throw createError({ statusCode: 503, statusMessage: 'error.db_unavailable', message: 'MongoDB is not available' })

  const profile = await BotProfile.findOne({ profileId: id, ownerId }).lean()
  if (!profile) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'profile not found' })

  const $set: Record<string, unknown> = {}
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 80)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'name cannot be empty' })
    $set.name = name
  }
  if (typeof body.enabled === 'boolean') $set.enabled = body.enabled
  if (typeof body.status === 'string' && STATUSES.has(body.status)) $set.status = body.status
  if (!Object.keys($set).length) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'nothing to update' })
  }

  const updated = await BotProfile.findOneAndUpdate({ profileId: id, ownerId }, { $set }, { new: true }).lean()
  return { success: true, data: updated }
})

