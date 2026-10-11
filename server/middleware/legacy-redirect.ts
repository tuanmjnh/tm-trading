// =============================================================================
//  Legacy route redirects (V3.3 §58.2 route re-home).
//
//  Applies the redirect table from `server/utils/legacy-redirect.ts` with a 301,
//  preserving any sub-path (dynamic ids) and the query string. Implemented as
//  Nitro middleware rather than `routeRules.redirect` because route rules cannot
//  re-emit a captured dynamic segment (e.g. `/runs/:id`). See docs/navigation-audit.md.
// =============================================================================

import { matchLegacy } from '../utils/legacy-redirect'

export default defineEventHandler((event) => {
  const method = event.method
  if (method !== 'GET' && method !== 'HEAD') return

  const url = getRequestURL(event)
  const path = url.pathname

  // Never touch API, build assets, or files with an extension.
  if (path.startsWith('/api/') || path.startsWith('/_nuxt') || path.startsWith('/__nuxt')) return
  if (/\.[a-z0-9]+$/i.test(path)) return

  const match = matchLegacy(path)
  if (!match) return

  return sendRedirect(event, `${match.to}${match.rest}${url.search}`, 301)
})
