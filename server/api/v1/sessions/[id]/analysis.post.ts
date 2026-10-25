import { getRouterParam, readBody } from 'h3'
import { analyzeSession, sessionAnalysisHttpError } from '../../../../utils/sessionAnalysis'

// =============================================================================
//  POST /api/v1/sessions/:id/analysis — AI analysis of a COMPLETED session.
//
//  Requires a sealed session with a FROZEN evidence set; returns an experiment
//  DRAFT that cites actual record ids from the evidence graph. The draft is
//  recorded as an `ai_proposals` row (status `new`) — it does not create an
//  experiment and cannot touch the active strategy (Phase F).
//
//  Body: { focus?: string, persist?: boolean } — `persist:false` is a dry run.
// =============================================================================

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') ?? '').trim()
  const body = (await readBody(event).catch(() => null)) as Record<string, unknown> | null
  try {
    const data = await analyzeSession(
      id,
      {
        focus: typeof body?.focus === 'string' ? body.focus : null,
        persist: body?.persist !== false,
      },
      {},
      requireOwnerId(event)
    )
    return { success: true, data }
  } catch (err) {
    throw sessionAnalysisHttpError(err)
  }
})
