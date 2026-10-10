import { readBody, getRouterParam } from 'h3'
import { engineModel } from '~~/server/utils/engineModel'

/**
 * PATCH /api/v1/paper/positions/:id/risk — update SL/TP for a paper position (§30.5).
 * Body: { sl?: number, tps?: number[] }
 */
export default defineEventHandler(async (event) => {
  const positionId = getRouterParam(event, 'id')
  if (!positionId) return { success: false, error: 'position id required' }

  const body = await readBody(event)
  const { sl = null, tps = null } = body ?? {}

  const Position = await engineModel('position.mjs', 'Position')
  if (!Position) return { success: false, error: 'mongo down' }

  const pos = await Position.findOne({ _id: positionId, status: 'open' }).lean()
  if (!pos) return { success: false, error: 'position not found or not open' }

  const update: any = {}
  if (sl !== null) update.sl = sl
  if (tps !== null) update.tps = tps

  if (Object.keys(update).length === 0) return { success: false, error: 'no changes provided' }

  await Position.updateOne({ _id: positionId }, { $set: { ...update, updatedAt: new Date() } })

  return { success: true, data: { positionId, sl: update.sl ?? pos.sl, tps: update.tps ?? pos.tps } }
})