import { readBody } from 'h3'
import { requireOwnerId } from '~~/server/utils/owner'
import { requireRootEvent } from '~~/server/utils/authz'
import { loadServicesStatus } from '~~/server/utils/intel'

/**
 * POST /api/v1/admin/health/services/reprobe — re-read service status for all
 * services (or a specific one).
 *
 * Root-only: it is an operator action, and the guard matches the run-once and
 * future supervisor control endpoints (docs/web-app/v4.2-operations-control-audit.md).
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
  requireRootEvent(event)
  const body = await readBody(event).catch(() => ({}))
  const serviceName = typeof body?.service === 'string' ? body.service.trim() : null

  // Force a fresh status read (which probes the services)
  const services = await loadServicesStatus()

  // If a specific service was requested, filter
  const result = serviceName
    ? services.find(s => s.name === serviceName) ?? null
    : services

  return {
    success: true,
    data: {
      probed: serviceName ? 1 : services.length,
      services: Array.isArray(result) ? result : [result].filter(Boolean),
      meta: { ownerId, forced: true }
    }
  }
})