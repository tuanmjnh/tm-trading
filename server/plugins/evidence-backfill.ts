/**
 * EVIDENCE-BACKFILL (§59.15) — keep every sealed session citable.
 *
 * Two sources of evidence gaps exist:
 *   1. sessions sealed BEFORE auto-freeze existed
 *      (server/api/v1/sessions/[id]/move.post.ts), and
 *   2. seal-time freezes that failed fail-soft during a store outage.
 *
 * The first sweep runs a few seconds after boot (so boot traffic wins), then a
 * PERIODIC sweep re-runs on an interval — gap (2) heals without a restart.
 * Both run the same bounded, idempotent sweep (D3) from
 * server/utils/evidenceSets.ts.
 *
 * Same contract as the other plugins: warn-only, never blocks boot, never
 * throws (server/plugins/system-app.ts). Installed once per process via a
 * global symbol — Nitro re-runs plugins on dev reloads, and a bare setInterval
 * would stack timers (process-guard.ts uses the same pattern).
 *
 * Env:
 *   EVIDENCE_BACKFILL=0           skip the sweep entirely.
 *   EVIDENCE_BACKFILL_LIMIT       per-run cap (default 50, max 200).
 *   EVIDENCE_BACKFILL_INTERVAL    seconds between sweeps (default 3600, min 60).
 *
 * Logging: a run is silent when there is nothing to examine and when every
 * session was already frozen (steady state = hourly noise otherwise); it logs
 * one line when it froze something or something failed, and warns when the
 * sweep could not run at all.
 */
const kInstalled = Symbol.for('tm-trading:evidence-backfill:installed')

export default defineNitroPlugin(() => {
  const proc = process as unknown as { [kInstalled]?: boolean }
  if (proc[kInstalled]) return
  proc[kInstalled] = true

  if (process.env.EVIDENCE_BACKFILL === '0') return

  const tag = '[evidence-backfill]'
  const limit = Number(process.env.EVIDENCE_BACKFILL_LIMIT) || 50
  // Clamp so a typo cannot hammer Mongo every second.
  const intervalMs = Math.max(Number(process.env.EVIDENCE_BACKFILL_INTERVAL) || 3600, 60) * 1000
  let running = false

  const sweep = async (): Promise<void> => {
    if (running) return // never overlap two sweeps
    running = true
    try {
      const { backfillTerminalSessionEvidence } = await import('../utils/evidenceSets')
      const res = await backfillTerminalSessionEvidence({}, { limit })
      if (res.reason) {
        console.warn(`${tag} skipped: ${res.reason}`)
      } else if (res.frozen > 0 || res.failed > 0) {
        console.log(`${tag} scanned=${res.scanned} frozen=${res.frozen} already=${res.already} failed=${res.failed}`)
      }
    } catch (err) {
      console.warn(`${tag} ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running = false
    }
  }

  void (async () => {
    // Let boot traffic win first: the sweep is a backlog job, not a request
    // dependency — delaying it a few seconds costs nothing.
    await new Promise(resolve => setTimeout(resolve, 5_000))
    await sweep()
    // Periodic self-heal: gap (2) above closes on the next tick.
    setInterval(() => { void sweep() }, intervalMs)
  })()
})
