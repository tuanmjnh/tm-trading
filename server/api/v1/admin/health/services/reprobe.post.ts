import { readBody } from 'h3'
import { requireOwnerId } from '~~/server/utils/owner'
import { loadServicesStatus } from '~~/server/utils/intel'

/**
 * POST /api/v1/admin/health/services/reprobe — trigger an immediate health probe
 * for all services (or a specific one). Writes fresh heartbeats to the JSON store.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)
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