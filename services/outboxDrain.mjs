// =============================================================================
//  TM TRADING — OUTBOX DRAIN TICK (V4.2 §7.3)
//
//  The delivery outbox is durable, but nothing retries it unless someone looks.
//  `alertRules` drains as a side effect of its own cycle, which couples delivery
//  freshness to rule evaluation cadence — a service that stops evaluating rules
//  also stops draining. This tick is the dedicated consumer: every interval it
//  sweeps whatever is due and reports the timestamp it last looked, which is the
//  evidence behind the registry's optional `outbox-consuming` readiness rule.
//
//  Zero-arg contract: `run.mjs runOne` calls `s.run()` with no arguments and
//  stringifies the return into the heartbeat (`lastSummary`, 500-char cap), so
//  this module is self-contained — it resolves its own models and never reaches
//  for a caller-supplied clock.
//
//  Fail-soft (D33): a Mongo outage is reported as `mongo: 'down'`, never thrown.
//  A drain failure is a service error and is auto-notified by run.mjs via the
//  durable `notify()` path on `service.error.outbox-drain`.
// =============================================================================
import { drainOutbox, enqueueNotification } from '../notify/outboxDriver.mjs'

export const OUTBOX_DRAIN_VERSION = 'outbox-drain.v1'

/**
 * One drain sweep. Returns a summary the supervisor + heartbeat can both digest:
 *
 *   attempted / accepted / sent / dead   what the sweep did (see drainOutbox)
 *   mongo                                'up' | 'down' — drives the
 *                                        `dependenciesReachable` probe
 *   evidence.outboxLastConsumedAt        the timestamp the `outbox-consuming`
 *                                        readiness rule asks for
 *
 * `evidence` is always present, even when nothing was due: "I looked, the queue
 * was empty" is the evidence the readiness rule needs, and a dead consumer
 * would stop reporting it.
 *
 * @returns {Promise<object>}
 */
export async function runOutboxDrain() {
  const at = Date.now()
  let mongo = 'down'
  let attempted = 0
  let accepted = 0
  let sent = 0
  let dead = 0

  try {
    const res = await drainOutbox({ now: () => at })
    attempted = Number(res?.attempted) || 0
    accepted = Number(res?.accepted) || 0
    sent = Number(res?.sent) || 0
    dead = Number(res?.dead) || 0
    mongo = 'up'
  } catch (e) {
    return {
      attempted: 0,
      accepted: 0,
      sent: 0,
      dead: 0,
      mongo: 'down',
      error: String(e?.message || e).slice(0, 300),
      evidence: { outboxLastConsumedAt: at },
    }
  }

  return {
    attempted,
    accepted,
    sent,
    dead,
    mongo,
    evidence: { outboxLastConsumedAt: at },
  }
}