// POST /api/v1/research/news-evaluations — news-impact scorecard (Slice E).
// Scores EXPIRED outlook snapshots vs subsequent price action with a
// persistence baseline. Body: { group, horizon, symbols[], asOfMs }.
import { runNewsScorecard } from '~~/server/utils/newsEvidence'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  return runNewsScorecard({
    ownerId: requireOwnerId(event),
    group: body.group ? String(body.group) : undefined,
    horizon: body.horizon ? String(body.horizon) : undefined,
    symbols: Array.isArray(body.symbols) ? body.symbols.map(String) : undefined,
    asOfMs: Number.isFinite(Number(body.asOfMs)) ? Number(body.asOfMs) : undefined,
  })
})
