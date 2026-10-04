import type { SystemRoute } from '../../types'

export function buildRouteTree(flatRoutes: SystemRoute[]): SystemRoute[] {
  const map = new Map<string, SystemRoute>()
  const roots: SystemRoute[] = []

  const sorted = [...flatRoutes].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))

  for (const item of sorted) {
    map.set(item.id, { ...item, children: [] })
  }

  for (const item of sorted) {
    const current = map.get(item.id)!
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(current)
    } else {
      roots.push(current)
    }
  }

  return roots
}
