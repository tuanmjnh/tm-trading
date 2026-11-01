// =============================================================================
//  TM TRADING — DRILL REGISTRY (fixtures for `npm run drills`)
//
//  The supervisor is only trustworthy if a real supervisor process, forking a
//  real worker process over real IPC, can prove the lifecycle contract on a
//  machine with no production services running.
//
//  These three definitions exercise the paths production cannot be made to
//  produce on demand:
//
//    drill-main   reports every readiness field the supervisor must accept
//                 (subscription ack, validated job, outbox consumption,
//                 market event). Without the worker-evidence channel this
//                 service could never become READY.
//    drill-quiet  subscription acknowledged but no market event for minutes:
//                 READY with a failed OPTIONAL freshness rule -> DEGRADED.
//    drill-crash  exits the process on request so crash detection, backoff and
//                 restart can be observed instead of assumed.
//
//  Loaded only through `TM_SUPERVISOR_REGISTRY`, never by production code.
// =============================================================================

import { READINESS_RULE_LABELS } from '../../../services/registry.mjs'

const req = id => ({ id, label: READINESS_RULE_LABELS[id], required: true })
const opt = id => ({ id, label: READINESS_RULE_LABELS[id], required: false })

/** Every fixture is one cycle of `tools/drills/fixtures/service.mjs`. */
const entry = 'tools/drills/fixtures/service.mjs'

export const SERVICES = Object.freeze([
  Object.freeze({
    id: 'drill-main',
    label: 'Drill — fully evidenced worker',
    category: 'platform',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry,
    runExport: 'runDrillCycle',
    outputCountKeys: ['count'],
    intervalSec: 1,
    startupGraceMs: 15_000,
    dependencies: [],
    readiness: [
      req('process-alive'),
      req('dependency-reachable'),
      req('subscription-acked'),
      req('recent-success'),
      req('validated-job'),
      req('outbox-consuming'),
      opt('fresh-event'),
      opt('output-produced'),
    ],
    supports: ['start', 'stop', 'restart', 'reset', 'run-once', 'probe'],
    supervised: true,
    planned: false,
  }),
  Object.freeze({
    id: 'drill-quiet',
    label: 'Drill — socket open, no data',
    category: 'platform',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry,
    runExport: 'runDrillCycle',
    outputCountKeys: ['count'],
    intervalSec: 1,
    startupGraceMs: 15_000,
    dependencies: [],
    // `fresh-event` is optional on purpose: a feed that subscribed but has not
    // ticked yet is DEGRADED, not FAILED (§17.4).
    readiness: [
      req('process-alive'),
      req('dependency-reachable'),
      req('subscription-acked'),
      req('recent-success'),
      opt('fresh-event'),
      opt('output-produced'),
    ],
    supports: ['start', 'stop', 'restart', 'reset', 'run-once', 'probe'],
    supervised: true,
    planned: false,
  }),
  Object.freeze({
    id: 'drill-crash',
    label: 'Drill — crash on request',
    category: 'platform',
    scope: 'system',
    executionMode: 'periodic',
    processGroup: 'intelligence',
    entry,
    runExport: 'runDrillCycle',
    outputCountKeys: ['count'],
    intervalSec: 1,
    startupGraceMs: 15_000,
    dependencies: [],
    readiness: [
      req('process-alive'),
      req('dependency-reachable'),
      req('recent-success'),
      opt('output-produced'),
    ],
    supports: ['start', 'stop', 'restart', 'reset', 'run-once', 'probe'],
    supervised: true,
    planned: false,
  }),
])

export default SERVICES