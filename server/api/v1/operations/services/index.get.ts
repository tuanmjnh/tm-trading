import { requireOwnerId } from '~~/server/utils/owner'
import { loadOperationsView } from '~~/server/utils/operations'

/**
 * GET /api/v1/operations/services — the read-only Operations view.
 *
 * Returns the service registry merged with the last supervisor snapshot: desired
 * vs observed state, readiness checks, telemetry and the recent operation
 * timeline (§17.9). Any authenticated user may read it — it describes the app
 * they are already signed into. Mutations (start/stop/restart/reset/probe/
 * run-once) are supervisor operations behind a root guard, not writes here.
 *
 * A supervisor that has never run yields registry-only rows
 * (`registered: false`), not an error: the screen must show "never started",
 * never a 500.
 */
export default defineEventHandler(async (event) => {
  requireOwnerId(event)

  const now = Date.now()
  const data = await loadOperationsView(now)

  return {
    success: true,
    data,
  }
})
