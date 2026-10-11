import { listLineage } from '../../../utils/dataCenter'

/**
 * GET /api/v1/data/lineage — backtest series -> dataset provenance (Slice 4).
 * Answers §58.9: "which dataset/recording with which hash produced this run".
 * Read-only; fail-soft (store down -> 200 with an empty list, never 500).
 */
export default defineEventHandler(async () => {
  const { data, mongo, filesMissing } = await listLineage()
  return { success: true, data, meta: { count: data.length, mongo, filesMissing } }
})
