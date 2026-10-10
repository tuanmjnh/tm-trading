import { getRouterParam, readBody } from 'h3'
import { strategyService, strategyVersionModel } from '../../../../utils/engineModel'
import type { ActivatePaperResult } from '~~/types/strategy'

/**
 * POST /api/v1/strategies/:id/activate-paper — set a version live (§30.4).
 *
 * Body: { strategyVersionId, by }
 * Only versions with status 'paper' or 'stable_paper' may be activated.
 */
export default defineEventHandler(async (event) => {
  const profileId = getRouterParam(event, 'id')
  if (!profileId) return { success: false, error: 'profile id required' }

  const body = await readBody(event)
  const { strategyVersionId, by = null } = body ?? {}

  if (!strategyVersionId) return { success: false, error: 'strategyVersionId required' }

  // Verify version exists and is paper-ready
  const Version = await strategyVersionModel()
  if (!Version) return { success: false, error: 'mongo down', meta: { mongo: 'down' } }

  const ver = await Version.findOne({ _id: strategyVersionId }).lean()
  if (!ver) return { success: false, error: 'version not found' }
  if (ver.status !== 'paper' && ver.status !== 'stable_paper') {
    return { success: false, error: `version status ${ver.status} cannot be activated (must be paper or stable_paper)` }
  }

  const { activatePaper } = await strategyService()
  const r = await activatePaper({ profileId, strategyVersionId, by }) as ActivatePaperResult
  if (!r.ok) return { success: false, error: r.code, detail: r.detail ?? null }

  return { success: true, data: { profileId: r.profileId, strategyVersionId: r.strategyVersionId } }
})