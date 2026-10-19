import { readBody } from 'h3'
import { startTestRun, testRunHttpError } from '~~/server/utils/testRuns'

// =============================================================================
//  POST /api/v1/runs — launch a backtest from the Test Builder (§58.9 Slice 3).
//
//  Body: { method?, symbol, tf, market?, limit?, preset?, params?, refresh? }
//  Runs the engine backtest through engine/run.mjs runOne, which persists the
//  run (D1 stamp: engineVersion/paramsHash/dataHash/gitRev) into reports/*.ndjson
//  and the `runs` collection. Returns the identity so the UI can deep-link into
//  Historical Runs. Validation -> 400; engine/network failure -> 502.
//
//  Token do tm-hub cap bat buoc (server/middleware/auth.ts) — route nay KHONG
//  nam trong PUBLIC_PATHS.
// =============================================================================

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  try {
    return { success: true, data: await startTestRun(body, {}, requireOwnerId(event)) }
  } catch (err) {
    throw testRunHttpError(err)
  }
})
