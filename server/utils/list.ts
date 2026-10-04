import { getQuery } from 'h3'

export interface ListParams {
  limit: number
  cursor?: string
}

/**
 * Read standard cursor-pagination query params: ?limit=&cursor=
 */
export function getListParams(event: Parameters<typeof getQuery>[0], defaultLimit = 20, maxLimit = 100): ListParams {
  const query = getQuery(event)
  const parsed = Number(query.limit)
  const limit = Math.min(Math.max(Number.isFinite(parsed) && parsed > 0 ? parsed : defaultLimit, 1), maxLimit)
  const cursor = query.cursor ? String(query.cursor) : undefined
  return { limit, cursor }
}

/**
 * Build the standard cursor list response: { success, data, nextCursor }
 */
export function cursorPage<T>(items: T[], limit: number, getCursor: (item: T) => string | number | null | undefined) {
  let data = items
  let nextCursor: string | number | null = null
  if (items.length > limit) {
    data = items.slice(0, limit)
    const last = data[data.length - 1]
    nextCursor = last === undefined ? null : (getCursor(last) ?? null)
  }
  return { data, nextCursor }
}
