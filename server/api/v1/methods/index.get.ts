import { loadMethodRegistry, loadLeagueSnapshot } from '../../../utils/methods'

/**
 * GET /api/v1/methods - registered method plugins + league snapshot
 * (roadmap Phase 10 UI). The registry mirrors engine/methods/* (single source,
 * D1); the league is a read-only snapshot file. Missing engine / snapshot
 * fails soft to empty lists (never 500).
 */
export default defineEventHandler(async () => {
  const [registry, league] = await Promise.all([loadMethodRegistry(), loadLeagueSnapshot()])
  return { success: true, data: { methods: registry, league } }
})