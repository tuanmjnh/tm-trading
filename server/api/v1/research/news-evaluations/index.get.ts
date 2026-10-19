// GET /api/v1/research/news-evaluations — list scorecard runs (Slice E/F).
// ?group=&horizon=&limit=. Read-only, newest first.
import { engineModel } from '~~/server/utils/engineModel'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const NewsEvaluation = await engineModel('newsEvaluation.mjs', 'NewsEvaluation')
  if (!NewsEvaluation) {
    return { evaluations: [], meta: { mongo: 'down', total: 0 } }
  }
  const filter: Record<string, unknown> = { ownerId: requireOwnerId(event) }
  if (query.group) filter.group = String(query.group)
  if (query.horizon) filter.horizon = String(query.horizon)
  const limit = Math.max(1, Math.min(100, Number(query.limit || 20)))
  const [docs, total] = await Promise.all([
    NewsEvaluation.find(filter).sort({ asOf: -1 }).limit(limit).lean(),
    NewsEvaluation.countDocuments(filter),
  ])
  return { evaluations: docs, meta: { mongo: 'up', total } }
})
