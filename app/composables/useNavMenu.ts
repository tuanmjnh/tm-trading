import type { NavigationMenuItem } from '@nuxt/ui'
import type { RouteTreeNode } from '~/types/rbac'

export const useNavMenu = () => {
  const { t } = useI18n()
  const auth = useAuth()
  const { hubFetch } = useHub()

  const allowedRoutes = useState<RouteTreeNode[]>('nav:allowedRoutes', () => [])

  async function fetchRoutes(force = false, targetAppId?: string) {
    if (allowedRoutes.value.length > 0 && !force) return allowedRoutes.value
    if (!auth.isAuthenticated.value) return []

    try {
      const query = targetAppId ? `?appId=${encodeURIComponent(targetAppId)}` : ''
      const { data } = await hubFetch<{ success: boolean, data: RouteTreeNode[] }>(`/api/v1/auth/routes${query}`)
      allowedRoutes.value = data || []
    } catch {
      allowedRoutes.value = []
    }
    return allowedRoutes.value
  }

  function clearRoutes() {
    allowedRoutes.value = []
  }

  /**
   * Translate a route label (nav i18n key).
   * Tries `nav.<label>` first, then the label as a full i18n key,
   * falling back to the raw label (or name) when no translation exists.
   */
  const translateRouteLabel = (label?: string | null, name?: string | null): string => {
    const raw = String(label || name || '')
    if (!raw) return ''
    const candidates = raw.startsWith('nav.') ? [raw] : [`nav.${raw}`, raw]
    for (const key of candidates) {
      const translated = t(key)
      if (translated && translated !== key) return translated
    }
    return raw
  }

  const translateLabel = (node: RouteTreeNode): string => translateRouteLabel(node.label, node.name)

  function mapRouteToNav(node: RouteTreeNode, open: Ref<boolean>): NavigationMenuItem {
    const label = translateLabel(node)

    if (node.children?.length) {
      return {
        label,
        icon: node.icon || 'i-lucide-folder',
        defaultOpen: true,
        type: 'trigger',
        children: node.children.map((child: RouteTreeNode) => mapRouteToNav(child, open))
      }
    }

    return {
      label,
      icon: node.icon || 'i-lucide-circle',
      to: node.path,
      onSelect: () => { open.value = false }
    }
  }

  function buildNavItems(open: Ref<boolean>): NavigationMenuItem[] {
    const router = useRouter()
    // Batch 4 (hub-route cleanup): hub's route tree still advertises hub-domain pages
    // (admin/apps, resources/*, ...) whose local files were deleted. Only surface nodes
    // that resolve to an actual local page so the menu never links to a 404.
    // Groups (nodes with children) are kept when at least one descendant survives —
    // a group's own path (e.g. "/admin") often has no page of its own.
    const localPaths = new Set(router.getRoutes().map(r => r.path.replace(/\/+$/, '') || '/'))
    const hasLocalPage = (p?: string | null): boolean => {
      if (!p || p.startsWith('#')) return false
      if (p === '*') return true
      return localPaths.has(p.replace(/\/+$/, '') || '/')
    }
    const filterLocal = (nodes: RouteTreeNode[]): RouteTreeNode[] =>
      nodes.flatMap((n) => {
        if (n.children?.length) {
          const kids = filterLocal(n.children)
          return kids.length > 0 ? [{ ...n, children: kids }] : []
        }
        return hasLocalPage(n.path) ? [n] : []
      })

    const hidden = new Set(['settings'])
    return filterLocal(allowedRoutes.value)
      .filter((node: RouteTreeNode) => !hidden.has(node.name) && node.isVisible !== false)
      .map((node: RouteTreeNode) => mapRouteToNav(node, open))
  }

  return {
    allowedRoutes: readonly(allowedRoutes),
    fetchRoutes,
    clearRoutes,
    buildNavItems,
    translateRouteLabel
  }
}
