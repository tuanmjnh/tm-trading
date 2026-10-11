/**
 * Pure navigation-tree helpers shared by the sidebar composable and the route
 * middleware. Kept dependency-free (no Nuxt/i18n imports) so it can be unit
 * tested with plain Node and reused on the server.
 */

export interface NavNode {
  path: string
  name?: string | null
  label?: string | null
  icon?: string | null
  /** V3.3 §58.2: hidden routes are seeded with is_visible:false and must not surface. */
  isVisible?: boolean | null
  children?: NavNode[]
}

export interface SelectNavOptions<T extends NavNode> {
  /** Returns true when a path resolves to an actual local page. */
  hasLocalPage: (path?: string | null) => boolean
  /** Route names that must never appear (legacy name-based hide list). */
  hiddenNames?: Set<string>
}

function isHidden<T extends NavNode>(node: T, hiddenNames: Set<string>): boolean {
  if (node.isVisible === false) return true
  const name = node.name
  return !!name && hiddenNames.has(name)
}

/**
 * Recursively selects the menu tree:
 * - nodes with `isVisible === false` are dropped together with their subtree,
 * - nodes whose name is in `hiddenNames` are dropped,
 * - groups (nodes with children) survive only when at least one descendant survives,
 * - leaves survive only when `hasLocalPage(path)` is true.
 */
export function selectNavRoutes<T extends NavNode>(
  nodes: T[],
  options: SelectNavOptions<T>
): T[] {
  const hiddenNames = options.hiddenNames ?? new Set<string>()

  const walk = (list: NavNode[]): NavNode[] =>
    list.flatMap((node) => {
      if (isHidden(node, hiddenNames)) return []
      if (node.children && node.children.length > 0) {
        const children = walk(node.children)
        return children.length > 0 ? [{ ...node, children }] : []
      }
      return options.hasLocalPage(node.path) ? [node] : []
    })

  return walk(nodes) as T[]
}

/**
 * Flattens the tree into paths, skipping `isVisible === false` subtrees.
 * Used by the middleware so hidden routes behave as if they did not exist.
 */
export function flattenVisiblePaths(nodes: NavNode[]): string[] {
  const out: string[] = []
  const walk = (list: NavNode[]) => {
    for (const node of list) {
      if (node.isVisible === false) continue
      out.push(node.path)
      if (node.children && node.children.length > 0) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Route membership check: matches a URL path against a nav path using an exact
 * match, a `:param` pattern of equal segment length, or a path prefix.
 */
export function navAllows(navPath: string, urlPath: string): boolean {
  if (!navPath || navPath.startsWith('#')) return false
  if (navPath === '*') return true
  if (navPath === '/') return urlPath === '/'

  const navSegs = navPath.replace(/\/+$/, '').split('/')
  const urlSegs = urlPath.replace(/\/+$/, '').split('/')

  if (navSegs.length === urlSegs.length) {
    let ok = true
    for (let i = 0; i < navSegs.length; i++) {
      const seg = navSegs[i] ?? ''
      if (seg.startsWith(':') && seg.length > 1) continue
      if (seg !== (urlSegs[i] ?? '')) { ok = false; break }
    }
    if (ok) return true
  }

  const prefix = navPath.replace(/\/+$/, '')
  return urlPath === prefix || urlPath.startsWith(`${prefix}/`)
}

/** Builds the `hasLocalPage` predicate from a set of local route paths. */
export function createHasLocalPage(localPaths: Set<string>) {
  return (path?: string | null): boolean => {
    if (!path || path.startsWith('#')) return false
    if (path === '*') return true
    return localPaths.has(path.replace(/\/+$/, '') || '/')
  }
}
