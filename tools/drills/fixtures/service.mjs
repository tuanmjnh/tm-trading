// =============================================================================
//  TM TRADING — DRILL WORKER BEHAVIOUR
//
//  One export for every fixture service. `TM_SERVICE_ID` selects the behaviour,
//  exactly the way `services/workerHost.mjs` passes it to a real service.
//
//  The module reports its observations through `summary.evidence` — the same
//  channel a production service uses — so a drill that passes proves the whole
//  evidence path (service -> worker host -> IPC -> supervisor -> readiness), not
//  a shortcut in the supervisor.
// =============================================================================

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Scratch directory owned by the drill runner, never production state. */
function scratchDir() {
  const dir = process.env.DRILL_SCRATCH_DIR
    || join(process.cwd(), 'node_modules', '.cache', 'tm-trading', 'drills')
  mkdirSync(dir, { recursive: true })
  return dir
}

function marker(name) {
  return join(scratchDir(), name)
}

/**
 * Run one cycle for whichever fixture service the supervisor started.
 *
 * @returns {Promise<{ ok: boolean, count: number, evidence: Record<string, unknown> }>}
 */
export async function runDrillCycle() {
  const serviceId = String(process.env.TM_SERVICE_ID ?? '')
  const at = Date.now()
  // No external dependency to reach, and the drill says so explicitly instead
  // of relying on a Mongo probe.
  const base = { dependenciesReachable: true }

  if (serviceId === 'drill-main') {
    return {
      ok: true,
      count: 3,
      evidence: {
        ...base,
        subscriptionAcked: true,
        lastEventAt: at,
        lastJobValidated: true,
        outboxLastConsumedAt: at,
      },
    }
  }

  if (serviceId === 'drill-quiet') {
    // The socket is open and acknowledged, but the last tick was five minutes
    // ago: the optional `fresh-event` rule must downgrade the service.
    return {
      ok: true,
      count: 1,
      evidence: {
        ...base,
        subscriptionAcked: true,
        lastEventAt: at - 300_000,
      },
    }
  }

  if (serviceId === 'drill-crash') {
    // The runner drops `crash.request`; the next cycle exits the process so the
    // supervisor has to detect the exit, back off and restart. `crash.done`
    // makes it exactly one crash so the drill does not become a restart loop.
    if (existsSync(marker('crash.request')) && !existsSync(marker('crash.done'))) {
      writeFileSync(marker('crash.done'), String(at))
      process.exit(1)
    }
    return { ok: true, count: 2, evidence: base }
  }

  return { ok: true, count: 0, evidence: base }
}

/**
 * Optional `reset()` hook: proves `reset` asked the module for ephemeral state
 * instead of deleting history.
 */
export async function reset() {
  writeFileSync(marker('reset.marker'), String(Date.now()))
}