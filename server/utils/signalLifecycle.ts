// =============================================================================
//  Signal lifecycle transitions (S8 chunk 4) — server side.
//
//  The lifecycle is an ADDITIVE overlay over the immutable evidence. This module
//  is the ONLY place that writes `lifecycleStatus` / `lifecycleAt` /
//  `lifecycleNote`; the read paths (server/utils/signals.ts,
//  server/utils/nativeSignals.ts) apply the default at projection time so a
//  row that has never been touched still renders `active`.
//
//  The state machine is tiny on purpose: every transition is explicit and
//  auditable, and an expired/invalidated/superseded row can never move again.
//  All writes are owner-scoped (a foreign id resolves to null, never a leak).
// =============================================================================

import { Types } from 'mongoose'
import { engineModel } from './engineModel'
import { isSignalLifecycleStatus, SIGNAL_LIFECYCLE_TRANSITIONS, type SignalLifecycleStatus } from '#shared/utils/signalLifecycle'

export interface LifecycleTransition {
  status: string
  at: string
  note: string
}

export interface ApplyLifecycleResult {
  ok: boolean
  previous: string | null
  current: string
  at: string
}

function transitionDoc(q: Record<string, unknown>): LifecycleTransition {
  return {
    status: String(q.status ?? ''),
    at: q.at instanceof Date ? q.at.toISOString() : String(q.at ?? ''),
    note: String(q.note ?? '')
  }
}

/**
 * Apply a lifecycle transition to one stored signal (alerts or signals
 * collection). Owner-scoped; returns null when the row does not exist or
 * belongs to another owner. Throws 400 when the transition is not allowed
 * from the current state.
 */
export async function applySignalLifecycle(
  collection: 'alert' | 'signal',
  ownerId: string,
  id: string,
  q: Record<string, unknown>
): Promise<ApplyLifecycleResult | null> {
  if (!ownerId || !Types.ObjectId.isValid(id)) return null
  const Model = await engineModel(collection === 'alert' ? 'alert.mjs' : 'signal.mjs', collection === 'alert' ? 'Alert' : 'Signal')
  if (!Model) return null

  const next = String(q.status ?? '').toLowerCase()
  if (!isSignalLifecycleStatus(next)) {
    const err = new Error(`invalid lifecycle status: ${q.status ?? ''}`)
    ;(err as any).statusCode = 400
    throw err
  }

  const doc = await Model.findOne({ _id: new Types.ObjectId(id), ownerId }).lean()
  if (!doc) return null

  const current = String(doc.lifecycleStatus ?? 'active').toLowerCase()
  const allowed = (SIGNAL_LIFECYCLE_TRANSITIONS[current as SignalLifecycleStatus] ?? []) as string[]
  if (!allowed.includes(next)) {
    const err = new Error(`lifecycle transition ${current} -> ${next} is not allowed`)
    ;(err as any).statusCode = 400
    throw err
  }

  const at = q.at instanceof Date ? q.at : q.at ? new Date(String(q.at)) : new Date()
  const note = String(q.note ?? '')
  await Model.updateOne(
    { _id: new Types.ObjectId(id), ownerId },
    {
      $set: {
        lifecycleStatus: next,
        lifecycleAt: at,
        lifecycleNote: note,
        lifecycleHistory: Array.isArray(doc.lifecycleHistory)
          ? [...doc.lifecycleHistory, transitionDoc({ status: next, at, note })]
          : [transitionDoc({ status: next, at, note })]
      }
    }
  )

  return { ok: true, previous: current, current: next, at: at.toISOString() }
}

/**
 * Read the lifecycle history for one signal (owner-scoped). Null on a
 * foreign/unknown id. The history array is append-only and immutable.
 */
export async function getSignalLifecycleHistory(
  collection: 'alert' | 'signal',
  ownerId: string,
  id: string
): Promise<LifecycleTransition[] | null> {
  if (!ownerId || !Types.ObjectId.isValid(id)) return null
  const Model = await engineModel(collection === 'alert' ? 'alert.mjs' : 'signal.mjs', collection === 'alert' ? 'Alert' : 'Signal')
  if (!Model) return null
  try {
    const doc = await Model.findOne({ _id: new Types.ObjectId(id), ownerId })
      .select('lifecycleStatus lifecycleAt lifecycleHistory')
      .lean()
    if (!doc) return null
    return Array.isArray(doc.lifecycleHistory) ? doc.lifecycleHistory.map(transitionDoc) : []
  } catch {
    return null
  }
}