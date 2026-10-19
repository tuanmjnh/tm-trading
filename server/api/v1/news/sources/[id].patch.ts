// PATCH /api/v1/news/sources/:id — operator enable/disable (V3.5 §60.2).
// Body: { enabled: boolean }. Only the switch is writable here — policy,
// rights, tier and license stay seeder/operator-DB territory. Auth: hub token
// via the global guard (same as other write endpoints).
import { setNewsSourceEnabled } from '~~/server/utils/newsStore'

export default defineEventHandler(async (event) => {
  const id = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event).catch(() => ({}))
  return setNewsSourceEnabled(id, body.enabled)
})
