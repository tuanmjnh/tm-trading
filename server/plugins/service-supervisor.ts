import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Explicit import: the plugin must fail loudly at build time, not at boot, if the
// selection rule moves.
import { desirableServices, type SupervisableDefinition } from '../utils/embeddedServices'

// =============================================================================
//  Embedded service supervisor (V4.2 §17.5 / §17.7).
//
//  The dashboard is the operator's window into the service control plane, and
//  that window is only honest if something actually drives the supervisor loop.
//  This plugin is that driver for dev and single-process self-hosting — the same
//  "embedded runtime" pattern as `bot-runtime.ts` and the AI workers.
//
//  What it does, once per tick: consume the durable command inbox (so the
//  Operations UI's start/stop/restart buttons work), advance the operations, and
//  keep the exclusive lease of every instance it hosts alive.
//
//  What it must NOT do: drain the workers when Nitro shuts down. A worker is a
//  separate process whose job is to keep running across a control-plane restart
//  — that is what the `control-plane-restart` drill pins — so `close` only stops
//  the timer.
//
//  Env:
//    SERVICE_SUPERVISOR_EMBEDDED=off   disable the embedded driver entirely
//    SERVICE_SUPERVISOR_AUTOSTART=off  drive the loop, but never queue the first
//                                      start for an untouched state file
//    SERVICE_SUPERVISOR_INTERVAL=<ms>  tick cadence (default 5000, min 2000)
// =============================================================================

const TICK_MS = Math.max(2_000, Number(process.env.SERVICE_SUPERVISOR_INTERVAL || 5_000) || 5_000)

/** How long to let the server finish booting before the first tick. */
const FIRST_TICK_DELAY_MS = 3_000

interface SupervisorStoreLike {
  listServices(): Array<{ serviceId: string, scopeKey: string, desired: string }>
}

type ServiceDefinitionLike = SupervisableDefinition

interface SupervisorLike {
  adopt(): number
  reconcileDesired(): string[]
  tick(options?: { consumeCommands?: boolean }): { services: unknown[], operations: unknown[] }
  request(input: {
    serviceId: string
    action: string
    actor: string
    idempotencyKey: string
    reason?: string | null
  }): { ok: boolean, code?: string, operation?: { operationId: string } }
  drain(): Promise<{ drained: number, killed: string[] }>
}

interface SupervisorModule {
  createSupervisor(options: Record<string, unknown>): SupervisorLike
  createProcessAdapter(options?: Record<string, unknown>): Record<string, unknown>
}

interface StoreModule {
  createSupervisorStore(options?: Record<string, unknown>): SupervisorStoreLike
}

interface RegistryModule {
  loadRegistry(): Promise<{ registry: ReadonlyArray<ServiceDefinitionLike>, source: string }>
}

async function loadModule<T>(relativePath: string): Promise<T> {
  const href = pathToFileURL(join(process.cwd(), relativePath)).href
  return (await import(/* @vite-ignore */ `${href}?t=${Date.now()}`)) as T
}

export default defineNitroPlugin((nitro) => {
  if (process.env.SERVICE_SUPERVISOR_EMBEDDED === 'off') {
    console.log('[service-supervisor] embedded driver disabled (SERVICE_SUPERVISOR_EMBEDDED=off)')
    return
  }

  const log = {
    log: (...args: unknown[]) => console.log('[service-supervisor]', ...args),
    warn: (...args: unknown[]) => console.warn('[service-supervisor]', ...args),
  }

  let supervisor: SupervisorLike | null = null
  let store: SupervisorStoreLike | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let bootTimer: ReturnType<typeof setTimeout> | null = null
  let ticking = false
  let tickFailures = 0

  async function boot() {
    try {
      const [supervisorModule, storeModule, registryModule] = await Promise.all([
        loadModule<SupervisorModule>('services/supervisor.mjs'),
        loadModule<StoreModule>('services/supervisorStore.mjs'),
        loadModule<RegistryModule>('services/registry.mjs'),
      ])
      const { registry, source } = await registryModule.loadRegistry()
      store = storeModule.createSupervisorStore(
        process.env.TM_SUPERVISOR_STATE ? { file: process.env.TM_SUPERVISOR_STATE } : {},
      )
      supervisor = supervisorModule.createSupervisor({
        store,
        registry,
        workers: supervisorModule.createProcessAdapter(),
      })

      const adopted = supervisor.adopt()
      const recovered = supervisor.reconcileDesired()

      // First boot (or an emptied state file): adopt the services:watch default.
      const wanted = desirableServices(registry)
      const known = new Set(store.listServices().map(record => record.serviceId))
      let queued = 0
      if (process.env.SERVICE_SUPERVISOR_AUTOSTART !== 'off') {
        for (const definition of wanted) {
          if (known.has(definition.id)) continue
          const result = supervisor.request({
            serviceId: definition.id,
            action: 'start',
            actor: 'embedded-supervisor',
            idempotencyKey: `embedded-autostart:${definition.id}`,
            reason: 'self-hosted runtime: start the services this app owns',
          })
          if (result.ok) queued += 1
        }
      }

      log.log(
        `embedded driver enabled (interval=${Math.round(TICK_MS / 1000)}s registry=${source}`
        + ` adopted=${adopted} recovered=${recovered.length} autostart=${queued}`
        + ` of ${wanted.length} owned service(s))`,
      )
      supervisor.tick()
    } catch (error) {
      log.warn('boot failed:', error instanceof Error ? error.message : error)
    }
  }

  function tick() {
    if (!supervisor || ticking) return
    ticking = true
    try {
      supervisor.tick()
      tickFailures = 0
    } catch (error) {
      tickFailures += 1
      // A failing tick must not spam the log: report the first one and every
      // hundredth after that.
      if (tickFailures === 1 || tickFailures % 100 === 0) {
        log.warn(`tick failed (${tickFailures}):`, error instanceof Error ? error.message : error)
      }
    } finally {
      ticking = false
    }
  }

  bootTimer = setTimeout(() => { void boot() }, FIRST_TICK_DELAY_MS)
  timer = setInterval(tick, TICK_MS)

  nitro.hooks.hook('close', () => {
    // Deliberately no drain: the workers are separate processes that must outlive
    // this control plane (see the `control-plane-restart` drill).
    if (timer) clearInterval(timer)
    if (bootTimer) clearTimeout(bootTimer)
    timer = null
    bootTimer = null
  })
})
