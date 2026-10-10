import { getRouterParam } from 'h3'
import { engineModel } from '../../../../utils/engineModel'
import { toConfluence } from '../../../../utils/intel'
import { explainConfluence } from '../../../../utils/methods'

/**
 * GET /api/v1/intel/confluence/:symbol - transparent per-symbol confluence
 * breakdown for the terminal context (roadmap §13.3 "Confluence must remain
 * transparent"). Reads the latest kind `confluence` doc; scores are stored by
 * services/confluence.mjs, never recomputed here (D1).
 *
 * Not found / Mongo down -> 200 + data:null (fail-soft, like /api/v1/intel).
 */
export default defineEventHandler(async (event) => {
  const symbol = String(getRouterParam(event, 'symbol') ?? '').toUpperCase()

  const Intel = await engineModel('intel.mjs', 'Intel')
  if (!Intel) return { success: true, data: null }

  try {
    const doc = await Intel.findOne({ kind: 'confluence', symbol }).sort({ ts: -1 }).lean()
    if (!doc) return { success: true, data: null }
    return { success: true, data: explainConfluence(toConfluence(doc)) }
  } catch {
    return { success: true, data: null }
  }
})