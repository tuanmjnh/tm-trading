import { getRouterParam, readBody } from 'h3'
import { moveSession, sessionsHttpError } from '../../../../utils/sessions'
import {
  autoFreezeSessionEvidence,
  AUTO_FREEZE_SESSION_STATES,
  type AutoFreezeResult
} from '../../../../utils/evidenceSets'

// =============================================================================
//  POST /api/v1/sessions/:id/move — advance the session lifecycle one legal
//  step. Body: { to: <state> }.
//
//  The engine's transition() refuses every illegal jump, so a client cannot
//  skip stages or reopen a terminal state. Fail-soft mapping: bad body -> 400,
//  unknown session -> 404, illegal transition -> 409, store down -> 503.
//  A human drives the state machine (D7).
//
//  Auto-freeze (§59.15): the moment a session ENTERS a terminal state its
//  evidence is frozen, so an AI proposal always has a citable set. This lives
//  here (the HTTP seam) not in utils/sessions.ts, which would create an import
//  cycle — evidenceSets already imports startSession from sessions. It is
//  fail-soft: an evidence failure never rolls back an already-sealed session.
// =============================================================================

interface MoveBody {
  to?: unknown
}

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw sessionsHttpError(new Error('session id is required'))
  }

  const body = (await readBody(event).catch(() => null)) as MoveBody | null
  const to = String(body?.to ?? '').trim()
  if (!to) {
    throw sessionsHttpError(new Error('to is required'))
  }

  try {
    const data = await moveSession(id, to, requireOwnerId(event))

    // Freeze evidence on entry into a terminal state. Fail-soft (never throws):
    // the session is already sealed, and a frozen set can still be made later
    // via the manual Freeze button.
    let autoFreeze: AutoFreezeResult | undefined
    if (AUTO_FREEZE_SESSION_STATES.includes(to)) {
      autoFreeze = await autoFreezeSessionEvidence(data)
    }

    return { success: true, data, ...(autoFreeze ? { autoFreeze } : {}) }
  } catch (err) {
    throw sessionsHttpError(err)
  }
})
