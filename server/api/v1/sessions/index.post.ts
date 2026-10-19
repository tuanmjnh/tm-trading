import { readBody } from 'h3'
import { sessionsHttpError, startSession } from '../../../utils/sessions'

// =============================================================================
//  POST /api/v1/sessions — start a trading session (Slice C).
//
//  Body: { kind?, strategyVersionId?, botProfileId?, accountId?,
//  instruments?, timeframes?, manifest?, restartedFrom?, createdBy? }.
//  The doc is guard-built (engine/session.mjs) and persisted once under its
//  D3 id. 400 on bad input, 409 on duplicate id, 503 when the store is down.
//  Token required (D10) — WRITE endpoint. A human (or an approved workflow)
//  starts sessions; nothing auto-starts (D7).
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw sessionsHttpError(new Error('body must be an object'))
  }
  try {
    const data = await startSession({
      ownerId: requireOwnerId(event),
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      strategyVersionId: typeof body.strategyVersionId === 'string' ? body.strategyVersionId : null,
      botProfileId: typeof body.botProfileId === 'string' ? body.botProfileId : null,
      accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      instruments: Array.isArray(body.instruments) ? body.instruments.map(String) : undefined,
      timeframes: Array.isArray(body.timeframes) ? body.timeframes.map(String) : undefined,
      manifest: body.manifest && typeof body.manifest === 'object' && !Array.isArray(body.manifest)
        ? body.manifest as Record<string, unknown>
        : null,
      restartedFrom: typeof body.restartedFrom === 'string' ? body.restartedFrom : null,
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : null
    })
    return { success: true, data }
  } catch (err) {
    throw sessionsHttpError(err)
  }
})
