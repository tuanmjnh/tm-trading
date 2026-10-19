// GET /api/v1/news/sources — source registry + health (V3.5 §60 Slice B).
// Provider failure is visible here (health.state + lastError), so the News
// Desk can render degraded banners. No secrets: tokens are never stored.
import { listNewsSources } from '~~/server/utils/newsStore'

export default defineEventHandler(async () => {
  return listNewsSources()
})
