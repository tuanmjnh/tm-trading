import { loadRiskStatus } from '../../../utils/risk'

/**
 * GET /api/v1/risk/status - trang thai risk gate + vi the dang mo (Phase 7).
 *
 * Token do tm-hub cap bat buoc (server/middleware/auth.ts - D10). Doc truc tiep
 * `risk_state` + `positions` cua engine (D1), khong tinh lai. Mongo khong ket
 * noi duoc tra 200 + data.mongo='down' (fail-soft, khong 500).
 */
export default defineEventHandler(async () => {
  return {
    success: true,
    data: await loadRiskStatus()
  }
})
