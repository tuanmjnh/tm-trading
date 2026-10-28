import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { requireOwnerId } from '~~/server/utils/owner'
import { loadServicesStatus } from '~~/server/utils/intel'

/**
 * POST /api/v1/admin/services/run-once — run all periodic intel/market services once.
 * Spawns `node services/run.mjs once` asynchronously and returns immediate acceptance.
 */
export default defineEventHandler(async (event) => {
  const ownerId = requireOwnerId(event)

  const scriptPath = join(process.cwd(), 'services', 'run.mjs')
  const child = spawn(process.execPath, [scriptPath, 'once'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, OWNER_ID: ownerId }
  })
  child.unref()

  // Wait a brief moment to allow initial services to start/beat
  await new Promise(r => setTimeout(r, 800))
  const services = await loadServicesStatus().catch(() => [])

  return {
    success: true,
    message: 'Services execution started',
    data: {
      services,
      ownerId
    }
  }
})
