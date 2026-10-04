import { loadIntelData } from '../../../utils/intel'

/**
 * GET /api/v1/intel - market intelligence cho dashboard (roadmap Phase 8).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Doc truc tiep
 * collection `intel` (services ghi) + heartbeat D9 tu logs/services.json.
 * Mongo khong ket noi duoc / services chua chay -> 200 + mongo='down'
 * + mang rong (fail-soft, khong 500).
 */
export default defineEventHandler(async () => {
  return {
    success: true,
    data: await loadIntelData()
  }
})
